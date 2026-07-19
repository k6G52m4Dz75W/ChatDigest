# ChatDigest / 聊摘 · 回归测试

## 跑测试

```bash
# 安装依赖（含 pytest）
pip install -r tools/requirements.txt
pip install pytest

# 跑全部测试
python -m pytest tests/ -v

# 跑单个文件
python -m pytest tests/test_ima_upload.py -v
python -m pytest tests/test_js_pure_equivalents.py -v
```

预期输出（pytest 9.0+）：

```
============================= 113 passed in 0.32s =============================
```

## 测试覆盖范围

### `tests/test_ima_upload.py`（21 个 case）

测 Python 工具链里**真正可测的纯函数**：

| 函数 | 性质 | case 数 |
|---|---|---|
| `derive_title(path)` | 文件名 → 真实标题 | 11 |
| `load_local_config(path)` | 解析 ima_config.ini | 10 |

**不测**：
- `load_credentials()` / `_unwrap()` / `get_addable_knowledge_base_list()` — 涉及凭证 + 网络，mock 成本高、价值低
- `upload_file_to_kb_raw()` / `upload_to_cos()` — 真上传，集成测试范畴

### `tests/test_js_pure_equivalents.py`（92 个 case）

测 `chatdigest.user.js` 里 **DOM 无关的字符串纯函数**的 Python 1:1 复刻版。

| 函数 | 性质 | case 数 |
|---|---|---|
| `fenceLen(text)` | 计算安全围栏长度 | 6 |
| `looksLikeMarkdownSource(text)` | 启发式判 Markdown 文章 | 8 |
| `balanceFences(md)` | 围栏闭合兜底 | 6 |
| `unwrapWrappingFence(md)` | 解包外层包裹围栏 | 6 |
| `unwrapSourceFences(md)` | 解包源码围栏 | 10 |
| `cleanCitations(md)` | 清洗引用角标残迹 | 8 |
| `normalizeMd(md)` | 折叠空行 / 收尾空白 | 6 |
| `extractH1(md)` | 提取首个 h1 | 6 |
| `sanitizeTitle(t)` | 文件名清洗 | 7 |
| `yamlQuote(v)` | YAML 标量加引号 | 16 |
| `extractDescription(md)` | 摘要提取 | 9 |
| `buildFileName(...)` | 拼文件名（mock SITE/Date） | 5 |

## 设计取舍

### 为什么 Python 复刻 JS 函数，不直接测真 JS

`chatdigest.user.js` 是个 IIFE 包裹的 Tampermonkey 脚本，要测真 JS 函数必须：
1. 改 user.js 主体（把纯函数暴露到 window 或拆成独立 module）— **有风险**，每次发版要兼容
2. 引入 Node + jsdom + node:test 测试栈 — 增加 CI 复杂度

退一步方案：**Python 1:1 复刻**（`tests/test_js_pure_equivalents.py` 文件里所有 `_js_xxx()` 函数）。这些函数都是字符串处理 + 简单 regex，行为完全可以等价复刻。改动 user.js 时**务必同步更新这里的复刻版**——这正是这套测试的核心价值：强迫 reviewer 显式确认「JS 和 Python 行为一致」。

如未来要测真 JS 函数（更直接、更稳），可走 Node + jsdom + node:test 路线，留作后续工作。

### 为什么**不测** `blockToMd` / `inlineToMd`

这两个是**深度递归 DOM 操作**（标签嵌套 + 特殊 `<pre>` / `<table>` / `.md-code-block` 分支 + 依赖 `isUiChrome` 等子函数），完整复刻需要造一个完整 DOM 节点 mock 树。问题是：

- **drift 风险高**：原 JS 函数加了新分支（如 v1.14.6 的 `.d813de27` 语言标签提取），Python 复刻容易忘记同步
- **价值低**：`blockToMd` 的核心逻辑（递归遍历）比「纯字符串处理」更依赖真实 DOM 结构，jsdom 仿真也只能复现一部分

所以本测试套件**只测 DOM 无关的纯函数层**——`blockToMd` 的回归靠：
- 纯字符串层（围栏、清洗、引用）的间接覆盖
- 真实页面手动验证
- 后续 Playwright 抓 snapshot 集成测试（见下文）

### 为什么**不测**站点 DOM 适配层

`ADAPTERS.deepseek.assistantSel` 这类选择器，测了也是「测我想象中 DeepSeek 长这样」。CHANGELOG v1.14.3 已经写过「误信 Edge 保存的 HTML 快照——其为 JS 渲染的局部窗口」—— 站点会变、选择器会失效，给这种代码写 unit test 是糊弄自己。

要测真站点行为，必须走 Playwright/Puppeteer headless 抓真实 DOM 跑转换器，**降级为可刷新 fixture 而非硬断言**（过期 = diff 提醒，不是 fail）。这超出本测试套件范围，留作 P1 工作。

## 测试发现的真 bug（v1.14.9 修复）

写这套测试时发现 `chatdigest.user.js` 的 `extractDescription` 有 2 个 v1.8.0 引入的 bug：

### Bug ① 标题行没跳过（v1.8.0 设计意图 vs 实现不一致）

- **设计意图**（注释）：「首个非标题/列表/引用/代码段落，截断」
- **实际实现**：先 `.map(l => l.replace(/^#{1,6}\s+/, '').trim())` 把每行标题前缀 strip 掉，**再** filter 列表/引用/代码围栏 — 但 filter 检查的是 strip 后的 `l`，所以**标题文字也作为摘要一部分**

表现：`# 我的标题\n\n这是摘要内容。` → description = `"我的标题 这是摘要内容。"`（多了"我的标题"）

### Bug ② 代码围栏内部行没跳过

- 原逻辑只跳过以 ` ``` ` 开头的行（围栏标记行），但 ` ``` ` 围栏**内部**的代码行（如 `print(1)`）会被当摘要加进去
- 表现：`# 标题\n\n` ```python\nprint(1)\n` ``` `\n\n这是摘要内容。` → description = `"print(1) 这是摘要内容。"`（多了"print(1)"）

### 修法（v1.14.9 同步修复）

- ① 链首加 `.filter(l => !/^#{1,6}\s/.test(l))` 用**原始行**跳标题行（必须在 strip map 之前）
- ② 改用 for 循环 + `inFence` 状态机跟踪是否在围栏内，围栏内所有行都跳过

修后：`# 我的标题\n\n` ```python\nprint(1)\n` ``` `\n\n这是摘要内容。` → description = `"这是摘要内容。"`（干净）

### 验证

`tests/test_js_pure_equivalents.py` 的 `TestExtractDescription`（13 个 case）覆盖：单 h1 / 多级标题 / 列表 / 引用 / 代码围栏 / 缩进的 `#`（不当标题）/ 只有标题 / 多标题 + 正文 / 自定义 maxLen 等场景。Python 复刻版行为已与修好后的真 JS 完全一致。

## 维护约定

- 改 `ima_upload.py` 里的纯函数 → 同步 `test_ima_upload.py`
- 改 `chatdigest.user.js` 里的字符串纯函数 → **必须**同步 `test_js_pure_equivalents.py` 里的 `_js_xxx()` 复刻版
- 改后跑 `pytest -v` 验证全 PASS，**explicitly 看测试 count**（"回归测试 PASS ≠ 框架实际工作"教训：FAIL 数量比 PASS 数量更值得看）
