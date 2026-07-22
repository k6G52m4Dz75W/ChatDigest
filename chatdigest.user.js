// ==UserScript==
// @name         ChatDigest / 聊摘 — AI 对话一键整理为 Markdown 知识库
// @namespace    https://github.com/chatdigest
// @version      1.20.2
// @description  ChatDigest / 聊摘 — 一键把 AI 对话整理成 Markdown 知识库文章。完全本地 / 无订阅 / 无需 API key / 多站点 (DeepSeek / ChatGPT / Kimi / Claude / 豆包 / 元宝) / 隐私优先 / 玻璃拟态 UI。可选推送到 IMA、Obsidian 等任意 Markdown 友好工具。locale-aware 文件名 (zh = 聊摘, 其他 = ChatDigest)。变更历史见 CHANGELOG.md。
// @author       ChatDigest Contributors
// @match        *://chat.deepseek.com/*
// @match        *://chatgpt.com/*
// @match        *://www.kimi.com/*
// @match        *://claude.ai/*
// @match        *://www.doubao.com/*
// @match        *://yuanbao.tencent.com/*
// @match        *://www.qianwen.com/*
// @match        *://gemini.google.com/*
// @run-at       document-idle
// @grant        GM_download
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    /* v1.20.0 新增: SCRIPT_VERSION 提取 + CHATDIGEST_TAG 拼装, 用于 report-bug 路径
       (GM menu "report bug" + alert 弹窗文本 + v1.15.15 FATAL 终极保险 alert/console)
       注入版本号 —— user 复制 alert 文本 / dev 看 console log 都能立刻知道是哪个版本触发的。
       提取策略:
         1) 优先 GM_info.script.version (Tampermonkey 注入, 反映**实际运行**版本,
            跟 @version 头可能因 cache / @namespace 略不同)
         2) 兜底 'unknown' (不再 hardcode 数字 —— 万一 hardcode 没跟上新版本号,
            反而会误导排查; 报 'unknown' 时 dev 一眼看出"用户那边 GM_info 异常"
            该追问, 而不是错信错版本号)
       daily-use 的 console.log / toast 提示不加版本号 (会啰嗦), 只有 report-bug 路径加. */
    let SCRIPT_VERSION = 'unknown';
    try {
        if (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.version) {
            SCRIPT_VERSION = GM_info.script.version;
        }
    } catch (_) { /* SCRIPT_VERSION 保持 'unknown' */ }
    const CHATDIGEST_TAG = 'ChatDigest: ' + SCRIPT_VERSION;

    /* ============================================================
     * v1.15.15 终极保险：整个主流程包 try/catch。任何 module-level throw
     * 都被 catch 住 + alert 显示具体错误（用户能直接看到"什么 throw 了"+
     * 报告给开发者）。
     *
     * 背景：v1.15.11/12 的 MSGS TDZ ReferenceError + v1.15.13/14 的 Tampermonkey 缓存,
     * 用户报告"完全崩了 + 开关也没了",根因是 IIFE 顶层 throw 把整个 userscript 挂掉
     * → FAB 不显示 + registerPushMenu 跑不到 + GM_registerMenuCommand 注册的开关都丢。
     *
     * v1.15.15 的原方案是"双保险": ① 顶部立刻注册一个 hardcoded label 的菜单项
     * 即使后续 throw 菜单也保留; ② 整个主流程包 try/catch 抓住 throw 弹 alert。
     *
     * v1.20.0 改: report bug 菜单**不再**放 IIFE 顶部 (那样会让菜单 UI 顺序变成
     * "report bug 在 IMA 推送开关之前", user 偏好 report bug 在推送开关下方)；
     * 移到 waitBody 里 initUI 之后调 registerReportBugMenu(), 跟 registerPushMenu
     * 同一注册路径, 自然落到 IMA 推送开关后面。
     *
     * 代价: line 74-1912 之间 throw 时, 菜单里没 report bug。但这段全是 const/let
     * 定义 + function 声明 (v1.15.13 已修 MSGS TDZ), 理论上不该 throw; 极端情况
     * IIFE 顶层 catch 仍兜底, 弹 FATAL alert (CHATDIGEST_TAG 带版本号, user
     * 复制 alert 文本照样能报告)。
     *
     * waitBody 内 initUI 自身 throw 不会丢菜单: try { initUI(); } catch { ... alert; }
     * 之后仍调 registerPushMenu + registerReportBugMenu。
     * ============================================================ */

    // ② 整个主流程包 try/catch — 任何 throw 都被抓住
    try {

    /* ============================================================
     * 站点适配器：不同 AI 网页的 DOM 结构不同，这里逐站适配
     * 每个适配器提供：
     *   - assistantSel : 定位「AI 回复」容器的选择器（可多个，逗号分隔）
     *   - userSel      : 定位「用户提问」容器的选择器（用于「导出全部对话」时与 AI 回复交错呈现）
     *   - titleSel     : 定位「对话标题」的选择器
     *   - inputSel     : 定位「输入框」的选择器（用于注入总结咒语）
     * ============================================================ */
    const ADAPTERS = {
        deepseek: {
            name: 'DeepSeek',
            // 取「AI 回复」容器（含 .ds-markdown 的 .ds-message）。
            // 注意：DeepSeek 的「思考块」内部也带 .ds-markdown（ds-think-content），
            // 故【不能】再追加 ", .ds-markdown"——否则会把思考块叶子节点也算成一条 AI 回复、
            // 并让 getLatestReply 拿到错误的节点。思考/答案的精确分离在 messageToMd 里按稳定类名处理。
            assistantSel: '.ds-message:has(.ds-markdown)',
            // 用户提问：DeepSeek 不给用户消息加 data-message-author-role="user"，
            // 而是用 .ds-message 容器包裹纯文本（无 .ds-markdown）；AI 回复的 .ds-message 内含 .ds-markdown。
            // 故用「含 .ds-message 但不含 .ds-markdown」精确命中用户提问，避开不稳定的哈希类（如 fbb737a4）。
            userSel: '.ds-message:not(:has(.ds-markdown))',
            titleSel: 'h3.flex-1, span[data-slate-editor], .chat-header-title',
            inputSel: 'textarea[name="search"], textarea[placeholder^="给 DeepSeek"], textarea, div[contenteditable="true"], div[contenteditable="plaintext-only"]',
        },
        chatgpt: {
            name: 'ChatGPT',
            assistantSel: '[data-message-author-role="assistant"] .markdown, [data-message-author-role="assistant"]',
            userSel: '[data-message-author-role="user"]',
            titleSel: 'h1, .conversation-title, header h2',
            inputSel: '#prompt-textarea, div[contenteditable="true"]',
        },
        kimi: {
            name: 'Kimi',
            // v1.17.0 修正: v1.16.0 写的 `.kimi-message-content, [data-role="assistant"]`
            // 实际 Kimi 页面**根本不存在**这两个 class/attr (来自 stub 假设) —— 见 v1.16.0 entry
            // "0 测试覆盖 / 手动验证清单: 打开 www.kimi.com F12 看到 ✅ ChatDigest started · Kimi"
            // 实际那时注入成功但 getAssistantMessages() 返回空, 一键导出后续全失败.
            // 真实 DOM (kimi.html 实测):
            //   user message:     <div class="chat-content-item chat-content-item-user">
            //                     ├ <div class="segment segment-user">
            //                     │   └ <div class="user-content">用户文本
            //                     └ <div class="segment-user-action-row">
            //                         └ [编辑 / 复制 / 分享] 按钮（应剔除）
            //   AI reply:         <div class="chat-content-item chat-content-item-assistant">
            //                     └ <div class="segment segment-assistant">
            //                       └ <div class="markdown-container"><div class="markdown">
            //                         └ <div class="paragraph"> / <h2> / <ul> / <table> 等标准 HTML
            //   input box:        <div contenteditable="true" role="textbox"> (Lexical editor)
            //                     (Kimi **没有** textarea, 用 contenteditable div + Lexical)
            //   no thinking block (搜 think/reasoning/cot/chain 0 命中; Kimi 暂时没 deepseek-style thinking)
            // userSel 故意选 .user-content 而不是 .chat-content-item-user：后者包含
            // 同级的 .segment-user-action-row（编辑/复制/分享 按钮），其 class 名
            // 是 segment-user-action-row / simple-button，不带 ds- 前缀，isUiChrome
            // 不会拦，会把按钮文字当正文带出。直接选 .user-content 绕过这个坑。
            assistantSel: '.chat-content-item-assistant',
            userSel: '.chat-content-item-user .user-content',
            titleSel: '.chat-title, header .title',
            inputSel: 'div[contenteditable="true"]',  // 去掉 `.chat-input textarea` (kimi.html 没 textarea)
        },
        claude: {
            name: 'Claude',
            assistantSel: '[data-testid="assistant-message"] .prose, [data-message-author-role="assistant"]',
            userSel: '[data-testid="user-message"]',
            titleSel: 'header h1, .conversation-title',
            inputSel: 'div[contenteditable="true"]',
        },
        doubao: {
            name: '豆包',
            // v1.18.1 修正：v1.18.0 的 `[data-testid="..."]` / `.bot-message` / `.markdown-body`
            // 实际 doubao.html 0 命中（跟 Kimi v1.16.0 stub 同一类问题 —— selector 从假设写、没真测过）。
            // 用户报告 3 个 bug 全是 selector 失效的级联后果：
            //   ① 一键发送后等不到 reply 完成 → ② 无法手动停止 → ③ 手动导出最新回复提示"没抓到有效内容"
            // 根因：assistantSel 选不到节点 → getAssistantMessages() 返回 [] → getLatestReply(null) → 全 fail
            //
            // 真实 DOM (doubao.html 实测, 2026-07-20)：
            //   - 消息 wrapper 用 [data-foundation-type] 标识（**稳定**，不像 minified class 每次 build 变）：
            //     · send-message-action-bar    = 用户消息的工具栏（"复制/分享/举报"...）
            //     · receive-message-action-bar = AI 回复的工具栏
            //     · receive-message-suggest-foundation = AI 回复后的"建议追问"
            //   - 每个 message row 结构 (e.g. AI reply):
            //     <div data-target-id="message-box-target-id">  <-- 稳定根
            //       <div>                                       <-- w-full
            //         <div class="flex flex-row ...">           <-- message row
            //           <div class="flex flex-col ...">          <-- content (markdown)
            //             <div class="container-XXXXX">         <-- minified content 容器
            //               ...user 文本 / AI markdown...
            //           </div>
            //           <div data-foundation-type="receive-message-action-bar">  <-- action bar (chrome)
            //         </div>
            //       </div>
            //     </div>
            //   - 输入框是 <textarea placeholder="发消息...">（**有** textarea，不像 Kimi 用的 contenteditable div）
            //
            // selector 策略：选 action bar（[data-foundation-type] 稳定）→ 用 getMessageNode hook
            // 拿它的**直接父**作为 message row。messageToMd clone message row + 移除 isUiChrome
            // （isUiChrome 用两次 closest() OR 检测 action bar 后代 — 避开 `closest('A, B')` 多 selector
            // 抛 SyntaxError 的 c50458b 崩溃 bug）→ 留下 content → blockToMd 走 markdown 转换。
            //
            // getMessageNode 走 "el.parentElement (1 层) + [data-target-id='message-box-target-id'] anchor
            // sanity check" —— 真实 DOM 中 el.parentElement 就是 message row (verified 2026-07-20
            // find_doubao6.py output parent[+0] = "flex flex-col flex-grow max-w-full min-w-0" 包含
            // content + action bar 2 个 children)。c5859ac 之前的 2 层祖版本拿 w-full outer
            // (parent[+1]) = 整个聊天区 → messageToMd 拼所有 messages → extractDescription 找不到
            // 正确 H1 → YAML description 脏或缺失。
            assistantSel: '[data-foundation-type="receive-message-action-bar"]',
            userSel: '[data-foundation-type="send-message-action-bar"]',
            titleSel: 'header h1, .title',
            inputSel: 'textarea[placeholder^="发消息"]',
            getMessageNode: (el) => {
                if (!el) return null;
                // 1) Fast path: el.parentElement IS the message row (verified doubao DOM 2026-07-20)
                const row = el.parentElement;
                if (row && row.closest && row.closest('[data-target-id="message-box-target-id"]')) {
                    return row;
                }
                // 2) Fallback: walk up until we find a div that is a direct child of
                // [data-target-id="message-box-target-id"] (defensive, in case doubao adds
                // 1 layer of wrapper in future)
                const anchor = el.closest && el.closest('[data-target-id="message-box-target-id"]');
                if (!anchor) return null;
                let p = el.parentElement;
                while (p && p !== anchor) {
                    if (p.parentElement === anchor &&
                        p.querySelector('[data-foundation-type$="action-bar"]')) {
                        return p;
                    }
                    p = p.parentElement;
                }
                return null;
            },
        },
        yuanbao: {
            name: '元宝',
            // v1.19.0 修正 (用户实测 yuanbao.html, 2026-07-20):
            // 老 stub `.agent-chat__message--bot .markdown, [data-role="assistant"]`
            // 在 yuanbao 真实 DOM 里 0 命中 —— 实际用稳定的 `data-conv-speaker` 属性
            // (跟 doubao 的 `data-foundation-type` 同一思路: 不依赖 minified class)
            // - data-conv-speaker="ai"     → AI 回复 (agent-chat__list__item--ai 整条)
            // - data-conv-speaker="human"  → 用户提问 (agent-chat__list__item--human 整条)
            // 输入框是 Quill editor, 不是 textarea: `div.ql-editor[contenteditable="true"]`
            // (跟 Kimi 一样的 Quill 实现, 但 Kimi 当时是写 inputSel fallback 撞上的)
            // 没有 getMessageNode hook 需求 —— item 本身 (agent-chat__list__item)
            // 就是消息 row, 直接当 messageToMd 输入。
            // 标题 HTML 快照里没出现 (conv 标题在 sidebar/header 折叠状态),
            // 留通用 `h1, h2` fallback。
            assistantSel: '[data-conv-speaker="ai"]',
            userSel: '[data-conv-speaker="human"]',
            titleSel: 'h1, h2, .chat-title, header h1',
            inputSel: 'div.ql-editor[contenteditable="true"]',
        },
        qwen: {
            name: '千问',
            // v1.21.0 真实 DOM 调研 (用户实测 e:\projects\qwen.html, 2026-07-21, 250KB):
            // 千问用 CSS Module hash 风格 (`message-card-j_n6rq` 等), hash 每次 build 变,
            // 不能直接用 class. 跟 yuanbao/doubao 同一思路: 用**语义化前缀**
            // + CSS attribute selector `[class*="前缀"]` 部分匹配, 兼容 hash 变种.
            // - chat-answers-card-wrap: AI 答案 wrapper (含 answer-meta 时间戳 + answer-common-card
            //   真正内容 + assistant-text 标签) —— 1 命中 (qwen.html 只有 1 条 AI 回复)
            // - chat-question-card-wrap: user 提问 wrapper (含 message-card-wrap question 内容)
            //   —— 2 命中 (qwen.html 1 条 user 提问 + 1 个重渲染 wrapper, 都命中)
            // 输入框是 Slate editor (跟 yuanbao Quill 同一思路, 现代富文本编辑器,
            // contenteditable + data-slate-editor 是稳定标识): 1 命中.
            // 标题 HTML 快照里没出现 (跟 yuanbao 一样, conv 标题在 sidebar/header 折叠状态),
            // 留通用 `h1, h2` fallback. 等用户实测后按需校准 (跟 yuanbao v1.19.0 节奏一样).
            assistantSel: '[class*="chat-answers-card-wrap"]',
            userSel:      '[class*="chat-question-card-wrap"]',
            titleSel:     'h1, h2, .chat-title, header h1',
            inputSel:     'div[contenteditable="true"][data-slate-editor="true"]',
        },
        gemini: {
            name: 'Gemini',
            // gemini.html 实测 (e:\projects\gemini.html, 2026-07-22, 247KB):
            // - 用 Angular Material 框架 (ng-star-inserted 505 hits, mat-mdc-* 几百 hits)
            // - AI 跟 user 用 custom element (Web Component) 不是普通 div: <model-response> / <user-query>
            //   querySelectorAll('model-response') 跟 querySelectorAll('div') 一样能选, 千问 ADAPTERS 已验证
            // - 真正 AI 文本在 <div class="markdown markdown-main-panel"> 段 (id="model-response-message-content<hash>")
            // - user 文本在 <user-query-content> 内
            // - input 跟 Kimi 一样用 Quill 富文本编辑器 (ql-editor class, contenteditable="true")
            // - chrome 5 个 data-test-id (copy-button / more-menu-button / thumb-up/down / prompt-copy-button)
            //   + Angular Material 通用 class (mat-icon / gem-icon-button / message-actions / freemium-rag-disclaimer)
            assistantSel: 'model-response',
            userSel:      'user-query',
            titleSel:     'h1, h2, .conversation-title, header h1',
            inputSel:     'div.ql-editor[contenteditable="true"]',
        },
    };

    /* 自动识别当前站点 */
    function detectSite() {
        const host = location.hostname;
        if (host.includes('deepseek')) return ADAPTERS.deepseek;
        if (host.includes('chatgpt') || host.includes('openai')) return ADAPTERS.chatgpt;
        if (host.includes('kimi.com')) return ADAPTERS.kimi;
        if (host.includes('claude')) return ADAPTERS.claude;
        if (host.includes('doubao')) return ADAPTERS.doubao;
        if (host.includes('yuanbao') || host.includes('tencent')) return ADAPTERS.yuanbao;
        if (host.includes('qianwen')) return ADAPTERS.qwen;
        if (host.includes('gemini')) return ADAPTERS.gemini;
        return null;
    }

    const SITE = detectSite();

    /* ============================================================
     * 核心：抓取 AI 回复文本
     * ============================================================ */
    function queryAll(sel) {
        try { return Array.from(document.querySelectorAll(sel)); }
        catch (e) { return []; }
    }

    function getAssistantMessages() {
        if (!SITE) return [];
        // 按优先级尝试各个选择器片段
        const frags = SITE.assistantSel.split(',').map(s => s.trim());
        let nodes = [];
        for (const f of frags) {
            nodes = queryAll(f);
            if (nodes.length) break;
        }
        // 站点可选 hook：把 selector 选到的 node 转换成「消息 row 容器」。
        // 例：豆包 assistantSel 选 action bar（稳定），getMessageNode(el) → action bar 的直接父
        // 拿 message row（content + action bar 一起），让 messageToMd clone + 移除 chrome 后输出纯 content。
        if (SITE.getMessageNode) {
            nodes = nodes.map(SITE.getMessageNode).filter(Boolean);
        }
        return nodes;
    }

    /* 抓取「用户提问」容器（与 getAssistantMessages 对应，用于全部对话交错导出）。
       各站点 userSel 仅取首选片段即可，因为会与 AI 节点统一按 DOM 顺序排序。 */
    function getUserMessages() {
        if (!SITE || !SITE.userSel) return [];
        const frags = SITE.userSel.split(',').map(s => s.trim());
        let nodes = [];
        for (const f of frags) {
            nodes = queryAll(f);
            if (nodes.length) break;
        }
        if (SITE.getMessageNode) {
            nodes = nodes.map(SITE.getMessageNode).filter(Boolean);
        }
        return nodes;
    }

    /* 判断是否为站点 UI 外壳（按钮、图标、代码块头部的 复制/下载/语言标签等）。
       这些元素不应进入 Markdown。DeepSeek 的样式类带稳定前缀 ds-，
       据此排除 header/toolbar/action/copy/lang/label 一类外壳；
       另外顺手剔除「代码块语言标签」（markdown/plaintext 等孤行文字）。 */
    function isUiChrome(el) {
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        if (tag === 'button' || tag === 'svg' || tag === 'path' || tag === 'img') return true;
        const cls = (el.className || '').toString();
        // v1.21.0 增: 千问 AI 回复末尾 ``` 装饰 (qk-md-text class + textContent 是纯 3+ 反引号).
        // 必须在所有其他 class regex 检查**之前**跑 (放在最后也行, 但放最前性能好且语义清晰).
        // qwen.html (line 11) 验证: chat-answers-card-wrap #2 块 145593-178130 内, card-container-wide div
        // 配对 158258-170983, **在 card-container div 之后**有 `<br><span class="qk-md-text complete">\`\`\`</span>`
        // (绝对 pos 171033, 在 div 外但在 chat-answers-card-wrap 内). 千问不解析 ``` 围栏, 原样 textContent.
        // inlineToMd 对 span fall through return inner, raw ``` 字符进 .md 末尾. 不是 card-container 内部残留,
        // 而是 card-container 块之后的"分隔装饰". 加固 isUiChrome 拦截, 避免透传.
        // 不能误伤: 含其他字符的 qk-md-text (如 `<span class="qk-md-text complete">普通文本</span>` 仍正常透传).
        if (/\bqk-md-text\b/i.test(cls) && /^[ \t\n]*`{3,}[ \t\n]*$/.test((el.textContent || ''))) return true;
        if (/\bds-[\w-]*(header|toolbar|action|copy|button|lang|label)[\w-]*\b/i.test(cls)) return true;
        // 豆包 chrome（data-foundation-type 时代，class 全是 minified 无稳定关键字）：
        // - send-message-action-bar: 用户消息工具栏（复制/分享/举报）
        // - receive-message-action-bar: AI 回复工具栏（复制/点赞/点踩/重新生成/语音）
        // - receive-message-suggest-foundation: AI 回复后"建议追问"
        // 整条 action bar + 内部 button 全部是 chrome —— ancestor 检查最稳（minified class 不可靠）。
        // ⚠️ 不能用 `el.closest('A, B')` 多 selector —— Element.closest() spec 规定只接
        //    1 个 selector, 传逗号分隔会抛 DOMException SyntaxError 炸 IIFE。
        //    必须拆成两次 closest() OR 起来。
        if (el.closest && (
            el.closest('[data-foundation-type$="action-bar"]') ||
            el.closest('[data-foundation-type$="suggest-foundation"]')
        )) return true;
        // Kimi chrome（data-v- scoped CSS 时代，class 是固定名不带 ds- 前缀）：
        // - sticky-release[-rail/-header]: 表格顶栏 sticky 容器
        // - table-actions[-content/-icon]: 表格操作区（复制/下载等）
        // - icon-button: 圆形操作按钮
        // - kimi-tooltip: 按钮悬浮提示（"复制"/"下载"等）
        // - table-title: 表格标题（"表格"）
        // - tooltip-*: 任意 tooltip 变体
        // - iconify: svg 图标 class
        if (/\b(sticky-release(-[a-z-]+)?|table-actions(-[a-z-]+)?|icon-button(-[a-z-]+)?|kimi-tooltip|table-title|tooltip-[a-z-]+|iconify)\b/i.test(cls)) return true;
        // 元宝 chrome (class 前缀 agent-chat__ / hyc-, 跟 DeepSeek ds- / 豆包 data-foundation 同思路:
        // 不用 minified class, 用稳定语义化 class + 关键词):
        // - agent-chat__conv--ai__toolbar: AI 消息工具栏 wrapper (复制/重新生成/点赞/点踩)
        // - agent-chat__toolbar: 工具栏本体 (内层, 包 toolbar__left/right 子元素)
        // - agent-chat__list__item__checkbox: 批量选择 checkbox (多选导出用)
        // - hyc-card-box-process-list: 思考/loading 框 (过程信息, 不是最终回复)
        // - agent-chat__bubble__prefix: AI 头像
        if (/\b(agent-chat__(conv--ai__toolbar|toolbar)|agent-chat__list__item__checkbox|hyc-card-box-process-list|agent-chat__bubble__prefix)\b/i.test(cls)) return true;
        // 千问 chrome (qwen.html 实测, 2026-07-21):
        // - chat-msg-bottom-anchor: 消息底部 anchor 元素 (jQuery 风格的滚动锚点)
        // - answer-meta: AI 答案 metadata wrapper (含 "07月20日 23:11" 时间戳等, 不是内容)
        // - assistant-text: "AI 助手" 角色标签 (元数据, 不是正文)
        // - chat-question-wrap: user 提问 wrapper 内层 (chat-question-card-wrap 是外层, 留 wrapper 整条)
        // v1.21.0 增: 表格 chrome (user 报告 case, 千问 qk-md-* 风格稳定无 hash, 跟 qk-md-text 同款)
        // - qk-md-table-action[-title/-bar]: 表格 action bar wrapper (含"表格"标题 + 操作按钮区)
        // - qk-md-table-download-[wrapper/icon/menu/menu-item]: 下载按钮 + 菜单 (内含"下载为表格"/"导出为图片" 文字)
        // - qk-md-download-icon: 下载 svg icon
        // - qk-md-copy-icon: 复制 svg icon
        // **不能 strip 的** (跟 chrome 同前缀但语义是内容):
        //   - qk-md-table / -head / -body / -row: 真实 table 结构
        //   - qk-md-table-section / -wrapper / -container: table 容器 (table 在 -container 内)
        //   - qk-md-text / -paragraph / -ul / -ol / -li / -strong / -code: 实际正文
        // v1.21.0 增: 卡片预览 chrome (user 报告 case, 千问 CSS Module hash 风格, 跟 message-card-j_n6rq 同款)
        // - card-container-wide-*: AI 偶尔插入的"外部引用卡片预览" (含 svg 缩略图 + title + "创建于 xx:xx" 描述)
        //   整块是 link 引用, 不是 AI 写的回复内容, 必须 strip. 通配 [\\w-]+ 兼容 wide/narrow/mobile 等变种.
        //   qwen.html 实测 0 hit (新对话才出现), 不跟 chat-answers-card-wrap / message-card-j_n6rq 冲突 (前缀不同).
        if (/\b(chat-msg-bottom-anchor|answer-meta|assistant-text|chat-question-wrap|qk-md-(table-action(-title|-bar)?|table-download-(wrapper|icon|menu|menu-item)|download-icon|copy-icon)|card-container-[\w-]+)\b/i.test(cls)) return true;
        // Gemini chrome (gemini.html 实测, 2026-07-22):
        // 跟 yuanbao 同一思路: ancestor 检查更稳 (Angular Material 通用 class 不可靠, 误伤风险高).
        // - [data-test-id="copy-button"]: AI 末尾复制按钮
        // - [data-test-id="more-menu-button"]: AI 末尾更多菜单
        // - [data-test-id="thumb-up-button"]: AI 点赞
        // - [data-test-id="thumb-down-button"]: AI 点踩
        // - [data-test-id="prompt-copy-button"]: user 提问复制按钮
        // - <message-actions>: AI 末尾 actions 整段 (含 thumb / copy / more menu 等, custom element)
        // - <freemium-rag-disclaimer>: Gemini 底部免责 ("Gemini can make mistakes" 等, custom element)
        // - <gem-icon-button> / <gem-popover> / <mat-menu>: Gemini / Material 弹层组件
        // ⚠️ 不能用 `el.closest('A, B')` 多 selector —— Element.closest() spec 规定只接
        //    1 个 selector, 传逗号分隔会抛 DOMException SyntaxError 炸 IIFE.
        //    必须拆成多次 closest() OR 起来.
        if (el.closest && (
            el.closest('[data-test-id="copy-button"]') ||
            el.closest('[data-test-id="more-menu-button"]') ||
            el.closest('[data-test-id="thumb-up-button"]') ||
            el.closest('[data-test-id="thumb-down-button"]') ||
            el.closest('[data-test-id="prompt-copy-button"]') ||
            el.closest('message-actions') ||
            el.closest('freemium-rag-disclaimer') ||
            el.closest('gem-icon-button') ||
            el.closest('gem-popover') ||
            el.closest('mat-menu')
        )) return true;
        // v1.21.0 增: 跨站通用 accessibility-hidden 元素 (Material Design / Bootstrap / WAI-ARIA 风格).
        // 视觉上不可见 (CSS `clip: rect(0 0 0 0); position: absolute;`) 但 textContent 还在 DOM 里,
        // 抓取路径会误捕获. 实测: gemini.html offset 164506 有
        // `<h2 class="cdk-visually-hidden screen-reader-model-response-label">Gemini 说</h2>`
        // (Angular Material screen-reader-only 元素, 出现在 AI 回复开头).
        // 跨站覆盖:
        // - cdk-visually-hidden: Material Design / Angular Material 标准 class
        // - sr-only / u-sr-only: Bootstrap 3 / 通用
        // - visually-hidden: Bootstrap 4 / 通用
        // - screen-reader-only / screen-reader-text: 各种自定义变体
        if (/\b(cdk-visually-hidden|u?sr-only|visually-hidden|screen-reader-(only|text))\b/i.test(cls)) return true;
        // 孤行语言标签（无子元素、文本恰为某语言名）
        if ((tag === 'span' || tag === 'label' || tag === 'div') && !el.children.length) {
            const t = (el.textContent || '').trim().toLowerCase();
            if (/^(markdown|plaintext|plain|text|txt|json|python|py|javascript|js|typescript|ts|bash|sh|shell|console|html|xml|css|yaml|yml|sql|go|rust|java|c\+\+|cpp|csv|toml|markdown text)$/.test(t)) return true;
        }
        return false;
    }

    /* 计算嵌套代码块所需的安全围栏长度：比内容中最长的连续反引号多一个，
       避免内容里出现 ``` 时把外层围栏提前闭合。 */
    function fenceLen(text) {
        let max = 0, run = 0;
        for (const ch of text) {
            if (ch === '`') { run++; if (run > max) max = run; }
            else run = 0;
        }
        return Math.max(3, max + 1);
    }

    /* v1.15.6 新增：用 fenceLen 算出的安全围栏把代码正文包成 fenced code block。
       之前 pre 块路径（L243）与 md-code-block 路径（L279）各有 2 行
       `const fence = '`'.repeat(fenceLen(text)); return '\\n' + fence + lang + '\\n' + text + '\\n' + fence + '\\n';`
       完全一样——重复。提到外层统一工具函数。
       行为 100% 等价（fenceLen 算法 + 围栏拼接顺序都不变），仅 1 处定义 + 2 处调用。
       v1.15.7 补充：UNWRAP_LANGS 列表原本两处**有意不同**（pre 5 个 / md-code-block 8 个，含 plain/english/eng），
       但 v1.15.7 进一步提到 MD_SOURCE_LANGS 统一（见下）后，差异消除——本 helper 不再涉及。 */
    function wrapFencedCode(text, lang) {
        const fence = '`'.repeat(fenceLen(text));
        return '\n' + fence + lang + '\n' + text + '\n' + fence + '\n';
    }

    /* v1.15.7 新增：模块顶部常量，统一「这些语言名 = 代码块里包的是 Markdown 源码 / 纯文本，不是真程序代码」列表。
       之前散在 3 处（局部 const，互不引用）：
         - blockToMd (pre 路径)     : mdDumpLangs  = ['markdown', 'md', 'plaintext', 'text', 'txt']                    (5)
         - blockToMd (md-code-block) : UNWRAP_LANGS  = ['markdown', 'md', 'text', 'plaintext', 'txt', 'plain', 'english', 'eng']  (8)
         - unwrapSourceFences        : srcLangs     = ['plaintext', 'text', 'markdown', 'md', 'txt']                   (5)
       3 个 list 高度重叠、顺序还不一样、UNWRAP_LANGS 多了 plain/english/eng 三个——重复 + 不一致。
       v1.15.6 当时判断「两处有意不同」（pre 不解包 plain/english/eng）保留差异；v1.15.7 用户 review 后决定
       反正 plain/english/eng 实际就是「这不是真代码、是文本」的信号，统一解包是正确行为不算 regression。
       提到 1 个常量 MD_SOURCE_LANGS（8 项并集），3 处共用；'plain'/'english'/'eng' 现在 pre + unwrapSourceFences
       也会解包。
       注：isUiChrome 里的语言 regex（markdown|plaintext|...|json|python|js|...）是**另一类语义**——
       DOM 遍历时跳过语言标签 chrome，覆盖范围比 MD_SOURCE_LANGS 广（含真代码语言 json/python/js 等），
       不合并、保留独立。 */
    const MD_SOURCE_LANGS = ['markdown', 'md', 'plaintext', 'text', 'txt', 'plain', 'english', 'eng'];

    /* 判断一段文本是否「本质上是 Markdown 文章源码」（而非真正的程序代码）。
       用于识别 DeepSeek 等把整篇回复包进代码围栏的「纯 Markdown 导出」场景。
       采用较稳的启发式：出现 ≥2 个标题，或存在管道表格，或 1 个标题 + 列表/引用。
       避免把带 # 注释的 Python/Shell 代码块误判为 Markdown。 */
    function looksLikeMarkdownSource(text) {
        const heads = (text.match(/(^|\n)#{1,6}\s/g) || []).length;
        const hasTable = /(^|\n)\|.*\|\n\s*\|[-:\s|]+\|/.test(text);
        const hasList = /(^|\n)(-|\*|\+|\d+\.)\s/.test(text);
        const hasQuote = /(^|\n)>\s/.test(text);
        return heads >= 2 || hasTable || (heads >= 1 && (hasList || hasQuote));
    }

    /* 行内元素 → Markdown（用于标题/段落/列表项/表格单元格的内部） */
    function inlineToMd(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent;
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const el = node;
        if (isUiChrome(el)) return '';
        const tag = el.tagName.toLowerCase();
        // 先递归子节点算出内部文本；注意必须遍历 children，绝不能 inlineToMd(el)（会把元素自身再传给自己 → 无限递归）
        const inner = Array.from(el.childNodes).map(inlineToMd).join('');
        if (tag === 'code') return '`' + (el.textContent || '').trim() + '`';
        if (tag === 'strong' || tag === 'b') return '**' + inner + '**';
        if (tag === 'em' || tag === 'i') return '*' + inner + '*';
        if (tag === 'del' || tag === 's' || tag === 'strike') return '~~' + inner + '~~';
        if (tag === 'a') {
            const href = el.getAttribute('href') || '';
            return href ? `[${inner}](${href})` : inner;
        }
        if (tag === 'img') {
            const alt = el.getAttribute('alt') || '';
            const src = el.getAttribute('src') || '';
            return src ? `![${alt}](${src})` : '';
        }
        if (tag === 'br') return '\n';
        return inner;
    }

    /* 表格 → Markdown 管道表 */
    function tableToMd(table) {
        const rows = Array.from(table.querySelectorAll('tr'));
        if (!rows.length) return '';
        const cellsOf = (tr) => Array.from(tr.children)
            .filter(c => /^(td|th)$/.test(c.tagName.toLowerCase()))
            .map(c => inlineToMd(c).replace(/\n/g, ' ').trim());
        const esc = (s) => s.replace(/\|/g, '\\|');
        return rows.map((tr, ri) => {
            const cells = cellsOf(tr).map(esc);
            const line = '| ' + cells.join(' | ') + ' |';
            return ri === 0 ? line + '\n' + '| ' + cells.map(() => '---').join(' | ') + ' |' : line;
        }).join('\n');
    }

    /* 块级元素 → Markdown（核心转换器）。
       - 代码块：保留语言标识，并对嵌套围栏做安全加长；
         若语言为 markdown/md（DeepSeek 常被要求输出「纯 Markdown 源码」而整体包进代码块），
         直接解包为原始 Markdown，避免外层再套一层围栏导致嵌套错误。
       - 标题/段落/列表/引用/表格/链接/强调 均按 HTML 结构重建 Markdown 语法。 */
    function blockToMd(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent;
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const el = node;
        if (isUiChrome(el)) return '';
        const tag = el.tagName.toLowerCase();

        // 子节点路由：inline element 走 inlineToMd 保留格式，block element 走 blockToMd。
        // 用于 li / blockquote / 未知 block 容器（div/section/article）递归 children 时——
        // 这些场景 AI 可能把 <strong>/<em>/<code>/<a> 等直接放在容器内，
        // 之前 blockToMd 对 inline tag 也走"未知 container"路径 fall through 丢格式
        // （例：<li>item with <code>code</code></li> 之前输出 "item with code"，code 标记丢失）。
        //
        // v1.18.1 修复: routeChild 跳过纯空白 text node, 避免 `<li>\n  <strong>...` 这类
        // HTML 缩进产生的 "\n  " text node 变成 "   \n\n   " 那种"空行带尾空格"残留,
        // 视觉上 "<strong>后面跟一行只有空格再接描述" 看着像 strong 没结束.
        const INLINE_TAGS = /^(strong|b|em|i|del|s|strike|a|img|br|code|span|u|small|sub|sup|mark)$/;
        const routeChild = (c) => {
            if (c.nodeType === Node.TEXT_NODE && /^[ \t\n\r]*$/.test(c.textContent)) {
                return '';  // 跳过纯空白 text node (HTML formatting 产生的)
            }
            return (c.nodeType === Node.ELEMENT_NODE && INLINE_TAGS.test(c.tagName.toLowerCase()))
                ? inlineToMd(c)
                : blockToMd(c);
        };

        // 代码块
        if (tag === 'pre') {
            const code = el.querySelector('code') || el;
            const cls = code.className || '';
            const m = cls.match(/language-([\w+#.-]+)/i) || cls.match(/lang-([\w+#.-]+)/i);
            const lang = m ? m[1].toLowerCase() : '';
            let text = (code.textContent || '').replace(/^\n+/, '').replace(/\n+$/, '');
            // 若语言标记为 markdown/md/plaintext/text/txt 等源码语言（见 MD_SOURCE_LANGS），
            // 或虽无语言但整块就是 Markdown 文章源码（DeepSeek 等常把整篇回复包进代码围栏当
            // 「纯 Markdown 导出」），则解包外层围栏、原样输出 Markdown，保留内部合法的 ```plaintext 等代码块。
            if (MD_SOURCE_LANGS.includes(lang) || (lang === '' && looksLikeMarkdownSource(text))) {
                return '\n' + text + '\n';
            }
            return wrapFencedCode(text, lang);
        }
        // DeepSeek 代码块：.md-code-block 包裹，内含 <pre>（带语法高亮 token）与 banner
        // （语言标签 <span class="d813de27"> + 复制/下载按钮）。
        if (tag === 'div' && /\bmd-code-block\b/.test(el.className || '')) {
            // 1) 语言标签：优先取 banner 内的 .d813de27（DeepSeek 真实语言名：markdown / text / plaintext …），
            //    回退到 banner 文本（去掉「复制/下载」按钮字）。旧逻辑查 [class*="header"] 会命中错误元素导致 lang 为空。
            const labelEl = el.querySelector('.d813de27');
            let lang = (labelEl ? labelEl.textContent : '').trim().toLowerCase();
            if (!lang) {
                const banner = el.querySelector('.md-code-block-banner-wrap');
                const bt = (banner ? banner.textContent : (el.textContent || ''))
                    .replace(/复制下载?|下载|复制/g, '').trim().toLowerCase();
                if (/^[a-z0-9+#.-]{1,20}$/.test(bt)) lang = bt;
            }
            // 2) 代码正文：优先 <pre>，其次 <code>；某些序列化快照 <pre> 为空时，
            //    退而取「去掉 banner/按钮后的整块文本」。
            const code = el.querySelector('pre') || el.querySelector('code');
            let text = code ? (code.textContent || '') : '';
            text = text.replace(/^\n+/, '').replace(/\n+$/, '');
            if (!text.trim()) {
                const clone = el.cloneNode(true);
                const b = clone.querySelector('.md-code-block-banner-wrap');
                if (b) b.remove();
                clone.querySelectorAll('button,.ds-button,svg').forEach(n => n.remove());
                text = (clone.textContent || '').replace(/^\n+/, '').replace(/\n+$/, '').trim();
            }
            if (!text.trim()) return ''; // 真·空代码块
            // 3) 这些语言（见 MD_SOURCE_LANGS）都是「把整篇 Markdown / 纯文本源码包起来的源码块」，
            //    应解包为原始内容；只有真正的程序代码语言（python / js / bash / json …）才保留围栏。
            //    对应 AI「只输出纯 Markdown 源码 / 不要整篇包进代码块」的诉求。
            if (MD_SOURCE_LANGS.includes(lang)) {
                return '\n' + text + '\n';
            }
            return wrapFencedCode(text, lang);
        }
        if (tag === 'code') return '`' + (el.textContent || '').trim() + '`';

        // 标题
        if (/^h[1-6]$/.test(tag)) {
            return '\n' + '#'.repeat(+tag[1]) + ' ' + inlineToMd(el).trim() + '\n';
        }
        // 段落
        if (tag === 'p') {
            // 注意：inlineToMd 会把 <br> 还原成 \n（行内换行），这里【不能】把 \n 折叠成空格，
            // 否则 <br> 产生的换行会丢失——例如引用块里逐行英文会被挤成一行、Markdown 彻底变形。
            // 尾部输出 2 个换行（\n\n）而非 1 个：Markdown 段落规范是「以双换行结束」，
            // 之前 \n 依赖下一 block 的 \n 前缀 + normalizeMd 折叠救场（碰巧对，不规范）。
            // 同时这是 AI 回复里 `text\n---`（无空行）触发 CommonMark setext h2 的根因——
            // <p> 内部 inline 拼接 / li 嵌套等场景会塌成 \ntext\n---\n，把段落撞成 h2。
            const t = inlineToMd(el).trim();
            return t ? '\n' + t + '\n\n' : '';
        }
        // 列表
        // v1.18.1 修复: OL marker 宽度 ("1. "/"10. ") ≥ 3 字符, 之前统一 2 空格缩进
        // 不够 CommonMark continuation 要求 (indent ≥ 首个 content 的 column) →
        // 描述 "飘" 出 list item 当独立段落, 跟 strong 合并渲染。
        // 改: OL 用 3 空格, UL 仍 2 空格 ("- " 是 2 字符)。
        if (tag === 'ul' || tag === 'ol') {
            const items = Array.from(el.children).filter(c => c.tagName.toLowerCase() === 'li');
            const indent = tag === 'ol' ? '\n   ' : '\n  ';
            // v1.20.0 修：yuanbao 把 AI 写的 markdown list 文本 ("1. xxx" / "• xxx")
            // 渲染为 <ol><li>1. xxx</li></ol> —— body 开头已经带 "1. " / "• " marker,
            // 跟外层 prefix 拼成双 marker ("1. 1. xxx" / "- • xxx")。
            // strip body 开头 AI 自带的 list marker, 跟外层 prefix 只留一份。
            // 其他站 (DeepSeek / Kimi / 豆包) 用真实 <ol><li> 渲染, body 不带 marker,
            // 这条 replace 不命中, 行为 0 变化。
            //
            // v1.21.0 修 (千问 markdown emphasis 错配 bug): 千问 chat-answers-card-wrap
            // 会把 **X** 解析成 <strong class="qk-md-strong"> (跟 <em> 不一样, em 千问
            // 不解析, strong 千问会解析), inlineToMd 处理 <strong> → '**' + inner + '**'
            // 输出 '**内容提炼**'。但 ul handler 这条 stripLead 字符类 `[-*+•·]`
            // 太宽, body 开头的 '**' 第一个 '*' 命中 stripLead, 被吃掉 1 个,
            // 留下 '*内容提炼**' + prefix '- ' = '- *内容提炼**：...' (user 报告 case)。
            // 修: stripLead 加 lookahead '(?!\\*)' 排除 marker 后接 '*' 的 case
            // (即 markdown bold 起始), 避免误伤 '**X**' 完整配对。yuanbao 的 '•首行'
            // (无空格 bullet) 仍然命中, 因为 '•' 不在 markdown emphasis 字符类。
            const stripLead = tag === 'ol'
                ? /^\s*\d+[.)]\s*/
                : /^\s*[-*+•·](?!\*)\s*/;
            const out = items.map((li, i) => {
                const prefix = tag === 'ol' ? (i + 1) + '. ' : '- ';
                let body = blockToMd(li).replace(/^\n+/, '').replace(/\n+$/, '');
                body = body.replace(stripLead, '').replace(/\n/g, indent);
                return prefix + body;
            }).join('\n');
            return '\n' + out + '\n';
        }
        if (tag === 'li') {
            return '\n' + Array.from(el.childNodes).map(routeChild).join('').trim() + '\n';
        }
        // 引用
        if (tag === 'blockquote') {
            const inner = Array.from(el.childNodes).map(routeChild).join('').trim();
            return '\n' + inner.split('\n').map(l => '> ' + l).join('\n') + '\n';
        }
        // 表格
        if (tag === 'table') return '\n' + tableToMd(el) + '\n';
        // 分隔线
        if (tag === 'hr') return '\n---\n';
        if (tag === 'br') return '\n';

        // 容器：递归子节点 — 未知 block 容器（div/section/article/aside/main 等）按段落分隔输出。
        // 之前走 fall through `join('')` 会塌成 inline 文本（多块粘一起，如
        // <div>A</div><div>B</div> → "AB"），同时塌成 text\n--- 触发 CommonMark setext h2 撞车。
        // 现在 wrap \n + content + \n\n 让未知 block 容器也符合 Markdown 段落分隔语义。
        return '\n' + Array.from(el.childNodes).map(routeChild).join('') + '\n\n';
    }

    /* 折叠多余空行、去除行尾空白。
       v1.18.1 修复 (2 处):
       1. 之前用 `[ \t]+\n` → `\n` 全局吃"行尾空格+换行", 但 list continuation 的 indent
          (e.g. ul/ol handler 输出 ` 集结...`) 也是这种"空格+换行+空格+文本"模式,
          会被误吃 → 3 空格缩进变成 0 空格, renderer 识别 description 为 list 外独立段落.
       2. 改成 `\n[ \t]+\n` 后又掉进新坑: 在 `\n   \n   \n   ` 这种"3 个 \n 各跟 3 空格"
          里, regex 是 non-overlapping, match 1 结束后从 match 1 结尾继续, 下一段开头
          是 sp 不是 \n, 第二个 match 永远 miss → "\n   \n   \n   " 只塌一半成
          "\n\n   \n   ", description 前多出"3sp+\n+3sp" 看着像 strong 没结束.
          改用 `(\n[ \t]+)+\n` → `\n\n` (1+ 次"\n+sp" 段, 一次性吞), 把整段塌成 2 \n. */
    function normalizeMd(md) {
        return md.replace(/(\n[ \t]+)+\n/g, '\n\n')
                 .replace(/\n{3,}/g, '\n\n')
                 .replace(/^\n+/, '')
                 .replace(/\n+$/, '')
                 .trim();
    }

    /* 围栏完整性兜底：确保 Markdown 中的代码围栏成对闭合（遵循 CommonMark 语义）。
       - 带信息串的围栏（如 ```text / ```plaintext）**只能是开场围栏**，绝不能作闭合；
       - 纯反引号围栏（如 ``` / ```` ，后无信息串）才能闭合当前开场围栏
         （且开场围栏反引号数 ≤ 闭合围栏反引号数时方才配对）。
       逐行扫描用栈配对，支持 ````` 包 ``` 的嵌套。遍历结束后若仍有未闭合的开场围栏，
       按各自反引号数补上纯反引号闭合围栏，从而彻底避免
       「某条消息漏闭合围栏 → 把后续所有轮次整段吞进代码块」这类灾难。 */
    function balanceFences(md) {
        const lines = md.split('\n');
        const stack = []; // 记录已开场围栏的反引号数
        for (const line of lines) {
            const bare = line.match(/^(`{3,})\s*$/);     // 纯反引号（可能是闭合）
            const withInfo = line.match(/^(`{3,})[^\s`]/); // 带信息串（必为开场）
            if (bare && !withInfo) {
                const len = bare[1].length;
                if (stack.length && stack[stack.length - 1] <= len) stack.pop();
                continue; // 无匹配开场则视为游离闭合，忽略
            }
            if (withInfo) {
                stack.push(withInfo[1].length); // 带信息串 → 必为开场
                continue;
            }
        }
        if (!stack.length) return md;
        const tail = stack.slice().reverse().map(l => '`'.repeat(l)).join('\n');
        return md.replace(/\s+$/, '') + '\n' + tail + '\n';
    }

    /* 兜底解包（保险网）：若整条消息本质上就是「被一层代码围栏包住的 Markdown 文章」
       （如 DeepSeek 无语言标识地整体包裹，或 blockToMd 仍输出了带外层围栏的结果），
       则剥掉外层围栏，输出干净的可渲染 Markdown。
       不再强求内部围栏完全平衡（DeepSeek 偶发围栏长度不一致），
       只要首行是围栏、内部整体像 Markdown 文章即解包；并容忍末尾空白行。 */
    function unwrapWrappingFence(md) {
        const t = md.replace(/^\n+/, '').replace(/\n+$/, '');
        const lines = t.split('\n');
        if (lines.length < 3) return md;
        if (!/^`{3,}/.test(lines[0])) return md;
        // 从尾部向前找最后一个围栏行（容忍末尾空白行，避免误判 last 为空串）
        let last = -1;
        for (let i = lines.length - 1; i >= 1; i--) {
            if (/^`{3,}\s*$/.test(lines[i])) { last = i; break; }
        }
        if (last === -1) return md;
        const body = lines.slice(1, last);
        const bodyStr = body.join('\n');
        const looksLikeMd =
            /(^|\n)#{1,6}\s/.test(bodyStr) ||
            /(^|\n)\|.*\|\n\s*\|[-:\s|]+\|/.test(bodyStr) ||
            /(^|\n)(-|\*|\+|\d+\.)\s/.test(bodyStr) ||
            /(^|\n)>\s/.test(bodyStr) ||
            /`{3,}/.test(bodyStr);
        if (!looksLikeMd) return md;
        return bodyStr.trim();
    }

    /* 解包「内嵌」的源码围栏：AI 常把整篇 Markdown 文章（或纯文本）用
       ```plaintext / ```text / ```markdown / ```md 整体包起来当作「源码」输出，
       而 DeepSeek 有时不把它渲染成代码块、而是把 ```plaintext 围栏本身当作可见文本泄漏进 DOM。
       若只靠 blockToMd 的 <pre> 分支或 unwrapWrappingFence（仅查首行），
       会漏掉「答案中部」的内嵌源码围栏，导致导出 md 里残留一堆 ```plaintext 代码块。
       这里在 Markdown 文本层面扫描并解包这些「源码围栏」：
       - 语言为 plaintext/text/markdown/md/txt → 必为「源码/纯文本」wrapper，直接解包为原始内容；
       - 语言为空且内容整体像 Markdown 文章 → 同样解包；
       - 其余语言（python/js/bash/...）→ 视为真正的代码块，保留围栏不动。
       与 <pre> 分支、unwrapWrappingFence 互补且幂等：若 <pre> 分支已解包则此处无围栏可解。 */
    function unwrapSourceFences(md) {
        let out = md, prev, guard = 0;
        do {
            prev = out;
            out = out.replace(/```([a-zA-Z0-9_+#.\-]*)\n([\s\S]*?)\n```(?=\n|$)/g, (m, lang, body) => {
                lang = (lang || '').toLowerCase();
                const looksMd = looksLikeMarkdownSource(body);
                if (MD_SOURCE_LANGS.includes(lang) || (lang === '' && looksMd)) {
                    return body.replace(/^\n+/, '').replace(/\n+$/, '') + '\n';
                }
                return m; // 真正的程序代码块（python/js/...）保留
            });
        } while (out !== prev && ++guard < 5);
        return out;
    }

    /* DeepSeek 引用角标清洗（仅作用于 Markdown 文本层面，站点无关、安全幂等）：
       DeepSeek 把带编号的文献引用渲染成可见角标（如 [-3]），导出时这些角标被原样抄入 md，
       表现为畸形引用链接 [-3](url) / -[-3](url)，并留下一堆没编号的短横残迹（-。 --。 -、）。
       由于保存的 HTML 是 JS 局部快照、常丢失动态引用 DOM，无法在 DOM 层精确识别，
       故在文本层做保守清洗：
       ① 引用链接规范化：[-3](url)、-[-3](url) → [3](url)（干净的编号引用，可正常跳转）；
       ② 残留短横：紧邻（中/英文）标点（。、：，；！？.,;:!?）前的连字符/短横/
          破折号（hyphen / en-dash / em-dash / minus sign）直接删除；
          正常中文不会在标点前写短横，且本脚本不引入破折号，故可安全移除；
          v1.15.4 扩字符类：原版只 `[-–]`，加 `—`（em-dash）/ `−`（minus sign）；
          标点从全角扩到「全角 + 半角」（AI 偶尔混用全半角）。
       ③ 外文术语与中文之间的残留分隔短横：Tanahashi-等 / 123-中 → Tanahashi等 / 123中。
          v1.15.4 扩字符类：原版只 `[A-Za-z]`，加 `0-9`（Figure-3 / 123-示意图 等也清洗）。
          中→英方向**故意不加**（保守：可能是用户正常用语如"第1章-Introduction"）。
       顺序：1 → 2 → 3（先洗短横+标点，避免 3 把"权威-。"切成"权威"+".",然后 2 不命中）。 */
    function cleanCitations(md) {
        // 1) 引用链接规范化
        md = md.replace(/-?\[-\s*(\d+)\s*\]\((https?:\/\/[^\s)]+)\)/g, '[$1]($2)');
        // 2) 短横/破折号 + (中英文)标点 → 去短横
        md = md.replace(/[-–—−]{1,3}(?=[。、：，；！？.,;:!?])/g, '');
        // 3) ASCII 字母/数字 + 短横 + 中文字符 → 去短横
        md = md.replace(/([A-Za-z0-9]+)-(?=[\u4e00-\u9fff])/g, '$1');
        return md;
    }

    /* 判断一个消息节点是否为「AI 回复」。DeepSeek 等带 .ds-markdown 标记；
       其余站点回退到站点专属 assistantSel 选择器匹配（容器自身或其内部含 AI 标记）。 */
    function isAssistantNode(node) {
        if (!node || !node.querySelector) return false;
        if (node.querySelector('.ds-markdown')) return true; // DeepSeek / 兼容
        if (SITE) {
            const frags = SITE.assistantSel.split(',').map(s => s.trim());
            for (const f of frags) {
                try {
                    // 豆包场景：getAssistantMessages 已经把 action bar 转成 message row，
                    // node.matches(assistantSel) 永远 false（row ≠ action bar）。
                    // 改成查 row 内部是否含 AI action bar。
                    if (SITE.getMessageNode) {
                        if (node.querySelector(f)) return true;
                    } else if (node.matches(f)) {
                        return true;
                    }
                } catch (e) {}
            }
        }
        return false;
    }

    /* 将单个消息节点转为 Markdown。对 AI 消息，把「思考过程」与「正式回复」分离：
       - 思考过程 = 节点内的 .ds-think-content（DeepSeek 稳定类名；其内才是真正的推理文本，
         外层仅含「已思考（用时 X 秒）」状态，不取）——套引用块并加「💭 思考过程」标题；
       - 正式回复 = 节点内的 .ds-assistant-message-main-content（DeepSeek 稳定类名；
         兜底取最后一个 .ds-markdown，避开思考块里的 .ds-markdown）。
       关键：DeepSeek 的「思考块」内部也带 .ds-markdown（ds-think-content），
       故不能用 node.querySelector('.ds-markdown') 取第一个（那会取到思考而非答案）。

       v1.15.8 新增 opts 参数：
         - opts.includeThinking (default true) : 是否把思考块前置到答案里。
           「导出全部对话」路径仍想要思考（做完整记录用），保持 true；
           「单条消息导出」4 个路径（FAB 一键导出 / 📥 导出最新回复 / 📋 复制最新回复 / Ctrl+Shift+S）
           按「知识库文章」语义应去思考，传 false。 */
    function messageToMd(node, opts) {
        if (!isAssistantNode(node)) {
            // 用户提问：直接抽文本（含 UI 外壳过滤），同样解包可能内嵌的源码围栏。
            // 顺序：先 balanceFences 补全闭合，再 unwrapSourceFences 解包（理由同 AI 分支）。
            let umd = normalizeMd(unwrapWrappingFence(blockToMd(node)));
            umd = balanceFences(umd);
            return cleanCitations(unwrapSourceFences(umd));   // 清洗可能的引用角标残迹（DeepSeek 编号引用）
        }
        // AI 回复：思考 vs 正式回复分离
        const thinkEl = node.querySelector('.ds-think-content');   // 思考推理（稳定类名）
        const ansEl = node.querySelector('.ds-assistant-message-main-content')   // 正式回复（稳定类名）
                   || [...node.querySelectorAll('.ds-markdown')].pop();          // 兜底：最后一个 .ds-markdown
        let answer;
        if (ansEl) {
            answer = normalizeMd(unwrapWrappingFence(blockToMd(ansEl)));
        } else {
            // 非 DeepSeek / 无稳定类名：克隆节点，移除思考块与 UI 外壳，剩余即回复
            const clone = node.cloneNode(true);
            if (thinkEl) thinkEl.remove();
            clone.querySelectorAll('*').forEach(e => { if (isUiChrome(e)) e.remove(); });
            answer = normalizeMd(unwrapWrappingFence(blockToMd(clone)));
        }
        // 解包答案内可能内嵌的「整篇 Markdown 源码」围栏（plaintext/text/markdown/md），
        // 避免导出 md 残留 ```plaintext 代码块（DeepSeek 把围栏当可见文本泄漏的情形）。
        answer = unwrapSourceFences(answer);
        // v1.15.8：opts.includeThinking 默认 true（向后兼容）；单条消息导出路径传 false
        // 表示「这是 KB 文章不是对话记录、不要思考」。判断写 !== false 而不是直接判 truthy，
        // 这样 opts 为 undefined / {} 时也走 true（保持旧行为）。
        const includeThinking = !opts || opts.includeThinking !== false;
        let thinking = '';
        if (includeThinking && thinkEl) {
            const thinkInner = thinkEl.querySelector('.ds-markdown') || thinkEl; // 取思考块内的推理正文
            let thinkRaw = normalizeMd(blockToMd(thinkInner));
            thinkRaw = unwrapSourceFences(thinkRaw); // 思考里若引用了源码围栏同样解包
            if (thinkRaw) {
                const bq = thinkRaw.split('\n').map(l => '> ' + l).join('\n');
                thinking = '> **💭 思考过程**\n' + bq;
            }
        }
        let md = (thinking ? thinking + '\n\n' : '') + answer;
        md = balanceFences(normalizeMd(md));   // 先补全可能缺失的闭合围栏（DOM 提取时结尾 ``` 偶会丢失）
        md = unwrapSourceFences(md);            // 再解包「整篇 Markdown/纯文本源码」围栏（plaintext/text/markdown/md/txt），顺序必须在 balanceFences 之后
        return cleanCitations(md);              // 最后清洗引用角标残迹（DeepSeek 编号引用 [-3](url) / 短横残留）
    }

    function getLatestReply(opts) {
        const msgs = getAssistantMessages();
        if (!msgs.length) return null;
        // 最后一个即最新回复；思考过程与正式回复分离 + 解包 Markdown 代码块 + 规整空行
        // v1.15.8：opts 透传给 messageToMd（控制 includeThinking 等选项）
        return messageToMd(msgs[msgs.length - 1], opts);
    }

    /* 判断元素是否「原生可滚动」（用计算样式 overflowY，比 scrollHeight 探测更稳，
       因为 transform 驱动的虚拟列表 track 不会撑大 scrollHeight）。 */
    function isScrollable(el) {
        if (!el || el === window || !el.nodeType || el.nodeType !== 1) return false;
        const cs = getComputedStyle(el);
        const oy = (cs.overflowY || '').trim();
        if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') return false;
        return el.scrollHeight > el.clientHeight + 1;
    }

    /* 定位聊天列表的「滚动容器」候选列表。
       虚拟列表可能滚动在内部容器（如 .ds-virtual-list / 其内部的 ds-scroll-area 原生视口），
       也可能滚动在整页 window。探测要点：
       - 向上找计算样式 overflowY 为 auto/scroll 的可滚动祖先；
       - 显式纳入 .ds-virtual-list*（DeepSeek 稳定类名，自身常是 ds-scroll-area 原生滚动容器）；
       - 深入 .ds-virtual-list 内部子孙，捕获可能藏在其中的原生滚动视口（如 ds-scroll-area 的 viewport）；
       - 整页 window 兜底。
       collectFullConversation 会对每个候选都做 Top→Bottom 扫描，grab 按 key 全局去重，
       确保只要任一候选是真正的滚动源，就能收集到从第一条到最后一条的完整对话。 */
    function findScrollContainers() {
        const probe = document.querySelector('.ds-message');
        if (!probe || getVlistKey(probe) == null) return null; // 非虚拟列表
        const list = [];
        const push = (el) => { if (el && el !== window && !list.includes(el)) list.push(el); };
        // 1) 向上找所有「可滚动」祖先（计算样式）
        let el = probe.parentElement;
        while (el && el !== document.body) {
            if (isScrollable(el)) push(el);
            el = el.parentElement;
        }
        // 2) DeepSeek 虚拟列表容器（类名稳定），并深入其内部找原生滚动视口
        document.querySelectorAll('.ds-virtual-list, .ds-virtual-list-items, .ds-virtual-list-visible-items').forEach(root => {
            push(root);
            try { root.querySelectorAll('*').forEach(c => { if (c !== root && isScrollable(c)) push(c); }); } catch (e) {}
        });
        // 3) 整页滚动兜底
        if (isScrollable(document.scrollingElement || document.documentElement)) push(window);
        return list.length ? list : null;
    }

    /* 强制把某容器滚到指定位置：原生 scrollTop + scrollTo API + 手动派发 scroll 事件
       （部分虚拟列表仅在 scroll 事件回调里重算窗口，程序化设置 scrollTop 需补发事件兜底）。 */
    function forceScrollTo(target, val) {
        if (target === window) { try { window.scrollTo(0, val); } catch (e) {} return; }
        try { target.scrollTop = val; } catch (e) {}
        if (target.scrollTo) { try { target.scrollTo({ top: val, behavior: 'auto' }); } catch (e) {} }
        try { target.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (e) {}
    }
    function getScrollTop(target) {
        if (target === window) return window.scrollY || window.pageYOffset || 0;
        return target.scrollTop;
    }
    function getScrollHeight(target) {
        if (target === window) return (document.scrollingElement || document.body).scrollHeight;
        return target.scrollHeight;
    }
    function getClientHeight(target) {
        if (target === window) return window.innerHeight;
        return target.clientHeight;
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    /* 把单个消息容器转成 {md, isAI}；思考/回复分离由 messageToMd 统一处理 */
    function messageToItem(node) {
        return { md: messageToMd(node), isAI: isAssistantNode(node) };
    }

    /* 虚拟列表的 data-virtual-list-item-key 不在 .ds-message 自身，
       而在其外层包裹 div 上（如 <div data-virtual-list-item-key="17"><div class="ds-message">…）；
       故用 closest 向上找带该属性的祖先来取 key。 */
    function getVlistKey(node) {
        const w = node.closest && node.closest('[data-virtual-list-item-key]');
        return w ? w.getAttribute('data-virtual-list-item-key') : null;
    }

    /* 聊天内容根容器（用于安全地点击「加载更早」类按钮，避免误点左侧栏历史会话） */
    function chatRoot() {
        return document.querySelector('.ds-virtual-list') || document.querySelector('.ds-message');
    }

    /* 安全点击「加载更早/历史」按钮：仅在聊天根容器内、且为 button/role=button/a、
       文本为纯粹的加载短语时才点击（左侧栏历史会话标题不会被误命中，不会导航离开）。 */
    function clickLoadEarlier() {
        const root = chatRoot();
        if (!root) return false;
        const els = root.querySelectorAll('button, [role="button"], a');
        for (const el of els) {
            const t = (el.textContent || '').replace(/\s+/g, '').trim().toLowerCase();
            if (/^(查看更早|加载更早|更早消息|历史消息|加载历史|查看更多|往上|向上|上一页|loadearlier|loadprevious)$/.test(t)) {
                try { el.click(); return true; } catch (e) { /* ignore */ }
            }
        }
        return false;
    }

    /* 滚动遍历虚拟列表，收集「从第一条到最后一条」的完整对话。
       关键：虚拟列表会回收 DOM 节点（同一元素被复用、data-virtual-list-item-key 会变化），
       故在每一屏渲染的当下立即抽取内容并按 key 去重，而非保留节点引用（否则会被回收覆盖）。
       每个收集到的条目都【绑定自己的 key】，最终按 key 升序排序——
       用 key 排序（而非内容）可避免「重复的用户提问文本」导致的排序碰撞（归属交错）。

       健壮性要点（针对「导出仍从中间开始 / 开头用户提问丢失」）：
       - 反复滚到【顶部】并等待，直到「出现过的最小 key 不再变小」为止——
         同时兼容两种虚拟列表：① 纯窗口化（一次滚到顶即渲染 0..N）；
         ② 按需懒加载历史（每次滚到顶才异步追加更早的消息，需多轮滚动+等待）。
       - 同理反复滚到【底部】确保抓到最新回复。
       - 每轮抓取后尝试点击聊天区内的「加载更早」按钮，触发懒加载。
       - 最后自顶向下扫一遍做兜底。 */
    async function collectFullConversation(onProgress) {
        const first = document.querySelector('.ds-message');
        // 关键修复：data-virtual-list-item-key 在 .ds-message 的【外层包裹 div】上，
        // 不在 .ds-message 自身——用 getVlistKey()（closest 向上找带属性的祖先）来判定与取 key。
        if (!first || getVlistKey(first) == null) return null; // 非虚拟列表
        const containers = findScrollContainers();
        if (!containers || !containers.length) return null;

        const items = [];        // { key, md, isAI }，按首次出现顺序
        const seen = new Set();  // 已收集过的 key
        const keyNums = () => [...seen].map(k => parseInt(k, 10)).filter(n => !isNaN(n));
        // v1.15.2: onProgress({pass, keys, minKey, maxKey}) 三个 pass 阶段都给回调
        const report = (pass) => { if (onProgress) onProgress({ pass, keys: items.length, minKey: minKey(), maxKey: maxKey() }); };
        function grab(pass) {
            document.querySelectorAll('.ds-message').forEach(n => {
                const key = getVlistKey(n);
                if (!key || seen.has(key)) return;
                seen.add(key);
                items.push(Object.assign({ key }, messageToItem(n)));
            });
            clickLoadEarlier(); // 聊天区内尝试触发懒加载历史
            report(pass);
        }
        const scrollAllTop = () => containers.forEach(c => forceScrollTo(c, 0));
        const scrollAllBottom = () => containers.forEach(c => { try { forceScrollTo(c, getScrollHeight(c)); } catch (e) {} });

        const minKey = () => { const a = keyNums(); return a.length ? Math.min(...a) : Infinity; };
        const maxKey = () => { const a = keyNums(); return a.length ? Math.max(...a) : -Infinity; };

        try {
            // ① 滚到顶部并收集；反复重试，直到「出现过的【最小 key】不再变小」为止。
            //    关键修复：原逻辑在「最小 key 没变小」时立即 break —— 但首次滚动若因
            //    重渲染耗时/滚动未命中真实容器而没立刻露出 key 1，会误判「已到顶」而提前退出，
            //    导致开头（含用户首个提问）丢失。现改为：仅在「已到 key 1」或「连续多次无更小 key」时才停。
            grab(1);  // v1.15.2: pass=1 = 顶部
            let lastMin = minKey(), noProgress = 0;
            for (let g = 0; g < 30; g++) {
                scrollAllTop();
                await sleep(400);
                grab(1);  // v1.15.2: pass=1 = 顶部
                const cur = minKey();
                if (cur <= 1) break;                 // 已抵达第一条（key 从 1 开始）
                if (cur >= lastMin) { if (++noProgress >= 4) break; } // 连续多次无更早消息才放弃
                else { noProgress = 0; lastMin = cur; }
            }
            // ② 滚到底部确保抓到最新回复（同理：连续多次无更大 key 才停）
            let lastMax = maxKey(), noProgress2 = 0;
            for (let g2 = 0; g2 < 30; g2++) {
                scrollAllBottom();
                await sleep(400);
                grab(2);  // v1.15.2: pass=2 = 底部
                const cur = maxKey();
                if (cur <= lastMax) { if (++noProgress2 >= 4) break; } else { noProgress2 = 0; lastMax = cur; }
            }
            // ③ 兜底：自顶向下逐屏扫一遍（覆盖非严格虚拟列表的站点）
            for (const container of containers) {
                const total = getScrollHeight(container);
                const step = Math.max(220, getClientHeight(container) * 0.7);
                for (let pos = 0; pos < total; pos += step) {
                    forceScrollTo(container, pos);
                    await sleep(140);
                    grab(3);  // v1.15.2: pass=3 = 兜底扫描
                }
                forceScrollTo(container, total);
                await sleep(200);
                grab(3);  // v1.15.2: pass=3 = 兜底扫描
            }
        } catch (e) { /* 忽略单个容器异常，继续 */ }

        if (!items.length) return null;

        // 排序：全为数值 key 时按 key 升序（唯一、无碰撞）；否则保持抓取顺序（≈时间正序）
        const numericKeys = items.every(it => /^\d+$/.test(it.key));
        if (numericKeys) items.sort((a, b) => parseInt(a.key, 10) - parseInt(b.key, 10));
        return items;
    }

    /* 导出全部对话：把「用户提问」与「AI 回复」按时间顺序交错拼接（采用轮次编号，Q/A 成对呈现）。
       为拿到「从第一条到最后一条」的完整对话，先尝试滚动遍历虚拟列表收集全部消息；
       失败（非虚拟列表 / 无滚动容器）则回退到直接 DOM 查询。 */
    async function getAllReplies(onProgress) {
        if (!SITE) return null;

        let items = null;
        try { items = await collectFullConversation(onProgress); } catch (e) { items = null; }

        if (!items || !items.length) {
            // 回退：直接 DOM 查询（非虚拟列表站点，或未识别到滚动容器）
            const aiNodes = getAssistantMessages();
            const userNodes = getUserMessages();
            const all = [...aiNodes, ...userNodes].sort((a, b) => {
                const rel = a.compareDocumentPosition(b);
                return (rel & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
            });
            items = all.map(node => ({
                md: messageToMd(node),
                isAI: userNodes.indexOf(node) === -1,
            }));
        }

        if (!items.length) return null;

        // 诚实提示：若收集到的【最小数值 key > 1】，说明没滚到对话最开头（可能缺失最早的用户提问）。
        // （对话 key 从 1 开始；若此处 > 1，通常是滚动容器未命中，需用户反馈以进一步定位。）
        const nums = items.filter(it => /^\d+$/.test(it.key)).map(it => parseInt(it.key, 10));
        if (nums.length && Math.min(...nums) > 1) {
            toast(t('toast.cantReachTop'), 'error');
        }

        let round = 0;
        const parts = [];
        // 轮次用 h1（而非 h2）：对「导出全部对话」这种长文件，每轮对话是本文件的最高层级；
        // 且 AI 回复内若自带 # 标题，h1 轮次可避免「h1 嵌在 h2 内」的非法嵌套。
        // 对话标题由 YAML frontmatter 的 title: 承载，不另起 body 级 h1。
        for (const it of items) {
            if (!it.isAI) {
                round++;
                parts.push(`# 👤 第 ${round} 轮 · 我的提问\n\n${it.md}`);
            } else {
                const tag = round > 0 ? `第 ${round} 轮 · ` : '';
                parts.push(`# 🤖 ${tag}AI 回复\n\n${it.md}`);
            }
        }
        return parts.join('\n\n');
    }

    function getChatTitle() {
        if (!SITE) return null;
        // 优先用页面 <title>：DeepSeek 为「对话标题 - DeepSeek」，剥离厂牌后缀即得聊天标题。
        // （旧 titleSel 指向的站内标题元素多为文章内容 h1 或不存在，故改以 document.title 为准。）
        const t = (document.title || '').trim();
        if (t) {
            let title = t.replace(new RegExp('\\s*[-\\u2013\\u2014]\\s*' + (SITE.name || '') + '\\s*$', 'i'), '').trim();
            if (!title) title = t;
            return title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
        }
        // 回退：站点专属选择器（站内可见标题元素）
        const frags = SITE.titleSel.split(',').map(s => s.trim());
        for (const f of frags) {
            const el = document.querySelector(f);
            if (el && el.innerText.trim() && el.innerText.trim() !== '新对话') {
                return el.innerText.trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
            }
        }
        return null;
    }

    /* ============================================================
     * 文件名规范：[软件名称]_[AI厂牌]_[时间戳]_[标题].md
     *   - 软件名称：本工具名，作为可切换中英文的变量（见下方 SOFTWARE_NAME）
     *   - AI厂牌  ：当前站点品牌，即 SITE.name（如 DeepSeek / ChatGPT）
     *   - 时间戳  ：沿用现有格式 YYYY-MM-DD_HHMM
     *   - 标题    ：优先级 → 截取内容中的 h1 → 网页页面标题 → 留空
     *               （「导出全部对话」例外：直接取网页页面标题、不做 h1 回退）
     * ============================================================ */

    /* 从抓取内容中提取第一个一级标题（h1，即单独一个 # 的标题行）作为标题候选 */
    function extractH1(md) {
        const lines = (md || '').split('\n');
        for (const line of lines) {
            const m = line.match(/^#\s+(.+?)\s*$/);
            if (m) return m[1].trim();
        }
        return '';
    }

    /* 标题清洗：去除文件名非法字符、折叠空白、限制长度 */
    function sanitizeTitle(t) {
        return (t || '')
            .replace(/[\\/:*?"<>|\n\r\t#]/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 60);
    }

    /* 标题解析（用于「导出/复制最新回复」「一键导出」等单条/切片导出）：
       优先级 内容 h1 → 网页页面标题 → 留空。
       与最初设计一致：单条回复优先用其自身的一级标题 h1；无 h1 时再退而取页面标题。
       「导出全部对话」不走此函数，而是直接取页面标题（见 exportAll）。 */
    function resolveTitle(md) {
        const fromH1 = sanitizeTitle(extractH1(md)); // 优先：内容首个 h1
        if (fromH1) return fromH1;
        const pageTitle = getChatTitle(); // 回退：页面 <title>（已清洗/截断/剥离厂牌后缀）
        return pageTitle || '';
    }

    /* 组装文件名：[软件名称]_[AI厂牌]_[时间戳]_[标题].md（标题为空则省略末尾段）。
       titleOverride 由「导出全部对话」传入页面标题（直接取、不做 h1 回退）；
       其余导出不传，则按 resolveTitle（内容 h1 → 页面标题 → 空）解析。 */
    function buildFileName(md, titleOverride) {
        const brand = SITE ? SITE.name : '通用';
        const now = new Date();
        const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        const parts = [SOFTWARE_NAME, brand, ts];
        const title = (titleOverride !== undefined) ? titleOverride : resolveTitle(md);
        if (title) parts.push(title);
        return parts.join('_') + '.md';
    }

    /* ============================================================
     * 导出动作
     * ============================================================ */
    /* ============================================================
     * YAML frontmatter（Properties）规范
     * 参考 Obsidian Properties / Web Clipper 文章模板：
     *   - 文件顶部单个 YAML frontmatter（--- 包裹），闭合后空一行；避免重复键；
     *   - 键名小写；tags 必须是「列表」格式（块式 - 项 或 行内 [a,b]），
     *     含 / 可作层级标签（ai/对话），标签纯文本、不带 #；
     *   - 日期用 YYYY-MM-DD；推荐用 created 而非 date；
     *   - URL/含 : # 等特字符的值必须加引号；空串/形似数字布尔也加引号。
     * ============================================================ */

    /* YAML 标量加引号：含 : # " ' 或首尾空白、空串、或形似 数字/布尔 时加双引号 */
    function yamlQuote(v) {
        const s = String(v);
        if (/[:#"']/.test(s) || /^\s|\s$/.test(s) || s === '' ||
            /^(true|false|null|~)$/i.test(s) || /^-?\d+(\.\d+)?$/.test(s)) {
            return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
        }
        return s;
    }

    /* 从抓取内容提取一段纯文本摘要，用于 YAML frontmatter 的 description。
       策略：跳过 H1 行（标题已由 frontmatter title 承载，不重复），取之后
       的前 N 字符（默认 100）。
       清洗规则：保留列表 bullet / 数字（结构信息），strip 其他行内/行首
       装饰（标题标记 / 引用 / 表格行 / 围栏内代码 / bold / italic /
       inline code / link / image），只留纯文本。
       不特意区分 H2/H3——用户视角下"开头那段"就是描述，不预先找 H2
       当 prefix；万一没 H2 也不影响。
       italic 跟 bullet `*` 的区分：bullet 行首 `*` 后面必跟空格，italic
       `*` 后面跟非空格非 `*` 字符——所以在 per-line 阶段处理 italic 时
       用 `\*([^*\s][^*\n]*?)\*` 卡住，bullet 不会被误杀。 */
    function extractDescription(md, maxLen) {
        maxLen = maxLen || 100;
        const lines = (md || '').split('\n');
        let started = false;   // 跳到 H1 之后才收集
        let inFence = false;   // 围栏内代码跳过
        const buf = [];
        for (const raw of lines) {
            if (!started) {
                if (/^#\s/.test(raw)) started = true;
                continue;
            }
            if (inFence) {
                if (/^```/.test(raw)) inFence = false;
                continue;
            }
            if (/^```/.test(raw)) { inFence = true; continue; }
            if (!raw.trim()) {
                if (buf.length) buf.push(' ');  // 空行 → 段落分隔
                continue;
            }
            // 行首装饰：strip 标题/引用/表格行；保留列表 bullet/number
            let cleaned = raw
                .replace(/^#{1,6}\s+/, '')     // 标题标记（H2/H3/...）
                .replace(/^>\s?/, '')          // 引用
                .replace(/^\|.*\|$/, '')       // 表格行
                .trim();
            if (!cleaned) continue;
            // per-line 阶段 strip 行内装饰：bold / image / link / italic /
            // inline code。**顺序很关键**——image 必须在 link 之前跑，
            // 否则 link regex 会把 `![alt](url)` 里的 `[alt](url)` 当成
            // 普通 link 吃掉，留下 `!alt` 没法被后续 image regex 识别。
            // italic 跟 bullet 的 `*` 通过 [^*\s] 区分：bullet 后必接
            // 空格（不在 [^*\s] 范围），italic 后必接非空非 `*` 字符
            // （在 [^*\s] 范围），bullet 不会被误杀。
            cleaned = cleaned
                .replace(/\*\*([^*]+)\*\*/g, '$1')             // bold
                .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')       // image（先于 link）
                .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')        // link
                .replace(/\*([^*\s][^*\n]*?)\*/g, '$1')        // italic
                .replace(/`([^`]+)`/g, '$1')                    // inline code
                .trim();
            if (!cleaned) continue;
            buf.push(cleaned);
        }
        const text = buf.join(' ').replace(/\s+/g, ' ').trim();
        if (!text) return '';
        return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
    }

    /* 构建统一、兼容的 YAML frontmatter（所有导出共用）。
       字段对齐 Obsidian / Web Clipper 文章模板：title/source/author/created/tags/description；
       published 在 AI 对话场景无真实发布时间，故不写（如需可改为 capture 时间）。
       该 frontmatter 被 Jekyll/Hugo/Obsidian/VuePress 等广泛识别，保证信息完整且跨编辑器兼容。 */
    function buildYamlFrontmatter(title, content, brand) {
        const now = new Date();
        const date = now.toISOString().slice(0, 10);
        const t = title || 'AI 对话知识库';
        const lines = ['---'];
        lines.push(`title: ${yamlQuote(t)}`);
        lines.push(`source: ${yamlQuote(location.href)}`);
        lines.push(`author: ${yamlQuote(brand || '未知')}`);
        lines.push(`created: ${date}`);
        const desc = extractDescription(content);
        if (desc) lines.push(`description: ${yamlQuote(desc)}`);
        // 标签：仅软件名称（如 ChatDigest）；厂牌已由 author 承载，无需重复
        lines.push('tags:');
        lines.push(`  - ${SOFTWARE_NAME}`);
        lines.push('---');
        return lines.join('\n') + '\n\n';
    }

    /* 构建文件头：统一 YAML frontmatter（保证信息完整、跨编辑器兼容）+ 标准 # 标题。
       title/source/author/created/description/tags 对齐 Obsidian Properties 规范，
       同时被 Jekyll/Hugo/VuePress 等广泛识别。
       title 来自 resolveTitle（内容 h1 → 页面标题 → 空）或由「导出全部对话」直接传入的页面标题，与文件名一致；
       若正文已含 h1 则不再补 # 标题，避免文件内出现两个一级标题。 */
    function buildHeader(title, content) {
        const fm = buildYamlFrontmatter(title, content, SITE ? SITE.name : '');
        // 正文已含 h1 时不再补文件级标题，避免文件内出现两个一级标题
        const hasH1 = /(^|\n)#\s+/.test(content || '');
        if (hasH1) return fm;
        return fm + `# ${title || 'AI 对话知识库'}\n\n`;
    }

    function downloadMarkdown(content, titleOverride) {
        if (!content || content.length < 10) {
            toast(t('toast.noContentDownload'), 'error');
            return false;
        }
        const title = (titleOverride !== undefined) ? titleOverride : resolveTitle(content);
        const full = buildHeader(title, content) + content;
        const fileName = buildFileName(content, titleOverride);
        const blob = new Blob([full], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast(t('toast.downloaded', { fileName }), 'ok');
        return true;
    }

    function copyMarkdown(content) {
        if (!content || content.length < 10) {
            toast(t('toast.noContentCopy'), 'error');
            return;
        }
        const title = resolveTitle(content);
        const full = buildHeader(title, content) + content;
        GM_setClipboard(full, 'text');
        toast(t('toast.copied'), 'ok');
    }

    /* 「导出全部对话」异步入口：虚拟列表需滚动收集，故 getAllReplies 为 async。
       收集期间给出进度提示（v1.15.2：每 1.5s 最多更新一次 toast，避免刷屏），
       结束后再触发下载；无内容时提示。 */
    function exportAll() {
        const startTime = Date.now();
        let lastToastUpdate = 0;
        const onProgress = ({ pass, keys, minKey, maxKey }) => {
            const now = Date.now();
            if (now - lastToastUpdate < 1500) return;  // 节流：1.5s 最多更新 1 次
            const elapsed = Math.floor((now - startTime) / 1000);
            const passName = pass === 1 ? '顶部' : pass === 2 ? '底部' : '兜底扫描';
            const minK = Number.isFinite(minKey) ? minKey : '?';
            const maxK = Number.isFinite(maxKey) ? maxKey : '?';
            toast(t('toast.scrolling2', { passName, keys, minK, maxK, elapsed }), 'ok');
            lastToastUpdate = now;
        };
        toast(t('toast.scrolling1'), 'ok');
        Promise.resolve(getAllReplies(onProgress)).then(md => {
            if (md) downloadMarkdown(md, getChatTitle() || ''); // 「导出全部对话」标题直接取页面标题，不做 h1 回退
            else toast(t('toast.noExportable'), 'error');
        }).catch(err => {
            console.error(t('console.exportAllFailed'), err);
            toast(t('toast.exportAllFailed', { err: err && err.message ? err.message : err }), 'error');
        });
    }

    /* ============================================================
     * 「总结咒语」注入器：把模板 prompt 写进输入框
     * ============================================================
     * v1.15.13 重要修正：SUMMARY_PROMPT 必须在 t() 和 MSGS 定义之后求值，
     * 否则脚本加载时 throw ReferenceError,整个 userscript 挂掉（v1.15.11/v1.15.12 bug）。
     * 实际定义位置见下面"const SUMMARY_PROMPT = t('summaryPrompt');"。
     * 故这里只留注释占位,真正定义见文件后方。 */

    /* 通用输入框定位：优先站点专属选择器，再回退到一组常见候选。
       关键修复：每个选择器都遍历其全部匹配节点（而非只取第一个），
       并跳过不可见 / 禁用的节点，避免「首个 textarea 隐藏 → 直接返回 null」的坑。
       DeepSeek 实际输入框为 <textarea name="search" placeholder="给 DeepSeek 发送消息">，
       故把 name/placeholder 锚点提到最高优先级。 */
    function findInput() {
        const candidates = [];
        if (SITE && SITE.inputSel) candidates.push(...SITE.inputSel.split(',').map(s => s.trim()));
        candidates.push(
            'textarea[name="search"]',
            'textarea[placeholder^="给 DeepSeek"]',
            'textarea',
            'input[type="text"]',
            'div[contenteditable="true"]',
            'div[contenteditable="plaintext-only"]',
            '[contenteditable="true"]',
            '[contenteditable="plaintext-only"]',
            '[role="textbox"]',
            '.ds-textarea',
            '#chat-input',
            '[data-testid="chat-input"]'
        );
        const seen = new Set();
        for (const sel of candidates) {
            let nodes;
            try { nodes = Array.from(document.querySelectorAll(sel)); }
            catch (e) { continue; } // 忽略非法选择器
            for (const el of nodes) {
                if (seen.has(el)) continue;
                seen.add(el);
                // 必须可见且未禁用；注意 fixed 定位元素的 offsetParent 可能为 null，
                // 这里额外用 getClientRects 兜底判断可见性。
                const visible = el.offsetParent !== null ||
                    (el.getClientRects && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none');
                if (visible && !el.disabled) return el;
            }
        }
        return null;
    }

    /* 兼容 textarea / input / contenteditable 的赋值。
       对 contenteditable 用 execCommand('insertText')，可触发 React 受控组件的 input 事件。 */
    function setInputValue(input, text) {
        if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
            const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
            setter.call(input, text);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            // v1.19.2+: contenteditable (Quill / Lexical / Slate) 走派发 paste 事件,
            // 不再走 execCommand('insertText'). 老逻辑问题:
            //   1. input.innerHTML = '' 清了 DOM, 但 Quill internal Delta state 没清,
            //      后续 Quill 监听到 DOM 变化会"覆盖回去"→ selection / 内容错乱
            //   2. execCommand('insertText', false, text) 是 deprecated, 而且把
            //      multi-line text 当 plain text 插入, \n 被吃 → 元宝 4 行 SUMMARY_PROMPT
            //      只剩第 1 行
            // 新逻辑: selectAll 让 paste handler 替换全部内容, 派发 paste 事件让
            // Quill 自己的 paste handler 处理 (它会把 \n 自动拆 <p>).
            // 1. 焦点
            input.focus();
            // 2. 全选现有内容 (让 paste handler 知道是替换, 不是 append)
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(input);
            sel.removeAllRanges();
            sel.addRange(range);
            // 3. 构造 paste 事件, clipboardData 带 multi-line text
            const dt = new DataTransfer();
            dt.setData('text/plain', text);
            let evt;
            try {
                evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
            } catch (e) {
                evt = new Event('paste', { bubbles: true, cancelable: true });
            }
            // 部分浏览器 (Firefox / Safari) SyntheticEvent.clipboardData 是 null,
            // 用 defineProperty 强制注入
            if (!evt.clipboardData) {
                Object.defineProperty(evt, 'clipboardData', { value: dt, configurable: true });
            }
            // v1.21.0 改: paste event 同时派发到 input 跟 closest('rich-textarea') 祖先
            // (Gemini 用 rich-textarea custom element 包装 ql-editor, paste 事件可能
            // 被 rich-textarea 拦截). 派发两份, 一份给 child 一份给 ancestor wrapper.
            input.dispatchEvent(evt);
            const richTa = input.closest && input.closest('rich-textarea');
            if (richTa && richTa !== input) {
                richTa.dispatchEvent(evt);
            }
            // v1.21.0 兜底: paste event 不响应 (Quill 2.x 改 API / 某些 framework 拦截),
            // 200ms 后如果 input.textContent 仍不包含 text 头 30 字符, 走老
            // execCommand('insertText') 方法. 兜底**只**在 paste 真不响应时跑, 不影响
            // paste 响应正常的站 (DeepSeek / Kimi / 豆包 / 元宝 / 千问). Gemini
            // 站 rich-textarea 包装 + Quill 2.x 可能不响应 synthetic paste event, 需要兜底.
            setTimeout(() => {
                if (!input.textContent.includes(text.slice(0, 30))) {
                    try {
                        input.focus();
                        const sel2 = window.getSelection();
                        const range2 = document.createRange();
                        range2.selectNodeContents(input);
                        sel2.removeAllRanges();
                        sel2.addRange(range2);
                        document.execCommand('insertText', false, text);
                    } catch (_) { /* ignore */ }
                }
            }, 200);
        }
    }

    /* 自动保存模式：注入咒语后自动发送，并等待最新回复生成完毕再抓取保存。
       AUTO_PUSH_IMA    : 自动保存后，是否顺带把内容推给本地 ima_watcher.py 导入 IMA
                          （需 ima_watcher.py 以 --serve 模式运行在 IMA_ENDPOINT）。
                          浏览器沙盒无法直接跑 python，故走「本地 HTTP 桥」实现。
       开关持久化        : 状态存于 Tampermonkey 存储区（GM_setValue / GM_getValue）。
                          脚本启动时若读不到存储值（首次使用），默认开启(true)并写入；
                          若已存有显式设置（含手动关闭的 false），则尊重该设置。
                          可在 Tampermonkey 箭头菜单（脚本命令）里随时切换 开/关。 */
    /* v1.15.10 locale-aware：根据浏览器/系统语言自动二选一。
       - navigator.language / navigator.languages 任一以 'zh' 开头（zh / zh-CN / zh-TW / zh-HK 等）→ '聊摘'
       - 其他语言（en / ja / ko / ...）→ 'ChatDigest'
       导出文件名同步跟随：CN 系统 → `聊摘_DeepSeek_2026-07-19_xxx.md`，其他 → `ChatDigest_DeepSeek_*.md`。
       YAML frontmatter tags 字段也用同一个值（保持文件名内 + 文件内一致）。
       旧 Chat2Knowledge_*.md 文件（v1.15.9 之前）仍可被 ima_upload.derive_title 正确解析——
       因为该函数用时间戳（YYYY-MM-DD_HHMM）做锚点取其后内容，不依赖前缀字符串。
       浏览器/系统切语言后下次启动自动跟随；如需手动锁定名，留给未来 override 机制。 */
    function isChineseLocale() {
        const langs = [navigator.language, ...(navigator.languages || [])]
            .filter(Boolean).map(s => s.toLowerCase());
        return langs.some(s => s.startsWith('zh'));
    }
    const SOFTWARE_NAME = isChineseLocale() ? '聊摘' : 'ChatDigest';

    /* v1.15.11 i18n catalog：所有 user-visible 文案（UI panel / toast / console / alert / SUMMARY_PROMPT）
       按 zh / en 两个字典维护。设计原则（参考通用 i18n 架构）：
       - source language (zh) 也走字典（不 hardcode、保证翻译者拿到 zh 字典就能翻 en 字典）
       - 一致性 > 亲切感（先内部一致再考虑调性，translator 无需读源码）
       - {name} 占位符做参数替换，translator 看到的是「可读的字符串」而非 JS 模板
       - 找不到 key 时回退到 key 字符串本身（开发期显眼、不静默吃掉）
       - 找不到 locale 时回退到 zh（保证总能找到字符串） */
    const MSGS = {
        zh: {
            'ui.titleFallback': '通用模式',
            'ui.btnAll':        '📚 导出全部对话',
            'ui.btnLatest':     '📥 导出最新回复',
            'ui.btnCopy':       '📋 复制最新回复',
            'console.started':  '✅ ChatDigest 已启动',
            'console.exportAllFailed': '[ChatDigest] 导出全部对话失败:',
            'console.inputNotFound':    '[ChatDigest] 未找到可见输入框',
            'console.initFailed':       '[ChatDigest] 初始化失败:',
            'alert.initFailed':         'ChatDigest 初始化失败:',
            'alert.initFailed.detail':  '详见浏览器控制台(F12)。',
            'toast.cantReachTop':       '⚠️ 未能滚动到对话最开头，导出可能缺失最早的消息',
            'toast.noContentDownload':  '⚠️ 没抓到有效内容，请确认 AI 已完整回复',
            'toast.downloaded':         '✅ 已下载：{fileName}',
            'toast.noContentCopy':      '⚠️ 没抓到有效内容',
            'toast.copied':             '📋 已复制',
            'toast.scrolling1':         '⏳ 正在滚动收集完整对话…',
            'toast.scrolling2':         '⏳ 正在滚动收集…({passName}阶段,已收集 {keys} 条,key {minK}~{maxK},{elapsed}s)',
            'toast.noExportable':       '⚠️ 没有可导出的对话',
            'toast.exportAllFailed':    '⚠️ 导出全部对话失败：{err}',
            'toast.pushOn':             '☁️ 自动推送 IMA：已开启',
            'toast.pushOnBase':         '☁️ 自动推送 IMA：',
            'toast.pushOff':            '☁️ 自动推送 IMA：已关闭',
            'toast.gmNotSupported':     '⚠️ 当前环境不支持 GM_xmlhttpRequest，无法推送 IMA',
            'toast.pushedOk':           '☁️ 已推送至 IMA 知识库',
            'toast.pushNonOk':          '⚠️ IMA 推送返回 {status}',
            'toast.pushFailed':         '⚠️ IMA 推送失败，请确认 ima_watcher.py --serve 在运行',
            'toast.pushTimeout':        '⚠️ IMA 推送超时（{s}s），请检查 ima_watcher.py',
            'toast.siteNotSupported':   '⚠️ 当前站点未适配',
            'toast.inputNotFound':      '⚠️ 找不到输入框（页面有 {ta} 个 textarea / {ce} 个可编辑区）',
            'toast.sendFailed':         '⚠️ 发送失败：站点未在 3s 内响应（input 仍含 prompt, AI 也没开始回复）',
            'toast.summaryInjected':    '✨ 已注入「总结咒语」，即将自动发送…',
            'toast.autoSent':           '🚀 已自动发送',
            'toast.autoTried':          '🚀 已尝试发送',
            'toast.waitingGen':         '⏳ 正在等待 {name} 生成完成…',
            'toast.waitingElapsed':     '⏳ 等待生成中…(已等 {s}s)',
            'toast.waitTimeout1':       '⏱️ 未检测到回复（2 分钟超时），请手动抓取',
            'toast.waitTimeout2':       '⏱️ 等待超时（2 分钟），请手动抓取',
            'summaryPrompt':            '请将我们刚才的全部对话，整理成一篇适合存入知识库的 Markdown 文章。要求：\n1. 提炼核心结论；\n2. 按层级标题重组；\n3. 真正的代码片段才用带语言标识的代码块（如 ```python）；\n4. 直接用标准 Markdown 格式输出（# 标题、表格、列表、加粗等正常渲染即可），不要把整篇文章再包进一个代码块里，也不要加开场白和结束语。\n5. 直接返回纯文本，不要打开或调用任何文档工具（豆包自带的 .docx / 文章视图等），内容直接打在聊天消息里。',
        },
        en: {
            'ui.titleFallback': 'Generic mode',
            'ui.btnAll':        '📚 Export all',
            'ui.btnLatest':     '📥 Export latest',
            'ui.btnCopy':       '📋 Copy latest',
            'console.started':  '✅ ChatDigest started',
            'console.exportAllFailed': '[ChatDigest] Export all failed:',
            'console.inputNotFound':    '[ChatDigest] Input box not found',
            'console.initFailed':       '[ChatDigest] Init failed:',
            'alert.initFailed':         'ChatDigest init failed:',
            'alert.initFailed.detail':  'See browser console (F12) for details.',
            'toast.cantReachTop':       '⚠️ Could not scroll to top, earliest messages may be missing',
            'toast.noContentDownload':  '⚠️ No content captured, make sure AI has fully replied',
            'toast.downloaded':         '✅ Downloaded: {fileName}',
            'toast.noContentCopy':      '⚠️ No content captured',
            'toast.copied':             '📋 Copied',
            'toast.scrolling1':         '⏳ Scrolling to collect full conversation...',
            'toast.scrolling2':         '⏳ Scrolling... ({passName} stage, {keys} msgs, key {minK}~{maxK}, {elapsed}s)',
            'toast.noExportable':       '⚠️ No conversations to export',
            'toast.exportAllFailed':    '⚠️ Failed to export all: {err}',
            'toast.pushOn':             '☁️ Auto-push IMA: enabled',
            'toast.pushOnBase':         '☁️ Auto-push IMA: ',
            'toast.pushOff':            '☁️ Auto-push IMA: disabled',
            'toast.gmNotSupported':     '⚠️ GM_xmlhttpRequest not available, cannot push to IMA',
            'toast.pushedOk':           '☁️ Pushed to IMA knowledge base',
            'toast.pushNonOk':          '⚠️ IMA push returned {status}',
            'toast.pushFailed':         '⚠️ IMA push failed, make sure ima_watcher.py --serve is running',
            'toast.pushTimeout':        '⚠️ IMA push timeout ({s}s), check ima_watcher.py',
            'toast.siteNotSupported':   '⚠️ Current site not supported',
            'toast.inputNotFound':      '⚠️ Input box not found (page has {ta} textareas / {ce} contenteditable)',
            'toast.sendFailed':         '⚠️ Send failed: site did not respond in 3s (input still has prompt, AI also not replying)',
            'toast.summaryInjected':    '✨ Summary spell injected, sending...',
            'toast.autoSent':           '🚀 Auto-sent',
            'toast.autoTried':          '🚀 Tried to send',
            'toast.waitingGen':         '⏳ Waiting for {name} to finish...',
            'toast.waitingElapsed':     '⏳ Waiting... ({s}s elapsed)',
            'toast.waitTimeout1':       '⏱️ No reply detected (2 min timeout), please capture manually',
            'toast.waitTimeout2':       '⏱️ Timeout (2 min), please capture manually',
            'summaryPrompt':            'Please organize our entire conversation into a Markdown article suitable for a knowledge base. Requirements:\n1. Distill the core conclusions;\n2. Restructure with hierarchical headings;\n3. Use code blocks with language identifiers only for actual code snippets (e.g. ```python);\n4. Output in standard Markdown format (# headings, tables, lists, bold, etc. should render normally) — do NOT wrap the entire article in a single code block, and skip opening/closing pleasantries.\n5. Return plain text directly in the chat message; do not open or invoke any document tools (e.g. site-built-in .docx / article views).',
        },
    };

    /* t(key, params?) — 取当前 locale 对应字符串，{name} 占位符做参数替换。

       v1.15.12 关键设计原则：**default = en，中文是特殊情况**。**不跨语言回退**——
       英语用户看到中文、或者中文用户看到英文，都是"看出对方语言"尴尬。具体：
       - 找得到 key → 用当前 locale 的字符串
       - 当前 locale 缺 key → 返回 key 字符串本身（开发者显眼，翻译未完成时仍可用，不静默吃掉）
       - 不再回退到对方 locale 字典（避免给英语用户显示中文、或反之）
       原因：v1.15.11 的 t() 在 en 缺 key 时会回退到 zh —— 翻译者忘了补一个 en key 就会让英语用户看到中文文案。
       v1.15.12 改成"宁可显示 key 也不显示对方语言"，虽然开发者会看到 'toast.scrolling1' 而非本地化文本，
       但**绝不会**把中文推给非中文用户（或反之）。

       查找顺序：`isChineseLocale()` → zh | en → MSGS[lang][key] | key。

       v1.15.13 重要：**调用方必须在 t() 和 MSGS 定义之后**才能求值。
       之前 SUMMARY_PROMPT 写在 L1001（远早于 t() 定义的 L1189），导致脚本加载时
       throw ReferenceError,整个 userscript 直接挂掉。修正后 SUMMARY_PROMPT 移到 t() 之后（紧跟其后），
       此注释作为未来维护者的 ordering constraint 提醒。 */
    function t(key, params) {
        const lang = isChineseLocale() ? 'zh' : 'en';
        const dict = MSGS[lang];
        let s = dict && dict[key];
        if (s === undefined) return key;  // 当前 locale 缺 key → 直接返回 key，不跨语言回退
        // v1.17.0+: SITE.name 自动 fallback 到 {name} placeholder (修复 i18n hardcode "DeepSeek" 等)
        // 隐式调用 t('toast.waitingGen') 也能拿到当前站品牌名 —— 不需每个 toast 调用显式传 SITE.name
        // 显式传 { name: 'XXX' } 优先级更高 (Object.assign 后写覆盖)
        const merged = params ? Object.assign({}, params) : {};
        if (typeof SITE !== 'undefined' && SITE && merged.name === undefined) {
            merged.name = SITE.name;
        }
        if (Object.keys(merged).length > 0) {
            s = s.replace(/\{(\w+)\}/g, (m, name) => merged[name] !== undefined ? String(merged[name]) : m);
        }
        return s;
    }

    /* v1.15.13 修正：SUMMARY_PROMPT 从原 L1001 移到这里（紧跟 t() 之后）。
       原因：t() 是 module-level 调用求值（const 初始化时执行），必须在 t() 和 MSGS 定义之后才能调用。
       之前在 L1001 早于 t() 定义 L1189 ~190 行,脚本加载时 throw ReferenceError 整个 userscript 挂掉。

       v1.15.14 防御性 fallback：try/catch 包住，失败时回退到硬编码中文 prompt。
       原因：万一未来又出现 ordering 问题（MSGS 还没初始化完 / t() 抛错），SUMMARY_PROMPT
       必须有兜底值,否则 injectSummaryPrompt 拿不到咒语,核心功能 (注入+发送+保存) 直接挂。
       这是 i18n 引入的「核心咒语不可因 i18n 失败而崩溃」原则 —— prompt 是功能,不是装饰。 */
    const SUMMARY_PROMPT = (() => {
        try {
            return t('summaryPrompt');
        } catch (e) {
            console.error('[' + CHATDIGEST_TAG + '] SUMMARY_PROMPT t() 失败,使用 fallback 硬编码:', e);
            return '请将我们刚才的全部对话,整理成一篇适合存入知识库的 Markdown 文章。要求:\n1. 提炼核心结论;2. 按层级标题重组;3. 真正的代码片段才用带语言标识的代码块(如 ```python);4. 直接用标准 Markdown 格式输出(# 标题、表格、列表、加粗等正常渲染即可),不要把整篇文章再包进一个代码块里,也不要加开场白和结束语;5. 直接返回纯文本,不要打开或调用任何文档工具(豆包自带的 .docx / 文章视图等),内容直接打在聊天消息里。';
        }
    })();

    const IMA_ENDPOINT = 'http://127.0.0.1:8765/ingest';

    const PUSH_STORAGE_KEY = 'c2k_auto_push_ima';   // Tampermonkey 存储区键名
    const MENU_CMD_ID = 'c2k-toggle-push';          // 箭头菜单命令 id（用于刷新文字）

    /* 读取自动推送开关：存储区无记录 → 默认开启并持久化；有记录 → 尊重之（含 false）。 */
    function loadAutoPush() {
        let v = null;
        try { v = GM_getValue(PUSH_STORAGE_KEY, null); } catch (e) { v = null; }
        if (v === null || v === undefined || v === '') {
            try { GM_setValue(PUSH_STORAGE_KEY, true); } catch (e) {}
            return true;
        }
        return !!v;
    }

    let AUTO_PUSH_IMA = loadAutoPush();

    /* 写入开关并持久化到存储区；同时弹出状态提示。 */
    function setAutoPush(on) {
        AUTO_PUSH_IMA = !!on;
        try { GM_setValue(PUSH_STORAGE_KEY, AUTO_PUSH_IMA); } catch (e) {}
        toast(AUTO_PUSH_IMA ? t('toast.pushOn') : t('toast.pushOff'), 'ok');
    }

    function pushMenuLabel() {
        // '开 ✓' / '关 ✗' 是 UI 状态字符（开/关 状态），各语言都看得懂，不本地化
        return t('toast.pushOnBase') + (AUTO_PUSH_IMA ? '开 ✓' : '关 ✗');
    }

    function onPushMenuToggle() {
        setAutoPush(!AUTO_PUSH_IMA);
        // 以同一 id 重新注册，刷新菜单项文字（Tampermonkey 4.x 支持 options.id）
        try { GM_registerMenuCommand(pushMenuLabel(), onPushMenuToggle, { id: MENU_CMD_ID }); } catch (e) {}
    }

    /* 在 Tampermonkey 箭头菜单（脚本命令）注册 开/关 开关 */
    function registerPushMenu() {
        try {
            GM_registerMenuCommand(pushMenuLabel(), onPushMenuToggle, { id: MENU_CMD_ID });
        } catch (e) {
            // 旧版 API（不支持 options 参数）兜底：文字固定为首次注册时的状态
            try { GM_registerMenuCommand(pushMenuLabel(), onPushMenuToggle); } catch (e2) {}
        }
    }

    /* v1.20.0: 把"report bug"菜单抽成函数, 在 waitBody 里 initUI 之后调 (跟
       registerPushMenu 同一路径, 菜单 UI 自然落到 IMA 推送开关下方)。
       IIFE 顶部不再 inline 注册 (v1.15.15 双保险的"菜单也保留"维度丢一边,
       但 initUI 自身 throw 仍由 waitBody catch 抓住 + alert, 之后仍调本函数;
       极端 case 走 IIFE 顶层 catch 弹 FATAL alert 兜底)。
       label / callback 跟 v1.15.15 时代完全一致, 行为兼容。 */
    function registerReportBugMenu() {
        if (typeof GM_registerMenuCommand !== 'function') return;
        try {
            // v1.20.0: 菜单 label 带版本号 (CHATDIGEST_TAG = "ChatDigest: 1.20.0"),
            // 跟 alert 弹窗 + console error 用同一个 tag, dev 一眼锁定版本
            GM_registerMenuCommand(CHATDIGEST_TAG + ' - report bug (open F12 console)', function () {
                try { alert(CHATDIGEST_TAG + ' - please open F12 console, copy any [ChatDigest FATAL] line, paste to developer.'); } catch (_) {}
            });
        } catch (_) { /* 极端情况:连 GM_registerMenuCommand 都不可用 — 跳过 */ }
    }

    /* 通过本地 HTTP 桥把 Markdown 推给 ima_watcher.py → IMA。
       依赖 GM_xmlhttpRequest（已在元数据 @grant 声明），可跨域访问 localhost。
       v1.15.0：加 timeout: 8000（8s）+ ontimeout 提示。原本没 timeout，
       如果 watcher 进程挂/端口被占，请求会一直挂着、UI 无反馈。 */
    const IMA_PUSH_TIMEOUT_MS = 8000;
    function pushToIma(content, filename) {
        if (typeof GM_xmlhttpRequest !== 'function') {
            toast(t('toast.gmNotSupported'), 'error');
            return;
        }
        GM_xmlhttpRequest({
            method: 'POST',
            url: IMA_ENDPOINT,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({ content, filename }),
            timeout: IMA_PUSH_TIMEOUT_MS,
            onload: (r) => {
                if (r.status >= 200 && r.status < 300) toast(t('toast.pushedOk'), 'ok');
                else toast(t('toast.pushNonOk', { status: r.status }), 'error');
            },
            onerror: () => toast(t('toast.pushFailed'), 'error'),
            ontimeout: () => toast(t('toast.pushTimeout', { s: IMA_PUSH_TIMEOUT_MS / 1000 }), 'error'),
        });
    }

    function injectSummaryPrompt() {
        if (!SITE) { toast(t('toast.siteNotSupported'), 'error'); return; }
        const input = findInput();
        if (!input) {
            const ta = document.querySelectorAll('textarea').length;
            const ce = document.querySelectorAll('[contenteditable="true"],[contenteditable="plaintext-only"]').length;
            console.warn(t('console.inputNotFound'), { textareas: ta, contenteditables: ce, href: location.href });
            toast(t('toast.inputNotFound', { ta, ce }), 'error');
            return;
        }
        const snippet = SUMMARY_PROMPT.slice(0, 30);
        // 记录发送前 msgs / users 数量. 三个成功信号**任一**通过即发送成功:
        //   (a) input.innerText 不含 snippet  → input 已清空 (Quill 默认模式, 跟 Kimi/元宝/千问 一样)
        //   (b) msgs.length 增加              → model-response 出现 (AI 开始 streaming, 1-5s)
        //   (c) users.length 增加             → user-query 出现 (Gemini 模式, Enter 处理后 ~100ms 秒出)
        // Gemini 实测 (gemini.html 2026-07-22, 247KB): user-query 跟 model-response 都是 <user-query> /
        // <model-response> custom element, 跟 ADAPTERS.gemini.userSel/assistantSel 完全对齐,
        // 所以 getUserMessages() 计数可靠. user-query 在 Enter 处理后立即添加 (等 AI 启动),
        // 比 model-response 早 1-5s 出现 → 最稳的"发送已处理"信号.
        // 之前 3s check 只看 (a)+(b), 大 prompt / 慢网下 AI 启动慢 → 3s 内 model-response 还没出,
        // 误判 send failed. 加 (c) 完美覆盖.
        const msgsBefore = getAssistantMessages().length;
        const usersBefore = getUserMessages().length;
        setInputValue(input, SUMMARY_PROMPT);
        setTimeout(() => {
            const injected = (input.innerText || input.textContent || '').includes(snippet);
            if (!injected) {
                console.error('[ChatDigest] inject failed: input.innerText 仍不包含 SUMMARY_PROMPT 截 30 字符');
                toast('注入失败: ' + t('toast.inputNotFound'), 'error');
                return;
            }
            autoSend(input);
            setTimeout(() => {
                const stillHas = (input.innerText || input.textContent || '').includes(snippet);
                const msgsAfter = getAssistantMessages().length;
                const usersAfter = getUserMessages().length;
                const newReplyStarted = msgsAfter > msgsBefore;
                const newUserSent = usersAfter > usersBefore;
                if (!stillHas || newReplyStarted || newUserSent) {
                    // (a)/(b)/(c) 任一通过 → 发送成功 (此时才显示 "已自动发送",
                    // click 本身只是 attempt, 不算成功)
                    toast(t('toast.autoSent'), 'ok');
                    setTimeout(waitAndAutoSave, 1000);
                    return;
                }
                console.error('[ChatDigest] send failed: input.innerText 仍含 snippet, msgs/users.length 也未增加');
                toast('发送失败: ' + t('toast.sendFailed'), 'error');
                return;  // 不调 waitAndAutoSave, 避免「老回复被误导出」
            }, 3000);
        }, 500);
    }

    /* 自动发送：优先点击「发送」按钮；
       找不到按钮时，在 textarea 上派发 Enter 键（DeepSeek/多数站点是回车即发送，
       Shift+Enter 才是换行，故这里只发纯 Enter）。

       v1.17.0+: 加 Kimi / 类 Lexical 站适配 —— Kimi send button 不是 <button>，
       是 <div class="send-button-container"> 含 <svg class="iconify send-icon" name="Send">。
       实际 HTML (用户实测 2026-07-19):
         <div class="send-button-container">
           <svg class="iconify send-icon" name="Send">...</svg>
         </div>
       现有 selector 全部 0 命中, 走 fallback `execCommand('insertParagraph')` —— 不发送,
       waitAndAutoSave 等 2s 稳定后直接抓最近已有 AI reply 导出. 修法: 加 Kimi 适配.

       v1.19.1+: 加元宝 (yuanbao.tencent.com) 适配 —— send button 是 <a id="yuanbao-send-btn">,
       class 是 CSS Module hash 风格 (style__send-btn___RwTm5), 禁用时加 --disabled
       modifier (style__send-btn--disabled___mhfdQ), 不是用 disabled 属性.
       <a> 没有原生 disabled 属性, 所以原来 `!b.disabled` 对 <a> 永远 true, 会把禁用的
       按钮也当成可点 → click 无声失败 → waitAndAutoSave 等到"AI 最后一次回答"
       (即上次的旧回答) 就保存了, 用户感觉"莫名其妙生成了一个文件".
       修法: sendSel 列表前加 [id="yuanbao-send-btn"] + 排除 className 含 '--disabled' 的元素.

       contenteditable fallback 也修了: 原来走 `execCommand('insertParagraph')`,
       Quill/Lexical 等现代编辑器不响应这个. 元宝的 div.ql-editor[contenteditable="true"]
       有 `enterkeyhint="send"`, 派发真 KeyboardEvent('keydown', { key: 'Enter' })
       才会触发 Quill 的 onKeyDown handler → 发送. */
    function autoSend(input) {
        // v1.21.0 改: 加 [data-test-id*="send-button"] 命中 Gemini
        // 实测 send button: <button class="mdc-icon-button mat-mdc-icon-button ..." aria-label="发送">
        // 在 <div data-test-id="send-button-container"> 内. 之前 sendSel 缺 data-test-id 兜底.
        // 可见性 check 用 getClientRects + getComputedStyle 兜底 Material Design CSS quirk
        // (transform / overflow:hidden wrap 让 offsetParent === null).
        const sendSel = '[id="yuanbao-send-btn"], [data-test-id*="send-button"], button[type="submit"], button[aria-label*="发送"], button[aria-label*="send" i], [data-testid="send-button"], .ds-send-button, .send-button, #send-button, .send-button-container, [name="Send"]';
        const isVisible = (el) => el.offsetParent !== null ||
            (el.getClientRects && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none');

        const fireEnter = (target) => {
            // v1.21.0 改: 派发 Enter 键时用 isComposing: false (synthetic event),
            // 防止 Quill 等编辑器误判 IME 输入中. 派发 3 次 (keydown / keypress / keyup)
            // 跟浏览器真实 Enter 按下行为一致.
            const fire = (type) => target.dispatchEvent(new KeyboardEvent(type, {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                location: 0,
                bubbles: true, cancelable: true, composed: true, isComposing: false
            }));
            fire('keydown'); fire('keypress'); fire('keyup');
        };
        const fireEnterFallback = () => {
            // contenteditable 路径也派发到 closest('rich-textarea') 祖先 (Gemini 站
            // rich-textarea custom element 包装 ql-editor, rich-textarea 可能拦截
            // keydown 不让内部 ql-editor 处理, 派发两份保证收到).
            if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
                fireEnter(input);
            } else {
                input.focus();
                fireEnter(input);
                const richTa = input.closest && input.closest('rich-textarea');
                if (richTa && richTa !== input) fireEnter(richTa);
            }
        };

        // v1.21.0 加固 (user 实测 Gemini 报告 "send button 在输入后才出现"):
        // 很多站 (Gemini / 元宝) send button 不是页面加载时就在 DOM, 是**内容驱动**的
        // — ql-editor 有内容后 Angular re-render 才加 "visible" class + 切 display:none→block.
        // 之前 autoSend 同步 find button, 500ms 内 Angular re-render 没完成 → 按钮还在
        // display:none → isVisible false → btn null → 走 fireEnter fallback → Gemini rich-textarea
        // 包装下 fireEnter 也不工作 → send failed.
        // 修法: 轮询 sendSel 找 button, 最多 2s (Angular re-render 实际 <500ms 足够 buffer).
        // 按钮一出现立刻 click. 2s 超时才走 fireEnter fallback.
        //
        // v1.21.0 加固 (user 实测 Gemini 报 "[ChatDigest] send failed: ... msgs/users.length
        // 也未增加"): 之前 sendSel 第一个命中是 [data-test-id*="send-button"] 容器 <div>,
        // 不是真 button. 结构是 <div data-test-id="send-button-container"><gem-icon-button>
        // <button aria-label="发送"></button></gem-icon-button></div>, 真 click handler 在
        // inner <button> 上. el.click() 在 div 上 dispatch 出去, click 事件是**向上 bubble**
        // 不是向下 — 不会触发 inner button 的 click handler. 所以 click 调了 Gemini 没反应.
        // 修法: findSendButton 优先 <button> 元素; 没 button 才 fallback 到 container 然后
        // querySelector 找内部 button. 保证点的是真 click handler 所在 element.
        //
        // v1.21.0 改: **不**在这里 toast "已自动发送" — click / fireEnter 只是**尝试**发送,
        // 跟真正的 "发送成功" 不是一回事. user 实测报告: 文本刚出现在输入框 toast 就显示
        // "已自动发送", 但实际没发送 → 3s 后又显示 "发送失败", 两个 toast 矛盾. 修法:
        // autoSend 只做 attempt (click / fireEnter), 不显示 toast. 真正的成功 / 失败 toast
        // 在 injectSummaryPrompt 的 3s check 里, 根据 user-query / msgs / input 状态判断.
        const findSendButton = () => {
            let candidates = [];
            try {
                candidates = Array.from(document.querySelectorAll(sendSel))
                    .filter(b => isVisible(b) && !b.disabled && !/(^|\s)--disabled(\s|$)/i.test(b.className || ''));
            } catch (e) { return null; }
            if (!candidates.length) return null;
            // 优先 <button> 元素 (真 click handler 所在)
            const btn = candidates.find(c => c.tagName === 'BUTTON');
            if (btn) return btn;
            // container / wrapper 没 button tag 自己, querySelector 找内部 button
            for (const c of candidates) {
                const innerBtn = c.querySelector && c.querySelector('button:not([disabled])');
                if (innerBtn && isVisible(innerBtn)) return innerBtn;
            }
            // 兜底: 用第一个 candidate (可能 trigger 不响应, 但至少有 attempt)
            return candidates[0];
        };
        const startTs = Date.now();
        const POLL_MAX = 2000;
        const POLL_INTERVAL = 100;
        const tryClick = () => {
            const btn = findSendButton();
            if (btn) {
                btn.click();
                return;
            }
            if (Date.now() - startTs > POLL_MAX) {
                fireEnterFallback();
                return;
            }
            setTimeout(tryClick, POLL_INTERVAL);
        };
        tryClick();
    }

    /* 轮询等待最新回复生成完毕：文本连续 2 次（约 2s）无变化、且页面无「停止」按钮时，
       判定为完成，自动抓取并下载为 Markdown。最长等待 2 分钟，超时提示手动操作。 */
    function waitAndAutoSave() {
        let prev = '';
        let stable = 0;
        const start = Date.now();
        const MAX = 120000;
        const MIN_WAIT = 5000;          // v1.15.2: 最小等待 5s，避免抓到「刚开始生成」的极短内容
        const PROGRESS_INTERVAL = 5000; // v1.15.2: 每 5s 更新一次进度 toast（不重置 timer）
        let lastProgressUpdate = 0;
        toast(t('toast.waitingGen'), 'ok');
        const tick = () => {
            const msgs = getAssistantMessages();
            const el = msgs.length ? msgs[msgs.length - 1] : null;
            if (!el) {
                const elapsed = Date.now() - start;
                if (elapsed - lastProgressUpdate > PROGRESS_INTERVAL) {
                    toast(t('toast.waitingElapsed', { s: Math.floor(elapsed / 1000) }), 'ok');
                    lastProgressUpdate = elapsed;
                }
                if (elapsed < MAX) setTimeout(tick, 1000);
                else toast(t('toast.waitTimeout1'), 'error');
                return;
            }
            const txt = el.innerText || '';
            const stopping = !!document.querySelector('button[aria-label*="停止"], button[aria-label*="stop" i], [data-testid="stop"], .ds-stop-button');
            if (txt.length > 0 && txt === prev && !stopping) stable++;
            else stable = 0;
            prev = txt;

            const elapsed = Date.now() - start;
            // v1.15.2: 进度反馈（仅在用户等待超过 5s 时才更新 toast，否则太频繁）
            if (elapsed - lastProgressUpdate > PROGRESS_INTERVAL) {
                toast(t('toast.waitingElapsed', { s: Math.floor(elapsed / 1000) }), 'ok');
                lastProgressUpdate = elapsed;
            }

            if (stable >= 2) {
                // v1.15.2: 稳定 2 次 + 至少 5s 才算完成（避免抓到刚开始生成时的极短内容）
                if (elapsed < MIN_WAIT) {
                    setTimeout(tick, 1000);  // 继续等到 MIN_WAIT
                    return;
                }
                // v1.15.8：FAB 一键导出按「知识库文章」语义，去掉思考块
                const md = getLatestReply({ includeThinking: false });
                const ok = downloadMarkdown(md);
                if (ok && AUTO_PUSH_IMA) {
                    // v1.20.0 修：push 跟 download 用同一份 full（含 yaml 头），
                    // 避免 IMA 推送落盘（ima_watcher.ingest_content 写到 watch_dir，
                    // 默认 %USERPROFILE%\Downloads，跟浏览器下载同目录）那一份缺失
                    // frontmatter —— 之前 pushToIma(md, ...) 直接传裸 md，ima_watcher
                    // 落盘 file 没 yaml 头，跟浏览器下载的"有 yaml 头 file"共存同目录，
                    // 用户在 Downloads 打开看到的是没 yaml 头那份（IMA 推送的），
                    // 误以为 downloadMarkdown 漏了 frontmatter。
                    const title = resolveTitle(md);
                    const full = buildHeader(title, md) + md;
                    pushToIma(full, buildFileName(md));
                }
                return;
            }
            if (elapsed > MAX) {
                toast(t('toast.waitTimeout2'), 'error');
                return;
            }
            setTimeout(tick, 1000);
        };
        tick();
    }

    /* ============================================================
     * Premium 玻璃拟态 UI
     * ============================================================ */
    GM_addStyle(`
        #c2k-panel {
            position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
            user-select: none;
        }
        /* 经典「分离按钮」：正方形主按钮 + 右侧细长箭头，二者拼为一个整体 */
        #c2k-actions {
            display: flex; align-items: stretch;
            border-radius: 16px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.28);
            transition: transform .25s cubic-bezier(.16,1,.3,1), box-shadow .25s;
        }
        #c2k-actions:hover { transform: translateY(-2px); box-shadow: 0 12px 40px rgba(77,107,254,.5); }
        #c2k-fab {
            width: 46px; height: 46px; border-radius: 16px 0 0 16px;
            display: flex; align-items: center; justify-content: center;
            font-size: 22px; cursor: pointer; color: #fff;
            background: rgba(255,255,255,0.08);
            backdrop-filter: blur(20px) saturate(180%);
            -webkit-backdrop-filter: blur(20px) saturate(180%);
            border: 1px solid rgba(255,255,255,0.18);
            border-right: none;
            transition: background .2s;
        }
        #c2k-fab:hover { background: rgba(255,255,255,0.16); }
        #c2k-arrow {
            width: 22px; height: 46px; border-radius: 0 16px 16px 0;
            display: flex; align-items: center; justify-content: center;
            font-size: 13px; line-height: 1; cursor: pointer; color: #fff;
            background: rgba(255,255,255,0.08);
            backdrop-filter: blur(20px) saturate(180%);
            -webkit-backdrop-filter: blur(20px) saturate(180%);
            border: 1px solid rgba(255,255,255,0.18);
            border-left: 1px solid rgba(255,255,255,0.30);
            transition: background .2s, transform .25s cubic-bezier(.16,1,.3,1);
        }
        #c2k-arrow:hover { background: rgba(77,107,254,0.22); }
        #c2k-arrow.open { transform: rotate(180deg); }
        #c2k-menu {
            position: absolute; bottom: 64px; right: 0; width: 232px;
            background: rgba(20,22,34,0.72);
            backdrop-filter: blur(28px) saturate(180%);
            -webkit-backdrop-filter: blur(28px) saturate(180%);
            border: 1px solid rgba(255,255,255,0.14);
            border-radius: 18px; padding: 10px;
            box-shadow: 0 16px 48px rgba(0,0,0,0.4);
            opacity: 0; transform: translateY(8px) scale(.96); pointer-events: none;
            transition: all .25s cubic-bezier(.16,1,.3,1);
        }
        #c2k-menu.open { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
        #c2k-menu .c2k-title { color: #aab; font-size: 11px; padding: 4px 8px 8px; letter-spacing: .5px; }
        #c2k-menu button {
            width: 100%; text-align: left; border: none; cursor: pointer;
            background: transparent; color: #eef; font-size: 13px;
            padding: 9px 10px; border-radius: 10px; transition: background .15s;
            display: flex; align-items: center; gap: 8px;
        }
        #c2k-menu button:hover { background: rgba(77,107,254,0.22); }
        #c2k-toast {
            position: fixed; bottom: 92px; right: 24px; z-index: 2147483647;
            padding: 10px 16px; border-radius: 12px; font-size: 13px; color: #fff;
            background: rgba(20,22,34,0.85); backdrop-filter: blur(12px);
            border: 1px solid rgba(255,255,255,0.16);
            box-shadow: 0 8px 24px rgba(0,0,0,0.3);
            opacity: 0; transform: translateY(8px); transition: all .25s; pointer-events: none;
            max-width: 320px;
        }
        #c2k-toast.show { opacity: 1; transform: translateY(0); }
        #c2k-toast.ok { border-color: rgba(80,220,140,.6); }
        #c2k-toast.warn { border-color: rgba(255,190,80,.6); }
        #c2k-toast.error { border-color: rgba(255,80,80,.6); }   /* v1.15.5 新增：critical 错误红边 */
    `);

    // IIFE 作用域变量，供 toast()、downloadMarkdown() 等闭包访问
    let toastEl = null, fab = null, arrow = null, menu = null, toastTimer = null;

    function toast(msg, type) {
        if (!toastEl) return;
        toastEl.textContent = msg;
        toastEl.className = 'show ' + (type || '');
        clearTimeout(toastTimer);
        if (type === 'error') {
            // v1.15.5 新增：error 类型持续显示 + click 关闭。
            // 之前所有 warn 都 2.6s 自动消失，导致「凭证缺失 / kb-id 权限错 / 推送失败 /
            // 等待超时 / 找不到输入框 / 站点未适配」等 critical 错误一闪而过、用户根本没注意。
            // error：sticky + 红边 + 鼠标 pointer + 点击关闭 + 自动隐藏之前的 sticky。
            toastEl.style.pointerEvents = 'auto';
            toastEl.style.cursor = 'pointer';
            toastEl.title = '点击关闭';
            toastEl.onclick = () => { toastEl.className = toastEl.className.replace('show', '').trim(); };
        } else {
            // ok / warn (2.6s auto-dismiss)
            toastEl.style.pointerEvents = 'none';
            toastEl.style.cursor = '';
            toastEl.title = '';
            toastEl.onclick = null;
            toastTimer = setTimeout(() => { toastEl.className = toastEl.className.replace('show', '').trim(); }, 2600);
        }
    }

    function initUI() {
        const panel = document.createElement('div');
        panel.id = 'c2k-panel';
        // v1.21.0 改: 不用 innerHTML (Gemini CSP / Trusted Types 严格, 报
        // "Element.innerHTML setter: Sink type mismatch violation blocked by CSP").
        // 改用 DOM API 重建, 跨浏览器 + 跨站 CSP 兼容. 6 个 child elements 结构简单.
        // c2k-title / c2k-menu / 3 个 button (data-act="all/latest/copy") / c2k-fab / c2k-arrow.
        // ⚠️ 局部 const 必须改名 menuEl (不能叫 menu), 否则跟外层 let menu (line 1934
        // 顶层 `let toastEl = null, fab = null, arrow = null, menu = null, toastTimer = null;`)
        // 同作用域重名 → "Identifier 'menu' has already been declared". 后面 line 2002
        // `menu = panel.querySelector('#c2k-menu');` 给外层 let menu 赋值, 引用跟
        // 局部 menuEl 是同元素 (同一 DOM node), 行为 0 变化.
        const menuEl = document.createElement('div');
        menuEl.id = 'c2k-menu';
        const title = document.createElement('div');
        title.className = 'c2k-title';
        title.textContent = `${SOFTWARE_NAME} · ${SITE ? SITE.name : t('ui.titleFallback')}`;
        menuEl.appendChild(title);
        for (const [act, key] of [['all', 'btnAll'], ['latest', 'btnLatest'], ['copy', 'btnCopy']]) {
            const btn = document.createElement('button');
            btn.setAttribute('data-act', act);
            btn.textContent = t(`ui.${key}`);
            menuEl.appendChild(btn);
        }
        panel.appendChild(menuEl);
        const actions = document.createElement('div');
        actions.id = 'c2k-actions';
        const fabEl = document.createElement('div');
        fabEl.id = 'c2k-fab';
        fabEl.title = '一键导出：注入并发送总结咒语，自动保存最新回复';
        fabEl.textContent = '📑';
        actions.appendChild(fabEl);
        const arrowEl = document.createElement('button');
        arrowEl.id = 'c2k-arrow';
        arrowEl.title = '更多操作';
        arrowEl.setAttribute('aria-label', '更多操作');
        arrowEl.textContent = '▴';
        actions.appendChild(arrowEl);
        panel.appendChild(actions);
        document.body.appendChild(panel);

        toastEl = document.createElement('div');
        toastEl.id = 'c2k-toast';
        document.body.appendChild(toastEl);

        fab = panel.querySelector('#c2k-fab');
        arrow = panel.querySelector('#c2k-arrow');
        menu = panel.querySelector('#c2k-menu');

        // 主图标：一键导出 = 注入并发送总结咒语 → 等待生成 → 自动保存最新回复
        fab.addEventListener('click', (e) => {
            e.stopPropagation();
            injectSummaryPrompt();
        });
        // 箭头：展开 / 收起菜单
        arrow.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = menu.classList.toggle('open');
            arrow.classList.toggle('open', open);
        });
        document.addEventListener('click', () => {
            menu.classList.remove('open');
            arrow.classList.remove('open');
        });

        menu.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const act = btn.dataset.act;
            // v1.15.8：单条消息导出路径（latest/copy）按「知识库文章」语义去掉思考块
            if (act === 'latest') downloadMarkdown(getLatestReply({ includeThinking: false }));
            else if (act === 'all') exportAll();   // 全部对话仍保留思考（做完整记录用）
            else if (act === 'copy') copyMarkdown(getLatestReply({ includeThinking: false }));
        });

        /* 快捷键
         *   Ctrl+Shift+S : 抓取最新回复并下载
         *   Ctrl+Shift+A : 抓取全部对话并下载
         */
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey) {
                // v1.15.8：单条消息快捷键（Ctrl+Shift+S）也按「知识库文章」语义去掉思考块
                if (e.key === 'S' || e.key === 's') { e.preventDefault(); downloadMarkdown(getLatestReply({ includeThinking: false })); }
                if (e.key === 'A' || e.key === 'a') { e.preventDefault(); exportAll(); }
            }
        });

        console.log('%c' + t('console.started'), 'color:#4D6BFE;font-weight:bold', SITE ? `· ${SITE.name}` : '· ' + t('ui.titleFallback'));
    }

    /* 等待 <body> 就绪再注入 UI：兼容 SPA 晚加载 / run-at 时机问题；
       即使脚本运行过早，也会每 100ms 重试，直到 body 出现。

       v1.20.0: initUI 的 try/catch 拆开, throw 后仍调 registerPushMenu + registerReportBugMenu
       —— 这样 initUI 自身 throw 时菜单 UI 顺序仍然完整 (IMA 推送 → report bug),
       v1.15.15 双保险的"菜单也保留"维度保持 (仅 IIFE 顶层 throw 那一极端 case 丢,
       由 IIFE 顶层 catch 弹 FATAL alert 兜底)。 */
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

    // v1.15.15 终极保险: catch 任何 module-level throw (不依赖 t()/MSGS)
    } catch (e) {
        try {
            // 用 hardcoded 文案 (不依赖 t() 翻译), 用户能直接看到具体错误
            // v1.20.0: alert / console 加 CHATDIGEST_TAG (e.g. "ChatDigest: 1.20.0"),
            // user 复制 alert 文本 / dev 看 console log 立刻知道是哪个版本触发的 bug
            var msg = '[' + CHATDIGEST_TAG + '] FATAL init failed: ' + (e && e.message ? e.message : String(e)) +
                      '\n\nStack: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n') : 'N/A') +
                      '\n\nPlease copy this alert text and report to developer.';
            try { console.error('[' + CHATDIGEST_TAG + ' FATAL]', e); } catch (_) {}
            try { alert(msg); } catch (_) { /* alert 不存在 (e.g. GM sandbox) — fallback console */ }
        } catch (_) { /* 终极保险的终极保险: 不让 catch 自身 throw */ }
    }
})();
