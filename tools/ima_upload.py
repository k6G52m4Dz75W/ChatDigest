#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ima_upload.py — 通过 IMA 官方 OpenAPI 把本地文件上传到知识库（纯官方、无第三方 CLI）

完全官方、不依赖 ima-cli / oo 等任何第三方封装：
  1. POST /openapi/wiki/v1/create_media  → 拿 media_id + 腾讯云 COS 临时凭证
  2. 用临时凭证把文件 PUT 到 COS
  3. POST /openapi/wiki/v1/add_knowledge → 文件正式进库

鉴权：每个请求带两个请求头 ima-openapi-clientid / ima-openapi-apikey。
凭证读取优先级：环境变量 IMA_CLIENT_ID / IMA_API_KEY
                → 文件 %USERPROFILE%\\.config\\ima\\{IMA_CLIENT_ID,IMA_API_KEY}
                  （Mac / Linux 等价：~/.config/ima/... 或 $HOME/.config/ima/...）

依赖：见同目录 requirements.txt
（cos-python-sdk-v5 是腾讯云官方 COS SDK，仅上传文件时用到）

用法:
  python ima_upload.py --kb-id <知识库ID> --file ./xxx.md
  python ima_upload.py --kb-id <ID> --file ./xxx.md --title "自定义标题"
  python ima_upload.py --kb-id <ID> --file ./xxx.md --folder-id <文件夹ID>
  # --kb-id 可省略：省略时自动读取同目录 ima_config.ini 的 KB_ID（手动传参优先覆盖）
  # 所有上传均经内部串行+节流（默认间隔 1.5s，--min-interval 可调），平滑请求节奏

凭证申请：https://ima.qq.com/agent-interface （免费，每人 1G）
知识库 ID：在 ima.qq.com 知识库设置里查看（形如 base64 的长串）
写入前会自动调用 get_addable_knowledge_base_list 校验该库可写，不可写会明确报错并列出可选项。
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import threading
import time

import requests

BASE = "https://ima.qq.com/openapi/wiki/v1"
MEDIA_TYPE_MARKDOWN = 7  # 官方 media_type 枚举：1=PDF 5=Excel 7=Markdown 11=笔记 2=网页

# IMA 导入工具链版本（与 ima_watcher.py 共用，通过 ima_upload.IMATOOLS_VERSION 读取）
IMATOOLS_VERSION = "1.2.8"


# --------------------------------------------------------------------------
# 凭证
# --------------------------------------------------------------------------
def load_credentials() -> tuple[str, str]:
    """返回 (client_id, api_key)，缺失则直接报错退出。"""
    client_id = os.environ.get("IMA_CLIENT_ID") or _read_file("~/.config/ima/IMA_CLIENT_ID")
    api_key = os.environ.get("IMA_API_KEY") or _read_file("~/.config/ima/IMA_API_KEY")
    if not client_id or not api_key:
        raise SystemExit(
            "[ERR] 缺少 IMA 凭证。请二选一配置：\n"
            "  环境变量:\n"
            "    export IMA_CLIENT_ID=<你的 Client ID>      # Mac / Linux\n"
            "    export IMA_API_KEY=<你的 API Key>\n"
            "    set    IMA_CLIENT_ID=<你的 Client ID>      # Windows (CMD)\n"
            "    set    IMA_API_KEY=<你的 API Key>\n"
            "  或文件（Windows CMD，%USERPROFILE% = 用户主目录）:\n"
            "    echo <id>  > \"%USERPROFILE%\\.config\\ima\\IMA_CLIENT_ID\"\n"
            "    echo <key> > \"%USERPROFILE%\\.config\\ima\\IMA_API_KEY\"\n"
            "    # Mac / Linux 终端可简写为：\n"
            "    #   echo <id>  > ~/.config/ima/IMA_CLIENT_ID\n"
            "    #   echo <key> > ~/.config/ima/IMA_API_KEY\n"
            "凭证在 https://ima.qq.com/agent-interface 免费申请（Key 仅显示一次）。"
        )
    return client_id, api_key


def _read_file(p: str) -> str | None:
    try:
        with open(os.path.expanduser(p), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return None


def load_local_config(path: str | None = None) -> dict[str, str]:
    """读取与 bat 共用的 ima_config.ini（默认位于本脚本同目录），返回 {KEY: value}。

    解析规则（与 ima_upload.bat 完全一致，兼容等号前后空格、值内空格）：
      - 跳过空行与注释（以 ; 或 # 开头）
      - 以第一个 = 切分 key/value，两者去首尾空格
      - key 统一大写，便于大小写不敏感匹配
    文件不存在或解析失败返回空 dict（不抛错，由调用方决定兜底行为）。
    可用键：KB_ID（必填知识库 ID）、SRC（默认来源/监视目录）、PY（仅 bat 用，Python 程序忽略）。
    """
    if path is None:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ima_config.ini")
    cfg: dict[str, str] = {}
    try:
        with open(path, encoding="utf-8") as f:
            for raw in f:
                s = raw.strip()
                if not s or s.startswith(";") or s.startswith("#"):
                    continue
                if "=" not in s:
                    continue
                key, val = s.split("=", 1)
                cfg[key.strip().upper()] = val.strip()
    except OSError:
        return {}
    return cfg


def _headers() -> dict[str, str]:
    cid, key = load_credentials()
    return {
        "ima-openapi-clientid": cid,
        "ima-openapi-apikey": key,
        "Content-Type": "application/json",
    }


# --------------------------------------------------------------------------
# OpenAPI 调用
# --------------------------------------------------------------------------
def create_media(
    path: str,
    kb_id: str,
    media_type: int | None = None,
    file_name: str | None = None,
) -> tuple[str, dict]:
    """
    第一步：申报文件，拿 media_id + COS 临时凭证。
    官方文档的 create_media 入参为 file_name/file_size/content_type/
    knowledge_base_id/file_ext；media_type 为可选（部分版本 API 要求，
    若服务端报缺参，可在调用处补 media_type=<对应枚举值>）。
    file_name 默认取文件名；上传前已由调用方统一规范为「标题.md」
    （与 add_knowledge 的 title 完全一致，符合 IMA 硬性规则）。
    """
    if file_name is None:
        file_name = os.path.basename(path)
    payload = {
        "file_name": file_name,
        "file_size": os.path.getsize(path),
        "content_type": "text/markdown",
        "knowledge_base_id": kb_id,
        "file_ext": "md",
    }
    if media_type is not None:
        payload["media_type"] = media_type
    r = requests.post(f"{BASE}/create_media", headers=_headers(), json=payload, timeout=30)
    data = _unwrap(r)
    return data["media_id"], data["cos_credential"]


def add_knowledge(
    media_id: str,
    title: str,
    kb_id: str,
    folder_id: str | None = None,
) -> dict:
    """第三步：把已上传 COS 的文件正式加入知识库。"""
    payload = {
        "media_type": MEDIA_TYPE_MARKDOWN,
        "media_id": media_id,
        "title": title,
        "knowledge_base_id": kb_id,
    }
    if folder_id:
        payload["folder_id"] = folder_id
    r = requests.post(f"{BASE}/add_knowledge", headers=_headers(), json=payload, timeout=30)
    return _unwrap(r)


def _unwrap(r: requests.Response) -> dict:
    """解析官方响应：可能包裹在 {code,msg,data} 里，也可能直接是数据。"""
    r.raise_for_status()
    body = r.json()
    code = body.get("code", 0)
    if code != 0:
        raise SystemExit(f"[ERR] IMA API 返回错误: code={code} msg={body.get('msg')}")
    return body.get("data", body)


def get_addable_knowledge_base_list() -> tuple[set[str], list[tuple[str, str]]]:
    """返回当前账号「可写入（添加内容）」的所有知识库。

    调用官方 get_addable_knowledge_base_list，分页拉全，返回
    (id_set, [(id, name), ...])。这是判断某个 kb_id 能否作为写入目标的权威来源。
    """
    ids: set[str] = set()
    infos: list[tuple[str, str]] = []
    cursor = ""
    while True:
        r = requests.post(
            f"{BASE}/get_addable_knowledge_base_list",
            headers=_headers(),
            json={"cursor": cursor, "limit": 50},
            timeout=30,
        )
        data = _unwrap(r)
        for item in data.get("addable_knowledge_base_list") or []:
            kid = item.get("id")
            if kid:
                ids.add(kid)
                infos.append((kid, item.get("name", "")))
        if data.get("is_end") or not data.get("next_cursor"):
            break
        cursor = data["next_cursor"]
    return ids, infos


# 进程内缓存：每个 kb_id 只打一次权限接口
_verified_writable: set[str] = set()


def assert_kb_writable(kb_id: str) -> None:
    """上传前确认 kb_id 属于当前账号可写入的知识库。

    不可写（如填错 ID、填了别人的只读分享库、或共享库无写权限成员）时，
    直接 SystemExit 并列出该账号可写的知识库，方便核对 --kb-id。
    """
    if kb_id in _verified_writable:
        return
    ids, infos = get_addable_knowledge_base_list()
    if kb_id in ids:
        name = next((n for i, n in infos if i == kb_id), "")
        print(f"[OK] 知识库可写: {name or kb_id}")
        _verified_writable.add(kb_id)
        return
    lines = "\n".join(f"    - {n}  ({i})" for i, n in infos) or \
        "    （无，请先在 ima.qq.com 创建/加入一个知识库）"
    raise SystemExit(
        f"[ERR] 知识库 ID 无写入权限: {kb_id}\n"
        f"当前账号可写入的知识库如下，请核对 --kb-id：\n{lines}\n"
        f"说明：① 共享知识库需你的账号是「有写权限的成员」才能写入；\n"
        f"      ② 公开分享链接(shareId)只是只读视图，不能作为写入目标。"
    )


# --------------------------------------------------------------------------
# COS 上传
# --------------------------------------------------------------------------
def upload_to_cos(path: str, cred: dict) -> None:
    """第二步：用临时凭证把文件 PUT 到腾讯云 COS。"""
    from qcloud_cos import CosConfig, CosS3Client

    cfg = CosConfig(
        Region=cred["region"],
        SecretId=cred["secret_id"],
        SecretKey=cred["secret_key"],
        Token=cred["token"],
    )
    client = CosS3Client(cfg)
    with open(path, "rb") as f:
        client.put_object(
            Bucket=cred["bucket_name"],
            Body=f,
            Key=cred["cos_key"],
            ContentType="text/markdown",
        )


# --------------------------------------------------------------------------
# 标题推导：从 ChatDigest 导出文件名提取真实标题
# --------------------------------------------------------------------------
# 文件名规范：[软件名称]_[AI厂牌]_[时间戳]_[标题].md
#   时间戳段形如 2026-07-15_2225（内部自带一个下划线），其后才是真实标题。
#   因此不能简单按 "_" 取最后一段（无标题文件会误取到 "2225"）。
# v1.15.9 重命名：v1.15.9 之前的导出会以 Chat2Knowledge_ 开头（仍能解析——
#   本函数用时间戳锚点取其后内容，不依赖前缀字符串）；v1.15.9 之后新导出会
#   以 ChatDigest_ 开头。两种前缀都支持，零迁移成本。
_TS_RE = re.compile(r"\d{4}-\d{2}-\d{2}_\d{4}")  # 时间戳锚点：YYYY-MM-DD_HHMM


def derive_title(path: str) -> str:
    """从文件名推导知识库标题。

    仅当文件名符合 ChatDigest 规范、且时间戳之后存在标题内容时，
    才返回「去掉前缀后的真实标题」；否则（非本项目导出文件、
    或时间戳后没有标题内容）回退为原始文件名（含扩展名）。
    """
    basename = os.path.basename(path)
    stem, _ = os.path.splitext(basename)  # 去掉 .md 等扩展名
    m = _TS_RE.search(stem)
    if m:
        title = stem[m.end():].lstrip("_").strip()  # 时间戳之后的内容，去前导下划线
        if title:
            return title
    return basename  # 回退：原始文件名（含扩展名）


# --------------------------------------------------------------------------
# 组合：直接把本地文件推进知识库
# --------------------------------------------------------------------------
def _upload_file_to_kb_raw(
    path: str,
    kb_id: str,
    title: str | None = None,
    folder_id: str | None = None,
) -> bool:
    """
    [内部原始实现] 上传单个文件到知识库。返回 True/False。
    串行+节流由公开入口 upload_file_to_kb 统一负责，这里只做纯上传。
    title 默认从文件名推导真实标题（去掉 ChatDigest 前缀
    `[软件名]_[厂牌]_[时间戳]_`）；文件名不符合该规范或标题为空时，
    回退为原始文件名。显式传 --title 时以传入值为准。

    关键：IMA 要求 title 与 file_name 完全一致（含扩展名），否则回退显示
    原 file_name。故最终写入的标题会统一规范为「标题.md」，并同时作为
    create_media 的 file_name 与 add_knowledge 的 title。
    """
    if not os.path.isfile(path):
        print(f"[ERR] 文件不存在: {path}")
        return False
    load_credentials()  # 提前校验凭证，缺凭证时给出清晰报错而非走到半路
    assert_kb_writable(kb_id)  # 写前确认该知识库可写（防填错 ID / 无写入权限）
    if title is None:
        title = derive_title(path)
    # IMA 硬性规则：title 必须与 file_name 完全一致（含扩展名），
    # 否则一律回退显示原 file_name。故统一规范为带 .md 的 effective_name，
    # 同时作为 create_media.file_name 与 add_knowledge.title，二者相等。
    effective_name = title if title.lower().endswith(".md") else title + ".md"
    if title != os.path.basename(path):
        print(f"[INFO] 标题已从文件名提取（去除前缀）: {effective_name}")

    print(f"[1/3] create_media: {effective_name}")
    media_id, cred = create_media(path, kb_id, file_name=effective_name)
    print(f"[2/3] 上传到 COS (bucket={cred.get('bucket_name')}, region={cred.get('region')})")
    upload_to_cos(path, cred)
    print(f"[3/3] add_knowledge: {effective_name}")
    add_knowledge(media_id, effective_name, kb_id, folder_id)
    print(f"[OK] 已导入知识库: {effective_name}")
    return True


# ── 串行 + 节流（统一上传管线）────────────────────────────────────
# 所有上传入口（ima_upload.py CLI、ima_upload.bat、ima_watcher.py 的
# 目录监视 / HTTP 桥）都经由本模块的 upload_file_to_kb，因此节流逻辑
# 集中在此、单一来源，避免各调用方各自实现。
# 说明：这是「进程内」节流——对 ima_watcher.py 这种常驻单进程（并发
# on_created 线程）能完美串行化；对 ima_upload.bat 多次调用（每次是独立
# 进程）则各进程锁互不影响，但 bat 本身是 for 串行循环、天然不会并发，
# 故无需跨进程协调。如需跨进程节流可再加共享状态文件（本项目暂不需要）。
_upload_lock = threading.Lock()
_MIN_INTERVAL = 1.5       # 两次上传之间的最小间隔（秒），可被 --min-interval 覆盖
_last_upload_ts = 0.0     # 上一次上传完成的时间戳（time.monotonic）


def set_min_interval(value: float) -> None:
    """[公开 API] 设置两次上传之间的最小间隔（秒），覆盖默认 _MIN_INTERVAL。

    替代外部直接对 ima_upload._MIN_INTERVAL 的私有赋值：
    - 保留单一下划线 _MIN_INTERVAL 作为模块内部状态的实现细节；
    - 外部（包括 ima_watcher.py / CLI argparse）一律走 setter，类型系统
      可识别、IDE 可跳转、调试栈更清晰；
    - 自动 clamp 负值到 0（与旧逻辑 max(0.0, x) 保持一致）。

    v1.2.7 新增（P3.15：immutable modules 内部状态被外部修改）。
    """
    global _MIN_INTERVAL
    _MIN_INTERVAL = max(0.0, float(value))


def get_min_interval() -> float:
    """[公开 API] 读取当前最小上传间隔（秒）。v1.2.7 新增，与 set_min_interval 配对。"""
    return _MIN_INTERVAL


def upload_file_to_kb(
    path: str,
    kb_id: str,
    title: str | None = None,
    folder_id: str | None = None,
) -> bool:
    """[公开入口，串行 + 节流] 上传单个文件到知识库，返回 True/False。

    在 _upload_file_to_kb_raw 之外套了一层全局锁 + 最小间隔，
    保证同一进程内任意时刻只有一个上传在进行，且相邻两次至少间隔
    _MIN_INTERVAL 秒，平滑请求节奏、降低被 IMA 风控/限流的风险。
    """
    global _last_upload_ts
    if not os.path.isfile(path):
        print(f"[ERR] 文件不存在: {path}")
        return False
    with _upload_lock:
        now = time.monotonic()
        wait = _MIN_INTERVAL - (now - _last_upload_ts)
        if wait > 0:
            print(f"[THROTTLE] 距上次上传 {now - _last_upload_ts:.1f}s，"
                  f"歇 {wait:.1f}s 再传…", flush=True)
            time.sleep(wait)
        ok = _upload_file_to_kb_raw(path, kb_id, title=title, folder_id=folder_id)
        _last_upload_ts = time.monotonic()
        return ok


def main() -> None:
    cfg = load_local_config()
    ap = argparse.ArgumentParser(description="通过 IMA 官方 OpenAPI 上传文件到知识库")
    ap.add_argument("--file", required=True, help="要上传的本地文件（.md）")
    ap.add_argument("--kb-id", default=cfg.get("KB_ID") or None,
                    help="目标知识库 ID（ima.qq.com 知识库设置里查看）；省略时读取同目录 ima_config.ini 的 KB_ID")
    ap.add_argument("--title", help="知识库里显示的标题，默认=从文件名提取的真实标题（去除 ChatDigest 前缀；旧版 Chat2Knowledge 前缀也兼容）；文件名无标题时回退为原始文件名")
    ap.add_argument("--folder-id", help="目标文件夹 ID（省略则进根目录）")
    ap.add_argument("--min-interval", type=float, default=1.5,
                    help="两次上传之间的最小间隔（秒），默认 1.5；用于平滑请求、降低被限流风险")
    ap.add_argument("--version", action="version", version=f"ima_upload {IMATOOLS_VERSION}")
    args = ap.parse_args()

    set_min_interval(args.min_interval)

    if not args.kb_id:
        ap.error("缺少 --kb-id，且 ima_config.ini 未配置 KB_ID。"
                 "请在 ima_config.ini 填写 KB_ID，或用 --kb-id 显式指定。")

    ok = upload_file_to_kb(args.file, args.kb_id, title=args.title, folder_id=args.folder_id)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
