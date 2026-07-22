# ChatDigest / 聊摘

[English](./README.md) | **[中文](./README.zh.md)**

**ChatDigest（聊摘）** 是一个 Tampermonkey 用户脚本，把 AI 网页对话（DeepSeek / ChatGPT / Kimi / Claude / 豆包 / 元宝等）一键整理成 **Markdown 知识库文章**。

> 思路：让 AI 自己当「总结引擎」，脚本只做「搬运工」+「文件管家」。在对话末尾让 AI 输出纯 Markdown，脚本负责抓取、命名、下载。

**完全本地 · 零订阅 · 零 API key · 隐私优先。** 核心导出（保存为本地 `.md` 文件）零配置、零网络——装好脚本、点一下、完事。可选推送到 **腾讯 ima**、**Obsidian**（计划中）或任意 Markdown 友好的知识库工具——用自己的账号、走官方 API、不经任何第三方。

**v1.15.10 起 `SOFTWARE_NAME` 按浏览器 locale 自动二选一**：中文系统 → `聊摘`、其他语言 → `ChatDigest`。导出文件名同步跟随（中文系统：`聊摘_DeepSeek_2026-07-19_xxx.md`；其他：`ChatDigest_DeepSeek_*.md`），YAML frontmatter `tags` 字段也跟随。同一份工具、海外/国内用户各自看到自己的语言文件名。

**v1.15.11 起 UI 全部中英双语**：所有 user-visible 文案（UI panel 按钮 / toast 提示 / console 错误 / alert / 总结咒语 `SUMMARY_PROMPT`）按浏览器 locale 自动切语言。源语言中文也走字典，38 个 key × 2 langs = 76 条翻译集中维护。

## 功能

- 🌐 **多站点自适应**：自动识别当前 AI 平台，使用对应选择器
- 📑 **一键导出（主图标）**：点右下角 📑 主图标即完成「注入并发送总结咒语 → 等待 AI 生成 → 自动保存最新回复」，无需任何手动操作
- 💬 **导出全部对话（含用户提问 + 完整历史）**：「📚 导出全部对话」会**先滚动遍历虚拟列表收集从第一条到最后一条的完整对话**（DeepSeek 等站点只渲染可视窗口，不滚动会漏掉开头），再按时间顺序把「👤 我的提问」与「🤖 AI 回复」交错拼接（按轮次编号成对呈现）。v1.14.0 起针对 DeepSeek 真实 DOM 强化了三处：① **滚动容器探测**改为扫描多个候选（`.ds-virtual-list` / `.ds-virtual-list-items` / `window`），不再因某个祖先 `scrollHeight` 探测瞬间未就绪而整段回退到「只抓可视窗口」（这正是一直漏掉开头、首条用户提问消失、归属交错的根因）；② **按 key 升序排序**且每条绑定自己的 `data-virtual-list-item-key`，避免「重复的用户提问文本」导致排序碰撞（归属交错）；③ `assistantSel` 不再追加 `, .ds-markdown`，避免把思考块叶子节点误算成独立 AI 回复
- 🧠 **思考过程与正式回复分离（blockquote）**：AI 回复里的「思考/推理过程」会被单独抽出来、套一层引用块（`> **💭 思考过程** …`），与下方「正式回复」在视觉上清楚区分；该逻辑对「导出全部对话 / 导出最新回复 / 复制最新回复 / 一键导出」统一生效。无思考过程的回复不会凭空生成思考块。**关键细节**：DeepSeek 的「思考块」内部也带 `.ds-markdown`（类名 `ds-think-content`），与正式回复的 `.ds-markdown.ds-assistant-message-main-content` 不同——故分离时按这两个**稳定类名**精确命中（取 `ds-think-content` 的推理正文、取 `ds-assistant-message-main-content` 的正式答案），而不是盲目取「第一个 `.ds-markdown`」（那会误把思考当答案、把「已思考（用时 X 秒）」状态当思考），从而保留思考原有的段落/列表格式
- ▴ **更多操作（右侧细长箭头）**：主按钮为正方形，右侧拼一个**细长**箭头（▴，默认朝上、展开时翻转为 ▾），二者组成一个「分离按钮」整体；点箭头展开菜单，提供三种粒度——「📋 复制最新回复 / 📥 导出最新回复 / 📚 导出全部对话」，功能不变、按需取用
- 🧩 **HTML→Markdown 转换器（核心）**：不再只靠 `innerText`，而是按 DOM 结构重建 Markdown——保留 `#` 标题层级、`|` 表格、列表、引用、`**粗体**`/链接/行内代码，以及代码块语言标识（````python` / ````js`）。无论 AI 把内容渲染成 HTML 还是包进代码块都能正确处理
- 📓 **统一 YAML 元数据头**：每个导出文件都在文件头写入标准 YAML frontmatter（title/source/author/created/tags/description，对齐 Obsidian Properties 规范），信息完整且被 Jekyll/Hugo/Obsidian/VuePress 等广泛识别，跨编辑器兼容。标题用标准 `# 标题`，正文已含 h1 时则只给元数据、不重复加标题。
- ✨ **「总结咒语」自动归档**：规范化 prompt 注入输入框 → 自动发送 → **自动等待 AI 生成完成** → **自动抓取并保存为 `.md`**（即主图标的一键导出逻辑）
- 🧹 **自动修复导出格式**：跳过 DeepSeek 代码块头部的「复制/下载/语言标签」等 UI 外壳；**在提取阶段即识别「整块 Markdown 源码被包进代码围栏」的导出**（DeepSeek 被要求输出"纯 Markdown"时常见），直接解包还原为可渲染 Markdown，不再依赖围栏平衡判断——即使外层（4 反引号）与内部（3 反引号）长度不一致也能正确剥离；对嵌套代码块做安全围栏加长，杜绝围栏嵌套导致的格式崩坏
- ☁️ **可选推送 IMA（官方 OpenAPI，默认开启）**：脚本自动保存后会顺带把 Markdown 推给本地 `ima_watcher.py`（需以 `--serve` 模式运行），经 `ima_upload.py` 走 **IMA 官方 OpenAPI**（create_media → COS 上传 → add_knowledge）直接导入知识库，不依赖任何第三方 CLI；开关在 Tampermonkey 箭头菜单「☁️ 自动推送 IMA：开/关」随时切换，状态持久化
- 🎨 **Premium 玻璃拟态 UI**：右下角「分离按钮」式悬浮控件（正方形 📑 主按钮 + 右侧细长 ▴ 箭头拼为一个整体），悬停动效，不破坏原站样式
- ⌨️ **快捷键**：
  - `Ctrl + Shift + S`：抓取最新回复并下载
  - `Ctrl + Shift + A`：抓取全部对话并下载
- 📁 **统一文件命名**：导出文件名固定为 `[软件名称]_[AI厂牌]_[时间戳]_[标题].md`（`ChatDigest_DeepSeek_2026-07-14_2259_标题.md`）。标题取值分两种场景：
  - **📚 导出全部对话 → 直接取网页页面标题 `document.title`**，不做 h1 回退（整段对话里混着 AI 生成的文章 h1，用页面标题才贴合「对话主题」；如 DeepSeek 的「心经英译历史 - DeepSeek」会自动剥离「 - DeepSeek」厂牌后缀得「心经英译历史」）；页面标题为空则留空（省略末段）。
  - **📥 导出/📋 复制「最新回复」、📑 一键导出 → 保持原逻辑**：优先取**截取内容里的首个 h1**，无 h1 时回退到页面标题，都没有则留空。
  - 软件名作为可切换中英文的变量（`SOFTWARE_NAME`），时间戳沿用 `YYYY-MM-DD_HHMM`

## 支持站点

| AI 站点          | URL                     | 状态      | 📑 一键导出         | 📚 导出全部对话       |
| ---------------- | ----------------------- | --------- | ------------------ | -------------------- |
| <img src="https://www.google.com/s2/favicons?domain=chat.deepseek.com&sz=32" width="16" height="16" alt="" style="vertical-align:middle"> DeepSeek         | `chat.deepseek.com`     | ✅ 已支持 | ✅                | ✅                |
| <img src="https://www.google.com/s2/favicons?domain=chatgpt.com&sz=32" width="16" height="16" alt="" style="vertical-align:middle"> ChatGPT          | `chatgpt.com`           | ✅ 已支持 | ✅                | ✅                |
| <img src="https://www.google.com/s2/favicons?domain=www.kimi.com&sz=32" width="16" height="16" alt="" style="vertical-align:middle"> Kimi             | `www.kimi.com`          | ✅ 已支持      | ✅                | ✅                |
| <img src="https://www.google.com/s2/favicons?domain=claude.ai&sz=32" width="16" height="16" alt="" style="vertical-align:middle"> Claude           | `claude.ai`             | ✅ 已支持 | ✅                | ✅                |
| <img src="https://www.google.com/s2/favicons?domain=www.doubao.com&sz=32" width="16" height="16" alt="" style="vertical-align:middle"> 豆包             | `www.doubao.com`        | ✅ 已支持 | ✅                | ✅                |
| <img src="https://www.google.com/s2/favicons?domain=yuanbao.tencent.com&sz=32" width="16" height="16" alt="" style="vertical-align:middle"> 元宝             | `yuanbao.tencent.com`   | ✅ 已支持 | ✅                | ✅                |
| <img src="https://www.google.com/s2/favicons?domain=gemini.google.com&sz=32" width="16" height="16" alt="" style="vertical-align:middle"> Gemini           | `gemini.google.com`     |           |                   |                   |
| <img src="https://www.google.com/s2/favicons?domain=www.qianwen.com&sz=32" width="16" height="16" alt="" style="vertical-align:middle"> 千问             | `www.qianwen.com`        | ✅ 已支持 | ✅                | ✅                |
| <img src="https://www.google.com/s2/favicons?domain=yiyan.baidu.com&sz=32" width="16" height="16" alt="" style="vertical-align:middle"> 文心一言         | `yiyan.baidu.com`       |           |                   |                   |
| <img src="https://www.google.com/s2/favicons?domain=chatglm.cn&sz=32" width="16" height="16" alt="" style="vertical-align:middle"> 智谱清言         | `chatglm.cn`            |           |                   |                   |
| <img src="https://www.google.com/s2/favicons?domain=xinghuo.xfyun.cn&sz=32" width="16" height="16" alt="" style="vertical-align:middle"> 讯飞星火         | `xinghuo.xfyun.cn`      |           |                   |                   |
| <img src="https://www.google.com/s2/favicons?domain=perplexity.ai&sz=32" width="16" height="16" alt="" style="vertical-align:middle"> Perplexity       | `perplexity.ai`         |           |                   |                   |
| <img src="https://www.google.com/s2/favicons?domain=grok.com&sz=32" width="16" height="16" alt="" style="vertical-align:middle"> Grok             | `grok.com` / `x.com`    |           |                   |                   |

> 「一键导出」= 注入总结咒语 + 自动发送 + 等待生成 + 自动保存（单条消息路径）；「导出全部对话」= 滚动遍历虚拟列表收集全量历史（多消息路径）。其余入口（导出最新 / 复制最新 / 自动推送 IMA）走同一路径、所有站点通用，不再单列。想要支持的站点请发 issue（附站点 URL + 截图 DOM 结构最佳），或参考下文「适配新站点」自行加 adapter。

## 安装

1. 浏览器装好 [Tampermonkey](https://www.tampermonkey.net/) 扩展
2. 点击 Tampermonkey 图标 → 「管理面板」→ 「新建脚本」
3. 清空默认内容，把 `chatdigest.user.js` 全文粘贴进去（v1.15.9 起项目更名为 ChatDigest / 聊摘，**v1.15.10 起脚本文件名也从 `chat2knowledge.user.js` 改为 `chatdigest.user.js`** —— 仍未发布用户重命名 0 成本）
4. `Ctrl + S` 保存即可生效

## 使用

1. 在任意支持的 AI 网页正常聊天
2. 想存档时，**直接点右下角 📑 主图标** → 一键导出：脚本自动注入「总结咒语」→ 自动发送 → 等待 AI 生成完成 → **自动抓取并保存为带 YAML 元数据头的 `.md`**
3. 需要更细粒度时，点主图标**右侧**的 **▴ 箭头** 展开菜单（自下而上）：
   - **📋 复制最新回复** → 复制到剪贴板
   - **📥 导出最新回复** → 直接下载当前最新回复（不重新生成）
   - **📚 导出全部对话** → 下载整段对话（会自动滚动收集从第一条到最后一条的完整历史，包括用户提问与 AI 思考过程；思考过程会以引用块 `> **💭 思考过程**` 与正式回复区分，稍候片刻）
4. 文件落地后，可手动导入 IMA / Obsidian / 任意知识库

## 配置项（脚本顶部）

```js
const SOFTWARE_NAME   = 'ChatDigest'; // 文件名前缀[软件名称]，可切换中英文（如中文发行版改 '聊摘'）
const IMA_ENDPOINT    = 'http://127.0.0.1:8765/ingest'; // 本地桥地址（与 ima_watcher.py --serve 端口一致）
```
> **自动推送 IMA 开关**：`AUTO_PUSH_IMA` 不再写死在源码里。脚本启动时若 Tampermonkey 存储区无记录（首次使用），**默认开启**并写入；之后可在 **Tampermonkey 箭头菜单（脚本命令）** 里随时切换「☁️ 自动推送 IMA：开/关」，状态持久化到存储区。无需改源码即可开/关。

### 文件名规范 `[软件名称]_[AI厂牌]_[时间戳]_[标题].md`

| 段 | 来源 | 示例 |
| --- | --- | --- |
| 软件名称 | `SOFTWARE_NAME` 常量（**v1.15.10 起按 locale 自动切换**） | 中文系统 `聊摘` / 其他 `ChatDigest` |
| AI厂牌 | 当前站点品牌 `SITE.name` | `DeepSeek` / `ChatGPT` / `Kimi` |
| 时间戳 | 现有格式 `YYYY-MM-DD_HHMM` | `2026-07-14_2259` |
| 标题 | 优先级：内容 h1 → 页面标题 → 留空 | `知识库命名规范设计` |

- 标题为空时省略末段：`ChatDigest_DeepSeek_2026-07-14_2259.md`
- 标题自动清洗非法文件名字符（`\ / : * ? " < > |` 等）并截断至 60 字
- 文件头内的一级标题与文件名标题保持一致，且正文已含 h1 时不再重复添加，避免文件内出现两个一级标题

## 可选：自动保存后推送 IMA（官方 OpenAPI）

**默认开启。** 脚本「📑 一键导出（或 📥 导出最新回复）」自动保存后，会顺带把 Markdown 推给本地 `ima_watcher.py`（需以 `--serve` 模式运行），经 `ima_upload.py` 走 **IMA 官方 OpenAPI**（create_media → COS 上传 → add_knowledge）直接导入知识库，不依赖任何第三方 CLI。

### 0. 一次性准备
1. 在 https://ima.qq.com/agent-interface 免费申请 **Client ID / API Key**（Key 仅显示一次，泄露可重置）。
2. 配置凭证（二选一）：

   **方式 A：环境变量（推荐）**

   Windows（CMD，`set` 仅当前窗口有效；想永久生效改用 `setx IMA_CLIENT_ID 你的ClientID`，需重开窗口才生效）：
   ```cmd
   set IMA_CLIENT_ID=你的 Client ID
   set IMA_API_KEY=你的 API Key
   ```
   Mac / Linux（bash，`export` 当前会话有效；想永久生效把这两行加到 `~/.bashrc` / `~/.zshrc`）：
   ```bash
   export IMA_CLIENT_ID="你的 Client ID"
   export IMA_API_KEY="你的 API Key"
   ```

   **方式 B：文件（脚本会自动读取，路径 `%USERPROFILE%\.config\ima\...`）**

   Windows（CMD）：
   ```cmd
   mkdir "%USERPROFILE%\.config\ima"
   echo 你的 Client ID>"%USERPROFILE%\.config\ima\IMA_CLIENT_ID"
   echo 你的 API Key>"%USERPROFILE%\.config\ima\IMA_API_KEY"
   ```
   Mac / Linux（bash）：
   ```bash
   mkdir -p ~/.config/ima
   echo "你的 Client ID"  > ~/.config/ima/IMA_CLIENT_ID
   echo "你的 API Key"    > ~/.config/ima/IMA_API_KEY
   ```
   注：`%USERPROFILE%`（Windows）= `~` / `$HOME`（Mac / Linux），三者等价都指向当前用户主目录。
3. 在你打算用的那个 Python 里装依赖（Windows 同样适用，在 CMD / PowerShell 里运行同样的命令即可）：`pip install -r tools/requirements.txt`。
   > ⚠️ **Miniconda / 虚拟环境用户**：bat 无法自动识别你的环境。Miniconda 默认不把 `python.exe` 加到 PATH，Windows 上 `where python` 优先命中的是 Microsoft Store 壳子或其他不相干的 python。**必须在 `tools/ima_config.ini` 里把 `PY =` 显式指向你环境的 `python.exe`**（例如 `C:\Users\<你>\miniconda3\envs\myenv\python.exe`），bat 会以这个硬编码路径为最高优先级。不知道 env 路径可以跑 `conda env list` 看。漏配这一项是桥接报 `No module named 'qcloud_cos'` HTTP 500 的最常见原因——尤其在重装 Miniconda 或者把依赖装到 base 之外的 env 之后。
4. 在 ima.qq.com 知识库设置里复制你的**知识库 ID**（形如 base64 长串）。需是当前账号**可写入**的库（个人库 / 有写权限的共享库）；上传时会自动校验，填错或无权限会立即报错并列出可选项。

### 1. 脚本侧开关（默认开启，无需改源码）
- 脚本启动若 Tampermonkey 存储区无记录（首次使用）**默认开启**自动推送并写入；之后随时可在 **Tampermonkey 箭头菜单（脚本命令）** 点击「☁️ 自动推送 IMA：开/关」即时切换，状态经 `GM_setValue`/`GM_getValue` 持久化。
- 桥地址默认 `http://127.0.0.1:8765/ingest`（常量 `IMA_ENDPOINT`），需与下方接收端 `--serve` 端口一致；一般不用改。

### 2. 启动接收桥（ima_watcher.py --serve）
```bash
python tools/ima_watcher.py --serve            # 默认读 ima_config.ini 的 KB_ID，端口 8765
python tools/ima_watcher.py --serve --port 8765 --kb-id "你的知识库ID"   # 可显式指定
```
Windows（CMD）：`python tools\ima_watcher.py --serve`
> `--kb-id` 可省略，省略时自动读取同目录 `ima_config.ini` 的 `KB_ID`；手动传参优先覆盖。
之后点「📑 一键导出」，脚本保存 `.md` 后会顺带推入 IMA 知识库（推送失败只是弹一条提示，本地 `.md` 照常保存，不会丢）。
完整参数与另一种「目录监视」用法见下方「接入 IMA 知识库 → ima_watcher.py 的两种用法」。

## 适配新站点

脚本顶部 `ADAPTERS` 对象集中了所有站点配置。要加新站，复制一项并改三个选择器即可：

```js
mysite: {
    name: '我的站点',
    assistantSel: '.ai-reply',          // AI 回复容器
    titleSel:     '.chat-title',        // 对话标题
    inputSel:     'textarea',           // 输入框
}
```

再用 F12 开发者工具「选择元素」箭头指向 AI 回复区域，把高亮 class 填进 `assistantSel` 即可。

## 接入 IMA 知识库（可选，官方 OpenAPI）

浏览器沙盒不能直连 IMA，本仓库放了一个独立桥梁：`tools/ima_watcher.py`（本地接收端 / 监视器）+ `tools/ima_upload.py`（实际上传器）。`ima_upload.py` 走 **IMA 官方 OpenAPI**（`https://ima.qq.com/openapi/wiki/v1`）：创建媒体拿 COS 临时凭证 → 上传文件到腾讯云 COS → `add_knowledge` 正式入库，**全程无第三方 CLI 依赖**。

> 首次使用需先申请并配置凭证、装依赖：见上方「可选：自动保存后推送 IMA → 0. 一次性准备」。

### ima_watcher.py 的两种用法

`ima_watcher.py` 是常驻本地的接收端，提供两种用法，按你的工作流二选一：

#### 用法一：HTTP 桥模式（--serve）— 接收脚本推送
配合上方「自动保存后推送 IMA」使用：脚本导出 `.md` 时主动把内容 POST 到桥，watcher 收到即落盘并上传。
```bash
python tools/ima_watcher.py --serve                 # 默认读 ima_config.ini 的 KB_ID，端口 8765
python tools/ima_watcher.py --serve --port 8765 --kb-id "你的知识库ID"   # 可显式指定
```
Windows（CMD）：`python tools\ima_watcher.py --serve`
- `--kb-id` 可省略，省略时自动读取同目录 `ima_config.ini` 的 `KB_ID`；手动传参优先覆盖。
- 桥地址 `http://127.0.0.1:8765/ingest` 需与脚本 `IMA_ENDPOINT` 一致（默认即一致，一般不用改）。
- 上传为**串行 + 节流**：统一在 `ima_upload.py` 的 `upload_file_to_kb`（进程内锁保证同一时刻只有一个上传，相邻两次至少间隔 1.5s，`--min-interval` 可改），平滑请求、降低被限流风险。

#### 用法二：目录监视模式 — 监视文件夹自动入库
不依赖浏览器推送：你（或脚本）把 `.md` 导出到某目录，watcher 监听该目录，出现新 `.md` 即自动上传。适合「已有 .md 落盘、想顺手入库」的场景。
```bash
python tools/ima_watcher.py "C:/Users/你/Downloads"          # 指定目录，KB_ID 读 ini
python tools/ima_watcher.py                                   # 省略：目录读 ini 的 SRC（仍无则 %USERPROFILE%\Downloads；Mac / Linux 等价 ~/Downloads），KB_ID 读 ini
```
Windows（CMD）：`python tools\ima_watcher.py "C:\Users\你\Downloads"`
- 目录参数与 `--kb-id` 均可省略：目录读 `ima_config.ini` 的 `SRC`（仍无则 `%USERPROFILE%\Downloads`；Mac / Linux 等价 `~/Downloads`），`--kb-id` 读 `KB_ID`。
- 已兼容浏览器「原子保存」：文件先以 `.md.part`/`.crdownload` 临时名写入、完成后再改名成 `.md`，watcher 会同时监听「直接落盘」与「改名落盘」两种事件，所以浏览器导出的 `.md` 也能被正确捕获（日志见 `[WATCH] 检测到 .md: …`）。
- 上传同样为串行 + 节流（同用法一），批量落盘时尤其能避免瞬时并发触发风控。
- 两脚本均支持 `--version` 查看版本（当前 `ima_upload.py` / `ima_watcher.py` = v1.2.1）。

#### Windows 一键启动器（双击 bat，免敲命令）

若不想开终端敲命令，可用仓库自带的两个启动器（位于 `tools/`，**双击即运行**）：

| 启动器 | 对应模式 | 说明 |
|---|---|---|
| `ima_watcher_bridge.bat` | 用法一（HTTP 桥 `--serve`） | 双击即起桥，等待脚本推送；关掉窗口即停止。 |
| `ima_watcher_monitor.bat` | 用法二（目录监视） | 双击默认监视 `ima_config.ini` 的 `SRC`（仍无则 `%USERPROFILE%\Downloads`；Mac / Linux 等价 `~/Downloads`）；**也可把文件夹拖到该 bat 上**，改为监视那个文件夹。关掉窗口即停止。 |

两个 bat 都会从同目录 `ima_config.ini` 读取 `PY`（Python 可执行文件，解决 Miniconda 未注册 PATH 的问题），无需手动配环境；`KB_ID` / `SRC` 仍由 `ima_watcher.py` 自己从 ini 读取。日志直接打印在弹出的控制台窗口里（常驻进程，关闭窗口即退出）。

### 纯命令行单次上传（ima_upload.py）
   ```bash
   python tools/ima_upload.py --kb-id "你的知识库ID" --file ./xxx.md
   ```
   Windows（CMD）：`python tools\ima_upload.py --kb-id "你的知识库ID" --file .\xxx.md`
   > `--kb-id` 可省略，省略时自动读取同目录 `ima_config.ini` 的 `KB_ID`；手动传参优先覆盖。`--title` 可指定入库标题（默认从文件名提取真实标题，见下）。

### 写入前自动校验权限

每次上传（`ima_upload.py` 的 CLI 与 `ima_watcher.py` 共用同一核心函数，一次改动全覆盖）会**先调用官方 `get_addable_knowledge_base_list`**，确认 `--kb-id` 属于当前账号**可写入**的知识库，校验通过才正式走 `create_media → COS → add_knowledge`；若不可写会立即报错并列出该账号所有可写知识库，方便核对 `--kb-id`。校验结果在进程内缓存，**每个 kb-id 只打一次接口**（watcher 长驻进程也只在首文件时校验一次）。

- 可写范围 = 你账号有写权限的知识库：**自己的个人库** / **自己建的共享库** / **你是「有写权限成员」的他人共享库**。
- `shareId` 分享链接（形如 `ima.qq.com/wiki/?shareId=...`）只是**只读视图**（访客限 3 轮问答），**不等于**可写入的 `knowledge_base_id`；想写入别人的共享库，需库主把你的账号加为写权限成员后，用该库的正式 `知识库 ID` 入库。

### 入库标题自动提取

上传时如果不显式传 `--title`，脚本会**从文件名自动提取真实标题**，去掉 ChatDigest 的命名前缀：

- 文件名规范：`[软件名称]_[AI厂牌]_[时间戳]_[标题].md`，例：`ChatDigest_DeepSeek_2026-07-15_2225_心经英译历史.md`
- 提取规则：以**时间戳段**（`YYYY-MM-DD_HHMM`，内部自带一个下划线）为锚点，取其**之后**的片段作为标题 → 上例提取出 `心经英译历史`
- 标题内若因清洗含下划线（如 `A_B_C标题`）会**原样保留**
- 以下情况**回退为原始文件名**（含 `.md`）：文件名不符合该规范（非 ChatDigest 导出的文件）、或时间戳后没有标题内容（如 `ChatDigest_DeepSeek_2026-07-15_2225.md` 这种省略末段的情形）
- **v1.15.9 之前导出的 `Chat2Knowledge_*.md` 文件也兼容**——`derive_title` 用时间戳锚点取其后内容，不依赖前缀字符串，旧文件 0 迁移成本
- 显式 `--title "..."` 时以传入值为准，不做任何处理

> ⚠️ **IMA 硬性规则**：入库后知识库显示的标题由 `title` 与 `file_name` 共同决定，**两者必须完全一致（含扩展名）**，否则一律回退显示原 `file_name`。因此脚本最终写入时会把提取出的标题统一规范为「`标题.md`」（缺扩展名则补 `.md`），并**同时作为 `create_media` 的 `file_name` 和 `add_knowledge` 的 `title`**。上例最终入库标题为 `心经英译历史.md`。

> 提取逻辑在 `tools/ima_upload.py` 的 `derive_title()`，CLI 与 `ima_watcher.py` 共用，一次改动全覆盖。

### 一键批量入库（ima_upload.bat，Windows）

嫌每次敲命令行麻烦，`tools/` 下附带了 `ima_upload.bat`，双击或拖放即可入库：

- **双击（不拖放任何东西）**：导入 ima_config.ini 的 `SRC` 指定的来源文件夹里**全部 `.md`**（仅一层，不递归子目录）。
- **拖放文件 / 文件夹到 bat 上**：导入被拖放项里的 `.md` —— 拖文件则 `.md` 才导入、非 `.md` 自动跳过；拖文件夹则导入该文件夹内的全部 `.md`（仅一层）。
- 拖放支持单文件 / 多文件 / 文件夹，路径含空格或特殊字符（`&`、`()` 等）均稳定。

**使用前一次性配置**（配置已移到独立 ini，bat 本身不再写任何配置）：

1. 把 `tools/ima_config_sample.ini` 复制为同目录的 `ima_config.ini`
2. 用记事本打开 `ima_config.ini`，填写下面三项（以 `;` 开头的行是注释，可忽略；等号前后可加空格、值里不要加引号）：

```ini
KB_ID = 你的知识库ID          ; 必填，ima.qq.com 知识库设置里查看
SRC   = C:\你的\导出目录      ; 双击模式用，留空则双击时必须拖放
PY    = C:\路径\python.exe    ; 可选；python 不在 PATH 时才需要（见下）
```

- `ima_config.ini` 已加入 `.gitignore`，不会随仓库提交、也不会泄露你的知识库 ID；仓库里只保留 `ima_config_sample.ini` 模板。
- `KB_ID` 为空时双击/拖放都会先报错提示，不会误传。
- **`PY` 就是 Python 可执行文件**（命令名或完整路径）。默认自动探测 `python` → 找不到再试 `py`；若你的 Python 是 **Miniconda 且未注册为默认 `python`**（PATH 里没有 `python`），直接把 `PY` 填成完整路径即可，例如 `PY = C:\Users\你的用户名\miniconda3\python.exe`（或某个虚拟环境 `…\envs\myenv\python.exe`）。
- 凭证沿用 `ima_upload.py` 的机制（环境变量 `IMA_CLIENT_ID`/`IMA_API_KEY` 或 `%USERPROFILE%\.config\ima\` 文件），**配置里不存凭证**。
- 详细用法、版本记录、以及「拖放闪退」排错见同目录 **`ima_upload_notes.txt`**（`.bat` 内禁止出现任何中文——含 echo 与注释——否则中文 Windows 下会闪退，故说明独立存放）。

> bat 本质只是调用 `ima_upload.py` —— 写入前权限校验、标题自动提取等规则与命令行完全一致（共用 `upload_file_to_kb`）。

## 文件结构

```
CHATDIGEST/
├── chatdigest.user.js        # 主脚本（Tampermonkey；v1.15.10 起从 chat2knowledge.user.js 改名）
├── README.md                # 本说明（英文）
├── README.zh.md             # 本说明（中文，本文件）
├── CHANGELOG.md             # 历史更新日志（脚本 / Python 工具链版本与排错记录）
└── tools/
    ├── ima_watcher.py           # 可选：本地 IMA 导入监视器 / HTTP 桥（官方 OpenAPI）
    ├── ima_upload.py        # 可选：IMA 官方 OpenAPI 上传器（create_media→COS→add_knowledge）
    ├── ima_upload.bat       # 可选：Windows 一键批量入库（双击=SRC 目录 / 拖放=选中项）
    ├── ima_watcher_bridge.bat  # 可选：Windows 双击启动 HTTP 桥模式（--serve），等脚本推送
    ├── ima_watcher_monitor.bat # 可选：Windows 双击启动目录监视模式（可拖文件夹上去指定监视目录）
    ├── ima_config_sample.ini    # 一键入库配置模板（复制为 ima_config.ini 后填写；ima_config.ini 已 gitignore）
    ├── requirements.txt      # Python 工具链依赖清单（pip install -r tools/requirements.txt）
    └── ima_upload_notes.txt # ima_upload.bat 使用说明与版本记录（.bat 内禁注释，说明独立存放）
```

### 导出元数据（YAML frontmatter / Obsidian Properties）

每个导出文件都在文件顶部写入**同一个** YAML frontmatter 块，对齐 Obsidian Properties 与 Web Clipper 文章模板规范，且被 Jekyll/Hugo/VuePress 等静态站点生成器广泛识别：

| 属性 | 值来源 | 格式 |
| --- | --- | --- |
| `title` | `resolveTitle()` 标题（含特字符时自动加引号） | 文本 |
| `source` | 对话 URL `location.href`（必加引号） | 带引号的 URL |
| `author` | 当前 AI 厂牌 `SITE.name`（如 `DeepSeek` / `豆包`） | 文本 |
| `created` | 抓取日期 | `YYYY-MM-DD` |
| `description` | 自动从正文首段提取摘要（≤200 字，超出加 `…`） | 文本（无正文时省略该键） |
| `tags` | 仅软件名称（如 `ChatDigest`）；厂牌已由 `author` 承载，不重复 | 列表（块式 `- 项`） |

规范要求：键名小写；`tags` 必须为列表且纯文本不带 `#`；URL 与含 `:` `#` 的值加引号；`created` 而非 `date` 避免重复；单个 frontmatter 块、闭合后空一行。

> `published` 在 AI 对话场景下无真实发布时间，故未写入（如需可改为捕获时间）。

## 更新记录

完整的历史更新日志（含 `chat2knowledge.user.js` 各版本、Python 工具链 `ima_upload.py` / `ima_watcher.py` / `ima_upload.bat` 的版本与排错记录）已独立存放于 **[CHANGELOG.md](./CHANGELOG.md)**。
