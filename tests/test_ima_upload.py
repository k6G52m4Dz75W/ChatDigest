"""
tests/test_ima_upload.py — Python 端纯函数测试

覆盖 ima_upload.py 里两个真正可测的纯函数：
  - derive_title(path)        : 从 ChatDigest 文件名提取真实标题
  - load_local_config(path)   : 解析同目录 ima_config.ini
  - set_min_interval / get_min_interval : v1.2.7 新增公开 setter（P3.15）

不测 load_credentials / _unwrap / get_addable_knowledge_base_list 等
涉及网络 + 凭证的 side-effect 函数（mock 成本高、价值低）。

为什么只测纯函数：
  v1.14.4 → v1.14.7 一连串回归（unwrapSourceFences 顺序错、balanceFences
  栈逻辑漏带信息串、cleanCitations 短横清洗漏 en-dash）都集中在
  "字符串处理" 这层；这层不依赖真实 DOM、不会随站点更新而失效。
  同样，ima_upload.py 的 derive_title / load_local_config 也是这种
  性质——稳，可测。
"""

from __future__ import annotations

import pytest

import ima_upload


# =============================================================================
# derive_title — 从 ChatDigest 文件名提取真实标题
# =============================================================================
class TestDeriveTitle:
    """文件名规范：[软件名]_[厂牌]_[YYYY-MM-DD_HHMM]_[标题].md
    时间戳段自带一个下划线，所以不能按 _ 取最后一段（无标题会误取 HHMM）。"""

    def test_standard_filename(self):
        """标准格式：时间戳 + 真实标题。"""
        assert ima_upload.derive_title(
            "Chat2Knowledge_DeepSeek_2026-07-15_2225_心经英译历史.md"
        ) == "心经英译历史"

    def test_no_title_segment_falls_back_to_full_basename(self):
        """无标题段（只有时间戳 + .md）→ 回退到原始文件名（含 .md）。"""
        assert ima_upload.derive_title(
            "Chat2Knowledge_DeepSeek_2026-07-15_2225.md"
        ) == "Chat2Knowledge_DeepSeek_2026-07-15_2225.md"

    def test_underscore_only_after_timestamp_falls_back(self):
        """时间戳后只有 _（lstrip 后空）→ 回退到原始文件名。
        实际场景：用户手抖多打了一个下划线。这种边界容易回归。"""
        assert ima_upload.derive_title(
            "Chat2Knowledge_DeepSeek_2026-07-15_2225_.md"
        ) == "Chat2Knowledge_DeepSeek_2026-07-15_2225_.md"

    def test_non_chat2knowledge_filename_falls_back(self):
        """非本项目导出文件（无时间戳）→ 回退到原始文件名。"""
        assert ima_upload.derive_title("my_random_notes.md") == "my_random_notes.md"

    def test_title_with_internal_underscores_preserved(self):
        """标题内含下划线 → 保留（lstrip 只去前导，不去中间）。
        IMA 的 KB_ID 也是 base64 含 _，跟标题行为要分开。"""
        assert ima_upload.derive_title(
            "Chat2Knowledge_DeepSeek_2026-07-15_2225_A_B_C标题.md"
        ) == "A_B_C标题"

    def test_multiple_leading_underscores_stripped(self):
        """时间戳后多个前导下划线 → 全部 lstrip 掉。
        实际场景：日期格式改了 / 用户多打了下划线。"""
        assert ima_upload.derive_title(
            "Chat2Knowledge_DeepSeek_2026-07-15_2225___my_title.md"
        ) == "my_title"

    def test_path_with_directory_uses_basename(self):
        """传完整路径（含目录）→ 只看 basename。"""
        assert ima_upload.derive_title(
            "C:/Users/me/Downloads/Chat2Knowledge_DeepSeek_2026-07-15_2225_标题.md"
        ) == "标题"

    def test_case_insensitive_brand_segment(self):
        """品牌段大小写无关（锚点是数字时间戳，regex 本身大小写中性）。"""
        assert ima_upload.derive_title(
            "CHAT2KNOWLEDGE_deepseek_2026-07-15_2225_标题.md"
        ) == "标题"

    def test_title_with_spaces_around(self):
        """标题前后空格（虽然文件名不该有）→ strip 掉。"""
        # 实际文件名：time stamp + `_` + `  标题  ` + `.md`
        # stem = `..._2026-07-15_2225_  标题  `, m.end 后是 `_  标题  `,
        # lstrip('_') → `  标题  `, strip() → `标题`
        assert ima_upload.derive_title(
            "Chat2Knowledge_DeepSeek_2026-07-15_2225_  标题  .md"
        ) == "标题"

    def test_uppercase_extension(self):
        """扩展名大写（.MD / .Md）→ 不影响（splitext 接受任意）。"""
        assert ima_upload.derive_title(
            "Chat2Knowledge_DeepSeek_2026-07-15_2225_标题.MD"
        ) == "标题"

    def test_no_extension(self):
        """无扩展名 → basename 就是 stem，回退路径正常。"""
        # 实际：splitext('foo') -> ('foo', ''), stem='foo', 没时间戳 → fallback
        assert ima_upload.derive_title("foo") == "foo"


# =============================================================================
# load_local_config — 解析与 bat 共用的 ima_config.ini
# =============================================================================
class TestLoadLocalConfig:
    """解析规则（与 bat 完全一致，跨 3 个 bat 共享）：
      - 跳过空行 / ; 注释 / # 注释
      - 第一个 = 切分 K/V
      - K 大写
      - 缺失文件返回 {}（不抛错）
      - value 内可含 =（base64 KB_ID 结尾常带 =）
    """

    def test_missing_file_returns_empty(self, tmp_path):
        """不存在的文件 → 空 dict，不抛错。"""
        assert ima_upload.load_local_config(str(tmp_path / "nope.ini")) == {}

    def test_simple_kv(self, tmp_path):
        ini = tmp_path / "test.ini"
        ini.write_text("KB_ID = abc123\n", encoding="utf-8")
        assert ima_upload.load_local_config(str(ini)) == {"KB_ID": "abc123"}

    def test_kv_without_spaces(self, tmp_path):
        """等号前后都不留空格 → 正常解析。"""
        ini = tmp_path / "test.ini"
        ini.write_text("KB_ID=abc\nSRC=C:/x\n", encoding="utf-8")
        assert ima_upload.load_local_config(str(ini)) == {
            "KB_ID": "abc", "SRC": "C:/x"
        }

    def test_kv_with_spaces(self, tmp_path):
        """等号前后留空格 → 正常解析（key 和 value 都要 strip）。"""
        ini = tmp_path / "test.ini"
        ini.write_text("KB_ID   =   abc123   \n", encoding="utf-8")
        assert ima_upload.load_local_config(str(ini)) == {"KB_ID": "abc123"}

    def test_comments_ignored(self, tmp_path):
        """; 和 # 开头的行都是注释 → 跳过。"""
        ini = tmp_path / "test.ini"
        ini.write_text(
            "; comment 1\n"
            "# comment 2\n"
            "\n"
            "KB_ID = xyz\n"
            "; trailing comment\n",
            encoding="utf-8",
        )
        assert ima_upload.load_local_config(str(ini)) == {"KB_ID": "xyz"}

    def test_no_equals_skipped(self, tmp_path):
        """没有 = 的行 → 跳过（不抛错）。"""
        ini = tmp_path / "test.ini"
        ini.write_text("garbage line without equals\nKB_ID = ok\n", encoding="utf-8")
        assert ima_upload.load_local_config(str(ini)) == {"KB_ID": "ok"}

    def test_value_with_equals(self, tmp_path):
        """value 内含 =（base64 KB_ID 经常以 = / == 结尾）→ 只切第一个 =。"""
        ini = tmp_path / "test.ini"
        ini.write_text("KB_ID = abc==\n", encoding="utf-8")
        assert ima_upload.load_local_config(str(ini)) == {"KB_ID": "abc=="}

    def test_keys_uppercased(self, tmp_path):
        """key 统一大写（与 bat 行为一致），调用方可用 KB_ID 而非 kb_id。"""
        ini = tmp_path / "test.ini"
        ini.write_text("kb_id = lower\nSRC = path\n", encoding="utf-8")
        cfg = ima_upload.load_local_config(str(ini))
        assert cfg == {"KB_ID": "lower", "SRC": "path"}

    def test_empty_value_allowed(self, tmp_path):
        """value 为空 → 解析为 ""（允许空配置）。"""
        ini = tmp_path / "test.ini"
        ini.write_text("KB_ID = \nSRC = path\n", encoding="utf-8")
        assert ima_upload.load_local_config(str(ini)) == {
            "KB_ID": "", "SRC": "path"
        }

    def test_realistic_ini(self, tmp_path):
        """模拟用户真实 ima_config.ini 形态。"""
        ini = tmp_path / "test.ini"
        ini.write_text(
            "; ============================================================\n"
            "; IMA 一键入库配置模板\n"
            "; ============================================================\n"
            "\n"
            "; 目标知识库 ID（必填）\n"
            "KB_ID = XfRj355RQMsKfYWE_pcWuH0bRN1joflINle3RAWeq6s=\n"
            "\n"
            "; 默认来源文件夹（可选）\n"
            "SRC = C:\\Users\\me\\Downloads\\Chat2Knowledge\n"
            "\n"
            "; Python 可执行文件完整路径（可选）\n"
            "PY = C:\\Users\\me\\miniconda3\\python.exe\n",
            encoding="utf-8",
        )
        cfg = ima_upload.load_local_config(str(ini))
        assert cfg == {
            "KB_ID": "XfRj355RQMsKfYWE_pcWuH0bRN1joflINle3RAWeq6s=",
            "SRC": "C:\\Users\\me\\Downloads\\Chat2Knowledge",
            "PY": "C:\\Users\\me\\miniconda3\\python.exe",
        }


# =============================================================================
# set_min_interval / get_min_interval — v1.2.7 新增公开 setter（P3.15）
# =============================================================================
class TestSetGetMinInterval:
    """v1.2.7 把 ima_upload._MIN_INTERVAL 的外部直接赋值改成 set_min_interval()
    公开 setter。这里只测 setter / getter 本身的契约，不测 upload_file_to_kb
    是否真的按新值 sleep（那条路径要起真上传、得不偿失——回归了看 stderr
    里的 [THROTTLE] 歇 X.Xs 就能定位）。

    用 monkeypatch 自动还原默认 1.5s，避免某个测试改了之后漏到下一个。"""

    DEFAULT = 1.5

    def test_default_value(self):
        """未调 setter → 默认 1.5s（与 _MIN_INTERVAL 模块常量一致）。"""
        assert ima_upload.get_min_interval() == self.DEFAULT

    def test_setter_updates_value(self, monkeypatch):
        """setter 写入后 getter 读出新值。"""
        monkeypatch.setattr(ima_upload, "_MIN_INTERVAL", self.DEFAULT)  # 保险还原
        ima_upload.set_min_interval(3.0)
        assert ima_upload.get_min_interval() == 3.0
        # 再改一次，确认 setter 不是 one-shot
        ima_upload.set_min_interval(0.5)
        assert ima_upload.get_min_interval() == 0.5

    def test_setter_clamps_negative_to_zero(self, monkeypatch):
        """负值 → clamp 到 0.0（与旧逻辑 max(0.0, x) 保持一致）。
        实际不会传负数（argparse 不限制），但 setter 作为公开 API
        应该 self-defend，免得未来有人手贱直接调。"""
        monkeypatch.setattr(ima_upload, "_MIN_INTERVAL", self.DEFAULT)
        ima_upload.set_min_interval(-1.0)
        assert ima_upload.get_min_interval() == 0.0
        # 零保持零
        ima_upload.set_min_interval(0.0)
        assert ima_upload.get_min_interval() == 0.0
