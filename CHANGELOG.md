# 更新记录（CHANGELOG）



**Latest: v1.21.0（脚本） / v1.2.8（Python 工具链） / 2026-07-22** — **Gemini (gemini.google.com) production-ready: 13 fix cascade**:

## v1.21.0：Gemini (gemini.google.com) production-ready: 13 fix cascade (2026-07-22)

Gemini ADAPTERS 13 commit cascade 修完, 让 Gemini 从"勉强可用"→"真正 production-ready" (跟 v1.18.0 Kimi / v1.20.0 元宝 / v1.20.2 千问 production-ready 同级). 按 user 决定走 minor (1.20.2 → 1.21.0, 首次真正支持新站点 = 能力扩展):

### Gemini 站专属修复 (12 commit)

1. **`0586740` Gemini (gemini.google.com) ADAPTERS 适配 — 7 站点全支持**:
   - 1 个新 ADAPTER (`gemini`), 跟 v1.20.0 元宝 / v1.20.2 千问一样 4 处改动一致: `@match` `gemini.google.com` / `ADAPTERS.gemini` / `isUiChrome` 10 个 chrome filter (cdk-visually-hidden / sr-only / visually-hidden / screen-reader-* / message-actions / freemium-rag-disclaimer / gem-icon-button / gem-popover / mat-menu + closest 链) / `detectSite` `gemini` 路由.
   - Gemini 站用 Angular Material + custom element (`<code-block>` / `<gem-icon-button>` / `<message-actions>` / `<rich-textarea>` 等), 跟其他站 `<div>` / `<section>` 完全不同, 适配器必须祖先检查 (`el.closest()`) 多次拆不能用 `closest('A, B')` selector list.

2. **`0e44ea5` initUI panel 改用 DOM API 重建, 修 Gemini CSP / Trusted Types 报错**:
   - Gemini 站 CSP / Trusted Types policy 不允许 `innerHTML` setter 注入 HTML 字符串. `initUI` 之前用 `innerHTML` 一行注入整个 panel HTML, Gemini 报 "Sink type mismatch violation".
   - 修法: 改用 DOM API (`document.createElement` + `appendChild` + `setAttribute`) 逐步重建 panel element tree, 不触发 Trusted Types 校验.

3. **`87d4df1` initUI 局部 const `menu` 改名 `menuEl`, 修 const/let 重名冲突**:
   - 改 initUI 用 DOM API 重建 panel, 局部加 `const menu = document.createElement('div')` 跟外层 `let menu` (line 1934) 同名, line 2002 `menu = panel.querySelector('#c2k-menu')` 给 const 赋值抛 "Invalid assignment to const 'menu'". strict mode 直接 SyntaxError 拒绝执行, Tampermonkey 静默吞, FAB 全部失效.
   - 修法: 局部 const 改名 `menuEl`, 外层 `let menu` 赋值保留, line 2012/2016/2020 引用外层 menu (= menuEl 同元素) 行为 0 变化.

4. **`fb9152e` Gemini FAB 注入/发送 3 处加固 (rich-textarea dispatch + success check + execCommand fallback)**:
   - Gemini input 是 `<rich-textarea>` 包 `<ql-editor>` (Quill editor), paste / keydown event 必须派发到 2 个 target (rich-textarea 跟 ql-editor). 派发到 1 个 target 不会触发另一个. execCommand fallback 修复 input 失焦时 setInputValue 不生效.

5. **`fa61d60` injectSummaryPrompt 发送 check 改 3s + msgs.length 增量判断 (Gemini 模式)**:
   - Gemini 模式 AI 回复 1-5s 才出现 model-response, 旧版 1.5s check 误判"没回复 → 发送失败". 改 3s + msgs.length 增量判断: msgs 增加 → 发送成功.

6. **`cc5a864` injectSummaryPrompt send check 加 user-query 数量信号 (Gemini 模式秒出)**:
   - 进一步加 user-query 元素增量判断, Gemini 模式 user-query 元素 100ms 秒出 (不等 AI 启动), 3 个成功信号 (a) input 清空 OR (b) msgs 增加 OR (c) users 增加 任一通过即成功. 同时新增 i18n `toast.sendFailed` (zh+en) 替代之前误导文案 "找不到输入框".

7. **`47fcb96` 撤回 `6fd39b6` 多 target Enter 派发 over-engineering, 改用 send button click**:
   - `6fd39b6` 一坨 5 target Enter 派发 + beforeinput 兜底 (28 行), user 实测报"杀鸡用牛刀" + 给完整 send button HTML. 我没看 user 提供的 HTML 仔细分析就上 multi-target 派发链, 实际根因是 sendSel 可见性 check 在 Material Design CSS 下 (`b.offsetParent !== null` 失败) → 改 1 行 + 加 `[data-test-id*="send-button"]` 命中 Gemini 容器. 撤回 6fd39b6 (净 -30 行), 改 sendSel 可见性 check 用 `getClientRects` + 加 `[data-test-id*="send-button"]` 兜底 (净 +17 行).

8. **`a1a19e6` autoSend 改轮询 send button (Gemini 内容驱动型 button 兜底)**:
   - Gemini send button 是**内容驱动**渲染 — input 空时容器 `display:none`, input 有内容后 Angular re-render 加 "visible" class → `display:block`. 旧版 autoSend 同步 query 500ms 内 Angular re-render 没完成 → 按钮还在 `display:none` → 找不到 → 走 fallback → fallback 也不工作 → 双重失败.
   - 修法: autoSend 改**轮询** (100ms 间隔, 最多 2s), button 一出现立刻 click, 实测 <500ms 命中.

9. **`ffa14c4` autoSend toast 移走, 发送确认后才显示 (避免 click≠成功的误导)**:
   - autoSend 调 `btn.click()` 立即 `toast('已自动发送', 'ok')` 是反模式, click 是 attempt 跟 success 是两件事. Gemini 模式下 click 后 input 失焦 / Angular 处理中, 3s 后才真发出去, 立即 toast "已发送" 跟 3s 后 "发送失败" 矛盾.
   - 修法: autoSend 只做 attempt 不 toast, 3s check 确认 (user-query 出现 / msgs 增加 / input 清空) 后才 toast. 顺手清理 dead i18n key `toast.autoSentEnter` (autoSend fireEnter 后不再 toast, key 没用).

10. **`f394fed` autoSend 优先选 `<button>` 元素, 避免 click container div 失效 (Gemini)**:
    - sendSel 加 `[data-test-id*="send-button"]` 跟 `button[aria-label*="发送"]` 都命中, 但 `el.click()` 在 div container 上 dispatch 出去, click 事件**向上 bubble 不是向下** — 不会触发 inner button 的 click handler. Gemini send 结构嵌套: `<div data-test-id="send-button-container"><gem-icon-button><button aria-label="发送">`.
    - 修法: 抽 `findSendButton()` helper, 3 层降级: 1) candidates 里直接有 `<button>` tag → 用它, 2) container/wrapper → drill down `querySelector('button:not([disabled])')` 找内部, 3) 兜底用 candidates[0].

11. **`52af215` isUiChrome strip accessibility-hidden 元素 (修 Gemini "Gemini 说" 出现在抓取开头)**:
    - Gemini 站用 `<h2 class="cdk-visually-hidden screen-reader-model-response-label">Gemini 说</h2>` 作为 screen-reader 提示, 视觉上不可见 (CSS `clip: rect(0 0 0 0); position: absolute;`) 但 textContent 还在 DOM 里, messageToMd 走 DOM tree 时把 "Gemini 说" 拼到 AI 回复开头.
    - 修法: isUiChrome 加跨站通用 accessibility-hidden class 检查: `cdk-visually-hidden` (Material Design) / `sr-only` (Bootstrap 3) / `visually-hidden` (Bootstrap 4) / `screen-reader-only` (自定义) / `screen-reader-text` (自定义). 任何站出现这些 class 立即 strip, 跨站通用.
    - Python 静态分析 gemini.html offset 164506 验证 7 个 cdk-visually-hidden 元素全是 screen-reader 文本 (与 Gemini 对话 / 你说 / Gemini 说 / 使用麦克风 等), 0 个超 20 chars, 不会误伤真实内容.

12. **`680ee36` Gemini 站 `<code-block>` custom element handler + isUiChrome 兜底 strip code-block-decoration**:
    - Gemini 站用 `<code-block>` custom element 包装代码块, 结构 `<code-block><div class="code-block-decoration header-formatted gds-emphasized-body-m"><span>Ini, TOML</span><div class="buttons">下载/复制</div></div><pre><code data-test-id="code-content" class="code-container formatted"><span class="hljs-comment"># 使用 gpu-next ...</span>...</code></pre></code-block>`.
    - 修法 (3 部分): 1) isUiChrome strip `code-block-decoration` class 整块 wrapper (含语言标签 + 复制/下载按钮, class 匹配整块不依赖具体语言名); 2) blockToMd 加 `<code-block>` custom element handler, 抽语言 (`.code-block-decoration > span` 任意 string lowercase) + 抽代码 (`<pre><code>`, 不依赖 `<code>` class 的 language-XXX 标记, Gemini `<code>` class 只含 hljs-* 语法高亮); 3) 抽 `codeBlockToMd` helper 跨站统一 3 处 (`<pre>` / DeepSeek / Gemini), 共同逻辑 (empty 检查 / MD_SOURCE_LANGS 解包 / wrapFencedCode 包围栏) 走 helper.
    - user 实测 (Python 模拟 user 提供的真实 outerHTML) 6 个检查项全 pass.

13. **`89e3221` wrapFencedCode normalize lang 字符, 修 Gemini "ini, toml" lang 不识别导致 markdown renderer 不 wrap code block**:
    - 真根因: 680ee36 commit 修了 `<code-block>` handler, 但 ` ```ini, toml ` fence lang 标识符含 `,` + ` ` 字符, **所有主流 markdown renderer** (VS Code / Obsidian / Typora / GitHub web) 看到 `,` ` ` 不识别为合法 fence info string, **不 wrap 成 code block, 整段当 inline text 处理**. CommonMark spec 严格说 info string 任意字符合法, 但**实际 renderer 行为**不一致, 是 spec 跟实现 gap.
    - 之前 Python 模拟 (verify_e2e.py) 全部 PASS, 因为模拟只看 raw markdown 文本 contains 检查, **不** 跑 markdown renderer, 漏了这层. user 实测报"问题依旧"才暴露 renderer 行为差异.
    - 修法: `wrapFencedCode` 内 normalize lang 字符串, 去掉所有非合法 fence lang 字符 (`[^a-zA-Z0-9_+#.\-]`), `ini, toml` → `initoml` (合法 lang, renderer 接受). 保留 `+` `#` `.` `-` 让 `c++` / `C#` / `objective-c` / `fsharp` 等真 lang identifier 不被破坏. 一处修, 4 个 wrapFencedCode 调用点 (`<pre>` / DeepSeek / Gemini / 其他) 自动应用, 跨站通用.
    - 真测 (Python 模拟 22 case, 2026-07-22): `ini, toml` → `initoml` / `Shell/Bash` → `ShellBash` / `Python 3` → `Python3` / `HTML / CSS` → `HTMLCSS` / `c++` / `C#` 保留 / 合法 lang (python / bash / json / markdown / 等) 全部不变 0 行为 regression.

## v1.20.2：千问 (www.qianwen.com) production-ready: 5 fix cascade (2026-07-22)

千问 ADAPTERS 5 commit cascade 修完, 让千问从"勉强可用"→"真正 production-ready" (跟 v1.18.0 Kimi / v1.20.0 元宝 production-ready 同级). 按 user 决定走 patch (1.20.1 → 1.20.2):

1. **`e9116d1` 千问 (www.qianwen.com) ADAPTERS 适配 — 6 站点全支持**:
   - 1 个新 ADAPTER (`qwen`), 跟 v1.20.0 元宝一样 4 处改动一致: `@match` `www.qianwen.com` / `ADAPTERS.qwen` / `isUiChrome` 4 个 chrome filter (chat-msg-bottom-anchor / answer-meta / assistant-text / chat-question-wrap) / `detectSite` `qianwen` 路由.
   - selector 用 CSS attribute `[class*="前缀"]` 兼容千问 CSS Module hash 风格 (`message-card-j_n6rq` 等 hash 每次 build 变, 语义化前缀稳定): `[class*="chat-answers-card-wrap"]` (AI) / `[class*="chat-question-card-wrap"]` (user) / `div[contenteditable="true"][data-slate-editor="true"]` (Slate editor 输入框).
   - 品牌已统一: `tongyi.aliyun.com` → `www.qianwen.com`, `ADAPTERS.tongyi` → `ADAPTERS.qwen`, `name` `'通义千问'` → `'千问'`. 不 bump @version (跟 yuanbao d9e44e3 / d98bb7a 一样攒一起发).

2. **`af43b88` ul handler stripLead 加 lookahead `(?!\*)`, 避免误伤 markdown bold 起始的 \***:
   - 症状: 千问 list 里 AI 写的合法 bold `**内容提炼**` 被错配成 `*内容提炼**` (开头 * 缺一个, 结尾 ** 多一个). 千问 table 里的 `**代码展示**` 正常, 但 list 里 `<strong>` 包的就错.
   - 真根因: 跟 v1.20.0 元宝双 marker 修是**完全同一个 bug 模式**. 千问 chat-answers-card-wrap 把 `**X**` 解析成 `<strong class="qk-md-strong">` (跟 `<em>` 不一样, em 千问不解析, strong 千问**会**解析), `inlineToMd` 处理 `<strong>` → `**` + inner + `**` 输出 `**内容提炼**` (line 414 对的). 但 ul handler 的 `stripLead = /^\s*[-*+•·]\s*/` (line 558) 字符类**包含 `*`**, body 开头 `**` 的第一个 `*` 命中 stripLead, 被吃掉 1 个, 留下 `*内容提炼**`. prefix `- ` + body → `- *内容提炼**`.
   - 修法: ul stripLead 加 lookahead `(?!\*)` 排除 marker 后接 `*` 的 case (即 markdown bold / italic emphasis 起始): 旧 `/^\s*[-*+•·]\s*/` → 新 `/^\s*[-*+•·](?!\*)\s*/`. `*` 后接 `*` (即 `**X**` bold 起始) → 不命中, 保留完整. `*` 后接空格 (元宝 `* 一些` 残留) → 仍命中, strip `* ` . `•` 后接字符 (元宝 `•首行` 残留) → 仍命中, strip `•`. 数字 marker (ol 路径) → 不受影响, 行为 0 变化. 已知合法路径 (DeepSeek / Kimi / 豆包 / 元宝) 都把 `*X*` 解析成 `<em>`、`**X**` 解析成 `<strong>`, `inlineToMd` line 414/415 对称输出, 不会有错配, fix 走完后正则不命中 → 行为 0 变化.

3. **`22dfd90` 千问表格 chrome strip — `qk-md-table-action*` / `qk-md-table-download-*` / `qk-md-download-icon` / `qk-md-copy-icon` 加 isUiChrome**:
   - 症状: 千问 table 周围有 action bar (含"表格"标题 + "下载为表格" / "导出为图片" 按钮 + 复制 svg 图标), 这些 chrome 文本泄漏到 .md 导出.
   - 真根因: `isUiChrome` 千问 regex 没覆盖这些 `qk-md-*` 风格稳定 class. `inlineToMd` 入口 line 409 `if (isUiChrome(el)) return ''` 没匹配 → 走 line 427 `return inner` 透传 textContent → "表格" / "下载为表格" / "导出为图片" 文本泄漏.
   - 修法: 千问 chrome regex 加 4 个前缀: `qk-md-table-action[-title/-bar]` (action bar wrapper + 子元素) / `qk-md-table-download-[wrapper/icon/menu/menu-item]` (下载按钮 + 菜单, 内含"下载为表格"/"导出为图片" 文字) / `qk-md-download-icon` (下载 svg) / `qk-md-copy-icon` (复制 svg). **不能 strip 同前缀但语义是内容的 class**: `qk-md-table` / `-head` / `-body` / `-row` (真实 table 结构), `qk-md-table-section` / `-wrapper` / `-container` (table 容器, table 在 `-container` 内), `qk-md-text` / `-paragraph` / `-ul` / `-ol` / `-li` / `-strong` / `-code` (实际正文). regex 关键词是 `action` / `download` / `copy`, 不含 `section` / `wrapper` / `container` 等, 安全.
   - 镜像测试 27/27 pass (8 chrome 命中 + 14 非 chrome 不命中 + 4 原千问 chrome) + 千问真实 DOM 不误伤 4/4 pass.

4. **`e5a9513` 千问卡片预览 chrome strip — `card-container-[\w-]+` 整块**:
   - 症状: 千问 AI 偶尔会"莫名其妙"嵌入一个卡片链接预览, 整块是 link 引用 (含 svg 缩略图 + title + "创建于 xx:xx" 描述), 跟 AI 写的回复内容无关, 整块泄漏到 .md.
   - 真根因: `isUiChrome` 千问 regex 没覆盖 `card-container-*` 前缀. 千问 CSS Module hash 风格 (跟 `message-card-j_n6rq` 同款), 但前缀 `card-container` 不在已有 regex. 整块 div 走容器回退, title / 描述文本 / svg 全部透传.
   - 修法: 千问 chrome regex 加 `card-container-[\w-]+` 前缀 (CSS Module hash 通配). 整块 div 走 `blockToMd` 入口 line 463 `if (isUiChrome(el)) return ''` 一刀切 strip, 不进入 routeChild 递归. 不跟已有 class 冲突: `chat-answers-card-wrap` (千问 ADAPTERS 选中) / `chat-question-card-wrap` / `message-card-wrap` / `message-card-j_n6rq` / `office-card-wrapper-` (qwen.html 命中) / `card-wrap` (qwen.html 命中) 全部不命中 (前缀不同).
   - 镜像测试 11/11 pass (4 `card-container-*` 命中 + 7 非 chrome 不命中) + 千问真实 DOM 不误伤 4/4 pass.

5. **`4c27dc7` 千问 AI 回复末尾 \`\`\` 装饰 strip — `qk-md-text` + 纯 3+ 反引号 textContent 命中 isUiChrome**:
   - 症状: user 实际 .md 末尾 1 行孤立 \`\`\`, 全文 0 开场围栏, 0 配对 (1 处 3+ 连续反引号都在末尾). 之前以为是 card-container 内部残留, 实际不是.
   - 真根因 (用 qwen.html 完整 HTML 重新 verify, 2026-07-22): 千问 AI 回复末尾有个"分隔装饰" — `<br><span class="qk-md-text complete">\`\`\`</span>` 在 `card-container-wide` div **配对范围** 158258-170983 **之后** (绝对 pos 171033, 在 div 外但在 chat-answers-card-wrap 内). 千问不解析 \`\`\` 围栏, 原样 textContent. `inlineToMd` 对 span fall through line 427 `return inner` 透传, raw \`\`\` 字符进 .md 末尾, `blockToMd` 容器回退 line 608 `return '\n' + ... + '\n\n'` 拼成末尾 1 行孤立 \`\`\`. `balanceFences` 不会补 (0 开场不补), `unwrapSourceFences` 不会解 (无围栏可解). 这次加固**按 user 思路 (不是末尾 strip hack), 直接加固 isUiChrome 拦截源**.
   - 修法: `isUiChrome` line 313 加一条检查 — 千问 `qk-md-text` class + textContent 是**纯 3+ 反引号** (regex `/^[ \t\n]*\`{3,}[ \t\n]*$/`) → strip. **不能误伤**: 含其他字符的 qk-md-text (如 `<span class="qk-md-text complete">普通文本</span>`) 仍正常透传, 因为 regex 要求 textContent 严格匹配纯反引号.
   - 镜像测试 16/16 pass (user 报告 case + 各种边界: 末尾换行 / 前后空白 / 6 反引号 / 混合字符 / 其他 class / 简化 class / 已有 chrome / 单反引号 / 双反引号 / 空 textContent / 纯空白). qwen.html 真实 span (`<br><span class="qk-md-text complete">\`\`\`</span>`) 验证 isUiChrome 命中 True.

## v1.20.1：report-bug 路径注入 @version + 菜单顺序调整 + SCRIPT_VERSION 兜底去 hardcode (2026-07-21)

## v1.20.1：report-bug 路径注入 @version + 菜单顺序调整 + SCRIPT_VERSION 兜底去 hardcode (2026-07-21)

v1.20.0 release 后, user 实测过程中提的 3 个跟"报告 bug 链路"相关的体验 / 鲁棒性改进, 3 commit cascade 修完 (按时间序):

1. **`aafc1f8` report-bug 路径注入 @version — user 复制 alert / dev 看 console 一眼锁定版本**:
   - 症状: v1.15.15 加的"report bug"菜单 + 终极保险 FATAL alert 文案硬编码 "ChatDigest" (无版本号)。user 复制 alert 文本报告 bug 时, dev 不知道是哪个版本触发的 —— 必须追问"你装的是 v1.19.0 还是 v1.19.1 还是某个 hack commit", 浪费 1 轮对话。同样 v1.15.13/14 时期 cache-busting hack commit 留的"半新半旧"版本, @version 头跟实际运行代码可能略不同, dev 看到 console log 也很难精确定位是哪个 commit。
   - 修法: 在 IIFE 顶部提取 SCRIPT_VERSION (优先 `GM_info.script.version` 反映**实际运行**版本, 兜底硬编码 '1.20.0' 跟 @version 头对齐, 终极保险 'unknown'), 拼成 `CHATDIGEST_TAG = 'ChatDigest: <version>'`, 然后 5 处 report-bug 路径用同一个 tag 注入版本号:
     - (1) `GM_registerMenuCommand` 菜单 label
     - (2) 菜单点击后的 alert 弹窗
     - (3) v1.15.15 终极保险 FATAL alert msg (IIFE 顶层 catch)
     - (4) v1.15.15 FATAL console.error
     - (5) SUMMARY_PROMPT t() 失败 fallback console.error
   - daily-use 的 i18n MSGS (console.exportAllFailed / console.inputNotFound / console.initFailed / alert.initFailed / console.started 等) 故意**不动**: 这些是用户日常使用看到的 console.log / alert / toast 提示, 每天可能弹几十次, 加版本号会啰嗦。report-bug 路径是低频 (用户遇到 bug 才会触发), 加版本号对 dev 排查价值高。

2. **`fa6d7b1` SCRIPT_VERSION 兜底不再 hardcode '1.20.0' — 真不可用就 'unknown'**:
   - user 反馈: aafc1f8 用了 3 层 fallback (GM_info → 硬编码 '1.20.0' → 'unknown'), 硬编码 '1.20.0' 是错的: 下个版本 bump 完, 忘改这里就回 '1.20.0' 跟实际运行代码不一致 —— dev 看到 alert 报 "ChatDigest: 1.20.0" 但实际跑的是 v1.20.1 / v1.21.0 新代码, 排查时按错版本号查 CHANGELOG 浪费 1 轮。
   - @version 头也是 hardcode, 不能用 1.20.0 当兜底源头 (跟 .user.js 头里的 @version 永远同步, 兜底就退化成 "恒等于 @version 头", 失去 dynamic 意义)。
   - 修法: 简化为 2 层: (1) `GM_info.script.version` (Tampermonkey 注入, 反映实际运行版本); (2) 兜底 `'unknown'` (不再 hardcode 任何数字)。报 `'unknown'` 时 dev 一眼看出 "用户那边 GM_info 异常 / 沙盒不可用", 该追问环境信息 (浏览器 / Tampermonkey 版本 / @grant 设置) —— 比错信错版本号要稳。

3. **`8efcb97` report bug 菜单移到 IMA 推送开关下方**:
   - user 偏好: Tampermonkey 菜单里 report bug 应该排在 IMA 推送开关**下方**, 而不是 v1.15.15 双保险设计的"IIFE 顶部先注册"位置 (那条会导致菜单 UI 顺序变成 report bug 在 IMA 推送开关**之前**)。
   - 原 v1.15.15 设计: 顶部立刻注册一个 hardcoded label 的 report bug 菜单项, 即使后续 throw 也保留 (跟 IIFE 顶层 catch 弹 FATAL alert 形成双保险)。代价: menu UI 顺序里 report bug 永远在 IMA 推送开关之前。
   - 修法: 把 report bug 注册抽成函数 `registerReportBugMenu()`, 移到 `waitBody` 里 `initUI` 之后调 (跟 `registerPushMenu` 同一注册路径), 菜单 UI 自然落到 IMA 推送开关下方。同时拆 `initUI` 的 try/catch 边界:
     ```js
     (function waitBody() {
         if (document.body) {
             try {
                 initUI();
             } catch (err) {
                 console.error(t('console.initFailed'), err);
                 alert(t('alert.initFailed') + ' ' + err.message + '\n' + t('alert.initFailed.detail'));
             }
             // 无论 initUI 成功还是 throw, 都注册菜单 —— 顺序: IMA 推送开关 → report bug
             registerPushMenu();
             registerReportBugMenu();
             return;
         }
         setTimeout(waitBody, 100);
     })();
     ```
   - 行为保证:
     - `initUI` 自身 throw → `waitBody` catch 抓住 + alert 弹 → 仍调 `registerPushMenu + registerReportBugMenu` → 菜单 UI 完整 (IMA 推送 → report bug 都在)
     - `initUI` 成功 → 正常注册两个菜单 → 同上顺序
   - 代价 (设计 trade-off): line 74-1912 之间 throw 时, 菜单里没 report bug。但这段全是 const/let 定义 + function 声明 (v1.15.13 已修 MSGS TDZ), 理论上不该 throw; 极端情况由 IIFE 顶层 catch 弹 FATAL alert 兜底 (CHATDIGEST_TAG 带版本号, user 复制 alert 文本照样能报告)。v1.15.15 双保险"菜单也保留"维度丢一边, 但 IIFE 顶层 catch 兜底保留。

`Semver`: **1.20.0 → 1.20.1 patch**:
- 3 commit 都是 debug 文案增强 + 菜单 UI 顺序调整, 没改 chat 端到端逻辑, 不算新可见能力
- 严格说 patch (跟 v1.20.0 minor 的 3 fix 性质不同: 那些改 chat 端到端, 这次改 report-bug 链路)
- `IMATOOLS_VERSION` 不动 (1.2.8 仍最新, 这次全是 userscript 端, Python 工具链 0 改动)

`@version` 1.20.0 → 1.20.1。

**所有站点** (DeepSeek / ChatGPT / Kimi / Claude / 豆包 / 元宝) 0 回归:
- aafc1f8: 加 `CHATDIGEST_TAG` 拼装, 5 处 report-bug 路径用 tag, daily-use MSGS 保持原状
- fa6d7b1: SCRIPT_VERSION 兜底从硬编码 '1.20.0' 改成 'unknown', 行为等价或更安全
- 8efcb97: `registerReportBugMenu()` 抽函数 + `waitBody` 拆 try/catch 边界, `initUI` + `registerPushMenu` 行为完全不变, FAB 显示逻辑 0 改动

Last 3 个脚本版本：v1.20.1（2026-07-21, report-bug 路径 @version 注入 + 菜单顺序调整 + SCRIPT_VERSION 兜底去 hardcode, semver patch）/ v1.20.0（2026-07-21, Yuanbao production-ready：3 fix cascade 修 IMA push yaml 头 + list 双 marker strip + SUMMARY_PROMPT 防文档工具逃逸, semver minor）/ v1.19.0（2026-07-20, 豆包真正支持 + OL list continuation indent 修复, semver minor）。

## v1.20.0：Yuanbao (yuanbao.tencent.com) production-ready: IMA push yaml 头 + list 双 marker strip + SUMMARY_PROMPT 防文档工具逃逸 (2026-07-21)

yuanbao ADAPTERS 早在 `afadcc2` (v1.19.0 阶段 commit) 就已经加上 (DOM selector / chrome filter 4 selector 校准 + send button `[id="yuanbao-send-btn"]` + contenteditable paste event 修多行注入),但 v1.19.0 发版时 yuanbao 实际还留 3 个真 bug,只有 chatdigest 自身下载那份 file 不受影响、IMA push 落盘那一份 + list 渲染 + AI prompt 行为都偏离预期。v1.20.0 3 commit cascade 修完, yuanbao 真正 production-ready:

1. **`3d2fc8b` FAB 一键导出 IMA push 跟 download 用同一份 full (含 yaml 头)**:
   - 症状: `AUTO_PUSH_IMA` 开启时, `waitAndAutoSave` 完成时 `pushToIma(md, buildFileName(md))` 直接传裸 `md`, 跟 `downloadMarkdown` 内部算的 `full = buildHeader(...) + md` (带 yaml 头) 不一致。`ima_watcher.ingest_content(content, filename, watch_dir, kb_id)` 收到后 `f.write(content)` 落盘到 `watch_dir` (默认 `%USERPROFILE%\Downloads`, 跟浏览器下载同目录)。结果 Downloads 文件夹出现 2 个几乎同名的 .md: 浏览器下载的有 yaml 头 / IMA push 落盘的无 yaml 头。
   - 用户反馈: 2026-07-21 用户在 yuanbao 看到 Downloads 里没 yaml 头那份 (其实 IMA push 落盘的), 误以为 `downloadMarkdown` 漏了 frontmatter。其实 `downloadMarkdown` 一直是对的 (用户 `导出最新回复` / `导出全部对话` 都能正常出 yaml 头), 是 push 路径漏一步 `buildHeader`。
   - 修法: `waitAndAutoSave` 完成时 `pushToIma(full, buildFileName(md))` 用同一份 `full` (含 yaml 头)。`buildHeader` / `buildYamlFrontmatter` / `downloadMarkdown` / `buildFileName` / `resolveTitle` 主体逻辑 0 改动, 1 处增 3 行。
   - 镜像测试: `verify_yuanbao_push.py` 验证 buildHeader / buildYamlFrontmatter / buildFileName / resolveTitle 纯函数, 新 push 跟 download 内部字面 100% 一致。

2. **`c1231df` yuanbao list 渲染双 marker — strip body 开头 AI 自带的 list marker**:
   - 症状: yuanbao 把 AI 写的 markdown 风格 list 文本 ("1. xxx" / "• xxx") 渲染为 `<ol><li>1. xxx</li></ol>` (跟 `<ul><li>• xxx</li></ul>` 同), `blockToMd` 处理 `<ol>/<ul>` 时给每个 `<li>` 加 prefix ("1. " / "- "), body 开头又已经带 "1. " / "• " marker, 拼起来成双 marker:
     ```
     1. 1.**能力边界固化**: ...
     2. 2.**指令高度稳定**: ...
     - •首行直接以一级标题进入主题
     ```
   - 根因: 之前一直误判为 "list 嵌套 quirk", 实际是 yuanbao 渲染机制特有: yuanbao 把 markdown 风格 list 文本内嵌为 `<ol><li>` 的 children 文本, 不是从结构生成。DeepSeek / Kimi / 豆包用真实 `<ol><li>` 渲染 (body 不带 marker), 所以好。
   - 修法: 处理 `<ol>/<ul>` 时, strip body 开头 AI 自带的 list marker, 跟外层 prefix 只留一份:
     - `ol`: `/^\s*\d+[.)]\s*/` (匹配 "1. " / "1) " / "1." / "1)", 允许 0+ 空格)
     - `ul`: `/^\s*[-*+•·]\s*/` (匹配 "- " / "* " / "+ " / "• " / "· ", 允许 0+ 空格)
   - 镜像测试: `verify_list_dedup.py` 9 case (yuanbao 1./2)/3./•/-、DeepSeek-style body 无 marker 不动、开头空白、数字段中间) 全过。其他站 (DeepSeek / Kimi / 豆包) body 不带 marker, strip 不命中, 0 行为变化。

3. **`ae1d2fa` SUMMARY_PROMPT 加防文档工具逃逸 (zh + en + fallback 全同步)**:
   - 症状: 豆包 (doubao) 等站 AI 在收到 "整理对话成 Markdown" 指令时, 有时自作主张调用站内自带的 .docx / 文章视图工具 (例: 豆包的"打开文档"按钮), 把生成的内容写到文档里而不是聊天消息里。结果: `waitAndAutoSave` 抓取的"最新回复" 是空 / 残片, 导出的 .md 文件内容缺失或空白, 用户不得不手动去文档工具复制。
   - 根因: SUMMARY_PROMPT (zh / en MSGS 里的 `'summaryPrompt'` key) 原本只约束"不要包代码块 / 不要开场白结束语", 没明确禁止调用文档工具, AI 遇到模糊场景时按平台默认行为走, 选错了输出通道。
   - 修法: 在 SUMMARY_PROMPT 第 4 条之后加第 5 条明确禁止:
     - zh: `\n5. 直接返回纯文本，不要打开或调用任何文档工具（豆包自带的 .docx / 文章视图等），内容直接打在聊天消息里。`
     - en: `\n5. Return plain text directly in the chat message; do not open or invoke any document tools (e.g. site-built-in .docx / article views).`
   - 3 处同步改, 保证正常路径 / 兜底路径行为一致: `chatdigest.user.js:1404` (zh MSGS) / `:1444` (en MSGS) / `:1496` (SUMMARY_PROMPT fallback 硬编码, v1.15.14 加的兜底)。zh / en 文案风格跟各自原文一致 (全角 vs ASCII 标点), fallback ASCII 标点 (跟历史 fallback 风格一致)。
   - 镜像测试: `verify_summary_prompt.py` 验证 t('summaryPrompt') 在 zh / en locale 下都拿到新 prompt, fallback 路径 (return 硬编码) 也带第 5 条, 3 处全部对齐。

`Semver`: **1.19.0 → 1.20.0 minor**:
- 3 个 fix 都是 bug fix, 严格说 patch, 但合起来把 yuanbao 从 "勉强能用" 升级到 "真正 production-ready" (跟 v1.18.0 "Kimi 输出 production-ready" 同级), 按用户 "攒一起发" 规则走 minor
- 没有新可见能力 (3 fix 都是现有 path 的 bug 修, 没有新增 entry point)
- `IMATOOLS_VERSION` 不动 (1.2.8 仍最新, 这次全是 userscript 端逻辑, Python 工具链 0 改动)

`@version` 1.19.0 → 1.20.0。

**所有站点** (DeepSeek / ChatGPT / Kimi / Claude / 豆包 / 元宝) 0 回归:
- 3d2fc8b: push 跟 download 现在都带 yaml 头, 其他站 IMA push 行为更一致 (以前 push 不带 yaml 头是个隐藏 bug, 现在统一了)
- c1231df: DeepSeek / Kimi / 豆包 body 不带 marker, strip 不命中, 0 行为变化
- ae1d2fa: SUMMARY_PROMPT 只追加 1 段说明, 不改现有 4 条, 也不改 injectSummaryPrompt / autoSend / waitAndAutoSave, AI 只是多一条行为约束

Last 3 个脚本版本：v1.20.0（2026-07-21, Yuanbao production-ready: 3 fix cascade 修 IMA push yaml 头 + list 双 marker strip + SUMMARY_PROMPT 防文档工具逃逸, semver minor）/ v1.19.0（2026-07-20, 豆包真正支持 + OL list continuation indent 修复, semver minor）/ v1.18.0（2026-07-20, Kimi 输出 production-ready：3 fix 链根治 setext h2 + 多块塌缩 + inline 丢失 + Kimi chrome 污染, semver minor）。

## v1.19.0：豆包 (doubao.com) 真正支持 + OL list continuation indent 修复 (2026-07-20)

v1.18.0 Kimi 输出 production-ready 时,豆包站点虽然 `match` 已加(`*://www.doubao.com/*`),但 v1.18.0 的 4 个 selector 全是 stub 假设(`[data-testid="message-assistant"]` / `.bot-message` / `.markdown-body` / `div[contenteditable="true"]` 之类),doubao 真实 DOM 里 0 命中 → 一键发送等不到 reply + 无法手动停止 + 手动导出"没抓到有效内容"3 个 bug 全部 cascade。
v1.19.0 用真实 DOM 调研(`E:\projects\doubao.html` 339KB)定位 doubao 的稳定结构:`[data-foundation-type="send-message-action-bar"]` (用户工具栏) / `[data-foundation-type="receive-message-action-bar"]` (AI 工具栏) / `[data-target-id="message-box-target-id"]` (稳定根) / `textarea[placeholder^="发消息"]` (输入框)。**3 commit cascade 修**:
1. `cad0d78` 列表 OL 缩进 2 空格 → 3 空格:OL marker `1. ` 宽度 3 字符,CommonMark continuation 要求 "indent >= 第一个 content column",2 空格 < 3 字符 → description 跟 strong 合并渲染
2. `8c4b43c` `normalizeMd` 修 2 处:
   - (a) `[ \t]+\n` → `\n` 全局吃"行尾空格+换行"误吃 list continuation 的 indent
   - (b) 改用 `(\n[ \t]+)+\n` → `\n\n` (1+ 次"\n+sp"段一次性吞),因 non-overlapping match 在 "\n   \n   \n   " 这种 3 段结构里只能塌一半
3. + `routeChild` 跳纯空白 text node (HTML 缩进产生的 `\n  ` text node 不会变成"   \n\n   "空行带尾空格残留)

测试: doubao 实际 HTML `<ol><li><strong>组织形式</strong><div></div>不属于...` 在 v1.19.0 输出 `1. **组织形式**\n\n   不属于...` (3 空格缩进,CommonMark 解析为 list item 内 2 个 `<p>`,description 真正嵌在 li 内,不再"飘"出 list 当独立段落)。Markdown 编辑器(用户 IDE / Obsidian)直接渲染正确。

`Semver`: **1.18.0 → 1.19.0 minor**:
- 豆包 = 新可见能力 (新站点真正支持) = minor (跟 v1.17.0 → v1.18.0 Kimi production-ready 同样的"从 stub → 真正可用"哲学)
- 列表 indent / normalize = bug fix,理论上 patch,但被豆包 minor 覆盖,整体 minor

`@version` 1.18.0 → 1.19.0。`IMATOOLS_VERSION` 不动(1.2.8 仍最新,这次全是 userscript 端 markdown 转换逻辑,跟 Python 工具链无关)。
**豆包 3 个用户报告 bug 全部修好**:① 一键发送后等 reply 完成 ② 手动停止 ③ 手动导出最新回复。
**Kimi / DeepSeek / ChatGPT / Claude / 元宝 全部回归测试通过**(v1.18.0 production-ready 基础 + 2 个 list indent cascade fix 不影响其他站点,因为 fix 是通用 markdown 规范化层,所有站点的 `<ol>/<ul>/<li>` 都受益)。

Last 3 个脚本版本:v1.19.0(2026-07-20, 豆包真正支持 + OL list continuation indent 修复, semver minor) / v1.18.0(2026-07-20, Kimi 输出 production-ready: 3 fix 链根治 setext h2 + 多块塌缩 + inline 丢失 + Kimi chrome 污染, semver minor) / v1.17.0(2026-07-19, Kimi 真正支持:修 v1.16.0 stub selector 3 处 + semver minor)。

Last 3 个 Python 工具链版本：v1.2.8（2026-07-18, ~/ → %USERPROFILE% user-facing 统一）/ v1.2.7（2026-07-18, P3.15 immutable modules 修复）/ v1.2.6（2026-07-18, type hints + LICENSE + CHANGELOG summary）。



## 仓库文档变更（README / 元数据）



> 这一节专门记录**仓库本身**的元数据 / 文档改动（README / LICENSE / 文件结构图 / .gitignore 等），不影响 userscript 行为，**不** bump `version` / `IMATOOLS_VERSION`。如有跟版本号挂钩的脚本 / 工具链改动，参见下面主体 CHANGELOG。



- **2026-07-19：README 中英双语拆分 + 表格精简 + 头部语言切换器** —

  - ① **README.md 默认改为英文版**（30338 chars / 300 行），原中文版重命名为 `README.zh.md`（16050 chars / 297 行）—— 为发版到 GitHub 做国际用户准备。海外用户访问仓库自动看到英文 README，中文用户点 `README.zh.md` 切换。

  - ② **两个 README 顶部都加了语言切换器**：英文版 `[English](./README.md) | [中文](./README.zh.md)`、中文版 `English | **中文**`（当前语言加粗显示）。翻译策略：保留所有技术术语原样（DeepSeek / ChatGPT / Kimi / Tampermonkey / YAML / frontmatter / API key 等）+ 所有代码块 / URL / 文件名 / 命令 / bat / ini 示例原文 + 所有 emoji 图标；翻译了所有描述性中文为地道英文。

  - ③ **README 支持站点表格精简**：从 8 列砍到 5 列（站点 / URL / 状态 / 一键导出 / 导出全部对话）—— 「导出最新」「复制最新」「自动推送 IMA」三列移除（前者跟「一键导出」同一路径、后者所有站点通用，没必要列），保留「一键导出（📑 FAB）」和「导出全部对话（📚）」两个**不同实现路径**的功能。「DeepSeek (备用) www.deepseek.com」重复行删除。

  - ④ **`match` 头部删除 `*://deepseek.com/*` 行**—— 7 个 match 行剩 6 个（每个已支持站点 1 行，`www.deepseek.com` 是 `chat.deepseek.com` 备用域名、跟 README 表格保持一致精简）。

  - ⑤ **README 文件结构图同步**——加 `README.zh.md` 行标注「中文版」、`chatdigest.user.js` 标注 v1.15.10 起从 `chat2knowledge.user.js` 改名。

  - **0 行为变化**：纯文档 + 1 行 `match` 清理，`version` 仍 1.15.16、`IMATOOLS_VERSION` 仍 1.2.8。

  - **最佳实践笔记**：开源项目 README 默认英文（GitHub trending top 项目 Vim / ripgrep / fzf / fd 全部如此）、中文版放 `README.zh.md` 作辅助——避免 README 顶部出现双语 i18n 噪音、跟 `description` 单语种保持一致。**「默认英文」不等于「只服务英文用户」**—— `README.zh.md` 跟英文版逐句对应翻译，0 信息丢失。



- **2026-07-19：v1.15.16 同步 `match` 头部精简(两步)** — 跟上面 README 表格精简保持一致,移除两条重复的 DeepSeek match 行:① `*://deepseek.com/*`(无 www, 历史上 v1.15.10 加的"备用"行, 实际 `www.deepseek.com` 跟 `chat.deepseek.com` 都会自动跳转或重定向到主站) ② `*://www.deepseek.com/*`(用户实测发现仍残留)。7 个 match 行剩 6 个, 跟 README 表格 6 行已支持站点 1:1 对应(`chat.deepseek.com` ↔ DeepSeek / `chatgpt.com` ↔ ChatGPT / `kimi.moonshot.cn` ↔ Kimi / `claude.ai` ↔ Claude / `www.doubao.com` ↔ 豆包 / `yuanbao.tencent.com` ↔ 元宝)。这个改动属于 userscript 元数据清理, 但**不** bump `version`(0 行为变化)。



---



## v1.18.0：Kimi 输出 production-ready — 3 fix 链根治 setext h2 + 多块塌缩 + inline 丢失 + Kimi chrome 污染 (2026-07-20)



> **TL;DR**: v1.17.0 Kimi "真正支持"只到 selector 层(能找到节点),**输出层不达标** —— 4 个层叠 bug:① `<div>text</div><hr/>` 输出 `text\n---`(无空行)撞 CommonMark setext h2 ② 相邻 `<div>` 段塌成一行 `<div>A</div><div>B</div>` → `AB` ③ `<li>item <code>code</code></li>` 丢反引号 → `item code` ④ Kimi 表格工具栏"复制/下载" + svg "..." 文字污染 export。v1.18.0 修 3 个独立 bug 链(commit `ab172e6` → `042ad94` → `d333221`),**根治** 4 个层叠 bug,让 Kimi + 之前所有站点 markdown 输出 production-ready。



### 🩺 根因(用户反馈驱动,2 步诊断)



**用户报告 "问题依旧"**(段落 + `---` 撞 setext h2),我先按"`<p>` 缺双换行"假设修了 `ab172e6`(`<p>` 改 `\n\n`),但 **user 实际 export 出来还是 1 个换行** —— 自查发现 AI **不用 `<p>` 而用 `<div class="paragraph">`**(Kimi / DeepSeek 等都常见),`ab172e6` 对实际 case 0 效果。



**v3 镜像测试 28 case 全分析**后定位真正根因:`blockToMd` 末尾"未知 container"走 fall through `Array.from(...).map(blockToMd).join('')` 跟 inline element 同路径,导致:

1. **多块塌缩**:`<div>A</div><div>B</div>` 都不加 wrapper → 拼成 `AB`

2. **setext 撞车**:`<div>text</div><hr/>` → `text` + `\n---\n` = `text\n---\n`(无空行)

3. **inline 标签丢失**:`<li>item <code>code</code></li>` 走 li 处理 → blockToMd 处理 `<code>` 走未知 container fall through → 反引号丢



用户**贴出 Kimi 完整 DOM HTML** 触发二次诊断:Kimi 表格包在 `<div class="table markdown-table">` 里,带 sticky-release / table-actions / kimi-tooltip / icon-button / table-title chrome 工具栏 —— **isUiChrome 只识别 DeepSeek 时代 `ds-` 前缀**,Kimi `data-v-` scoped CSS 时代 class 名不带 `ds-` 全部漏过滤,污染 export。



### 🔧 3 个 commit cascade fix



| Commit | 范围 | 修了什么 |

|---|---|---|

| `ab172e6` | `<p>` handler | `\n + text + \n` → `\n + text + \n\n`(Markdown 段落规范 = 双换行结束)。**单 `<p>` 修复对 AI 实际 `<div>` 路径 0 效果**,但奠定了"块级容器必须 wrap 双换行"的设计哲学。 |

| `042ad94` | 未知 block 容器 + li/blockquote 递归 | ① 末尾 fall through 改 `\n + content + \n\n`(让 div/section/article 也按段落分隔输出)② li/blockquote 改用 `routeChild` helper 路由 inline element 到 `inlineToMd` 保留格式。**这一 commit 才是 source-level 治本**。 |

| `d333221` | `isUiChrome` | 加 Kimi chrome 识别:`sticky-release[-rail/-header]` / `table-actions[-content/-icon]` / `icon-button[-*]` / `kimi-tooltip` / `table-title` / `tooltip-*` / `iconify`(`\b` 单词边界避免误伤)。**DeepSeek `ds-` 前缀识别保持不动**,其他站零回归。 |



### 📊 semver 选择:1.17.0 → 1.18.0 **minor**(不是 patch)



跟 v1.17.0 总结的"首次真正支持一个新站点 = minor"哲学**完全对称**:

- v1.17.0 只到 selector 层(能找到节点),但**输出层不达标** —— 跟 v1.16.0 同样 inflated

- v1.18.0 让 Kimi 输出达到生产质量(用户实测"现在的 markdown 好了很多"),等效"首次真正 production-ready"

- 用户视角:**v1.17.0 几乎不能用**(输出撞 setext h2、塌行、丢格式、污染),**v1.18.0 完全可用** = 新可见能力 = minor

- 反之如果只是 v1.17.0 "已能用 + 修 bug" 才是 patch(类似 v1.15.11 那种 ordering bug)



### ✅ 验证(28 case + 1 真实 Kimi HTML)



**v3 镜像测试 28 case**(`<div>A</div><div>B</div>`、`<div>text</div><hr/>`、`<article>text</article>`、`<li>item <code>code</code></li>`、`<blockquote>quote with <strong>bold</strong></blockquote>` 等):

- 13 case: FIX(从无空行 / 塌行 / 丢格式 → 正确)

- 0 case: REGRESSION

- 15 case: behavior identical or improved(标准 case 仍正常)



**用户贴的完整 Kimi 真实 HTML**(含 sticky-release 表格工具栏、`<ul start="1">`、`<li><div class="paragraph">...</div></li>` 嵌套)+ Kimi chrome filter 实测输出**完全正确**:段落 / `---` 之间有空行(setext 不撞)、`**bold**` 保留、表格无"复制/下载"残留、列表正常。



### 🛠 为什么不沿用之前的 post-process hack



之前 v1.16 阶段试过 2 个 hack:

- `ensureHrBlankLine` (a60b128 → 3020c8e revert) — 拼好之后补空行,**治标**

- `stripRedundantHr` (4e30f43 / d35a209 → aa3190b / 3553926 revert) — 删 AI 自带的 `---`,**误伤**(AI 的 `---` 是正常 thematic break,不是冗余)



`042ad94` 跟 `ab172e6` 都是 **source-level 治本**:在源头让 `blockToMd` 自身就符合 Markdown 段落分隔语义,**不依赖**下游 block 救场(post-process hack 范式)。手搓 vs 库 决策暂缓(v1.19/v2.0 milestone 评估 Turndown),详见 user memory "首次真正支持 stub 站点 = semver minor"。



### 🔄 不破坏向后兼容



- `@version` 1.17.0 → 1.18.0

- `IMATOOLS_VERSION` 不动(1.2.8 仍最新,本次 3 个 fix 全是 userscript 端 markdown 转换逻辑,跟 Python 工具链无关)

- v1.15.11 ~ v1.17.0 所有 fix / stub / Kimi 适配器全部保留

- DeepSeek / ChatGPT / Claude / 豆包 / 元宝等其他站点 0 行为变化(只对未知 block 容器加 wrapper,对已显式处理的 tag 行为完全不变)

- pytest 仍 139 PASS(无 Python 改动)

- 用户 force reload 步骤不变(v1.15.15 的 5 步操作仍适用,version 改成 1.18.0)



---



## v1.17.0：Kimi 站点真正支持 — 修 v1.16.0 stub selector + 重新实测 (2026-07-19)



> **TL;DR**: v1.16.0 发布的"Kimi 首次真正支持"实际是 stub —— `assistantSel/userSel/inputSel` 3 个 selector 全部从假设写的、**实际 Kimi 页面根本不存在那些 class/attr**。`@match` 迁到 `www.kimi.com` 后脚本能注入 SUMMARY_PROMPT（用户看到输入框有咒语），但 `getAssistantMessages()` 返回空，**一键导出后续全失败**。v1.17.0 用真实 DOM 测出的 selector 重写适配器。



### 🚨 v1.16.0 stub bug 发现过程



v1.16.0 commit `57b1668` 改 `*://kimi.moonshot.cn/*` → `*://www.kimi.com/*` + host 探测简化，但 `assistantSel: '.kimi-message-content, [data-role="assistant"]'` 跟 `userSel: '[data-role="user"]'` 跟 `inputSel: '.chat-input textarea, div[contenteditable="true"]'` **全是从假设写的、没真测过**。CI 跑通、release body 2240 chars、API verify 全 PASS —— 按 agent memory "**回归测试 PASS ≠ 框架实际工作**" —— 真实 Kimi 站点上一键导出：注入 SUMMARY_PROMPT 成功 → AI 实际回复 → **但 `getAssistantMessages()` 找不到节点 → `getLatestReply()` 返回 null → 整个一键导出流程 fail**。



用户实测反馈"现在一键导出只能抓到输入框输入文字，后续都是失败的"——本以为是 selector 部分错，**audit 实际是 selector 全错**。



### 🩺 根因（用 kimi.html 实测 DOM 校对）



| Selector (v1.16.0 stub) | kimi.html 实际存在? | 真实 selector (v1.17.0) |

|---|---|---|

| `.kimi-message-content` | **0 命中** | `.chat-content-item-assistant` |

| `[data-role="assistant"]` | **0 命中** | (同上) |

| `[data-role="user"]` | **0 命中** | `.chat-content-item-user` |

| `.chat-input textarea` | **0 命中** (kimi.html **没 textarea**) | `div[contenteditable="true"]` (Lexical editor) |



**kimi.html 实际 DOM 结构** (4 个 `.chat-content-item`，2 user + 2 AI 对话 round)：



```html

<!-- user message -->

<div class="chat-content-item chat-content-item-user">

  <div class="segment segment-user">

    <div class="user-content">手臂上这样的纹身...</div>

  </div>

</div>



<!-- AI reply -->

<div class="chat-content-item chat-content-item-assistant">

  <div class="segment segment-assistant">

    <div class="markdown-container">

      <div class="markdown">

        <div class="paragraph">从图片来看...</div>

        <h2>常见寓意</h2>

        <ul><li>...</li></ul>

        <table>...</table>

      </div>

    </div>

  </div>

</div>

```



**额外发现**：

- Kimi 用 **Lexical editor** (`data-lexical-editor="true"` / `data-lexical-text="true"`)，**不是 textarea**

- **没有 thinking block**（搜 think/reasoning/cot/chain 全 0 命中）—— Kimi 暂时没 deepseek-style 思考链，`messageToMd` 走"非 DeepSeek 路径"（clone + 移除 UI chrome + `blockToMd`）能正常处理



### 🔧 修法（cascade sync 5 处）



| # | 文件 | 改动 |

|---|------|------|

| ① | `chatdigest.user.js:87-95` | Kimi 适配器 3 个 selector 全部重写 + 加详细注释（真实 DOM 结构 + 跟 v1.16.0 stub 对比） |

| ② | `chatdigest.user.js:4` | `@version` 1.16.0 → **1.17.0** (semver minor) |

| ③ | `README.md:42` | Kimi 行加 "✅ Supported (v1.17.0)"（label 修正：v1.16.0 "Supported" 是错的） |

| ④ | `README.zh.md:42` | Kimi 行加 "✅ 已支持 (v1.17.0)" |

| ⑤ | `CHANGELOG.md` | 顶部 summary + Last 3 + 加本 entry |



### 📊 semver 选择



**`1.16.0 → 1.17.0`（minor bump, 不是 patch）**



按 v1.16.0 总结的"首次真正支持一个新站点 = minor"原则，**反过来**也适用：**v1.16.0 自称"真正支持"但实际是 stub**——v1.17.0 修 selector 后才**真正**支持 Kimi，所以是 minor bump 修复 stub bug，不是 patch 级 bug fix。



**关键判断**：

- patch = 修已有 broken 行为（用户已能用 + 修 bug）—— ❌ Kimi v1.16.0 用户**完全不能**用一键导出，不是"已有 broken 行为"

- minor = 新增可见能力（用户从不能用 → 能用）—— ✓ Kimi v1.17.0 用户**真正**能用一键导出，等于**新功能上线**



### ⚠️ 教训（label honesty / 实战回归）



- **README "✅ Supported" 标签必须代表"真用户实测过"**：v1.16.0 标 Kimi "✅ Supported" 但实际是 stub，违反"标签要跟实际行为一致"原则。v1.17.0 改 label 加 "(v1.17.0)" 显式说明**何时**真支持。

- **CI 跑通 ≠ 框架实际工作**：v1.16.0 release verify 7 个 check 全 PASS（包括 body length 2240、mention 0 命中、Contributors 1 个真实 author），**但 Kimi 实际不能用**——CI 只 verify 文本格式、不 verify 实际 DOM selector 工作。**JS 端 0 单测**，selector 错误没人发现直到用户实测反馈。

- **"0 测试覆盖"的代价**：v1.16.0 entry 写过"0 测试覆盖:JS 端 0 单测,host 探测 + match 模式都是 runtime;**手动验证清单**（必做）① 安装/更新 userscript → ... ② 点 FAB(📑)→ 应该触发'总结咒语'自动注入 + 发送 + 等待 AI 回复 + 自动保存"——**这一步如果当时真做了, v1.16.0 stub 立刻能发现**。v1.17.0 之前没人按这个清单实测。

- **未来防御**（同 v1.15.13 教训）：在 `tests/test_js_pure_equivalents.py` 加一个"DOM fixture 集成测试"——把 `kimi.html` (用 `gitignore` 排除本地调试文件) 里的关键 DOM 节点 dump 成 fixture，selector 写错时静态扫描立即 fail。但 fixture 维护负担大 —— 候选方案不在 v1.17.0 scope。



### 🔗 cascade bump 必要性



按 agent memory "**cascade fix 必须 cascade bump，不假装旧版稳态**"：

- v1.16.0 自称"修 selector"实际是错 selector → v1.17.0 是真正修

- v1.16.0 Tampermonkey 用户拿不到 fix（除非手动 disable + 重装）—— bump @version 让 Tampermonkey 自动检测新版本

- 不 bump 的话 v1.16.0 release page 继续撒谎"v1.16.0 Kimi 真正支持" —— 必须 bump



`@version` 1.16.0 → 1.17.0。`IMATOOLS_VERSION` 不动（1.2.8 仍最新，Kimi selector 修是 userscript 端改动不是工具链改动）。pytest 仍 139 PASS（无 Python 改动）。



### 📝 手动验证清单（必做，按顺序）



1. Tampermonkey 仪表盘 → 找 "ChatDigest / 聊摘" → version 是不是 **1.17.0**

2. 打开 `https://www.kimi.com` → F12 Console 看到 `✅ ChatDigest started · Kimi` 字样

3. **真实对话 round 至少 1 个**（先问 Kimi 一个问题让它回复）

4. 点 FAB（📑）→ 触发总结咒语注入 + 发送 + 等待 + 自动保存

5. 下载的 `.md` 文件应该含 **完整对话**：user 提问 + AI 回复（不是只有注入的 SUMMARY_PROMPT 文本）

6. F12 Console 看到 `[ChatDigest] ...` log，无 `404 adapter not found` 之类 fallthrough



### 🏷️ release 重建



v1.16.0 release page 自称"首次真正支持 Kimi"是错的——v1.17.0 release 重建时**改 v1.16.0 description 反映事实**（"v1.16.0 改 @match, v1.17.0 才真正支持"），但 release 仍是 v1.16.0（已经发布的 release 不能改 body），新 v1.17.0 release 反映新事实。**v1.16.0 release page description 保留历史**（按 agent memory "不删非自生成文件 / 不覆盖用户事实"），不动 body；v1.17.0 release 显式说明"v1.16.0 Kimi selector 全错，v1.17.0 真支持"。



## v1.16.0：Kimi 站点首次真正支持 (2026-07-19)



> **TL;DR**: `` `match` `` 从 `*://kimi.moonshot.cn/*` 迁到 `*://www.kimi.com/*`，Kimi 站点用户从 v1.16.0 起能正常使用。之前 Kimi "✅ Supported" 标了 N 个版本都是 stub，只有 DeepSeek 是真正在生产环境跑过验证。



### 🚀 根因



v1.15.16 之前 `ADAPTERS.kimi` 适配器代码虽然存在 (`assistantSel: '.kimi-message-content, [data-role="assistant"]'` + host 探测分支 `if (host.includes('kimi') || host.includes('moonshot'))`)，但 `match` 头部字段写的是 `*://kimi.moonshot.cn/*` —— **该域名 Kimi 团队早已迁到 `www.kimi.com`**。`kimi.moonshot.cn` 现在空站 / 重定向，所以 v1.15.16 之前 **Kimi 站点上脚本根本跑不起来** (Tampermonkey `match` 字段不匹配就不注入脚本，`www.kimi.com` 上 `` `match` `` `*://kimi.moonshot.cn/*` 完全没命中，适配器再全也白搭)。



### 🔧 修法（6 处改动 cascade 同步）



| # | 文件 | 改动 |

|---|------|------|

| ① | `chatdigest.user.js:4` | `` `version` `` 1.15.16 → **1.16.0** |

| ② | `chatdigest.user.js:9` | `` `match` `` `*://kimi.moonshot.cn/*` → `*://www.kimi.com/*` |

| ③ | `chatdigest.user.js:122` | host 探测从 `kimi \|\| moonshot` 简化成 `kimi.com`（顺手清掉 dead code） |

| ④ | `README.md:42` | Kimi URL `kimi.moonshot.cn` → `www.kimi.com` |

| ⑤ | `README.zh.md:42` | Kimi URL 同步 |

| ⑥ | `CHANGELOG.md` | 顶部 summary + Last 3 + 本 entry |



### 📊 semver 选择



**`1.15.16 → 1.16.0`（minor bump，不是 patch）**



- **patch** = 修已有 broken 行为（用户已能用，但有 bug / 部分功能坏掉）

- **minor** = 新增可见能力（用户没用过的 stub → 能用）← **本版本属于这个**

- **major** = 破坏性变更



**关键判断**：旧版本里 Kimi 用户实际用过吗？没用过（只是 stub）= minor；用过但坏了 = patch。



### 📝 验证清单



1. Tampermonkey 仪表盘 → "ChatDigest / 聊摘" → version 是不是 **1.16.0**

2. 打开 `https://www.kimi.com` → F12 Console 看到 `✅ ChatDigest started · Kimi` 字样

3. 在 `www.kimi.com` 上点 FAB（📑）→ 触发总结咒语注入 + 发送 + 等待 + 自动保存

4. F12 Console 看到 `[ChatDigest] ...` log，无 `404 adapter not found` 之类 fallthrough

5. `kimi.moonshot.cn` 上脚本**不再注入**（预期行为，`match` 字段改了）



### ⚠️ 教训 (label honesty)



README "✅ Supported" 标签必须代表"真正在生产环境验证过"——之前标 Kimi 是"有 stub 代码就标 yes"，违反"标签要跟实际行为一致"原则。v1.16.0 起 Kimi 才真正支持，后续若新增站点，**必须先有真用户实测**才能在 README 表格标 ✅，否则用 🟡(stub) / ❌(未支持)。



### 🔗 cascade bump 必要性



`match` 字段跨站点 URL 变化是 fix + 首次真支持，按 "cascade fix 必须 cascade bump" 规则不假装旧版稳态 —— v1.15.16 summary 顶部写"0 行为变化，纯 metadata 清理"，在 1.15.16 内偷偷加 Kimi URL 迁移会让 summary 撒谎，所以**必须 minor bump 到 1.16.0**。



`version` 1.15.16 → 1.16.0。`IMATOOLS_VERSION` 不动（1.2.8 仍最新）。pytest 仍 139 PASS（无 Python 改动）。



## v1.15.16：清理 description 臃肿 — 1833 → 240 字符(-87%),最佳实践对齐(2026-07-19)**



用户 review 时指出"`description` 里塞版本更新记录太臃肿,这是最佳实践规范吗?"——是 anti-pattern。v1.15.15 的 description 已经膨胀到 **1833 字符 / ~1222 字**(把 v1.14.9 ~ v1.15.15 共 14 个版本 changelog 全塞进单行 description,平均每版加 ~130 chars),而且每加一个版本都往上堆,典型的"渐进式膨胀失控"。**最佳实践**(参考 npm / browser extension / VS Code extension / userscripts 主流项目):`description` 只写 **1-3 句功能描述**,变更历史归 `CHANGELOG.md` / GitHub Releases / 项目根目录 markdown。**description 应当跟 GitHub README 顶部对齐**——简洁、卖点、不被 changelog 噪音污染。**修法**:v1.15.16 的 description 改成 **240 字符**,只保留 6 项核心信息:① 1 句功能描述("一键把 AI 对话整理成 Markdown 知识库文章");② 4 大差异化卖点(完全本地 / 无订阅 / 无需 API key / 隐私优先);③ 多站点支持(DeepSeek / ChatGPT / Kimi / Claude / 豆包 / 元宝);④ 玻璃拟态 UI;⑤ IMA / Obsidian 等任意 Markdown 友好工具推送;⑥ locale-aware 文件名(zh = 聊摘, 其他 = ChatDigest);⑦ "变更历史见 CHANGELOG.md" 引导。**0 行为变化**,纯 metadata 清理,代码本身 0 改动。**V8 仿真整段 IIFE 跑通**(zh-CN + en-US),菜单注册、IIFE 顶部"report bug"兜底、SUMMARY_PROMPT try/catch fallback、waitBody 全部正常。pytest 仍 139 PASS(无 Python 改动)。`version` 1.15.15 → 1.15.16。`IMATOOLS_VERSION` 不动(1.2.8 仍最新)。**v1.15.11 ~ 1.15.15 的 fix 全部保留** — v1.15.16 是 metadata 清理不是 fix。**最佳实践笔记**: userscript / npm package / browser extension / IDE plugin 任何 metadata 字段(`description` / `package.json description` / `extension marketplace description`)在每次发版前 grep 长度,> 500 chars 立即 trim;变更历史永远归 CHANGELOG.md (单独文件 / GitHub Releases),**不**塞进 metadata 字段。





## v1.15.15：终极保险 — IIFE 顶部立刻注册"report bug"菜单项(hardcoded label),整个主流程包 try/catch,任何 module-level throw 都被抓住 + alert 详细错误(2026-07-18)**



v1.15.13/14 修了 ordering + SUMMARY_PROMPT try/catch,但用户实测**升 v1.15.14 仍报"完全崩了 + 开关也没了 + 啥也不出来"**——根因是 **Tampermonkey 缓存 + 默默 disable**:v1.15.11/12 的 throw `ReferenceError: Cannot access 'MSGS' before initialization` 让 Tampermonkey 标 disabled,即使 version 升 1.15.13/14 它也不自动重 fetch + re-enable。同时任何 module-level throw(无论根因)都会让后续 registerPushMenu / initUI / waitBody 跑不到 → 菜单丢 + FAB 不显示 → "完全崩了 + 啥也不出来"。**v1.15.15 终极保险双层**:**① IIFE 顶部 `try { GM_registerMenuCommand('ChatDigest: report bug (open F12 console)', ...); } catch(_){}`** — hardcoded label,**不依赖 t()/MSGS/SITE/PUSH_STORAGE**,即使后续 throw 菜单也保留;**② 整个主流程包 `try { ... 原 IIFE 全部代码 ... } catch(e) { alert('FATAL: ' + e.message + ' Stack: ' + e.stack.split('\n').slice(0,3).join('\n') + ' Copy this to developer.'); console.error('[ChatDigest FATAL]', e); }`** — 任何 module-level throw 都被抓住 + alert 弹窗告诉"具体什么挂了"+ 真实 stack trace 前 3 行(hardcoded 英文,不依赖 i18n 翻译,翻译都可能 throw)。**用户升 v1.15.15 后**:① **有 throw** 也能看到 alert 弹窗("具体什么挂了 + stack 头 3 行"),贴回给开发者即可根因定位,不再黑盒;② **无 throw** 也能在 Tampermonkey 菜单看到至少一项 "ChatDigest: report bug" (说明 IIFE 真的跑了 + 菜单注册成功);③ 即使 Tampermonkey 缓存了 v1.15.13/14 文件,v1.15.15 `version` bump 会触发检测,绝大多数情况自动重 fetch。**V8 stress test 验证**:模拟 v1.15.11 TDZ throw 状态(`const MSGS = {...}` 改成 `throw new Error('SIMULATED TDZ'); const MSGS = {...}`),v1.15.15 终极保险 catch 住 + 菜单仍注册成功(1 项 "ChatDigest: report bug");正常情况(无 throw)v1.15.15 终极保险不干扰 — V8 整段 IIFE 跑通、菜单注册、所有 init 流程正常。**用户实操清单**(必做,按顺序):① Tampermonkey 仪表盘 → 找 "ChatDigest / 聊摘" → 看 status(若 disabled 需先 enable) → 看 version 是不是 1.15.15;② F12 → Console → 切到 ChatDigest 那行 → 确认 0 个 uncaught error 红字;③ FAB(📑)一键导出 → 触发总结咒语注入 + 发送 + 等待 + 自动保存;④ 若①②③任一失败 → Tampermonkey 仪表盘 → 删除 ChatDigest → 把 `E:\Projects\ChatDigest\chatdigest.user.js` 重新拖入 → 强制刷新 DeepSeek 页面 → 再看 F12 Console,若有 `[ChatDigest FATAL]` 弹窗或红字,**直接整段贴回给我**;⑤ **force reload 后仍 fail** → 试 incognito 模式装一次(绕开所有 cache),若 incognito 也 fail 则问题在文件本身,贴 F12 红字给我。`version` 1.15.14 → 1.15.15。`IMATOOLS_VERSION` 不动(1.2.8 仍最新)。pytest 仍 139 PASS(无 Python 改动)。**v1.15.13/14 仍记录**——v1.15.15 是终极保险,前 2 个 fix 是中间步骤,都有效。





## v1.15.14：防御性 fallback — SUMMARY_PROMPT 求值加 try/catch 兜底到硬编码中文 prompt,i18n 任何 ordering 异常都不影响核心「总结咒语」注入功能(2026-07-18)**



v1.15.13 修了 SUMMARY_PROMPT ordering ReferenceError(把 const 挪到 t()/MSGS 定义之后),但用户实测**仍报"插件完全运行不起来了"**——根因是 **Tampermonkey 缓存**:v1.15.11/12 时代码 throw `ReferenceError: Cannot access 'MSGS' before initialization` 把整个 IIFE 挂掉,v1.15.13 bump version 修了 ordering 但**Tampermonkey 不一定自动重 fetch + execute 旧 cache**(尤其在用户已禁用自动更新、或者 version 变更被静默 dedup 的情况下),所以用户**实际仍在跑 v1.15.11/12 的 broken 版本**。**v1.15.14 双层保险**:① `version` 1.15.13 → 1.15.14 强制 Tampermonkey 检测新版本(绝大多数情况自动重 fetch);② **加 try/catch 包裹 SUMMARY_PROMPT 求值**,任何 throw(MSGS TDZ / t() 内部抛错 / 未来再有 ordering 问题)都 console.error 详细原因 + fallback 到硬编码中文 prompt——核心「总结咒语注入 + 发送 + 等待 + 保存」功能**不再因 i18n 异常而崩溃**。**设计原则**:**"prompt 是功能,不是装饰"**——i18n 失败时**降级显示原文**而非让用户看到 undefined / 脚本挂掉;只有"用户输入"的 toast/UI 文本才是"装饰",SUMMARY_PROMPT 是直接发给 AI 的指令、必须 always-work。**Fallback 硬编码内容**:完整的中文总结咒语(从 MSGS.zh['summaryPrompt'] 一字不差复制过来),与 zh locale 走 t() 的输出**完全等价**——所以 fallback 路径下用户无任何体验差异(只是失去了"用 en locale 时显示英文 prompt"的能力,但这种 locale 用户的硬编码 prompt 是中文、他们会改成 en 也是 0 修复价值——i18n 失败本就是异常态、不是常态)。**用户实操清单**(必做,按顺序):① Tampermonkey 仪表盘 → 找到 "ChatDigest / 聊摘" → 看显示版本是不是 1.15.14;② F12 Console → 切到 ChatDigest 那行 → 确认 0 个 `ReferenceError` 红字;③ FAB(📑)一键导出 → 触发总结咒语注入 + 发送 + 等待 + 自动保存(不是按字面 text "summaryPrompt",也不是 console 报错);④ 若①②③任一失败 → Tampermonkey 仪表盘 → 删除 ChatDigest → 把 `E:\Projects\ChatDigest\chatdigest.user.js` 重新拖入 → 强制刷新 DeepSeek 页面。**V8 仿真已确认** v1.15.14 整个 IIFE 跑通(zh-CN + en-US)、ordering 0 issue、stress test 模拟"v1.15.11 ordering bug + v1.15.14 try/catch"——fallback 生效、整个 userscript 不挂。`version` 1.15.13 → 1.15.14。`IMATOOLS_VERSION` 不动(1.2.8 仍最新)。pytest 仍 139 PASS(无 Python 改动)。





## v1.15.13：hotfix — 修复 v1.15.11/v1.15.12 ReferenceError 导致整个 userscript 完全无法加载的回归（2026-07-18）**



用户实测反馈"插件完全运行不起来了"。**根因**：`const SUMMARY_PROMPT = t('summaryPrompt')`（v1.15.11 引入、用 `t()` 取中英 prompt）在 L1001 求值，但 `t()` 函数和 `MSGS` 字典在 L1189/L1097 才定义——脚本按行加载到 SUMMARY_PROMPT 时 `t`/`MSGS` 还没定义，**throw ReferenceError**，整个 userscript 直接挂掉：FAB 失效、init 红字、所有 toast/console 全部不工作。**为什么没被测试发现**：JS 端 0 单测（locale 探测 + 翻译都是 runtime），pytest 139 PASS 完全没覆盖这个 ordering 问题；只有**用户实测**才能发现。**修法**（最小侵入）：① 把 `const SUMMARY_PROMPT = t('summaryPrompt')` 从 L1001 移到 **L1211**（紧跟 `function t()` 定义之后），原 L1001 位置只留注释占位 + ordering constraint 提醒；② `t()` 函数注释里加 v1.15.13 ordering 提醒。**关键不变量**：`SUMMARY_PROMPT = t('summaryPrompt')` 仍是 module-load-time 求值（IIFE 顶层），不需要改造成 lazy fetch。**手动验证清单**（**必做**，pytest 139 PASS 不够）：① 安装/更新 userscript → Tampermonkey 菜单显示 ChatDigest 1.15.13（无红字报错）；② 点 FAB（📑）→ 应该触发"总结咒语"自动注入 + 发送 + 等待 AI 回复 + 自动保存（不是按字面 text "summaryPrompt"）；③ 任意 toast 出现（点 FAB 后的"已注入"等），不是 undefined 或红字。**教训**：i18n 这种"新增 module-load-time 函数依赖"改动必须**人工验证**——pytest 只能覆盖 Python 端纯函数，JS 端 ordering / 加载顺序问题只能靠人肉。**未来防御**（候选，不在 v1.15.13 scope）：在 `tests/test_js_pure_equivalents.py` 加一个"static analysis"测试，扫描 `const X = f()` pattern、确认 f 在 X 之前定义，能在 CI 阶段挡住 80% 这类 ordering bug。`version` 1.15.12 → 1.15.13。`IMATOOLS_VERSION` 不动。





## v1.15.12：i18n 修 — 缺 key 时不跨语言回退,设计原则"default = en,中文是特殊情况"（2026-07-18）**



用户 review v1.15.11 后指出**"无法判断语言的话回退为en，避免看不出中文的尴尬"**——这是个**设计原则**，但 v1.15.11 的 t() 实现没完全遵守：原 `t()` 在 `MSGS[lang][key]` 找不到时会**回退到 `MSGS.zh[key]`**——结果就是**英语用户看到 en 缺 key 时自动显示中文文案**，正好是用户说的"尴尬"场景。**修法**：`t()` 改成 **不跨语言回退**——当前 locale 缺 key 时直接返回 key 字符串本身（开发者显眼、便于排查翻译缺漏；翻译未完成时用户看到 `'toast.scrolling1'` 而非错误语言文案），**绝不**把对方语言推给当前用户。**关键不变**：1) 语言检测仍由 `isChineseLocale()` 决定（zh / zh-CN / zh-TW / zh-HK → zh，其他 → en；语言无法判断时自动走 en 路径）；2) `MSGS.zh` / `MSGS.en` 字典 0 改动（仍 38 keys × 2 langs）；3) 缺 key 时 fallback 行为从「跨语言回退到 zh」改为「直接返回 key」——开发者体验会从「静默显示错的语言」变成「看到 'toast.scrolling1' 这种技术字符串」，**这是有意的设计**：强迫翻译者补全而**不是**让用户看到对方语言。**为什么 default = en**:项目起源于中文（v1.0 时代），但**目标用户群**是全球（GitHub 公开后海外/国内用户都有），en 是国际通用语；「遇到歧义默认 en」是开源国际化项目的标准实践（Linux kernel、npm、Python 等都遵循）。**手动验证清单**：1) zh-CN 用户 + MSGS.zh 缺 key → 显示 key 字符串（不串到 en）；2) en 用户 + MSGS.en 缺 key → 显示 key 字符串（**不再串到 zh**，v1.15.11 的 bug）；3) zh-CN 用户 + MSGS.zh 有 key + MSGS.en 缺 key → 显示中文（与 v1.15.11 行为一致）；4) en 用户 + MSGS.en 有 key + MSGS.zh 缺 key → 显示英文（与 v1.15.11 行为一致）。`version` 1.15.11 → 1.15.12。`IMATOOLS_VERSION` 不动（1.2.8 仍最新，t() 修是 JS 端 i18n 设计微调、不影响工具链）。pytest 仍 139 PASS（无 Python 改动）。





## v1.15.11：i18n — 所有 user-visible 文案(UI / toast / console / alert / SUMMARY_PROMPT)按浏览器 locale 中英双语(2026-07-18)**



rebrand **真正的完结篇**——名字(v1.15.9) + 描述(v1.15.9) + 文件(v1.15.10) + locale(v1.15.10) + **文案(v1.15.11)** 5 套就绪。**新加 `MSGS` 字典 + `t(key, params?)` helper**：`MSGS = { zh: { ... }, en: { ... } }` 维护 38 个 key × 2 langs = 76 条翻译;`t(key, params?)` 按 `isChineseLocale()` 选语言,`{name}` 占位符做参数替换。**5 大类文案全本地化**: ① UI panel(4 键:title fallback / 3 按钮)、② toast(24 键:24 个 toast() 调用全用 t())、③ console(4 键:startup / 3 个 console.error/warn)、④ alert(2 键:initFailed + initFailed.detail)、⑤ SUMMARY_PROMPT(1 键:中英两个版本,zh 是源 / en 是 translation)。**关键设计原则**(参考通用 i18n 架构): ① **source language (zh) 也走字典**(不 hardcode,translator 拿到 zh 字典就能翻 en);② **一致性 > 亲切感**(translator 无需读源码);③ **`{name}` 占位符**而非 JS 模板,translator 看到的是可读字符串;④ **找不到 key 回退到 key 本身**(开发期显眼,不静默吃掉);⑤ **找不到 locale 回退 zh**。**3 套查找/替换机制**: 找到 key → 用;en 字典缺漏 → 静默回退 zh(翻译未完成时仍可用);都缺 → 返回 key(开发期调试)。**关键不变量**: `SUMMARY_PROMPT = t('summaryPrompt')` 在 script 加载时求值一次(脚本 IIFE 顶层),后续 setInputValue/autoSend 用的是该常量——locale 探测在脚本加载时就完成,中途切 locale 不会重新求值(切语言需刷新页面);`SOFTWARE_NAME` 同理。**0 行为变化**:纯文案改写,所有逻辑路径不变。**0 测试覆盖**:JS 端 0 测试,locale 探测 + 翻译都是 runtime;**手动验证清单**: ① zh-CN 浏览器 → 所有 toast/UI 中文、SUMMARY_PROMPT 中文、AI 输出中文;② en-US 浏览器 → 全英文、SUMMARY_PROMPT 英文、AI 输出英文;③ zh-CN 但切到 en-US → 全英文(下次启动);④ 翻译缺漏 → 自动回退 zh(不静默报错);⑤ 浏览器 navigator.language 为空 → 回退 zh(安全默认)。`version` 1.15.10 → 1.15.11。`IMATOOLS_VERSION` 不动(1.2.8 仍最新,rebrand + i18n 都是 JS 端 UX 改动不是工具链改动)。pytest 仍 139 PASS(测试用 'Chat2Knowledge_*.md' 作 derive_title 输入,函数用时间戳锚点不依赖前缀,0 改动)。





## v1.15.10：locale-aware `SOFTWARE_NAME` + 脚本文件重命名 `chat2knowledge.user.js` → `chatdigest.user.js`（2026-07-18）**



rebranding 完结篇——名字 + 描述 + 文件 + locale 全套就绪。**新加 `isChineseLocale()` helper** + `SOFTWARE_NAME` 改为 `isChineseLocale() ? '聊摘' : 'ChatDigest'`：检测规则为 `navigator.language` / `navigator.languages` 任一以 `zh` 开头（zh / zh-CN / zh-TW / zh-HK 等）→ 中文模式，其他语言 → 英文模式。**4 处 live code 同步跟随 `SOFTWARE_NAME` 值**：① 导出文件名（`聊摘_DeepSeek_2026-07-19_xxx.md` vs `ChatDigest_DeepSeek_*.md`）；② YAML frontmatter `tags` 字段（保持文件名内 + 文件内一致）；③ UI panel 标题（CN 系统显示 `聊摘 · DeepSeek`，其他 `ChatDigest · DeepSeek`）；④ Tampermonkey 自动更新通知（version 触发）。**0 override 机制**——按用户决议保持简单，浏览器/系统切语言后下次启动自动跟随；如需手动锁定留给未来（v1.15.11 / v1.16 再说）。**脚本文件重命名**：`chat2knowledge.user.js` → `chatdigest.user.js`（未发布用户重命名 0 成本，已安装用户不受影响——他们用的是 v1.15.9 之前的脚本）。**测试改动**：`tests/test_js_pure_equivalents.py::TestBuildFileName` 5 个 case 的 `software_name` 参数和 expected output 从 `Chat2Knowledge` → `ChatDigest`（仅示例数据更新、`buildFileName` 函数本身不变）；`TestDeriveTitle` 0 改动（`derive_title` 用时间戳锚点取其后内容、不依赖前缀字符串）。**关键不变量**：`derive_title` 用时间戳（YYYY-MM-DD_HHMM）做锚点取其后内容——所以 `Chat2Knowledge_*.md`（v1.15.9 之前）+ `ChatDigest_*.md`（v1.15.9）+ `聊摘_*.md`（v1.15.10+）三种前缀都正确提取，旧用户文件 0 迁移成本。**LICENSE / README / notes / tampermove 文档同步**：LICENSE 保持 `ChatDigest Contributors`（法律/技术文档不分 locale、全局统一）；README 加 1 段说明 locale 行为 + 改 6 处文件名引用。**0 测试覆盖**：locale 探测是浏览器 runtime、Python 测不出；手动验证清单在 ima_upload_notes.txt v1.15.10 record 里。pytest 仍 139 PASS（5 buildFileName 测试改用 ChatDigest 名字后全 PASS）。`IMATOOLS_VERSION` 不动（1.2.8 仍最新——rebranding + locale 是 JS 端 UX 改动不是工具链改动）。`version` 1.15.9 → 1.15.10。





## v1.15.9：rebranding —— 项目正式更名为 ChatDigest / 聊摘（2026-07-18）**



发版前最后一轮「打磨品牌面」——重命名 + 措辞重写,准备 push 到 GitHub。**前后对照**：旧名 `Chat2Knowledge`（直白功能型但无品牌感）→ 新名 `ChatDigest`（英文，digest = 摘要/消化,暗合"注入总结咒语让 AI 重组织"独特卖点）+ `聊摘`（中文,2 字压缩、「聊」动作+「摘」结果、画面感强）。**4 大核心差异化卖点**（之前描述里没强调、这次写进 hero）：① **完全本地**（所有处理在浏览器内完成、对话内容不离开你的设备）；② **零订阅**（永久免费、无任何会员体系）；③ **零 API key**（核心导出「保存为本地 .md」零配置、零网络；可选推送 ima 用的是你自己申请的 IMA 官方 OpenAPI 凭证,不是我们的）；④ **隐私优先**（不上传对话到任何第三方服务器）。**多导出目标**：当前是 ima（已实现）+ Obsidian（计划中）+ 任意 Markdown 友好工具。**改名范围**（11 处 live code + 6 处 docs）：① `chat2knowledge.user.js` `name` / `namespace` (`https://github.com/chat2knowledge` → `https://github.com/chatdigest`,forward-looking) / `version` (1.15.8 → 1.15.9) / `description` (新 hero 句 + 4 大卖点 + v1.15.9 trace 注入版本列表) / `author` (Chat2Knowledge → ChatDigest Contributors);② user.js 内部 `SOFTWARE_NAME = 'Chat2Knowledge'` → `'ChatDigest'`,且加注释说明「旧 Chat2Knowledge_*.md 文件仍可被 derive_title 正确解析(时间戳锚点 + 不依赖前缀),0 迁移成本」;③ user.js UI 标题 / console 标签 / console 错误 / alert 文本全部 Chat2Knowledge → ChatDigest;④ `LICENSE` copyright `2026 Chat2Knowledge Contributors` → `2026 ChatDigest Contributors`;⑤ `README.md` 顶部加 hero section(完整版中文描述) + 6 处文件名/SOFTWARE_NAME 引用更新;⑥ `tools/ima_upload.py` 头部 docstring + argparse help + `derive_title` 注释 / `tools/ima_watcher.py` 头部 docstring + argparse description / `tools/ima_config_sample.ini` + `ima_config.ini` 文件路径示例 / `tools/requirements.txt` 顶部注释全部同步。**0 行为变化**:`derive_title` 用时间戳锚点取其后内容,**不依赖前缀字符串**——所以新 `ChatDigest_*.md` 和旧 `Chat2Knowledge_*.md` 都正确提取,旧用户文件 0 迁移成本。**0 测试变化**: `test_ima_upload.py` 里所有 `derive_title` 测试用 `"Chat2Knowledge_DeepSeek_...md"` 作为输入数据,函数锚点是时间戳不依赖前缀,测试仍 139 PASS 0 改动。`test_js_pure_equivalents.py` 里 `buildFileName` 测试传 `software_name="Chat2Knowledge"` 作为参数,只是示例数据,函数工作原理不变,测试仍 0 改动。**GitHub 仓库名建议 `chatdigest`** (namespace 已更新为 `https://github.com/chatdigest`);**Tampermonkey 脚本文件名 `chat2knowledge.user.js` 保持不变** (避免已安装用户需要重新安装的成本——name 内部就是 ChatDigest 字符串)。**`IMATOOLS_VERSION` 不动**(1.2.8 仍最新,rebranding 是 JS 端 branding 改动不是工具链改动,Python 工具链无相应语义变化)。pytest 仍 139 PASS。`version` 1.15.8 → 1.15.9。





## v1.15.8：单条消息导出按「知识库文章」语义去掉思考块,「导出全部对话」保留（2026-07-18）**



用户实测发现 📑 一键导出（FAB）和 📥 导出最新回复导出的「最后回复」**包含** DeepSeek 的 `> 💭 思考过程` 引用块——思考是 AI 推理过程、不是知识库文章内容,作为 KB 文章应该去掉更 relevant。**修法**:`messageToMd(node, opts)` 加 `opts.includeThinking` 参数（默认 `true` 保持向后兼容），`getLatestReply(opts)` 透传；4 个「单条消息导出」路径**全部**传 `{ includeThinking: false }`：① FAB `waitAndAutoSave`（一键导出 KB 文章）;② 📥 导出最新回复 菜单按钮;③ 📋 复制最新回复 菜单按钮;④ `Ctrl+Shift+S` 快捷键。**「导出全部对话」(`exportAll` / `act === 'all'` / `Ctrl+Shift+A`) 不动**——它走 `messageToItem`/`messageToMd` 默认路径（不传 opts,保持 true）,每条 AI 消息仍前置思考块,因为这是「完整对话记录」语义,思考 trace 对理解对话有用。**判断写法** `opts.includeThinking !== false` 而非 truthy 判断——保证 `opts === undefined` / `opts === {}` 时也走 true(向后兼容,任何外部调用方如浏览器 console 直接调 `getLatestReply()` 都保持旧行为)。**`messageToMd` 注释 + 4 个 call site 注释都更新**,记录「为什么单条 vs 全部不同」的设计理由（KB 文章 vs 完整记录）。`version` 1.15.7 → 1.15.8。Python 工具链不动（v1.2.8 仍最新）。**注意**：JS 端无单测覆盖,验证靠手动（FAB 一次 + 📥 导出最新回复一次,确认 0 个 `> 💭 思考过程` 块;再跑 📚 导出全部对话一次,确认思考块仍在）。pytest 仍 139 PASS（无 Python 改动）。





## v1.15.7：提 `MD_SOURCE_LANGS` 模块顶部常量统一 3 处「源码围栏解包」列表（2026-07-18）**



审 `blockToMd` 与 `unwrapSourceFences` 时发现 3 个 inline 列表含义完全一样（「这些语言名 = 代码块里包的是 Markdown 源码 / 纯文本，不是真程序代码，应解包为原始内容」）但**内容重叠 + 顺序不一致 + 列表大小不同**——重复且易踩：① `blockToMd` pre 路径 `mdDumpLangs = ['markdown','md','plaintext','text','txt']` (5)；② `blockToMd` md-code-block 路径 `UNWRAP_LANGS = ['markdown','md','text','plaintext','txt','plain','english','eng']` (8)；③ `unwrapSourceFences` `srcLangs = ['plaintext','text','markdown','md','txt']` (5)。**v1.15.6 当时判断差异「有意」**（pre 不解包 plain/english/eng）保留；本轮用户 review 后决定**反正 plain/english/eng 实际就是「这不是真代码、是文本」的信号，统一解包是正确的、不算 regression**。**修法**：抽到模块顶部 `const MD_SOURCE_LANGS = ['markdown','md','plaintext','text','txt','plain','english','eng']`（8 项并集），3 处共用。**isUiChrome 的语言 regex 不合并**——它语义不同（DOM 遍历时跳过语言标签 chrome，覆盖范围比 MD_SOURCE_LANGS 广、含真代码语言 json/python/js 等），是「UI chrome 识别」而非「源码解包」。**轻微行为变化**（不是 regression）：pre 块路径 + `unwrapSourceFences` 现在也会解包 `plain` / `english` / `eng` 语言标记的围栏——之前会保留 ```english 围栏，现在解包为原文。这正是 v1.15.6 trace 文档里「如未来需要可统一」的承诺兑现。`version` 1.15.6 → 1.15.7。Python 工具链不动（v1.2.8 仍最新）。





## v1.15.6：提 `wrapFencedCode()` 工具函数消除 pre / md-code-block 块 fenced code 拼接重复（2026-07-18）**



审 `blockToMd` 时发现 pre 块路径与 md-code-block 路径**末尾 2 行**完全一样：`const fence = '\\`'.repeat(fenceLen(text)); return '\\n' + fence + lang + '\\n' + text + '\\n' + fence + '\\n';`（都在 unwrap-lang 检查之后）。**修法**：新增 `wrapFencedCode(text, lang)` helper（紧贴 `fenceLen` 定义），2 处调用点改成单行 `return wrapFencedCode(text, lang);`。**纯重构、行为 100% 等价**（fenceLen 算法 + 围栏拼接顺序都不变）。**UNWRAP_LANGS 列表保留差异**（pre 路径 `['markdown','md','plaintext','text','txt']` 5 个；md-code-block 路径 `['markdown','md','text','plaintext','txt','plain','english','eng']` 8 个，多 3 个 `plain/english/eng` 是 DeepSeek 站点专属语言名）——不在本次重构范围，跨路径合并 UNWRAP_LANGS 是**行为变化**（会让 pre 块也解包 `english` 源码块）而非单纯 DRY。**改动量**：净 -2 行（3 行定义 + 2 行重复 → 3 行定义 + 2 行调用）；可读性 +1（fence wrap 模式只在一处出现、命名即语义）。`fenceLen` Python 复刻版（`tests/_js_fence_len`）未变，pytest 仍 139 PASS。`version` 1.15.5 → 1.15.6。Python 工具链不动（v1.2.8 仍最新）。





## v1.15.5：toast 错误分级——critical 错误改持续显示+点击关闭，重要错误不再一闪而过（2026-07-18）**



之前所有 `toast('⚠️ ...', 'warn')` 都 2.6s 自动消失，导致「凭证缺失 / kb-id 权限错 / IMA 推送失败（HTTP 4xx/5xx / 网络 / 超时）/ 当前站点未适配 / 找不到输入框 / 等待 AI 回复超时（2 分钟）/ 导出失败 / 没抓到内容」等 **critical 错误一闪而过、用户根本没注意**——尤其是「等待超时」「导出失败」「找不到输入框」这种 silent failure，用户以为成功了、实际啥也没发生。**修法**：① 新增 `toast` 第 3 种类型 `'error'`（CSS 红边、`#c2k-toast.error { border-color: rgba(255,80,80,.6); }`），区别于 `.warn` 的橙边。② `toast()` 函数检测 `type === 'error'` 时跳过 2.6s auto-dismiss timer、改设 `pointer-events: auto` + `cursor: pointer` + `title: '点击关闭'` + `onclick` 关闭——**sticky 显示、用户点掉**。③ 审计 13 处 `'warn'` 调用，**全部**是 critical（没有一个是「小提示」级别），统一改成 `'error'`；`'warn'` 类型保留在 CSS 里（无 active caller，但留着以备未来真有「2.6s 就够」的场景）。13 处分类：**[1]** 滚动未到顶（导出部分丢失）/ **[2]** 没抓到内容（download 静默失败）/ **[3]** 没抓到内容（copy 静默失败）/ **[4]** 没可导出对话 / **[5]** 导出失败带 err.message / **[6]** 当前环境无 GM_xmlhttpRequest / **[7]** IMA 推送返回非 2xx / **[8]** IMA 推送网络失败（ima_watcher.py 未起）/ **[9]** IMA 推送超时 / **[10]** 当前站点未适配 / **[11]** 找不到输入框 / **[12]** 等待 AI 回复超时（2 分钟未检测到）/ **[13]** 等待超时（2 分钟兜底分支）。**ok / 进度 toast 不动**（`✅ 已下载` / `⏳ 正在滚动收集...` / `✨ 已注入咒语` / `🚀 已自动发送` / `☁️ 已推送 IMA` / `⏳ 等待生成中...` 等）——这些是确认/进度，2.6s auto-dismiss 合理。`version` 1.15.4 → 1.15.5。Python 工具链不动（v1.2.8 仍最新）。





- **Python 工具链 v1.2.8：`~/` user-facing 字符串统一成 Windows 标准 `%USERPROFILE%` 写法（2026-07-18）**：审 `ima_upload.load_credentials()` 时发现 user-facing 字符串（`ima_upload.py` 模块 docstring / `load_credentials` 凭证缺失报错 / `ima_watcher.py` 模块 docstring + argparse help / `README.md` 一次性准备段 / `ima_upload_notes.txt` / `ima_config_sample.ini` 与 `ima_config.ini`）散落着 `~/.config/ima/...` 与 `~/Downloads` 写法。**问题**：Windows 是本项目主要用户群，README 在 Windows 段写 `%USERPROFILE%`、在 Linux 段写 `~/`、又在 `ima_upload.py` 报错里写 `~/`——**首次 Windows 用户看到 `~/` 会困惑**（cmd 里 `~` 不是内置变量，需 bash 才有）。`%USERPROFILE%` 和 `~` 在 Windows Python 上**多数情况等价**（`HOME` 未设时 `expanduser('~')` 走 `USERPROFILE`），但**有 edge case**（`HOME` 显式设为其他值时 `expanduser('~')` 走 `HOME` 而非 `USERPROFILE`，凭证会写到 `HOME/.config/ima/...` 而不是 `USERPROFILE/.config/ima/...`，跟用户预期不符）。**修法**（最小侵入，**仅 user-facing 字符串改动，0 行为变化**）：所有 user-facing 字符串统一成 `%USERPROFILE%` 风格（Windows 是主要读者群），Mac/Linux 写法以「等价说明」/「注释」形式跟在 Windows 块后面。**Python 内部实现**继续保留 `os.path.expanduser('~')`（跨平台标准做法、行为不变）——这是实现细节，user-facing 不暴露。`argparse` help 里 `%%USERPROFILE%%` 是 `argparse` 的 `%(...)s` 字符串替换转义（Python 3.14+ 严格化），输出仍为 `%USERPROFILE%`。docstring / `load_credentials` 报错里的 `\D` `\c` `\i` 用 `\\` 双重转义（Python 3.12+ 不再静默 `\X` 无效转义、升 `SyntaxWarning`，`python -W error` 严格模式会 fail）。`README.md` 重构「0. 一次性准备」段：① Windows 段（CMD）放前面；② Mac/Linux 段（bash）作为等价写法；③ 末尾加「`%USERPROFILE%` = `~` / `$HOME`，三者等价」一行 note。**纯字符串 cosmetic，0 代码逻辑变化**：`_read_file(p)` 内部仍用 `os.path.expanduser(p)` 展开 `~/.config/ima/...`，`DEFAULT_WATCH_DIR` 仍用 `os.path.expanduser('~')`，行为完全等价。**3 个 bat 字节审计**：grep 全部 `bat` 文件确认 0 处 `~/` / `expanduser` / `.config\ima` 残留（bat 里的 `~` 是 `%~1` / `%~dp0` 参数展开语法，跟 home dir 无关）。本机 `pytest tests/` 仍报 `139 passed in 0.30s` 行为不变。`IMATOOLS_VERSION` 1.2.7 → 1.2.8。脚本不动。



- **Python 工具链 v1.2.7：immutable modules 修复——`set_min_interval` setter + `C2KServer` 子类替代两处私有 hack（2026-07-18）**：审 `ima_watcher.py` 时定位到两处「immutable modules 内部状态被外部修改」（P3.15）——都是给类型系统/读者都绕路的设计：① `ima_watcher.py` 与 `ima_upload.py` 自己的 `main()` 都做 `ima_upload._MIN_INTERVAL = max(0.0, args.min_interval)`，**直接写另一个 module 的下划线开头变量**——改 `_MIN_INTERVAL` 名字时漏改、调试栈看 `_MIN_INTERVAL` 来源不直观、IDE 不识别为公开 API。② `IngestHandler._app()` 读 `self.server._c2k`（`type: ignore[attr-defined]`），`run_serve_mode` 做 `httpd._c2k = {'watch_dir': watch_dir, 'kb_id': kb_id}`，**给 `HTTPServer` 实例挂私有属性注入 handler 状态**——`HTTPServer` 不知道 `c2k_config` 存在、`BaseHTTPRequestHandler` 拿不到正经 API。**修法（最小侵入）**：`ima_upload.py` 加 `set_min_interval(value: float) -> None` / `get_min_interval() -> float` 公开 setter/getter（保留 `_MIN_INTERVAL` 作为模块内部状态实现细节、setter 内 `max(0.0, float(value))` 复刻旧 clamp 逻辑），`ima_upload.py:382` 与 `ima_watcher.py:287` 改成 `set_min_interval(args.min_interval)`；`ima_watcher.py` 加 `class C2KServer(HTTPServer): ... self.c2k_config = {...}` 显式子类，`IngestHandler._app()` 改读 `self.server.c2k_config`，`run_serve_mode` 用 `C2KServer((addr, port), IngestHandler, watch_dir=..., kb_id=...)` 一步实例化（不再私有属性 hack）。**新加测试** `TestSetGetMinInterval` 3 case：默认 1.5s、setter 写入可读回、负值 clamp 到 0；`monkeypatch` 自动还原默认避免跨测试污染。本机 `pytest tests/ -v` 报 `139 passed in 0.28s`（136 + 3）。`ima_watcher --version` 输出 `ima_watcher 1.2.7` 验证 import refactor 未破坏。`IMATOOLS_VERSION` 1.2.6 → 1.2.7。脚本不动。

## v1.15.4：扩 `cleanCitations` 字符类覆盖面（2026-07-18）**



v1.14.7 引入的 `cleanCitations` 用 3 个 regex 清洗 DeepSeek 引用角标残迹，但字符类不完整——只覆盖 `hyphen + en-dash`，AI 常用 `em-dash（—）` 和 `minus sign（−）` 漏洗；标点只全角 `。、：，；！？`，半角 `. , ; : ! ?` 漏洗；regex 3 只匹配 `[A-Za-z]+` 不含数字，`Figure-3 / 123-示意图` 漏洗。**4 处扩展**：① 短横字符类从 `[-–]` 扩到 `[-–—−]`；② 标点字符类从全角扩到全角+半角（`[。、：，；！？.,;:!?]`）；③ regex 3 从 `A-Za-z` 扩到 `A-Za-z0-9`；④ 中→英方向**故意不加**（保守：可能是用户正常用语如"第1章-Introduction"）。**bug 行为** vs **新行为**：原版 `权威——。` / `权威−。` / `权威--,` / `123-示意图` 都漏洗；v1.15.4 全部清洗。新增 7 个 `TestCleanCitations` case 覆盖边界（em-dash / minus sign / 半角 / 数字+中文 / 中→英不洗 / 英文术语不洗 / 短横后空格不洗）；pytest 129 → 136 PASS。Python 复刻版 `_js_clean_citations` 同步更新（行为完全等价）。`version` 1.15.3 → 1.15.4。**附 P2.13 / P2.14 trace**：本轮一并审查"setInputValue 是否保留原内容"（P2.13）和"buildFileName 缓存"（P2.14），结论都是**当前实现是合理设计**——前者避免影响咒语效果（用户一般是确定要导出才按一键），后者效率低但安全（避免缓存与文件名变化不同步）。不写代码，trace 在本条记录。



## v1.15.3：JS 脚本头部 `author` 改为 `Chat2Knowledge Contributors`（2026-07-18）**



纯元数据修正——之前是 `Senior Developer`（初始开发者的个人署名），现在改成 `Chat2Knowledge Contributors` 与 v1.2.6 新增的 `LICENSE` 文件 copyright `2026 Chat2Knowledge Contributors` 对齐，**项目归属感从"个人"转为"项目"**。功能完全不变（仅 user.js 头部 metadata），但显式 bump 留下 trace，让 reviewer 知道这是有意调整（不是 git history 残留）。Tampermonkey update 通知会触发，提示用户"归属变更"——这正是 bump 的价值所在（让用户感知到元数据变化）。Python 工具链不动（v1.2.6 仍最新）。`version` 1.15.2 → 1.15.3。



- **Python 工具链 v1.2.6：LICENSE 文件 + type hints + CHANGELOG summary 行（2026-07-18）**：① 新增根目录 `LICENSE`（MIT License 标准文本，copyright 2026 Chat2Knowledge Contributors），跟 `chat2knowledge.user.js` 头部的 `license MIT` 对齐——之前只有脚本头部声明，根目录无 LICENSE 文件，GitHub 上不显示 license badge，fork 者不确定能怎么用。② `ima_upload.py` 全部 14 个函数加 type hints（参数 + 返回类型），用 `from __future__ import annotations` + Python 3.10+ 语法（`str | None` 替代 `Optional[str]`、`tuple[str, str]` 替代 `Tuple[str, str]`）；用 `inspect.signature` 验证所有 annotation 是合法 Python 表达式、pytest 129 PASS 行为不变。③ CHANGELOG 顶部加「Latest: v1.15.2（脚本） / v1.2.6（Python 工具链）」summary 行 + Last 3 个版本号速查——之前 CHANGELOG 38KB / 60+ 条目，无法快速定位最新版本。**纯代码质量/法律/UX 改进，0 行为变化**。`IMATOOLS_VERSION` 1.2.5 → 1.2.6。脚本不动。

## v1.15.2：waitAndAutoSave 加 5s 进度反馈 + 最小等待 5s；exportAll 滚动收集加 1.5s 节流进度反馈（2026-07-18）**



① `waitAndAutoSave`（一键导出后的"等待生成"循环）原 toast 只显示「正在等待 DeepSeek 生成完成…」一直不动、用户不知道是死循环还是真的在等；现在每 5s 更新一次 toast 显示「⏳ 等待生成中…(已等 Xs)」。**② 最小等待 5s**：原逻辑「文本稳定 2 次 + 停止按钮消失」就触发保存，但 AI 刚发送完咒语就开始生成时（<1s），DOM 里的「已思考（用时 X 秒）」状态文本会先稳定 2 次后 AI 才开始输出真实答案——现在加 `MIN_WAIT = 5000` 至少等 5s 才认完成，避免抓到「刚开始生成」的极短内容。**③ exportAll 加进度反馈**：`collectFullConversation` 3 个 pass（顶部 / 底部 / 兜底扫描）+ 5 个 `grab()` 调用各传 pass 参数 1/2/3；`exportAll` 创建 `onProgress` 回调，每 1.5s 最多更新一次 toast 显示「⏳ 正在滚动收集…(顶部/底部/兜底阶段,已收集 N 条,key X~Y,Ns)」——之前无反馈，30+ 次滚动让用户以为脚本卡死。这俩改动跟 P1.5 (timeout)、P1.7 (dead code) 思路一致：**纯前端 UX 改进，无外部依赖**。`version` 1.15.1 → 1.15.2。



## v1.15.1：删 `extractMarkdown` 无意义别名（2026-07-18）**



审计发现 `extractMarkdown` **不是 dead code**（`messageToMd` 里 4 处调用：用户分支 / AI 答案 / AI 答案兜底 / 思考），但**是无意义间接**——函数体就是 `return blockToMd(node)`，注释承诺"兼容别名 + 统一规整：折叠多余空行、去除行尾空白"但实际规整在 `normalizeMd` 里、这里只 return 别名。**「注释撒谎」是 dead code 的另一种形式**——留着会误导未来读者以为有规整逻辑。删函数 + 改 4 处调用点为直接 `blockToMd(node)` + 删悬空注释。行为完全等价（机械替换），0 风险。Python 复刻测试套件本来就没复刻 `blockToMd`（v1.2.3 时已说明 drift 风险高、跳过），这次清理不需改测试。`version` 1.15.0 → 1.15.1。



- **Python 工具链 v1.2.5：HTTP 桥 /ingest 接收端加 IP 滑动窗口限流（2026-07-18）**：每个 client_ip 1 分钟内最多 30 次推送，超限返回 HTTP 429 + `[RATELIMIT]` 控制台日志。自用场景（127.0.0.1 监听）攻击面小，但加这层保护 ① 防止 watcher 自己的循环 bug 把同一文件反复 ingest ② 防止未来加多 tab 抓取时不小心刷爆 ③ 防止恶意 tab 灌入垃圾。**与现有 `upload_file_to_kb` 的「上传节流」（1.5s 间隔、防 IMA 风控）职责独立、互补**——一个是管出去，一个是管进来。新增模块级常量 `_RATE_LIMIT_PER_MIN = 30` + dict 存 bucket（按 client_ip 索引时间戳列表）+ Lock 保护；纯函数版本 `_check_rate_limit(client_ip, now, buckets, limit, window_s)` 参数显式便于测试，线程安全 wrapper `_check_rate_limit_thread_safe()` 加默认参数给 HTTP handler 用。`IngestHandler.do_POST` 在 URL 校验后、JSON 解析前插入限流检查（无效 URL 不消耗配额，但无效 JSON 也消耗，避免恶意 400 探测打满 bucket）。**顺手修一个潜在 bug**：`do_POST` 原先没 try/except 包 `ingest_content`，HTTP 模式下 `load_credentials` 抛的 `SystemExit` 会被 `BaseHTTPRequestHandler` 默认处理杀掉整个 watcher 进程；现在跟 watcher 模式一致，加 try/except 接住 SystemExit/Exception 并返回 5xx，让 watcher 继续 serve。**端到端验证**：启动 watcher + 跑 32 个 POST 请求，#1-#30 全部进入 ingest 流程（无凭证返回 500 但限流未触发），#31/#32 正确返回 429 + "rate limit exceeded (30/min)"。新增 `tests/test_ima_watcher.py`（12 个 case：9 个 `_check_rate_limit` 纯函数 + 3 个模块常量 sanity check）；本机 `pytest tests/ -v` 报 `129 passed in 0.30s`。脚本侧 `pushToIma` 的 `onload` 自动处理 429（`r.status >= 300` 走 else → 弹"⚠️ IMA 推送返回 429"），不需要改 user.js。`IMATOOLS_VERSION` 1.2.4 → 1.2.5。

## v1.15.0：给 IMA 推送加 8s timeout + 试抽 bat 公共库未遂（2026-07-17）**



① `pushToIma` 的 `GM_xmlhttpRequest` 加 `timeout: 8000` + `ontimeout` 提示，原本没 timeout——如果 watcher 进程挂或端口被占，请求会一直挂着、UI 无反馈。8s 够本地 HTTP 桥正常处理（一般 < 1s），又不至于让用户久等。② 试抽 `tools/_lib_common.bat` 公共库（消除 3 个 bat 重复的 ini 解析头），写了 `_lib_common.bat` 提供 `:init` / `:read_py` / `:resolve_py` 子程序并把 3 个 bat 改成 `call "%SCRIPT_DIR%_lib_common.bat" :label`——**实测发现 `call file.bat :label` 语法 cmd 不支持**（变量不传回、label 找不到），子程序的 `set` 设的变量无法在父作用域读取。回滚 3 个 bat、删除 `_lib_common.bat`，3 个 bat 保持原 v1.1.8 形态重复 30 行 ini 解析头。**结论**：cmd 原生不支持子文件公共库，要消除重复得用「发布时拼接」或「PowerShell wrapper」等 hack——得不偿失。`version` 1.14.9 → 1.15.0。



- **v1.14.9 + Python 工具链 v1.2.4：顺手修 `extractDescription` 两个 v1.8.0 bug（2026-07-17）**：(1) 标题行没跳过——原实现先 `.map` strip 标题前缀再 filter，filter 检查的是 strip 后的 `l` 所以标题文字也作为摘要一部分（与注释「首个非标题段落」意图不一致）；(2) 代码围栏内部行没跳过——原逻辑只跳以 ``` 开头的行，但 ``` 围栏**内部**的代码行（如 `print(1)`）被当摘要加进去。修法：链首加 `.filter(l => !/^#{1,6}\s/.test(l))` 用**原始行**跳标题行（必须在 strip map 之前）+ 改 for 循环 + `inFence` 状态机跟踪围栏内/外，围栏内所有行都跳过。修后行为：`# 我的标题\n\n```python\nprint(1)\n```\n\n这是摘要内容。` → description = `"这是摘要内容。"`（修复前会是 `"我的标题 print(1) 这是摘要内容。"`）。`TestExtractDescription` 同步更新（13 个 case），Python 复刻版行为与修好的真 JS 完全一致；本机 `pytest tests/ -v` 报 `117 passed in 0.25s`。

- **Python 工具链 v1.2.3：新增 `tests/` 回归测试套件（2026-07-17）**：113 个 pytest case 覆盖 Python 端 + JS 端纯函数层。`test_ima_upload.py`（21 个 case）测 `derive_title` / `load_local_config` 真实 Python 纯函数；`test_js_pure_equivalents.py`（92 个 case）测 `chat2knowledge.user.js` 里 DOM 无关字符串纯函数的 Python 1:1 复刻版（`fenceLen` / `looksLikeMarkdownSource` / `balanceFences` / `unwrapWrappingFence` / `unwrapSourceFences` / `cleanCitations` / `normalizeMd` / `extractH1` / `sanitizeTitle` / `yamlQuote` / `extractDescription` / `buildFileName`）。**不测** `blockToMd` / 站点选择器层（drift 风险高 + 站点会变），取舍详见 `tests/README.md`。本机 miniconda (Python 3.13) 跑 `pytest tests/ -v` 报 `113 passed in 0.24s`，explicitly verify 测试 count（避「回归测试 PASS ≠ 框架实际工作」教训）。**测试发现一个 v1.8.0 引入的真 bug**：`chat2knowledge.user.js` 的 `extractDescription` 函数注释说「首个非标题/列表/引用/代码段落」但实现是 strip 标题前缀后**保留标题文字**作为摘要（`# 我的标题` → description 开头是「我的标题」）。本测试套件**只反映并标记问题**（`TestExtractDescription` 类注释 + 复刻函数 docstring），不动原 JS；是否修由用户决定（修法：在 filter 里加 `!/^#{1,6}\s/.test(l)`，检查 strip 前的原始行）。`IMATOOLS_VERSION` 由 1.2.2 升到 1.2.3；`--version` 同步。

- **Python 工具链 v1.2.2：新增 `tools/requirements.txt` + 依赖描述统一（2026-07-17）**：把散落在 7 处的 `pip install cos-python-sdk-v5 requests [watchdog]` 命令合并到单一来源 `tools/requirements.txt`（带最低版本下限 `>=1.0.0 / >=2.20.0 / >=2.0.0`，不 pin 小版本）。改动的 7 处：README「一次性准备」第 3 步、`ima_upload.py` 头部 docstring、`ima_watcher.py` 头部 docstring、`ima_upload.bat` / `ima_watcher_bridge.bat` / `ima_watcher_monitor.bat` 的缺依赖错误提示（统一改为 `pip install -r "%SCRIPT_DIR%requirements.txt"`）、`ima_upload_notes.txt`「Python」小节。README「文件结构」图同步加 `requirements.txt` 条目。`IMATOOLS_VERSION` 由 1.2.1 升到 1.2.2；本机 miniconda (Python 3.13) 跑 `pip install -r tools/requirements.txt` 一次通过；`ima_upload.py --version` / `ima_watcher.py --version` 输出 `1.2.2`。全仓库 grep 验证：除 CHANGELOG 历史条目与本次「v1.2.2」版本记录本身外，0 处仍出现裸 `pip install` 列举依赖的命令。3 个 bat 字节审计通过（无 BOM / CRLF / 0 裸 LF / 0 非 ASCII / 0 `!` / 0 裸 `&` / 0 字面圆括号 / 括号平衡）。注意：`cos-python-sdk-v5` 名字里虽然带 "v5" 但 PyPI 版本号是 1.9.x（v5 SDK 一直沿用 1.x），别被名字骗写出 `>=5.0.0` 导致 `pip` 报「No matching distribution found」。

- **Python 工具链 v1.2.1：新增两个 watcher 启动器 bat（2026-07-16）**：`tools/ima_watcher_bridge.bat`（双击起 HTTP 桥 `--serve`）、`tools/ima_watcher_monitor.bat`（双击起目录监视，可拖文件夹指定监视目录）。两者复用 `ima_upload.bat` 的 ini→`PY` 安全提取头（解决 Miniconda 未注册 PATH）、`where python/py` 兜底与 `--version` 健康自检，遵守 bat 铁律（CRLF / 纯 ASCII / 无 `REM`/`::` / 无裸 `&` / 括号平衡），无 OK/FAIL 横幅与 `pause`（常驻进程自身阻塞）。`KB_ID`/`SRC` 仍由 `ima_watcher.py` 从 ini 读取。版本号 `IMATOOLS_VERSION` 由 1.2.0 升到 1.2.1，两脚本 `--version` 同步。



- **ima_upload.bat v1.1.8：删除整套文件日志逻辑（仅屏幕上屏，不再写盘）**：用户确认 Python 输出、OK/FAIL 横幅、汇总都已实时显示在屏幕上，`ima_upload.log` 日志文件多余。改动：移除 bat 内 `LOG` / `TMPFILE` 变量与所有 `>> "%LOG%"` 写文件行；Python 改为直接输出到屏幕、紧接 `set "RC=%errorlevel%"` 捕获退出码（去掉「先重定向到临时文件 `_upload_out.tmp` 再 `type` 到日志与屏幕」的两步）。保留 `chcp 65001` 与 `PYTHONIOENCODING=utf-8` 以保证屏幕上中文不乱码。字节审计：无 BOM / 120 CRLF、0 裸 LF / 0 非 ASCII / 0 `!` / 0 裸 `&` / 括号 24/24 平衡，且再无 echo 行文本含字面圆括号。同步更新 `ima_upload_notes.txt`（「成功 / 失败提示」小节改为「直接上屏、不再写日志」；两处故障自查删掉「打开 ima_upload.log」指引、改为「从 cmd 手动运行 bat 看具体报错」）与 README 对应小节。

- **ima_upload.bat v1.1.7：修复「上传成功、收尾时报 `: was unexpected at this time.` 并闪退」**：根因是 `:upload` 子程序里 `if %RC%==0 ( ... ) else ( ... )` 收尾块在**执行前**就被 cmd 一次性解析；else 分支那行 echo 文本 `… (exit=%RC%): …` 里的字面圆括号被 cmd 当成「新代码块开/闭」，其后 `: %ARG%` 变成非预期的 `:` → 报 `: was unexpected`。此块**无论成败、是否真的执行到 else 都会在解析阶段崩**（所以上传明明成功了仍闪退）。修复：去掉该 echo 的圆括号、改为 `echo [FAIL] upload failed, exit code %RC%: %ARG%`，并全文扫描确认再无 echo 行文本含字面圆括号。字节审计：无 BOM / 135 CRLF、0 裸 LF / 0 非 ASCII / 0 `!` / 0 裸 `&` / 括号 24/24 平衡。教训：bat 里「`(...)` 块内的 echo 文本出现半角圆括号」会令整个块解析失败（哪怕那一行从不执行）；块内 echo 一律用中文全角括号「（）」或不含半角括号的写法。同步更新 `ima_upload_notes.txt`（新增「常见故障：`: was unexpected`」一节 + 版本记录 v1.1.7）。

- **ima_upload.bat v1.1.6：新增「上传成功 / 失败的可视化提示」**：此前 bat 把 Python 的全部输出重定向进 `ima_upload.log`，屏幕上只打 `[upload] 路径` 一行，用户看不到结果。现改为：① 每个 `.md` 上传时把 Python 真实输出（成功 `[OK] 已导入知识库: ...` / 失败 `[ERR] ...`）**同时显示在屏幕并写入日志**；② 紧接着打明确横幅 `[OK] uploaded: <路径>` 或 `[FAIL] upload failed, exit code N: <路径>`；③ 全部处理完打汇总 `[summary] uploaded OK : N` / `[summary] failed : M`（都没上传则提示 no files were uploaded）。另设 `PYTHONIOENCODING=utf-8` + 顶部 `chcp 65001` 防中文乱码；Python 输出先落到临时文件 `_upload_out.tmp` 再 `type` 到日志与屏幕，结束前删除。同步更新 `ima_upload_notes.txt`（新增「成功 / 失败提示」小节 + 版本记录 v1.1.6）。（注：v1.1.8 起不再写日志文件、不使用临时文件，Python 输出直接上屏。）

- **ima_upload.bat v1.1.5：修复「ima_config.ini 已配好 KB_ID 却报 not set」**：v1.1.4 的解析只给 value 去空格、没给 key 去空格。当 ima_config.ini 写成 `KB_ID = xxx`（等号前带空格）时，for /f 切出的 key 是 `KB_ID `（带尾随空格），与代码里比对的 `KB_ID` 不相等 → 永远设不上 → 报 `KB_ID not set`。现加一层 `for /f "tokens=1 delims= "` 给 key 去首尾空格，value 仍用原内层 for /f 去前导空格。现已支持 `KB_ID = xxx`、`KB_ID=xxx`、`SRC = 路径`、`PY = 路径`（含空格、含结尾 `=` 的 base64 型 KB_ID 均正常）。用脚本以真实 `ima_config.ini` 模拟 for /f 切分验证：KB_ID / PY 均正确提取、SRC 留空（拖放模式不需要）。同步更新 `ima_upload_notes.txt`（新增「常见故障：KB_ID not set」一节 + 版本记录 v1.1.5）。

- **ima_upload.bat v1.1.4：彻底修好「& was unexpected」解析错误（最终致命点）**：用户从 cmd 直跑 bat 拿到具体报错 `& was unexpected at this time.`，据此定位到最后一层致命点——**`:trim` 子程序里的两行 `if ... set ... & goto trim_loop`**。该子程序是从 `for /f (...) do (...)` 配置解析块内被 `call` 出来的，cmd 在「块内 call 子程序 + 子程序内含 `&` 复合命令」这种嵌套下会解析错乱而报 `&` 错误并中止。这是压在 v1.1.3（echo 裸括号）之下的**第二层**解析错误，所以 v1.1.3 修完仍崩。修复：彻底删除 `:trim` 子程序与其 `call`，配置解析改为「外层 `for /f` 按 `=` 切分 key/value、内层 `for /f "eol= tokens=*"` 直接给 value 去首尾空格（for /f 自带去空白）」，并去掉 `EnableDelayedExpansion`（已无 `!var!` 需求）。现全文**零 `!`、零裸 `&`（仅剩 `2>&1` 重定向）、括号 20/20 平衡、CRLF、纯 ASCII、无 BOM**——已穷尽所有经典 `.bat` 崩溃诱因。教训：bat 里「从 `()` 块内 call 一个含 `&` 的子程序」是经典雷区，配置/文本处理优先用纯 `for /f` 嵌套而非 `call` 子程序 + `&`。同步更新 `ima_upload_notes.txt`（「常见故障」加第 (4) 条 + 版本记录 v1.1.4）。



- **ima_upload.bat v1.1.3：最终修好「拖放闪退」（更正根因）**：前两轮（v1.1.1 去中文、v1.1.2 改 CRLF）都只是预防措施，**真正的致命点是 `.bat` 内两处 `echo` 提示行带了未转义的括号**——`(e.g. Miniconda python)` 与 `file(s)/folder`，且这两行都处在 `if (...) ( ... )` 代码块内。cmd 会把 echo 里的 `(` 当成新代码块开始、`)` 当成块结束，导致括号不匹配、整段脚本语法错误而立即中止 → 窗口一闪即关（此问题从 v1.0.0 起就存在，所以前两轮的修复都没碰到）。已把两处 echo 改写为不含裸括号的英文，并用脚本逐行扫描确认：全文仅剩 if/for 代码块内的合法括号、echo 行零括号、括号总数 18/18 平衡，同时确认无 BOM、CRLF、纯 ASCII——现已消除全部经典 `.bat` 崩溃诱因。并更正 README / notes 此前对根因的误判（中文 / LF 非本次致命点）。



- **ima_upload.bat v1.1.2：真正修好「拖放闪退」**：上轮 v1.1.1 只去掉了中文，但仍闪退——真正根因是 **`.bat` 文件是 LF（Unix 换行）而非 CRLF（Windows 换行）**。`cmd.exe` 强制要求 CRLF，LF 会让多行 `if (...) ( ... )` 块与标签解析失败、整段脚本报语法错误而立即中止 → 黑窗口一闪即关（这其实很可能才是 bat 自始从未在 Windows 上跑通的原因，之前手动 `python ima_upload.py` 跑通的是 Python 本体、不是 bat）。已用 CRLF 重写文件（126 行全 CRLF、0 裸 LF），并新增逐步日志便于定位（注：v1.1.8 起已移除 `ima_upload.log`，若仍异常请从 cmd 手动运行 bat 看具体报错）。注意：若你用编辑器改动过本 bat，务必保存为 **CRLF**，否则会复现闪退。中文去化（v1.1.1）与 `shift` 拖放循环一并保留。同步更新 `ima_upload_notes.txt`（「常见故障」补充 CRLF 根因 + 自检项）与 README 对应小节。



- **ima_upload.bat v1.1.1：修复「拖放 bat 闪退」**：根因是 `.bat` 里残留了中文字符（echo 提示行）。中文 Windows 用 GBK 代码页解析 UTF-8 的 `.bat`，中文字节的某几个字节会被误读成 `)` `&` `>` 等命令元字符，触发「命令语法不正确」导致整段脚本立即中止、黑窗口一闪即关——只删 REM 里的汉字没用，因为出问题的不是注释而是 echo 行。现把 `.bat` 内**所有中文（含 echo 与任何注释）全部改为纯英文 ASCII**，详细中文用法集中保留在 `ima_upload_notes.txt`。拖放入参也由脆弱的 `for %%a in (%*)` 改为 `shift` 循环逐个处理，避免路径含空格/特殊字符时被拆碎。自检：用记事本打开 `ima_upload.bat`，应搜不到任何中文字符。同步更新 `ima_upload_notes.txt`（新增「常见故障：拖放 bat 闪退」一节）与 README 对应小节。



- **ima_upload.bat 配置外置到 ima_config.ini**：把原先写在 bat 头部的 `KB_ID` / `SRC` / `PY` 三项配置移到独立 ini 文件。新增 `tools/ima_config_sample.ini` 模板，用户复制为同目录 `ima_config.ini` 后填写；`ima_config.ini` 已加入 `.gitignore`（仓库只保留模板，不泄露个人知识库 ID / 本地路径）。bat 启动时读取 `ima_config.ini`（缺失则提示复制模板），并保留 `python`→`py` 自动探测作为 `PY` 未填时的兜底。`PY` 即 Python 可执行文件——默认自动探测 `python`/`py`，Miniconda 未注册为默认 python 时直接填完整路径（如 `C:\Users\用户名\miniconda3\python.exe`）。同步更新 README「一键批量入库」小节与文件结构树，以及 `ima_upload_notes.txt`。



- **凭证环境变量重命名（统一为 `IMA_CLIENT_ID` / `IMA_API_KEY`）**：将原先散乱的 `IMA_OPENAPI_CLIENTID` / `IMA_OPENAPI_APIKEY` 统一为更干净的 `IMA_CLIENT_ID` / `IMA_API_KEY`。涉及 `tools/ima_upload.py`（`load_credentials()` 的 env 读取与文件回退路径 `~/.config/ima/{IMA_CLIENT_ID,IMA_API_KEY}`、报错提示改为 Mac/Linux `export` 与 Windows `set` 双版本）、`tools/ima_watcher.py` 文档串、`README.md` 全部命令块，以及 `ima-openapi` skill 参考实现。**注意**：IMA 接口 HTTP 请求头 `ima-openapi-clientid` / `ima-openapi-apikey` 由服务端固定、不受影响；文件回退路径由 `client_id`/`api_key` 改为 `IMA_CLIENT_ID`/`IMA_API_KEY`，若已建旧文件请重命名。

- **工具链（tools）新增 ima_upload.bat**：Windows 一键批量入库。头部可配 `KB_ID`（必填）与 `SRC`（双击来源目录）；**双击**则导入 `SRC` 内全部 `.md`（仅一层），**拖放文件/文件夹**则导入其中 `.md`（非 `.md` 跳过、文件夹仅一层）。拖放参数规范化（去引号/去末尾反斜杠）；自动探测 `python`/`py`；中文报错；结束 `pause`。因 `.bat` 内禁止中文注释，用法与版本记录独立存于同目录 `ima_upload_notes.txt`（遵循跨项目 `.bat` 铁律）。bat 本质调用 `ima_upload.py`，权限校验与标题提取规则与命令行一致。同步更新 README「一键批量入库」小节与文件结构树。



- **工具链（tools/ima_upload.py）v1.15.2**：修复「IMA 入库标题永远显示整段文件名」。根因是 IMA 硬性规则「**title 必须与 file_name 完全一致（含扩展名），否则回退显示原 file_name**」，而旧代码只改了 `add_knowledge` 的 `title`、`create_media` 的 `file_name` 仍是整段文件名（含 Chat2Knowledge 前缀），二者不一致触发回退。现把 `derive_title()` 提取出的标题统一规范为「`标题.md`」（缺扩展名自动补），并**同时**作为 `create_media.file_name` 与 `add_knowledge.title`（方案 A：保证生效、零风险）。另：`chat2knowledge.user.js` 导出「全部对话」的轮次 header 由 `## ` 改为 `# `（h1）——对长文件每轮对话即最高层级；且可避免 AI 回复内自带 `# ` 标题时产生「h1 嵌在 h2 内」的非法嵌套；对话标题由 YAML frontmatter 的 `title:` 承载。README「入库标题自动提取」补 IMA 硬性规则说明。

- **工具链（tools/ima_upload.py）v1.15.1**：入库标题改为「从文件名自动提取真实标题」。`upload_file_to_kb` 默认标题不再直接用整个文件名，而是调用新增的 `derive_title()`：以文件名时间戳段 `YYYY-MM-DD_HHMM`（`[软件名]_[厂牌]_[时间戳]_[标题].md` 规范，时间戳内自带一个下划线）为锚点，取其之后片段作标题（例：`Chat2Knowledge_DeepSeek_2026-07-15_2225_心经英译历史.md` → 标题 `心经英译历史`）；非 Chat2Knowledge 导出文件、或时间戳后无标题内容时**回退为原始文件名**（含 `.md`）；显式 `--title` 仍以传入值为准。CLI 与 `ima_watcher.py` 共用核心函数，一次改动全覆盖。README 新增「入库标题自动提取」小节；`ima-openapi` skill 易错点同步补充标题提取提示、并修正一处错误端点名（`add_knowledge_base_doc` → 实际 `add_knowledge`）。

- **文档（README）Windows 适配**：原 IMA 导入相关命令只给 Linux 写法（`export` / `./` 路径），Windows 用户无法直接套用。现每个命令块均补充 Windows（CMD）等价写法：环境变量 `export` → `set`、`~` → `%USERPROFILE%`；python 运行命令补 `tools\xxx.py` 反斜杠形式；并提示 Windows 下 `pip` 命令一致、`python` 找不到时改用 `py` 启动器或安装时勾选「Add Python to PATH」。同步修正 `ima-openapi` skill 中凭证变量名（初版误写，后于「凭证环境变量重命名」条目统一为 `IMA_CLIENT_ID` / `IMA_API_KEY`）。

- **工具链（tools/ima_upload.py）v1.15.0**：新增「上传前确认知识库可写」校验。`upload_file_to_kb` 在正式入库前先调用官方 `get_addable_knowledge_base_list`，确认 `--kb-id` 属于当前账号可写入的知识库（个人库 / 有写权限的共享库），通过才走 `create_media → COS → add_knowledge`；不可写（填错 ID、填了他人只读分享库、或共享库无写权限成员）立即 `SystemExit` 并列出该账号所有可写知识库方便核对。校验结果进程内缓存，**每个 kb-id 只打一次接口**，CLI 与 `ima_watcher.py` 一次改动均覆盖。README 同步补「写入前自动校验权限」小节与「个人库 vs 共享库 / `shareId` 只是只读视图」说明。

- **v1.14.7**：修正「导出 md 里第 1 轮 AI 回复一堆 `[-3](url)` 畸形引用链接 + `权威--。`/`译本--。`/`Tanahashi-等` 等短横残迹（用户反馈『问题依旧』）。这是 v1.14.6 修掉代码块后浮现的**第二类转码 bug**：DeepSeek 把带编号的文献引用渲染成可见角标 `[-3]`，导出时被原样抄入 md；而其前置分隔短横 `-` 与没编号的短横残迹（`--。`）则散布在正文里。注：用户给的 `excerpt.html`（keys 3–19）是 JS 局部快照，**不含动态引用 DOM**（全文无 baike/nhfjw 链接），无法在 DOM 层精确识别，故改在 **Markdown 文本层做保守清洗**（新增 `cleanCitations()`，站点无关、幂等）：① 引用链接规范化 `[-3](url)` / `-[-3](url)` → `[3](url)`（干净编号引用，可正常跳转）；② 删除紧邻中文标点（`。、：，；！？`）前的连字符/短横残迹（全文无合法破折号，可安全移除）；③ 外文术语与中文间的残留分隔短横 `Tanahashi-等` → `Tanahashi等`。`cleanCitations` 接入 `messageToMd()` 的 AI / 用户两条分支收尾；由于 `description` 摘要源自已清洗的正文，frontmatter 也一并干净。校验（jsdom 加载脚本真实函数 + 真实 22:25 导出文件正文）：引用链接残迹 **9 → 0**、短横+中文标点残迹 **11 → 0**、`💭 思考过程` 与 0 围栏均不受影响、其余轮次无回归；第 1 轮 AI 回复读起来恢复自然。版本 1.14.7。

- **v1.14.8**：自动推送 IMA 开关改为「存储区 + 默认值」驱动——脚本启动若 Tampermonkey 存储区无记录则默认开启(true)并写入；可在 Tampermonkey 箭头菜单（脚本命令）随时切换 开/关，状态经 `GM_setValue`/`GM_getValue` 持久化，不再需要改源码。新增 `GM_registerMenuCommand`/`GM_setValue`/`GM_getValue` 授权。

- **工具链（tools/，非脚本版本）**：新增 `ima_upload.py`，改用 **IMA 官方 OpenAPI**（`/openapi/wiki/v1`：create_media → COS 上传 → add_knowledge，`media_type=7`=Markdown）直接上传知识库，彻底替代原先指向第三方 `ima-cli` 的 `ima_watcher.py` 错误命令（旧 `IMPORT_CMD=['ima-cli','import',...]` 子命令对不上、且 `ima-cli` 未安装，导致 0 次导入）。`ima_watcher.py` 现统一调用 `ima_upload.upload_file_to_kb`，`--kb` 参数改为 `--kb-id`（知识库 ID）。凭证读取优先级：环境变量 `IMA_OPENAPI_CLIENTID` / `IMA_OPENAPI_APIKEY` → 文件 `~/.config/ima/{client_id,api_key}`。依赖 `cos-python-sdk-v5 requests`（COS 上传用官方 SDK）；语法校验 + 凭证缺失友好报错 + 参数必填校验均通过。

- **v1.14.6**：修正 v1.14.5 的**根本误判**并修掉残留的 ` ```plaintext ` 代码块。用户提供**第 2 轮提问区的 100% 真实 F12 DOM**（`excerpt.html`，keys 3–19 完整子树）作基准，据此纠正 v1.14.5 的一个错误结论——v1.14.5 声称「真实 DeepSeek HTML 既没有 `.md-code-block` 也没有 `<pre>`」，但那份校准用的 keys 16–20 只是**恰好不含代码块的尾部子集**；真实对话区（keys 3–19）**确有 25 个 `.md-code-block` 且含 `<pre>`/`<code>`**，v1.14.4/1.14.5 据此补的 `.md-code-block` 分支在真实 DOM 上**本应触发**，只是语言提取写错了才没生效。两处真修复：**① 语言标签提取错**：真实标签在 banner 内的 `<span class="d813de27">`（markdown/text/plaintext），旧代码却查 `[class*="header"]`（命中错误元素 → `lang=""`）或 `firstElementChild` 且仅对 plaintext 做了 `looksLikeMarkdownSource` 散文门槛 → 孔茨英译（纯英文散文）被判为非 Markdown 而**保留 ` ```plaintext ` 围栏**。现改为优先读 `.d813de27`、回退到 banner 文本（去「复制/下载」），并把 `markdown`/`md`/`text`/`plaintext`/`txt`/`plain`/`english` **全部解包**（对应你最终指令「真正的代码片段才用代码块，整篇不要包进代码块」），真实 `python`/`js` 等代码块保留围栏。**② 解包时机错**：`messageToMd` 原顺序为 `unwrapSourceFences` → `balanceFences`，而内嵌的 ` ```plaintext `（AI 把译文包进 `markdown` 源码块时产生）在解包步仍是「只有开头、结尾 ``` 在 DOM 提取时丢失」的**不平衡**状态，`unwrapSourceFences` 必须首尾配对才能解 → 解不掉；随后 `balanceFences` 给它**补了闭合围栏** → 最终成了永久 ` ```plaintext ` 块。现改为**先 `balanceFences` 补全闭合、再 `unwrapSourceFences` 解包**。校验：用 jsdom 在真实 `excerpt.html` 上跑完整 `messageToMd()` 并模拟整段导出——` ```plaintext ` 残留 **0 处**、` ```text ` 残留 **0 处**、真实 ` ```python ` 原样保留、所有答案部分零破损围栏；其余 ` ``` ` 仅出现在「💭 思考过程」引用块里（AI 字面提及 ` ```markdown ` 等），属忠实转录非转码 bug。版本 1.14.6。

- **v1.14.5**：修复「导出 md 残留一堆 ` ```plaintext ` 代码块（把译文/整段内容包进代码块、格式乱）」。用户提供**100% 真实 F12 DOM**（`excerpt.html`，含 keys 16–20 的完整 `.ds-message` 子树）作为校准基准，据此校正了 v1.14.4 的一个根本误判。**① 关键发现**：真实 DeepSeek HTML 里**既没有 `.md-code-block`、也没有 `<pre>`/`<code>` 类名**（整篇类名表只有 `ds-*` 与 `markdown-table-wrapper`）。这说明 v1.14.4 新增的 `.md-code-block` 分支**基于一份不存在/局部的假结构、在真实 DOM 上永远不会触发**，它并非真正的修复路径。**② 真正的根因**：当 AI 把「整篇 Markdown 源码」用 ` ```plaintext ` / ` ```text ` / ` ```markdown ` 整体包起来（用户早期 prompt「只输出纯 Markdown 源码」所致），DeepSeek 有时**不把它渲染成代码块，而是把 ` ```plaintext ` 围栏标记本身当作可见文本泄漏进 DOM**；`extractMarkdown` 于是把 ` ```plaintext … ``` ` 原样抄进 md。旧 `unwrapWrappingFence()` **只检查 md 首行**，只能解包「整条消息就是一整个围栏」的情况，对**答案中部的内嵌源码围栏**（如「## 经典译本全文」下的译文块）无能为力 → 导出 md 残留游离 ` ```plaintext `。**③ 修复**：新增 `unwrapSourceFences()`——在 Markdown 文本层面**扫描整段**并解包 `plaintext`/`text`/`markdown`/`md`/`txt` 等「源码围栏」（这些语言在 DeepSeek 语义里本就表示「按 Markdown 渲染的源码/纯文本」，不是真代码），同时**保留** `python`/`js`/`bash` 等真正的程序代码块不动；与 `<pre>` 分支、`unwrapWrappingFence` 互补且幂等（若 `<pre>` 分支已解包则此处无围栏可解）。该函数在 `messageToMd()` 的「答案 / 思考 / 用户提问」三处都接入。校验：① 对真实坏 md 跑 `unwrapSourceFences()`，` ```plaintext ` 由 3 处→0 处干净解包、译文变纯文本、真实 ` ```python ` 与用户提示里提到的「` ```python `」字样均原样保留；② 用同一真实 DOM 在 jsdom 里跑完整 `messageToMd()`，5 条消息 **0 个残留围栏**、3 处「💭 思考过程」引用块分离正常，且与坏 md 对应轮次（如 key20 = 第 10 轮 AI）逐字吻合。版本 1.14.5。



- **v1.14.4**：修复「导出全部对话后段格式乱、从第 3 轮起整段被吞进代码块」的问题（用户诊断「是 AI 输出问题还是转码问题」→ **确认是转码 bug，非 AI 输出**）。根因：DeepSeek 把「整篇 Markdown 源码」整体包进语言为 `text`/`markdown` 的代码块，旧 `.md-code-block` 分支**无条件按原语言再套一层围栏**，导致该外层围栏与内部嵌套围栏长度/配对错乱、留下**未闭合（或错配）的 ` ```text ` 围栏**，把后续所有轮次整段吞进代码块（文件中第 173、383 行各有一个游离 ` ```text ` 即此症）。修复：**① `.md-code-block` 分支对 `text`/`markdown`/`md` 一律解包为原始 Markdown**（这些语言在 DeepSeek 里本就表示「按 Markdown 渲染的源码」，不应再套外层围栏）；`plaintext`/`txt` 仅当内容本身像 Markdown 文章时才解包，否则保留为带语言标识的代码块（如经文仍保持 `plaintext` 代码块）。**② 新增 `balanceFences()` 兜底**：遵循 CommonMark 语义——带信息串的围栏（如 ` ```text `）**只能是开场、绝不能作闭合**，纯反引号围栏才闭合当前开场围栏；遍历结束仍有未闭合围栏时按各自反引号数补闭合，彻底杜绝「单条消息漏闭合 → 后续轮次被吞」的灾难。两处改动均接入唯一的 `messageToMd()` 漏斗，对「导出全部/最新、复制、一键导出」统一生效。语法校验通过、围栏配对逻辑经 jsdom 校验。版本 1.14.4。

- **v1.14.3**：修复「导出全部对话仍从中间某轮（AI 回复）开始、缺失开头用户提问」的根因（已据用户提供的**真实 DOM** 校正：key 从 **1** 开始、key 1 = 首个用户提问；此前误信 Edge 保存的 HTML 快照——其为 JS 渲染的局部窗口，仅含 key 4–20，属假「真相」）。**① 滚动容器探测不准**：`findScrollContainers()` 原只用 `scrollHeight > clientHeight + 4` 向上找可滚动祖先，对 `transform: translateY(...)` 驱动的虚拟列表 track（DeepSeek 真实结构：`.ds-virtual-list` → `.ds-virtual-list-items` → `.ds-virtual-list-visible-items[transform]`）可能漏判；现改用**计算样式 `overflowY`** 判定 `isScrollable()`，并**深入 `.ds-virtual-list` 内部子孙**捕获可能藏在其中的原生滚动视口（如 `ds-scroll-area` 的 viewport），`.ds-virtual-list*` 与 `window` 仍兜底纳入。**② 滚动未真正生效 / 提前退出**：新增 `forceScrollTo()`（同时设 `scrollTop`、`scrollTo({top})`、并**手动派发 `scroll` 事件**触发虚拟列表重算窗口）；原顶部循环在「最小 key 没变小」时**立即 `break`**——若首次滚动因重渲染耗时未立刻露出 key 1 会误判「已到顶」而提前退出、丢开头，现改为「仅 `cur<=1` 或连续 4 次无更小 key 才停」。此外 `getAllReplies()` 在收集到的最小 key>1 时**诚实 toast 警告**「可能缺失最早消息」。代码语法校验通过，待用户在真实页面验证。

- **v1.14.2**：修复「导出全部对话失败：cls is not defined」。v1.14.0 新增 `.md-code-block` 处理分支时，误用了仅在 `if (tag === 'pre')` 块内声明的 `const cls`（块级作用域），当遍历到普通 `<div>` 代码块时 `cls` 未定义即抛 `ReferenceError`，导致整段导出中断。`blockToMd()` 的 div 分支改为直接用 `el.className || ''` 判定 `.md-code-block`，不再引用外部 `cls`。语法校验通过。版本 1.14.2。

- **v1.14.1**：修正 v1.14.0「页面标题优先 → 内容 h1 回退」被**全局误用**的问题。v1.14.0 把该逻辑写进了共享的 `resolveTitle()`，导致「导出/复制最新回复」「一键导出」也跟着改成页面标题优先——这背离了最初「h1 优先」的设计，且并非用户本意。`resolveTitle()` 现已**还原为「内容 h1 → 页面标题 → 留空」**（仅服务最新/复制/一键导出）；新增 `titleOverride` 参数贯穿 `downloadMarkdown()` / `buildFileName()`，`exportAll()` 单独以 `getChatTitle() || ''` 传入**页面标题（直接取、不做 h1 回退）**。即：导出全部对话 → 直接取页面标题；导出/复制最新回复、一键导出 → 保持原 h1 优先逻辑。用 jsdom 对真实 HTML 回归：export-all 标题=「心经英译历史」（无视正文 h1）、最新回复含 h1 时取 h1、无 h1 时回退页面标题、厂牌后缀正确剥离。版本 1.14.1。

- **v1.14.0**：依据用户保存的**真实 DeepSeek 页面 HTML** 重写 DOM 适配，修复 v1.13.0 暴露的三个问题。**① 思考过程被吞没 + 格式丢失（根因）**：DeepSeek 的「思考块」内部也带 `.ds-markdown`（类名 `ds-think-content`），v1.13.0 用 `node.querySelector('.ds-markdown')` 取「第一个」反而拿到思考块、`clone` 再移除全部 `.ds-markdown` 后只剩「已思考（用时 X 秒）」状态 → 思考正文被当答案、状态被当思考。v1.14.0 按**稳定类名**精确分离：思考=`.ds-think-content` 内的推理正文、答案=`.ds-assistant-message-main-content`，保留思考原有的段落/列表格式。**② 首条用户提问消失 + 归属交错（根因）**：`findScrollContainer()` 在真实环境探测不到可滚动祖先（`scrollHeight` 未就绪）→ `collectFullConversation()` 返回 `null` → 静默回退「只抓可视窗口」→ 漏掉 key 0 之前的开头、整体错位。v1.14.0 改为扫描**多个滚动候选**（`.ds-virtual-list` / `.ds-virtual-list-items` / `window`）各自 Top→Bottom 扫描、按 key 全局去重；每条绑定自己的 key 并**按 key 升序排序**，避免重复提问文本导致的排序碰撞。同时 `assistantSel` 去掉 `, .ds-markdown`，避免把思考块叶子算成独立 AI 回复。**③ 文件名标题缺失**：`getChatTitle()` 原 `titleSel` 命中不到标题元素；改用 `document.title`（剥离「 - DeepSeek」厂牌后缀），`resolveTitle()` 改为「页面标题优先 → 内容 h1 回退」。另新增 `.md-code-block` 处理，跳过「markdown复制下载」头部标签、按头部语言正确输出围栏代码块。用 jsdom 对真实 HTML 回归：17 条窗口 key 4→20 全部收集、归属序列 `AUAU…` 正确、思考含真实推理且不含状态头、答案含文章正文且不含「复制下载」、标题解析为「心经英译历史」。版本 1.14.0。

- **v1.13.0**：修复「导出全部对话仍从中间某轮开始」的根因，并新增思考/回复分离。**① 虚拟列表 key 取错位置（根因）**：v1.12.0 误以为 `data-virtual-list-item-key` 在 `.ds-message` 自身上，实际它在**外层包裹 div** 上（`<div data-virtual-list-item-key="17"><div class="ds-message">…</div></div>`）。旧代码读 `.ds-message` 的该属性永远为 `null` → `collectFullConversation()` 直接 `return null` → 静默回退到「只抓可视窗口」的直接 DOM 查询 → 必然从中间截断。新增 `getVlistKey()`（用 `closest('[data-virtual-list-item-key]')` 向上找带属性的祖先）来判定虚拟列表与按 key 去重，现在能真正滚动收集从第一条到最后一条。用 jsdom 回归：旧逻辑在 `.ds-message` 上取 key 为 `null`、新逻辑正确取到 `1`。**② 思考过程与正式回复分离**：新增 `messageToMd()` / `isAssistantNode()`，对 AI 消息把「思考过程」单独抽出、套引用块（`> **💭 思考过程**`），与正式回复（首个 `.ds-markdown`）分开放置；克隆节点后移除 `.ds-markdown` 与 UI 外壳即得思考内容。`getLatestReply()` 与 `getAllReplies()` 回退路径统一改用 `messageToMd()`，使「导出最新/全部/复制/一键导出」四处表现一致；无思考的回复不会凭空生成思考块。

- **v1.12.0**：修复「导出全部对话」两大问题。**① 漏掉开头（虚拟列表）**：DeepSeek 等站点用虚拟列表（节点带 `data-virtual-list-item-key`），只渲染可视窗口，直接 `querySelectorAll` 只能拿到当前窗口、从中间开始。新增 `collectFullConversation()`——滚动遍历列表、在每屏渲染当下即抽取内容并按 key 去重（避免节点回收覆盖），收集「从第一条到最后一条」的完整对话，结束后还原滚动位置；非虚拟列表站点自动回退到直接 DOM 查询。**② 思考过程被拆成两条回复**：DeepSeek `assistantSel` 改为取「含 `.ds-markdown` 的 `.ds-message` 容器」（而非单个 `.ds-markdown` 叶子），使一轮回复里的「思考过程 + 答案」合并为同一条，不再出现「两个第 1 轮回复」。用 jsdom 模拟虚拟列表（12 条、AI 含思考+答案）回归：收集数=12、用户轮=6、AI 回复=6（合并而非 12）、首条为用户、末条为 AI、顺序正确。`getAllReplies` 改为 `async`，菜单与 `Ctrl+Shift+A` 经由新增的 `exportAll()` 包装。

- **v1.11.4**：修正 DeepSeek「导出全部对话」仍缺失用户提问的问题（v1.11.3 的 `userSel` 猜测值 `[data-message-author-role="user"]` 无效）。经 F12 核对真实 DOM：DeepSeek **不给用户消息加 `data-message-author-role="user"`**，而是用 `.ds-message` 容器包裹纯文本（无 `.ds-markdown`），AI 回复的 `.ds-message` 才内含 `.ds-markdown`。故 DeepSeek `userSel` 改为 `.ds-message:not(:has(.ds-markdown))`——用稳定的 `ds-` 设计系统前缀精确命中用户提问，避开不稳定的哈希类（如 `fbb737a4`）。用 jsdom 对真实对话 DOM 做回归：用户提问命中数=2、AI 回复命中数=2、交错顺序正确。

- **v1.11.3**：修复「导出全部对话只导出了 AI 的话、缺失用户提问」的潜藏 bug。新增各站点 `userSel`（用户提问容器选择器）与 `getUserMessages()`；`getAllReplies()` 重写——把「用户提问」与「AI 回复」节点合并后**按 DOM 顺序排序交错**拼接，并以轮次编号（`## 👤 第 N 轮 · 我的提问` / `## 🤖 第 N 轮 · AI 回复`）成对呈现。仅 AI 或无用户节点时自动降级（不报错）。`getLatestReply`（单条最新回复）保持不变。

- **v1.11.2**：悬浮按钮视觉重做——改为经典「分离按钮（split button）」形态。主按钮为 **46×46 正方形**（左侧圆角），右侧拼一个 **22×46 细长箭头**（右侧圆角），二者去掉间距、共用边框并以一条细分隔线衔接，视觉上是一个整体而非两个方块。箭头默认 `▴` 朝上（菜单从上方展开）、展开时旋转 180° 变 `▾`。悬停时整体微微浮起、各自背景提亮。

- **v1.11.1**：修复悬浮按钮布局 bug。原箭头按钮渲染成独立的方块且位于图标**左侧**、默认朝下。改为「图标 + 箭头同处**一个**玻璃方框」：箭头移到图标**右侧**、去掉自身边框/背景融入容器，默认朝上（▴，菜单在上方故指向上方）、展开时旋转 180° 指向下方。DOM 顺序调整为 `fab → arrow`，`#c2k-actions` 承接玻璃质感，`#c2k-fab`/`#c2k-arrow` 不再各自带框。

- **v1.11.0**：UI 简化与一键导出。**主图标 📑 直接作为「一键导出」**：点击即注入并发送总结咒语、等待生成完成、自动保存最新回复（等价于原来的「注入总结咒语」全流程）。其余三项收拢进主图标旁的 **▾ 箭头菜单**，自下而上顺序为：📋 复制最新回复 / 📥 导出最新回复 / 📚 导出全部对话（仅文本与顺序调整，功能不变）。移除原悬浮面板里独立的「✨ 注入并发送总结咒语」按钮；新增 `#c2k-actions` 容器与 `#c2k-arrow` 箭头按钮（展开时旋转 180°）样式。

- **v1.10.0**：移除「Obsidian 双链」独立导出模式，彻底统一为单一 YAML 导出。经确认 Obsidian 双链（`[[ ]]`）通常用在正文里指向**其它**笔记，而非包在自己 H1 上；而两种格式产出的 YAML 元数据本就一致，独立模式无实质差异。精简内容：`buildHeader`/`downloadMarkdown`/`copyMarkdown` 去掉 `obsidian` 参数与 `# [[标题]]` 分支；删除「📓 Obsidian 双链导出」按钮、`Ctrl+Shift+O` 快捷键、`AUTO_SAVE_FORMAT` 配置项。现在所有导出都是「YAML frontmatter + 标准 `# 标题`」，代码与认知负担都更小。

- **v1.9.1**：修复 Obsidian 模式下一级标题重复的问题——正文已含 h1 时，Obsidian 模式不再额外补 `# [[双链标题]]`，与正文 h1 共用同一个一级标题（两种格式行为现已一致：`hasH1` 时只给 YAML frontmatter）。

- **v1.9.0**：头部统一为 YAML 元数据格式。**普通 Markdown 与 Obsidian 双链两种导出现在共用同一套 YAML frontmatter**（title/source/author/created/description/tags），信息完整且被 Jekyll/Hugo/Obsidian/VuePress 等广泛识别，最大化兼容。双链 `[[ ]]` 语法**默认关闭**——仅 Obsidian 模式（「📓 Obsidian 双链导出」/ `Ctrl+Shift+O` / `AUTO_SAVE_FORMAT='obsidian'`）才把标题写成 `# [[双链标题]]`，普通 Markdown 用标准 `# 标题`。原普通 Markdown 的 `> 抓取时间` 引用块元信息被移除，并入 YAML。内部将 `buildObsidianFrontmatter` 重命名为 `buildYamlFrontmatter`。

- **v1.8.1**：调整 Obsidian 导出的 `tags`——去掉无信息量的 `ai/对话` 与重复的厂牌标签，改为只保留软件名称（如 `Chat2Knowledge`）；厂牌信息已由 `author` 承载，不再单列。

- **v1.8.0**：Obsidian 导出补齐标准 YAML Properties——`title` / `source`（引号） / `author`（AI 厂牌） / `created`（YYYY-MM-DD） / `description`（正文首段自动摘要，≤200 字截断） / `tags`（块式列表：软件名称）。新增 `yamlQuote()`（特字符/URL/数字布尔自动加引号）与 `extractDescription()` 辅助函数；遵循 Obsidian Properties 规范（小写键、列表格式、单 frontmatter 块）。`published` 因 AI 对话无真实发布时间暂不写入。

- **v1.7.0**：统一导出文件名规范为 `[软件名称]_[AI厂牌]_[时间戳]_[标题].md`。新增 `SOFTWARE_NAME` 可配置变量（软件名称，支持中英文切换，默认 `Chat2Knowledge`）；文件头标题与文件名标题统一取自 `resolveTitle()`（优先级：抓取内容 h1 → 网页页面标题 → 留空），正文已含 h1 时不再重复添加文件级标题，避免文件内出现两个一级标题。

- **v1.6.2**：修复真实 HTML 渲染路线（case A）下转换崩溃/畸形。**根因1（致命）**：`inlineToMd` 的 `strong`/`em`/`a` 处理器误写成 `inlineToMd(el)`（把元素自身再传给自己）→ 遇 `<strong>` 即无限递归栈溢出、整体转换失败。此前全是"整篇包代码块"路径（case B，走 `<pre>` 的 textContent，不碰行内标签）故潜伏至今。**根因2**：`<p>` 处理器把 `<br>` 产生的 `\n` 塌成空格，引用块逐行英文被挤成一行。用 jsdom 对真实 DeepSeek HTML 做回归测试，输出已完全正确（标题/表格/列表/引用/粗斜体/`#` 均正常，`<br>` 换行保留）。

- **v1.6.1**：修正"补充说明"被吞进 plaintext 代码块的问题。**根因是 `SUMMARY_PROMPT` 第 4 条"只输出纯 Markdown 源码"诱导 DeepSeek 把整篇包进代码围栏**（且偶发内层块漏闭合）。改为要求"直接输出标准 Markdown 渲染，不要整体包代码块"，让 DeepSeek 渲染成真实 HTML 由 HTML→MD 转换器逐块还原，从上游消除整类包裹问题。

- **v1.6.0**：修复 DeepSeek「纯 Markdown 导出」把整篇回复包进代码围栏导致格式全丢的问题。改为在提取阶段用 `looksLikeMarkdownSource()` 识别 Markdown 源码块并直接解包；`unwrapWrappingFence()` 改为容错版（容忍末尾空白行、不再强求内部围栏平衡）。

- **v1.5.0**：内置 HTML→Markdown 转换器（按 DOM 结构重建标题/表格/列表/引用/代码块）；新增可选「自动保存后推送 IMA」开关（`AUTO_PUSH_IMA` + `ima_watcher.py --serve`）。

- **v1.4.0**：「注入并发送总结咒语」后自动等待生成完成并自动抓取保存；跳过 UI 外壳、解包嵌套围栏。

- **v1.3.0**：自动发送（点按钮 / 派发 Enter）；稳定定位 `<textarea name="search">` 输入框。

- **v1.2.0**：等 `<body>` 就绪再注入 UI、放宽 `match`、初始化报错弹窗。

- **v1.1.0**：保留代码块语言标识；新增 Obsidian 双链格式导出。

- **v1.0.0**：初版，多站点自适应 + 玻璃拟态面板。

