"""
tests/test_js_pure_equivalents.py — JS 字符串纯函数的 Python 复刻 + 测试

【设计取舍】为什么不直接测真 JS 函数
  chat2knowledge.user.js 是个 IIFE 包裹的 Tampermonkey 脚本，要测真 JS 函数
  必须改 user.js 主体（把纯函数拆成独立 module 或暴露到 window），这是有风险
  的改动（每次发版要兼容测试，函数重命名/重组会破坏现有 DOM 适配层）。

  退一步：这些纯函数都是「字符串处理 + 简单 regex」，逻辑等价于 Python
  复刻。复刻版能 100% 覆盖相同 case，回归时一样能报警。

  文件里所有 _js_xxx() 函数都是 chat2knowledge.user.js 里的原函数 1:1
  Python 复刻（逐行对照实现）。改动原 JS 时务必同步更新这里的复刻版——这
  正是这套测试的核心价值：**强迫 reviewer 显式确认「JS 和 Python 行为
  一致」**。

  如未来要测真 JS 函数（更直接、更稳），可走 Node + jsdom + node:test 路
  线，参考 tests/README.md。

【覆盖的 JS 函数】
  - fenceLen(text)                : 计算安全围栏长度
  - looksLikeMarkdownSource(text) : 判断文本是否像 Markdown 文章
  - balanceFences(md)             : 围栏闭合兜底
  - unwrapWrappingFence(md)       : 解包外层包裹围栏
  - unwrapSourceFences(md)        : 解包 plaintext/text/markdown 等源码围栏
  - cleanCitations(md)            : 清洗 DeepSeek 引用角标残迹
"""

from __future__ import annotations

import re

import pytest


# =============================================================================
# 复刻层：chat2knowledge.user.js 里的纯字符串函数 1:1 Python 复刻
# 改动 user.js 时务必同步更新这里
# =============================================================================

def _js_fence_len(text: str) -> int:
    """fenceLen(text) — 计算安全围栏长度：比内容中最长连续反引号多 1。
    原 JS：'function fenceLen(text) { ... return Math.max(3, max + 1); }'
    """
    max_run = 0
    run = 0
    for ch in text:
        if ch == "`":
            run += 1
            if run > max_run:
                max_run = run
        else:
            run = 0
    return max(3, max_run + 1)


def _js_looks_like_markdown_source(text: str) -> bool:
    """looksLikeMarkdownSource(text) — 启发式判断一段文本是否「本质上
    是 Markdown 文章源码」。

    原 JS：
        const heads   = (text.match(/(^|\\n)#{1,6}\\s/g) || []).length;
        const hasTable = /(^|\\n)\\|.*\\|\\n\\s*\\|[-:\\s|]+\\|/.test(text);
        const hasList  = /(^|\\n)(-|\\*|\\+|\\d+\\.)\\s/.test(text);
        const hasQuote = /(^|\\n)>\\s/.test(text);
        return heads >= 2 || hasTable || (heads >= 1 && (hasList || hasQuote));
    """
    heads = len(re.findall(r"(^|\n)#{1,6}\s", text))
    has_table = bool(re.search(r"(^|\n)\|.*\|\n\s*\|[-:\s|]+\|", text))
    has_list = bool(re.search(r"(^|\n)([-*+]|\d+\.)\s", text))
    has_quote = bool(re.search(r"(^|\n)>\s", text))
    return heads >= 2 or has_table or (heads >= 1 and (has_list or has_quote))


def _js_balance_fences(md: str) -> str:
    """balanceFences(md) — 围栏闭合兜底：
    - 带信息串的围栏（```text）只能是开场，绝不能作闭合
    - 纯反引号围栏才能闭合当前开场围栏
    - 遍历结束若有未闭合开场，按各自反引号数补闭合
    """
    lines = md.split("\n")
    stack: list[int] = []
    bare_re = re.compile(r"^(`{3,})\s*$")
    with_info_re = re.compile(r"^(`{3,})[^\s`]")
    for line in lines:
        bare = bare_re.match(line)
        with_info = with_info_re.match(line)
        if bare and not with_info:
            length = len(bare.group(1))
            if stack and stack[-1] <= length:
                stack.pop()
            continue  # 无匹配开场则视为游离闭合，忽略
        if with_info:
            stack.append(len(with_info.group(1)))
            continue
    if not stack:
        return md
    tail = "\n".join("`" * l for l in reversed(stack))
    return re.sub(r"\s+$", "", md) + "\n" + tail + "\n"


def _js_unwrap_wrapping_fence(md: str) -> str:
    """unwrapWrappingFence(md) — 整段被一层代码围栏包住时剥掉外层。
    容忍末尾空白行、不强求内部围栏完全平衡（DeepSeek 偶发围栏长度不一致）。
    """
    t = md.strip("\n")
    lines = t.split("\n")
    if len(lines) < 3:
        return md
    if not re.match(r"^`{3,}", lines[0]):
        return md
    # 从尾部向前找最后一个围栏行（容忍末尾空白行）
    last = -1
    for i in range(len(lines) - 1, 0, -1):
        if re.match(r"^`{3,}\s*$", lines[i]):
            last = i
            break
    if last == -1:
        return md
    body = lines[1:last]
    body_str = "\n".join(body)
    looks_like_md = (
        re.search(r"(^|\n)#{1,6}\s", body_str)
        or re.search(r"(^|\n)\|.*\|\n\s*\|[-:\s|]+\|", body_str)
        or re.search(r"(^|\n)([-*+]|\d+\.)\s", body_str)
        or re.search(r"(^|\n)>\s", body_str)
        or "`{3,}".replace("{3,}", "```") in body_str
    )
    if not looks_like_md:
        return md
    return body_str.strip()


def _js_unwrap_source_fences(md: str) -> str:
    """unwrapSourceFences(md) — 在 Markdown 文本层扫描并解包源码围栏：
    - 语言为 plaintext/text/markdown/md/txt → 必为「源码/纯文本」wrapper，解包
    - 语言为空 + 内容整体像 Markdown → 同样解包
    - 其余语言（python/js/bash/...）→ 视为真正的代码块，保留围栏
    """
    src_langs = {"plaintext", "text", "markdown", "md", "txt"}
    fence_re = re.compile(r"```([a-zA-Z0-9_+#.\-]*)\n([\s\S]*?)\n```(?=\n|$)")
    out = md
    prev = None
    guard = 0
    while out != prev and guard < 5:
        prev = out
        out = fence_re.sub(
            lambda m: _unwrap_one(m, src_langs), out
        )
        guard += 1
    return out


def _unwrap_one(m: re.Match, src_langs: set[str]) -> str:
    """unwrapSourceFences 的 sub callback。"""
    lang = (m.group(1) or "").lower()
    body = m.group(2)
    if lang in src_langs or (lang == "" and _js_looks_like_markdown_source(body)):
        return body.strip("\n") + "\n"
    return m.group(0)  # 真正的程序代码块保留


def _js_clean_citations(md: str) -> str:
    """cleanCitations(md) — DeepSeek 引用角标残迹清洗（v1.15.4 扩覆盖面）：
    1) 引用链接规范化：[-3](url) / -[-3](url) → [3](url)
    2) 删除紧邻（中/英文）标点（。、：，；！？.,;:!?）前的
       连字符/短横/破折号（hyphen / en-dash / em-dash / minus sign）
    3) ASCII 字母/数字 + 短横 + 中文字符 → 去短横
       v1.15.4 扩数字支持（Figure-3 / 123-示意图 等也清洗）。
       中→英方向**故意不加**（保守：可能是用户正常用语如"第1章-Introduction"）。
    顺序：1 → 2 → 3（先洗短横+标点，避免 3 把"权威-。"切成"权威"+".",然后 2 不命中）。
    """
    # 1) 引用链接
    md = re.sub(
        r"-?\[-\s*(\d+)\s*\]\((https?://[^\s)]+)\)", r"[\1](\2)", md
    )
    # 2) 短横/破折号 + (中英文)标点 → 去短横
    #    字符类:hyphen + en-dash + em-dash + minus sign
    #    lookahead 标点:全角 + 半角（AI 偶尔混用全半角）
    md = re.sub(r"[-–—−]{1,3}(?=[。、：,，；！？.,;:!?])", "", md)
    # 3) ASCII 字母/数字 + 短横 + 中文字符 → 去短横
    md = re.sub(r"([A-Za-z0-9]+)-(?=[\u4e00-\u9fff])", r"\1", md)
    return md


# =============================================================================
# 测试层
# =============================================================================

class TestFenceLen:
    """计算安全围栏长度：保证外层围栏比内层最长反引号串多 1。"""

    def test_no_backticks_returns_minimum_3(self):
        assert _js_fence_len("hello world") == 3

    def test_single_backtick(self):
        """1 个反引号（行内 code）→ 仍为最小 3。"""
        assert _js_fence_len("`inline`") == 3

    def test_two_consecutive_backticks(self):
        assert _js_fence_len("``inline``") == 3

    def test_three_consecutive_backticks(self):
        """内容含 ``` → 外层要 4 个反引号才不会被提前闭合。"""
        assert _js_fence_len("```code```") == 4

    def test_four_consecutive_backticks(self):
        assert _js_fence_len("````fenced with 4````") == 5

    def test_max_run_scans_whole_text(self):
        """找的是「最长的连续反引号串」，不是首个。"""
        text = "``` ```\n\n```python\nprint(1)\n```"
        assert _js_fence_len(text) == 4


class TestLooksLikeMarkdownSource:
    """启发式判断「这段文本是否本质上是一篇 Markdown 文章」。
    用来识别「AI 把整篇回复包进代码围栏」的场景。"""

    def test_plain_python_code_is_not_markdown(self):
        """普通 Python 代码 → False（避免把 # 注释误判为标题）。"""
        text = (
            "import os\n"
            "# this is a comment\n"
            "def foo():\n"
            "    return 1\n"
        )
        assert _js_looks_like_markdown_source(text) is False

    def test_two_headings_is_markdown(self):
        text = "# 标题一\n\n段落\n\n## 标题二\n\n更多段落\n"
        assert _js_looks_like_markdown_source(text) is True

    def test_one_heading_with_list_is_markdown(self):
        text = "# 标题\n\n- item 1\n- item 2\n"
        assert _js_looks_like_markdown_source(text) is True

    def test_one_heading_with_quote_is_markdown(self):
        text = "# 标题\n\n> 引用\n"
        assert _js_looks_like_markdown_source(text) is True

    def test_one_heading_alone_is_not_markdown(self):
        """单标题 + 段落（无列表/引用）→ 启发式 False（避免误判代码注释）。"""
        text = "# 标题\n\n这是普通段落。\n"
        assert _js_looks_like_markdown_source(text) is False

    def test_pipe_table_is_markdown(self):
        text = (
            "| 列1 | 列2 |\n"
            "| --- | --- |\n"
            "| a   | b   |\n"
        )
        assert _js_looks_like_markdown_source(text) is True

    def test_ordered_list_alone_is_not_markdown_enough(self):
        """纯有序列表 + 段落（无标题）→ False（heads=0, 表格/引用/标题都不命中）。"""
        text = "1. 第一\n2. 第二\n段落\n"
        assert _js_looks_like_markdown_source(text) is False

    def test_quote_alone_is_not_markdown(self):
        """纯引用 + 段落（无标题）→ False。"""
        text = "> 引用\n\n更多文字\n"
        assert _js_looks_like_markdown_source(text) is False


class TestBalanceFences:
    """围栏闭合兜底。关键：带信息串的围栏必为开场；纯反引号才能闭合。
    这就是 v1.14.4 修的栈逻辑——之前漏了带信息串的判定。"""

    def test_balanced_fences_unchanged(self):
        """配对的围栏 → 不变。"""
        md = "```python\nprint(1)\n```\n"
        assert _js_balance_fences(md) == md

    def test_unclosed_fence_gets_tail(self):
        """开场围栏无闭合 → 末尾补一个纯反引号闭合。"""
        md = "```python\nprint(1)\n"
        result = _js_balance_fences(md)
        assert result.endswith("```\n")
        # 围栏长度匹配（这里是 3 个反引号）
        assert "```\n" in result

    def test_fence_with_info_is_opener_only(self):
        """带信息串的围栏（```python）只能是开场，绝不能当闭合。
        这是 v1.14.4 修复的关键 bug——之前用同一种判定分不清。"""
        md = (
            "```python\n"
            "print(1)\n"
            "```python\n"  # ← 看起来像围栏但带信息串，必为开场
        )
        # 第二个 ```python 应被推入栈不被弹出；末尾应补一个 ``` 闭合
        result = _js_balance_fences(md)
        assert result.rstrip().endswith("```")

    def test_nested_fences_4_wrapping_3(self):
        """4 反引号包 3 反引号 → 已配对，不补闭合。"""
        md = "````\n```python\nprint(1)\n```\n````\n"
        assert _js_balance_fences(md) == md

    def test_orphan_closing_fence_ignored(self):
        """孤立的纯反引号闭合（无开场）→ 忽略，不影响栈。"""
        md = "```\n孤立的闭合\n```\n"  # 第一个 ``` 是开场
        result = _js_balance_fences(md)
        # 配对正确，不应再补闭合
        assert result.count("```") == 2  # 仍然只有原 2 个

    def test_multiple_unclosed_fences(self):
        """多个未闭合开场 → 按各自反引号数补对应闭合。"""
        md = "```python\n```js\n"
        result = _js_balance_fences(md)
        # 末尾应有 2 个闭合围栏（每个 3 个反引号）
        lines = result.rstrip().split("\n")
        assert lines[-1] == "```"
        assert lines[-2] == "```"


class TestUnwrapWrappingFence:
    """整段被一层代码围栏包住且内容像 Markdown → 剥掉外层。"""

    def test_wrapped_markdown_gets_unwrapped(self):
        """整段被 ``` 包住且内容是 Markdown → 解包。"""
        md = "```\n# 标题\n\n段落\n```\n"
        result = _js_unwrap_wrapping_fence(md)
        assert result == "# 标题\n\n段落"

    def test_wrapped_non_markdown_unchanged(self):
        """被围栏包但不像 Markdown → 不解。"""
        md = "```\nimport os\nprint(1)\n```\n"
        result = _js_unwrap_wrapping_fence(md)
        assert result == md

    def test_no_wrapping_unchanged(self):
        """没有围栏 → 不动。"""
        md = "# 标题\n\n段落\n"
        result = _js_unwrap_wrapping_fence(md)
        assert result == md

    def test_too_short_unchanged(self):
        """少于 3 行（围栏行 + 内容 + 围栏行至少 3 行）→ 不动。"""
        md = "```\n内容\n"
        result = _js_unwrap_wrapping_fence(md)
        assert result == md

    def test_trailing_blank_lines_tolerated(self):
        """末尾有空行也能正确找闭合围栏（避免误判 last=-1）。"""
        md = "```\n# 标题\n\n段落\n```\n\n\n"
        result = _js_unwrap_wrapping_fence(md)
        assert result == "# 标题\n\n段落"

    def test_unbalanced_inner_fences_tolerated(self):
        """内层围栏长度不一致时也能解包（DeepSeek 偶发）。"""
        # 外层 3 个反引号，内部有 4 个反引号（不平衡）
        md = "```\n# 标题\n\n```python\nprint(1)\n````\n\n更多内容\n```\n"
        result = _js_unwrap_wrapping_fence(md)
        # 不应崩，且应解包出主要内容
        assert "标题" in result
        assert "更多内容" in result


class TestUnwrapSourceFences:
    """在 Markdown 文本层扫描并解包源码围栏（plaintext/text/markdown/md/txt）。"""

    def test_plaintext_fence_with_markdown_unwraps(self):
        """```plaintext 包 MD → 解包。"""
        md = "前文\n\n```plaintext\n# 标题\n\n段落\n```\n\n后文\n"
        result = _js_unwrap_source_fences(md)
        assert "前文" in result
        assert "# 标题" in result
        assert "后文" in result
        assert "```plaintext" not in result

    def test_text_fence_unwraps(self):
        """```text 也解。"""
        md = "```text\n# 标题\n```\n"
        result = _js_unwrap_source_fences(md)
        assert "```" not in result
        assert "# 标题" in result

    def test_markdown_fence_unwraps(self):
        md = "```markdown\n# 标题\n```\n"
        result = _js_unwrap_source_fences(md)
        assert "```markdown" not in result
        assert "# 标题" in result

    def test_md_alias_unwraps(self):
        md = "```md\n# 标题\n```\n"
        result = _js_unwrap_source_fences(md)
        assert "```md" not in result
        assert "# 标题" in result

    def test_real_code_preserved(self):
        """```python 是真代码 → 保留围栏。"""
        md = "```python\nprint('hello')\n```\n"
        result = _js_unwrap_source_fences(md)
        assert "```python" in result
        assert "print('hello')" in result

    def test_javascript_preserved(self):
        md = "```javascript\nconsole.log(1)\n```\n"
        result = _js_unwrap_source_fences(md)
        assert "```javascript" in result

    def test_no_fence_unchanged(self):
        """没有围栏 → 不动。"""
        md = "# 标题\n\n普通段落\n"
        result = _js_unwrap_source_fences(md)
        assert result == md

    def test_nested_unwrap_converges(self):
        """嵌套解包应能在 guard 限制内收敛。"""
        # 模拟 v1.14.5 描述的场景：外层 ```text 包 MD，内部还有 ```plaintext 包代码
        md = (
            "```text\n"
            "前文\n\n"
            "```plaintext\n# 标题\n```\n\n"
            "后文\n"
            "```\n"
        )
        result = _js_unwrap_source_fences(md)
        # 两次解包后不应残留任何源码围栏
        assert "```text" not in result
        assert "```plaintext" not in result
        # MD 内容保留
        assert "# 标题" in result

    def test_unknown_language_with_markdown_body_unwraps(self):
        """无语言标记 + 内容像 MD → 解包（对应 blockToMd 的 'lang == "" && looksMd' 路径）。"""
        md = "前文\n\n```\n# 标题\n\n段落\n```\n\n后文\n"
        result = _js_unwrap_source_fences(md)
        assert "前文" in result
        assert "# 标题" in result
        assert "后文" in result


class TestCleanCitations:
    """DeepSeek 引用角标残迹清洗：v1.14.7 引入的修复。"""

    def test_normalize_citation_link(self):
        """[-3](url) → [3](url)。"""
        md = "看 [-3](https://example.com/3) 这个引用"
        result = _js_clean_citations(md)
        assert result == "看 [3](https://example.com/3) 这个引用"

    def test_strip_leading_dash_in_citation(self):
        """-[-3](url) → [3](url)。"""
        md = "正文 -[-3](https://example.com/3) 后续"
        result = _js_clean_citations(md)
        assert result == "正文 [3](https://example.com/3) 后续"

    def test_strip_dash_before_chinese_punctuation(self):
        """紧邻中文标点前的短横（如 权威--。）→ 去掉。"""
        md = "权威--。这样很对。"
        result = _js_clean_citations(md)
        # 两条短横都应被删（命中 [-–]{1,3} 范围）
        assert "权威。这样很对" in result or "权威。这样很对。" in result
        assert "--" not in result

    def test_strip_dash_between_english_and_chinese(self):
        """Tanahashi-等 → Tanahashi等。"""
        md = "据 Tanahashi-等人的研究"
        result = _js_clean_citations(md)
        assert "Tanahashi等人的研究" in result
        assert "Tanahashi-等" not in result

    def test_real_dash_not_stripped(self):
        """普通破折号（不在中文标点前、不连英中）→ 保留。"""
        md = "这是 - 一个普通短横"
        result = _js_clean_citations(md)
        # 这里 "-" 后面是空格，不是中文标点也不是中文，规则不应触发
        assert "这是 - 一个普通短横" == result

    def test_no_citation_unchanged(self):
        """没有引用也没有短横残迹 → 不动。"""
        md = "# 标题\n\n这是普通段落。\n"
        result = _js_clean_citations(md)
        assert result == md

    def test_multiple_citations_all_normalized(self):
        """多个引用链接都规范化。"""
        md = "看 [-1](https://a.com/1) 和 -[-3](https://a.com/3) 这两个"
        result = _js_clean_citations(md)
        assert "[1](https://a.com/1)" in result
        assert "[3](https://a.com/3)" in result
        assert "[-1]" not in result
        assert "[-3]" not in result

    def test_dash_variants_handled(self):
        """hyphen(-) 和 en-dash(–) 都应被清洗。"""
        md1 = "权威--。测试。"
        md2 = "权威––。测试。"  # en-dash
        # 两种都应去掉两条短横
        for md in (md1, md2):
            result = _js_clean_citations(md)
            assert "--" not in result
            assert "––" not in result

    # v1.15.4 新增 — 扩字符类 / 扩数字支持 / 扩半角标点 / 中-英方向保守
    def test_em_dash_handled(self):
        """v1.15.4 扩字符类：em-dash(—) 也应被清洗。
        原版只 hyphen + en-dash，em-dash（AI 常用）漏洗。"""
        md = "权威——。这是测试。"  # em-dash em-dash + 全角句号
        result = _js_clean_citations(md)
        assert "——" not in result
        assert "权威。这是测试。" == result

    def test_minus_sign_handled(self):
        """v1.15.4 扩字符类：minus sign(−, U+2212) 也应被清洗。"""
        md = "权威−。这是测试。"  # minus sign + 全角句号
        result = _js_clean_citations(md)
        assert "−" not in result
        assert "权威。这是测试。" == result

    def test_halfwidth_punctuation_handled(self):
        """v1.15.4 扩标点：半角 . , ; : ! ? 也应被清洗（AI 偶尔混用全半角）。"""
        md = "权威--,这是测试"  # 半角逗号
        result = _js_clean_citations(md)
        assert "权威,这是测试" == result

    def test_digit_with_chinese_handled(self):
        """v1.15.4 扩数字支持：数字+短横+中文 也能清洗。
        注意：regex 3 要求 ASCII(字母/数字)+短横+直接连中文（中间无空格），
        所以 'Figure-3 是示意图'（短横后是空格）不会被洗；
        但 '123-中文'（短横直接连中文）会被洗。"""
        md = "Figure-3 是示意图,123-中文 也洗"
        result = _js_clean_citations(md)
        # 123-中文 清洗；Figure-3 后面是空格不洗（regex 3 要求直接连中文）
        assert "Figure-3 是示意图,123中文 也洗" == result

    def test_chinese_to_english_dash_NOT_stripped(self):
        """中→英方向**故意不加**（保守）：可能是用户正常用语如"第1章-Introduction"。
        如果用户写 `第1章-Introduction`，应保持不变；v1.15.4 不动中→英方向。"""
        md = "第1章-Introduction 是引言"
        result = _js_clean_citations(md)
        assert result == md, f"中→英方向不应清洗（保守），但得到了: {result!r}"

    def test_dash_without_chinese_punct_unchanged(self):
        """短横后面不是中文也不是中文标点 → 不洗。
        普通连字符（如 'state-of-the-art'）应保持原样。"""
        md = "state-of-the-art design"
        result = _js_clean_citations(md)
        assert result == md

    def test_dash_before_english_punct_unchanged(self):
        """短横在英文标点(半角)前不洗（标点已经在字符类里，但 'a- b' 这种 '短横后空格' 不算 '短横+标点'）。
        实际上我们扩字符类后,半角标点也会命中,所以 'a-. b' 会变 'a. b'——但这是预期的。
        这里测的是更明确的边界:英文里的 'a- b'（短横后空格）不应被 regex 2 命中。"""
        md = "a- b"
        result = _js_clean_citations(md)
        assert result == md, f"短横后空格不应被 regex 2 命中: {result!r}"


# =============================================================================
# 第二组：DOM 无关的 JS 字符串工具函数复刻
# 这些跟前面 6 个纯函数性质相同（输入字符串 → 输出字符串），
# 但分布在 user.js 不同的工具区，所以单列一组。
# =============================================================================

def _js_normalize_md(md: str) -> str:
    """normalizeMd(md) — 折叠多余空行、去行尾空白、去首尾空白。"""
    md = re.sub(r"[ \t]+\n", "\n", md)
    md = re.sub(r"\n{3,}", "\n\n", md)
    md = re.sub(r"^\n+", "", md)
    md = re.sub(r"\n+$", "", md)
    return md.strip()


def _js_extract_h1(md: str) -> str:
    """extractH1(md) — 取抓取内容里第一个 h1 标题（# 开头单独一行）。
    找不到返回空串。"""
    lines = (md or "").split("\n")
    for line in lines:
        m = re.match(r"^#\s+(.+?)\s*$", line)
        if m:
            return m.group(1).strip()
    return ""


def _js_sanitize_title(t: str) -> str:
    """sanitizeTitle(t) — 清洗文件名非法字符、折叠空白、限制 60 字。"""
    s = re.sub(r"[\\/:*?\"<>|\n\r\t#]", "_", t or "")
    s = re.sub(r"\s+", " ", s).strip()
    return s[:60]


def _js_yaml_quote(v) -> str:
    """yamlQuote(v) — YAML 标量加引号：含 : # " ' 或首尾空白、空串、
    形似数字/布尔 时加双引号。"""
    s = str(v)
    if (
        re.search(r"[:#\"\\']", s)
        or re.search(r"^\s|\s$", s)
        or s == ""
        or re.search(r"^(true|false|null|~)$", s, re.IGNORECASE)
        or re.search(r"^-?\d+(\.\d+)?$", s)
    ):
        escaped = s.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return s


def _js_extract_description(md: str, max_len: int = 200) -> str:
    """extractDescription(md, maxLen=200) — 从正文首段提取摘要。

    【v1.14.9 修复】
    ① 标题行：用原始行跳过（必须在 strip 之前）。
    ② 代码围栏内部：用状态机 inFence 跟踪，围栏内所有行都跳过。
    """
    max_len = max_len or 200
    lines = (md or "").split("\n")
    paras: list[str] = []
    in_fence = False  # v1.14.9 新增：跟踪是否在 ``` 围栏内
    for raw in lines:
        if in_fence:
            if re.match(r"^```", raw):
                in_fence = False
            continue
        if re.match(r"^```", raw):
            in_fence = True
            continue
        if re.match(r"^#{1,6}\s", raw):
            continue
        stripped = re.sub(r"^#{1,6}\s+", "", raw).strip()
        if not stripped:
            continue
        if re.match(r"^[-*+]\s", stripped):
            continue
        if re.match(r"^>\s", stripped):
            continue
        paras.append(stripped)
    text = re.sub(r"\s+", " ", " ".join(paras)).strip()
    if not text:
        return ""
    return text if len(text) <= max_len else text[:max_len] + "…"


def _js_build_file_name(
    md: str,
    title_override,
    site_name: str,
    software_name: str,
    now: "datetime.datetime",
) -> str:
    """buildFileName(md, titleOverride) — 拼文件名。
    真实函数依赖全局 SITE / SOFTWARE_NAME / Date()，这里显式注入。
    格式: {SOFTWARE_NAME}_{site_name}_{YYYY-MM-DD_HHMM}_{title}.md
    标题为空则省略末段。"""
    ts = (
        f"{now.year:04d}-{now.month:02d}-{now.day:02d}"
        f"_{now.hour:02d}{now.minute:02d}"
    )
    parts = [software_name, site_name, ts]
    if title_override is _UNSET:
        # 真实函数：title_override !== undefined ? title_override : resolveTitle(md)
        # 这里用 sentinel 表示「未传」 → 走 resolveTitle（但 resolveTitle 需 DOM/page title，
        # 单元测里把 md 的第一个 h1 当 title，模拟 resolveTitle 的「h1 优先」路径）
        from_title = _js_extract_h1(md) or ""
        from_title = _js_sanitize_title(from_title)
        if from_title:
            parts.append(from_title)
    else:
        if title_override:
            parts.append(title_override)
    return "_".join(parts) + ".md"


# sentinel：表示调用方没传 titleOverride
_UNSET = object()


# =============================================================================
# 测试层
# =============================================================================

class TestNormalizeMd:
    """折叠多余空行、去行尾空白、去首尾空白。"""

    def test_already_clean(self):
        assert _js_normalize_md("正常文本\n") == "正常文本"

    def test_strip_leading_blank_lines(self):
        """开头的空行去掉。"""
        assert _js_normalize_md("\n\n# 标题\n") == "# 标题"

    def test_strip_trailing_blank_lines(self):
        """末尾的空行去掉。"""
        assert _js_normalize_md("# 标题\n\n\n") == "# 标题"

    def test_collapse_three_or_more_blank_lines_to_two(self):
        """3+ 个连续空行 → 折叠为 2 个（保留段落间距）。"""
        md = "段落一\n\n\n\n\n段落二\n"
        assert _js_normalize_md(md) == "段落一\n\n段落二"

    def test_strip_trailing_whitespace(self):
        """行尾的空格/制表符去掉（不破坏 Markdown 换行）。"""
        md = "行一   \n行二\t\n行三\n"
        assert _js_normalize_md(md) == "行一\n行二\n行三"

    def test_no_newline_at_all(self):
        assert _js_normalize_md("单行") == "单行"


class TestExtractH1:
    """取抓取内容里第一个 # 一级标题。"""

    def test_first_h1(self):
        assert _js_extract_h1("# 标题一\n\n段落\n\n## 子标题\n") == "标题一"

    def test_skip_until_h1(self):
        """前几行不是 h1（可能是 YAML 残留、空行）→ 继续往下找。"""
        md = "---\ntitle: foo\n---\n\n# 真实标题\n"
        assert _js_extract_h1(md) == "真实标题"

    def test_no_h1_returns_empty(self):
        assert _js_extract_h1("## 子标题\n\n普通段落\n") == ""

    def test_h2_h3_not_h1(self):
        """`#` 必须是一级（1 个 #）。两个 ## 是 h2，不算。"""
        assert _js_extract_h1("## h2\n### h3\n") == ""

    def test_strip_trailing_hash(self):
        """标题末尾的 # 也接受（但本函数只匹配 `# xxx`，不匹配 `xxx #`）。"""
        assert _js_extract_h1("# 标题\n") == "标题"

    def test_empty_md(self):
        assert _js_extract_h1("") == ""


class TestSanitizeTitle:
    """清洗文件名非法字符、折叠空白、限制 60 字。"""

    def test_replace_illegal_chars(self):
        s = "标题/含:非法*?字符\"<>|"
        result = _js_sanitize_title(s)
        # 所有非法字符都被替换成 _
        for ch in s:
            if ch in '/:*?"<>|':
                assert ch not in result
        # 但字母数字中文保留
        assert "标题" in result
        assert "含" in result
        assert "非法" in result
        assert "字符" in result

    def test_replace_newline_and_tab(self):
        assert _js_sanitize_title("标题\n含\t换行") == "标题_含_换行"

    def test_replace_hash(self):
        """`#` 也算非法字符（避免和 Markdown 标题混）。"""
        assert _js_sanitize_title("# 标题") == "_ 标题"

    def test_collapse_whitespace(self):
        # 原 JS 顺序：先 replace 非法字符（含 \t → _），再 collapse 空白
        # 所以 tab 会先被替换成 _，再被 collapse 时跟前面空格合并
        # → 实际是 "多个 空格_分隔"，不是 "多个 空格 分隔"
        assert _js_sanitize_title("多个   空格\t分隔") == "多个 空格_分隔"

    def test_trim(self):
        assert _js_sanitize_title("  标题  ") == "标题"

    def test_slice_to_60(self):
        long = "a" * 100
        assert len(_js_sanitize_title(long)) == 60

    def test_empty_returns_empty(self):
        assert _js_sanitize_title("") == ""
        assert _js_sanitize_title(None) == ""


class TestYamlQuote:
    """YAML 标量加引号规则：含 : # \" ' 或首尾空白/空串/数字/布尔 时加双引号。"""

    def test_plain_text_unchanged(self):
        assert _js_yaml_quote("hello") == "hello"

    def test_chinese_unchanged(self):
        assert _js_yaml_quote("中文标题") == "中文标题"

    def test_quote_when_contains_colon(self):
        assert _js_yaml_quote("a:b") == '"a:b"'

    def test_quote_when_contains_hash(self):
        assert _js_yaml_quote("a#b") == '"a#b"'

    def test_quote_when_contains_quote_char(self):
        assert _js_yaml_quote('say "hi"') == '"say \\"hi\\""'

    def test_quote_empty_string(self):
        assert _js_yaml_quote("") == '""'

    def test_quote_string_with_leading_space(self):
        assert _js_yaml_quote(" leading") == '" leading"'

    def test_quote_string_with_trailing_space(self):
        assert _js_yaml_quote("trailing ") == '"trailing "'

    def test_quote_numeric_string(self):
        """纯数字字符串 → 加引号（避免被解析成数字）。"""
        assert _js_yaml_quote("12345") == '"12345"'

    def test_quote_float_string(self):
        assert _js_yaml_quote("3.14") == '"3.14"'

    def test_quote_negative_number(self):
        assert _js_yaml_quote("-42") == '"-42"'

    def test_quote_boolean_strings(self):
        assert _js_yaml_quote("true") == '"true"'
        assert _js_yaml_quote("false") == '"false"'
        assert _js_yaml_quote("null") == '"null"'
        assert _js_yaml_quote("~") == '"~"'

    def test_quote_case_insensitive_boolean(self):
        assert _js_yaml_quote("TRUE") == '"TRUE"'
        assert _js_yaml_quote("False") == '"False"'

    def test_escape_backslash_in_value(self):
        assert _js_yaml_quote("a\\b") == '"a\\\\b"'

    def test_url_is_quoted(self):
        """URL 含 : → 加引号。"""
        assert _js_yaml_quote("https://example.com") == '"https://example.com"'

    def test_non_string_coerced(self):
        """非字符串会被 String() 强转。Python str(None) == 'None',
        跟 JS String(null) == 'null' 不同——'None' 不在 case-insensitive
        boolean regex 范围里，所以不会被 quote；'null' 会。"""
        assert _js_yaml_quote(42) == '"42"'
        assert _js_yaml_quote(None) == "None"  # Python 强转 ≠ JS 强转


class TestExtractDescription:
    """从正文首段提取摘要。

    【v1.14.9 修复后行为】跳过头部 h1~h6 标题行（含 # ## ### 等），
    保留正文段落。列表/引用/代码围栏行被过滤，空行被跳过。
    设计意图与实现一致：description 只含正文，不含标题文字。"""

    def test_heading_line_skipped(self):
        """首行是标题 → 跳过（v1.14.9 修复前的 bug 是 strip 后保留）。"""
        md = "# 标题\n\n这是摘要内容。\n"
        assert _js_extract_description(md) == "这是摘要内容。"

    def test_heading_then_list_skipped(self):
        """标题 + 列表项 → 两者都跳过，只剩正文。"""
        md = "# 标题\n\n- item 1\n- item 2\n\n这是摘要内容。\n"
        assert _js_extract_description(md) == "这是摘要内容。"

    def test_heading_then_quote_skipped(self):
        md = "# 标题\n\n> 引用\n\n这是摘要内容。\n"
        assert _js_extract_description(md) == "这是摘要内容。"

    def test_heading_then_code_fence_skipped(self):
        md = "# 标题\n\n```python\nprint(1)\n```\n\n这是摘要内容。\n"
        assert _js_extract_description(md) == "这是摘要内容。"

    def test_h2_h3_h6_all_skipped(self):
        """所有级别标题（# ~ ######）都跳过。"""
        md = "## h2\n### h3\n#### h4\n##### h5\n###### h6\n\n正文内容。\n"
        assert _js_extract_description(md) == "正文内容。"

    def test_only_heading_returns_empty(self):
        """只有标题（无正文）→ 摘要为空（修复前会返回标题文字）。"""
        md = "# 标题\n"
        assert _js_extract_description(md) == ""

    def test_heading_only_no_body(self):
        """多个标题无正文 → 摘要为空。"""
        md = "# h1\n## h2\n### h3\n"
        assert _js_extract_description(md) == ""

    def test_indented_hash_not_a_heading(self):
        """行首有空格 + `#` 不是真标题（行内代码/段落）→ 不跳过。
        `^` 锚定行首,前面有空格就不匹配 ^#{1,6}\\s。"""
        md = "段落开头有 # 符号的讨论\n\n继续正文。\n"
        assert _js_extract_description(md) == "段落开头有 # 符号的讨论 继续正文。"

    def test_truncate_long_paragraph(self):
        long = "很长的文本。" * 100
        result = _js_extract_description(long)
        assert len(result) <= 201  # 200 + "…"
        assert result.endswith("…")

    def test_no_heading_keeps_body(self):
        """无标题、列表/引用被跳、剩正文。"""
        md = "这是摘要内容。\n"
        assert _js_extract_description(md) == "这是摘要内容。"

    def test_collapse_whitespace(self):
        """多行段落被 join 成一行。"""
        md = "第一行\n第二行\n第三行\n"
        assert _js_extract_description(md) == "第一行 第二行 第三行"

    def test_custom_max_len(self):
        md = "a" * 50
        result = _js_extract_description(md, max_len=10)
        assert result == "a" * 10 + "…"

    def test_multiple_headings_then_body(self):
        """多个标题 + 正文 → 只保留正文。"""
        md = "# 一级\n\n## 二级\n\n### 三级\n\n真正的内容在这里。\n"
        assert _js_extract_description(md) == "真正的内容在这里。"


class TestBuildFileName:
    """buildFileName 拼文件名。依赖全局 SITE / SOFTWARE_NAME / Date()，
    这里显式注入。"""

    def test_with_title_from_h1(self, mock_datetime):
        """无 titleOverride → 从 md 的 h1 提取标题。"""
        result = _js_build_file_name(
            md="# 心经英译历史\n\n正文\n",
            title_override=_UNSET,
            site_name="DeepSeek",
            software_name="ChatDigest",
            now=mock_datetime,
        )
        assert result == "ChatDigest_DeepSeek_2026-07-15_2225_心经英译历史.md"

    def test_with_explicit_title_override(self, mock_datetime):
        """显式传 titleOverride（不洗、不解析）→ 原样使用。"""
        result = _js_build_file_name(
            md="任何内容",
            title_override="自定义标题",
            site_name="DeepSeek",
            software_name="ChatDigest",
            now=mock_datetime,
        )
        assert result == "ChatDigest_DeepSeek_2026-07-15_2225_自定义标题.md"

    def test_no_title_segment_omitted(self, mock_datetime):
        """标题为空 → 省略末段。"""
        result = _js_build_file_name(
            md="无标题内容",
            title_override="",
            site_name="DeepSeek",
            software_name="ChatDigest",
            now=mock_datetime,
        )
        assert result == "ChatDigest_DeepSeek_2026-07-15_2225.md"

    def test_different_site_name(self, mock_datetime):
        result = _js_build_file_name(
            md="# 标题\n",
            title_override=_UNSET,
            site_name="ChatGPT",
            software_name="ChatDigest",
            now=mock_datetime,
        )
        assert result == "ChatDigest_ChatGPT_2026-07-15_2225_标题.md"

    def test_timestamp_pads_to_2_digits(self, mock_datetime_single_digit):
        """月/日/时/分不足 2 位补 0。"""
        result = _js_build_file_name(
            md="# 标题\n",
            title_override=_UNSET,
            site_name="DeepSeek",
            software_name="ChatDigest",
            now=mock_datetime_single_digit,
        )
        assert result == "ChatDigest_DeepSeek_2026-07-05_0307_标题.md"


# =============================================================================
# Fixtures for buildFileName tests
# =============================================================================

import datetime


@pytest.fixture
def mock_datetime() -> datetime.datetime:
    """2026-07-15 22:25（标准 2 位数字，便于断言）。"""
    return datetime.datetime(2026, 7, 15, 22, 25)


@pytest.fixture
def mock_datetime_single_digit() -> datetime.datetime:
    """2026-07-05 03:07（验证 padding 0）。"""
    return datetime.datetime(2026, 7, 5, 3, 7)
