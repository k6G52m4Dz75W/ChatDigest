#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ChatDigest / 聊摘 — 本地 IMA 导入助手（官方 OpenAPI 版）

把 Tampermonkey 导出的 .md 通过 IMA 官方 OpenAPI 直接上传到你的知识库，
不经过任何第三方 CLI（不依赖 ima-cli / oo）。真正的上传由同目录的
ima_upload.py（官方 OpenAPI + 腾讯云 COS）完成。

所有上传均经 ima_upload.upload_file_to_kb 串行+节流地执行（进程内锁 + 默认
1.5s 最小间隔，可用 --min-interval 调整），以平滑请求节奏、降低目录监视模式
下批量落盘时被账号风控/限流的风险。节流逻辑统一收口在 ima_upload.py。

两种运行模式：

1) 目录监视模式（默认）
   监听指定目录，当出现新的 .md 文件（由 Tampermonkey 脚本下载），
   自动上传到指定知识库。
   用法:
       pip install -r tools/requirements.txt（仅目录监视模式需要 watchdog；HTTP 桥模式 --serve 不需要）
       python ima_watcher.py "C:/Users/你/Downloads" --kb-id "你的知识库ID"
       # --kb-id 可省略（自动读同目录 ima_config.ini 的 KB_ID）
       # 目录参数也可省略（读 ima_config.ini 的 SRC，仍无则默认 %USERPROFILE%\\Downloads；Mac / Linux 等价 ~/Downloads）

2) HTTP 桥模式（--serve）
   启动一个本地 HTTP 服务（默认 127.0.0.1:8765），接收 ChatDigest
   用户脚本推送过来的 Markdown，写入目录后再上传到 IMA。
   用法:
       python ima_watcher.py --serve --kb-id "你的知识库ID" --port 8765
       # --kb-id 可省略（自动读同目录 ima_config.ini 的 KB_ID）
   脚本侧需将 chatdigest.user.js 顶部的 AUTO_PUSH_IMA 改为 true，
   并保持 IMA_ENDPOINT 指向同一地址。

前置（一次性）：
   - 在 https://ima.qq.com/agent-interface 免费申请 Client ID / API Key，
     配成环境变量 IMA_CLIENT_ID / IMA_API_KEY，
     或用文件 %USERPROFILE%\\.config\\ima\\{IMA_CLIENT_ID,IMA_API_KEY}
     （Mac / Linux 等价：~/.config/ima/... 或 $HOME/.config/ima/...）。
   - 知识库 ID：在 ima.qq.com 知识库设置里查看。
"""

import argparse
import json
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

# 让同目录下的 ima_upload 可导入（无论从哪个 cwd 启动）
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ima_upload  # noqa: E402

DEFAULT_PORT = 8765

# 文件名清洗规则（与 chatdigest.user.js 的 sanitizeTitle 严格对齐）。
#
# userscript 端 sanitizeTitle 用 [\\/:*?"<>|\n\r\t#] 黑名单；bridge 落盘
# 阶段原本用 isalnum + '._- ' 白名单，' + ' 不在白名单 → ' + ' 被替换为 '_'，
# 跟 userscript 下载到 Downloads/ 的文件名不一致。改为同一份黑名单：
_FILENAME_UNSAFE_RE = re.compile(r'[\\/*?:"<>|\n\r\t#]')

# ---------------------------------------------------------------------------
# HTTP 接收端限流（v1.2.5 新增）
# ---------------------------------------------------------------------------
# 与 ima_upload.upload_file_to_kb 的「上传节流」职责独立、互补：
#   - 上传节流：管出去（上传到 IMA 时的 1.5s 间隔，防 IMA 风控）
#   - HTTP 限流：管进来（/ingest 接收端的 IP 限流，防客户端灌入）
#
# 自用场景（127.0.0.1 监听、攻击面小）但仍加这层保护：
# 1. 防止 watcher 自己的循环 bug 把同一文件反复 ingest
# 2. 防止未来加了多 tab 抓取时不小心刷爆 ingest
# 3. 防止恶意 tab 灌入垃圾
_RATE_LIMIT_PER_MIN = 30     # 每个 client_ip 1 分钟内最多 30 次推送
_rate_buckets: dict = {}     # {client_ip: [t1, t2, ...]} monotonic 时间戳列表
_rate_lock = threading.Lock() # 多线程并发请求时保护 _rate_buckets


def _check_rate_limit(client_ip: str, now: float, buckets: dict,
                      limit: int = 30, window_s: float = 60.0) -> bool:
    """滑动窗口限流：1 个 client_ip 在 window_s 秒内最多 limit 次推送。
    超限返回 False（caller 应返回 HTTP 429）。纯函数，便于测试。

    参数全部显式传入（无 module-level 副作用），让单元测试可独立控制
    now / buckets / limit / window_s；生产用 _check_rate_limit_thread_safe
    包装，加锁 + 默认参数。
    """
    cutoff = now - window_s
    bucket = [t for t in buckets.get(client_ip, []) if t > cutoff]
    if len(bucket) >= limit:
        buckets[client_ip] = bucket
        return False
    bucket.append(now)
    buckets[client_ip] = bucket
    return True


def _check_rate_limit_thread_safe(client_ip: str) -> bool:
    """线程安全版本：进程内锁 + 默认参数 + 当前 monotonic 时间。
    生产环境用这个；测试用 _check_rate_limit 纯函数版。"""
    with _rate_lock:
        return _check_rate_limit(
            client_ip, time.monotonic(), _rate_buckets,
            limit=_RATE_LIMIT_PER_MIN, window_s=60.0,
        )
DEFAULT_WATCH_DIR = os.path.join(os.path.expanduser('~'), 'Downloads')


def import_to_kb(path: str, kb_id: str):
    """把本地 .md 文件上传到指定知识库（官方 OpenAPI）。

    直接委托 ima_upload.upload_file_to_kb——串行+节流逻辑已统一收口在
    该函数的「进程内」锁与最小间隔中，本模块不再重复实现，保证单一管线。
    """
    return ima_upload.upload_file_to_kb(path, kb_id)


def ingest_content(content: str, filename: str, watch_dir: str, kb_id: str) -> bool:
    """把推送来的 Markdown 内容落盘到 watch_dir，再上传到知识库。"""
    os.makedirs(watch_dir, exist_ok=True)
    safe = _FILENAME_UNSAFE_RE.sub('_', filename) or 'note.md'
    if not safe.lower().endswith('.md'):
        safe += '.md'
    path = os.path.join(watch_dir, safe)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"[INGEST] 已落盘: {path}")
    return import_to_kb(path, kb_id)


def run_watch_mode(watch_dir: str, kb_id: str):
    # 目录监视依赖 watchdog；HTTP 桥模式（--serve）不依赖它，所以 bridge 能跑
    # 而 monitor 崩，最常见的根因就是「跑 monitor 的那个 Python 没装 watchdog」。
    # 这里把 ImportError 转成清晰、可执行的报错，而不是抛一串看不懂的 traceback。
    try:
        from watchdog.observers import Observer
        from watchdog.events import FileSystemEventHandler
    except ImportError:
        sys.stderr.write(
            "[ERR] 缺少依赖 watchdog —— 目录监视模式必需，但 HTTP 桥模式 --serve 不需要，\n"
            "     所以 bridge 能起、monitor 一启动就退。请用与本脚本相同的 Python 安装：\n"
            f"         {sys.executable} -m pip install watchdog\n"
        )
        sys.exit(2)

    class Handler(FileSystemEventHandler):
        # 浏览器下载是「原子保存」：先写 note.md.part / .crdownload 临时文件，
        # 写完再改名为 note.md。最终 .md 的出现是 on_moved 事件，故必须同时
        # 监听 on_created（直接落 .md 的场景）与 on_moved（改名落 .md 的场景），
        # 否则会出现「文件明明在 Downloads 里、watcher 却毫无反应」。
        _TEMP_SUFFIXES = ('.part', '.crdownload', '.tmp')

        def _maybe_ingest(self, path: str):
            low = path.lower()
            if low.endswith(self._TEMP_SUFFIXES):
                return  # 浏览器下载的半成品，跳过
            if not low.endswith('.md'):
                return
            time.sleep(0.5)  # 等文件写完（保险）
            print(f"[WATCH] 检测到 .md: {path}")
            # 关键：单文件处理失败绝不能拖垮整个监视器。watchdog 在工作线程里跑回调，
            # 未捕获异常（含 load_credentials/assert_kb_writable 抛的 SystemExit）会被
            # 静默吞掉——既看不到报错，上传也悄悄失败。这里显式接住并继续监视。
            try:
                ok = import_to_kb(path, kb_id)
                if ok:
                    print(f"[OK] 处理完成: {path}")
                else:
                    print(f"[WARN] 处理未成功（已跳过，监视继续）: {path}")
            except SystemExit as e:
                print(f"[ERR] 处理失败（已跳过，监视继续）: {path}\n    {e}")
            except Exception as e:  # noqa: BLE001
                print(f"[ERR] 处理异常（已跳过，监视继续）: {path}\n    {type(e).__name__}: {e}")

        def on_created(self, event):
            if event.is_directory:
                return
            self._maybe_ingest(event.src_path)

        def on_moved(self, event):
            if event.is_directory:
                return
            self._maybe_ingest(event.dest_path)

    os.makedirs(watch_dir, exist_ok=True)
    try:
        observer = Observer()
        observer.schedule(Handler(), watch_dir, recursive=False)
        observer.start()
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"[ERR] 无法启动目录监视（目录 {watch_dir}）：{type(e).__name__}: {e}\n")
        sys.exit(2)
    print(f"[START] 目录监视: {watch_dir}  (知识库 ID: {kb_id})")
    print("[INFO]  Ctrl+C 退出")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


class C2KServer(HTTPServer):
    """HTTPServer 子类，注入 watch_dir / kb_id 给 handler 读。

    v1.2.7 改（P3.15：immutable modules 内部状态被外部修改）：
    之前是 `httpd._c2k = {...}` 私有属性 hack——类型系统不识别、
    BaseHTTPRequestHandler 拿不到正经 API。改成显式子类，c2k_config
    是公开 attribute，IDE 跳转、mypy、阅读都更顺。
    """
    def __init__(self, addr, handler_cls, watch_dir: str, kb_id: str):
        super().__init__(addr, handler_cls)
        self.c2k_config = {'watch_dir': watch_dir, 'kb_id': kb_id}


class IngestHandler(BaseHTTPRequestHandler):
    # v1.2.7 改：之前是 self.server._c2k（私有属性），现在走 C2KServer 公开 attribute
    def _app(self):
        return self.server.c2k_config

    def do_GET(self):
        if urlparse(self.path).path in ('/', '/health'):
            self._send_json(200, {'ok': True, 'mode': 'ima-ingest'})
        else:
            self._send_json(404, {'ok': False, 'error': 'not found'})

    def do_POST(self):
        if urlparse(self.path).path != '/ingest':
            self._send_json(404, {'ok': False, 'error': 'not found'})
            return
        # v1.2.5 新增：HTTP 接收端限流（防恶意/异常客户端灌入）
        # 注意：放在 url 校验之后、JSON 解析之前——无效 URL 不消耗配额，
        # 但无效 JSON 也消耗（避免恶意用 400 探测打满 bucket）
        client_ip = self.client_address[0]
        if not _check_rate_limit_thread_safe(client_ip):
            print(f"[RATELIMIT] {client_ip} hit {_RATE_LIMIT_PER_MIN}/min limit, returning 429")
            self._send_json(429, {'ok': False, 'error': f'rate limit exceeded ({_RATE_LIMIT_PER_MIN}/min)'})
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
            raw = self.rfile.read(length) if length else b''
            data = json.loads(raw or b'{}')
        except Exception as e:  # noqa: BLE001
            self._send_json(400, {'ok': False, 'error': f'bad request: {e}'})
            return

        content = data.get('content', '')
        filename = data.get('filename', 'note.md')
        if not content.strip():
            self._send_json(400, {'ok': False, 'error': 'empty content'})
            return

        cfg = self._app()
        # 与 watch 模式一致：单文件处理失败（load_credentials 抛 SystemExit /
        # assert_kb_writable 抛 SystemExit / 网络异常）不能拖垮整个 watcher；
        # 显式接住并返回 5xx，让客户端从 toast 看到具体错误原因。
        try:
            ok = ingest_content(content, filename, cfg['watch_dir'], cfg['kb_id'])
            self._send_json(200 if ok else 502, {'ok': ok})
        except SystemExit as e:
            print(f"[ERR] HTTP ingest failed (SystemExit, watcher keeps running): {e}")
            self._send_json(500, {'ok': False, 'error': str(e) or 'SystemExit'})
        except Exception as e:  # noqa: BLE001
            print(f"[ERR] HTTP ingest failed (watcher keeps running): {type(e).__name__}: {e}")
            self._send_json(500, {'ok': False, 'error': f'{type(e).__name__}: {e}'})

    def _send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # 安静日志
        pass


def run_serve_mode(watch_dir: str, kb_id: str, port: int):
    os.makedirs(watch_dir, exist_ok=True)
    httpd = C2KServer(('127.0.0.1', port), IngestHandler,
                      watch_dir=watch_dir, kb_id=kb_id)
    print(f"[START] HTTP 桥: http://127.0.0.1:{port}/ingest  (知识库 ID: {kb_id}, 落盘目录: {watch_dir})")
    print("[INFO]  Ctrl+C 退出")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.shutdown()


def main():
    cfg = ima_upload.load_local_config()
    ap = argparse.ArgumentParser(description="ChatDigest / 聊摘 本地 IMA 导入助手（官方 OpenAPI）")
    ap.add_argument("watch_dir", nargs='?', default=cfg.get("SRC") or DEFAULT_WATCH_DIR,
                    help="监听/落盘目录，例如 C:\\Users\\你\\Downloads（省略时读 ima_config.ini 的 SRC，仍无则默认 %%USERPROFILE%%\\Downloads；Mac / Linux 等价 ~/Downloads）")
    ap.add_argument("--kb-id", default=cfg.get("KB_ID") or None,
                    help="目标知识库 ID（ima.qq.com 知识库设置里查看）；省略时读取同目录 ima_config.ini 的 KB_ID")
    ap.add_argument("--serve", action="store_true", help="以 HTTP 桥模式运行（接收脚本推送）")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT, help="HTTP 桥端口（仅 --serve）")
    ap.add_argument("--min-interval", type=float, default=1.5,
                    help="两次上传之间的最小间隔（秒），默认 1.5；用于平滑请求、降低被限流风险")
    ap.add_argument("--version", action="version", version=f"ima_watcher {ima_upload.IMATOOLS_VERSION}")
    args = ap.parse_args()

    # 节流间隔统一由 ima_upload.upload_file_to_kb 的进程内锁负责，
    # 这里只是把 --min-interval 透传给它。
    # v1.2.7 改：走 ima_upload.set_min_interval() 公开 setter，替代
    # 之前 ima_upload._MIN_INTERVAL = ... 私有变量直接赋值。
    ima_upload.set_min_interval(args.min_interval)

    if not args.kb_id:
        ap.error("缺少 --kb-id，且 ima_config.ini 未配置 KB_ID。"
                 "请在 ima_config.ini 填写 KB_ID，或用 --kb-id 显式指定。")

    if args.serve:
        run_serve_mode(args.watch_dir, args.kb_id, args.port)
    else:
        run_watch_mode(args.watch_dir, args.kb_id)


if __name__ == '__main__':
    main()
