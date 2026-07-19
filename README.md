# ChatDigest / 聊摘

**[English](./README.md)** | [中文](./README.zh.md)

**ChatDigest (聊摘)** is a Tampermonkey userscript that turns AI web chats (DeepSeek / ChatGPT / Kimi / Claude / Doubao / Yuanbao, etc.) into **Markdown knowledge base articles** with a single click.

> Philosophy: let the AI itself be the "summarization engine" — the script just acts as the "porter" + "file librarian". Append a prompt at the end of the chat, the AI outputs pure Markdown, and the script handles capture, naming, and download.

**Fully local · No subscription · No API key · Privacy-first.** The core export (save as local `.md` file) requires zero config and zero network — install the script, click once, done. Optionally push to **Tencent ima**, **Obsidian** (planned), or any Markdown-friendly knowledge base tool — using your own account, official APIs, no third-party intermediary.

**Since v1.15.10, `SOFTWARE_NAME` auto-switches based on browser locale**: Chinese system → `聊摘`, other languages → `ChatDigest`. Export filenames follow the same rule (Chinese system: `聊摘_DeepSeek_2026-07-19_xxx.md`; other: `ChatDigest_DeepSeek_*.md`), and the YAML frontmatter `tags` field follows too. Same tool, users worldwide see their own language filename.

**Since v1.15.11, the entire UI is bilingual (Chinese + English)**: all user-visible text (UI panel buttons / toast notifications / console errors / alerts / the summary spell `SUMMARY_PROMPT`) auto-switches by browser locale. The source language (Chinese) also goes through the dictionary, with 38 keys × 2 languages = 76 translations maintained centrally.

## Features

- 🌐 **Multi-site auto-adaptation**: automatically detects the current AI platform and uses the appropriate selectors
- 📑 **One-click export (main icon)**: click the 📑 main icon at the bottom-right to complete "inject + send summary spell → wait for AI generation → auto-save the latest reply", with zero manual steps
- 💬 **Export entire conversation (user prompts + full history)**: "📚 Export all" **first scrolls through the virtual list to collect the complete conversation from the first message to the last** (DeepSeek and other sites only render the visible window, so without scrolling the beginning is missed), then interleaves "👤 My prompt" with "🤖 AI reply" in chronological order (paired by turn number). Since v1.14.0, three DeepSeek DOM hardening fixes: ① **scroll container detection** now scans multiple candidates (`.ds-virtual-list` / `.ds-virtual-list-items` / `window`), no longer falling back to "only visible window" because an ancestor's `scrollHeight` wasn't ready (this was the root cause of missing beginnings, disappearing first user prompt, attribution mix-up); ② **sort by key ascending** and bind each entry to its own `data-virtual-list-item-key`, avoiding sort collisions from "duplicate user prompt text" (attribution mix-up); ③ `assistantSel` no longer appends `, .ds-markdown`, avoiding counting thinking-block leaf nodes as independent AI replies
- 🧠 **Thinking process separated from final reply (blockquote)**: the "thinking / reasoning process" inside AI replies is extracted separately and wrapped in a quote block (`> **💭 思考过程** ...`), visually distinct from the "final reply" below; this logic applies uniformly to "Export all / Export latest / Copy latest / One-click export". Replies without thinking won't fabricate thinking blocks. **Key detail**: DeepSeek's "thinking block" also contains `.ds-markdown` (class name `ds-think-content`), different from the final reply's `.ds-markdown.ds-assistant-message-main-content` — so separation uses these two **stable class names** to target precisely (take the reasoning body from `ds-think-content`, take the final answer from `ds-assistant-message-main-content`), not blindly "the first `.ds-markdown`" (which would mistake thinking for answer, or "Has thought (took X seconds)" status for thinking), preserving the original paragraph/list format of the thinking
- ▴ **More actions (right-side slim arrow)**: main button is a square, paired with a **slim** arrow on the right (▴, default points up, flips to ▾ when expanded), forming a "split button" whole; clicking the arrow opens a menu offering three granularities — "📋 Copy latest / 📥 Export latest / 📚 Export all", same functionality, pick as needed
- 🧩 **HTML→Markdown converter (core)**: no longer relying on `innerText`, but rebuilding Markdown from DOM structure — preserves `#` heading levels, `|` tables, lists, quotes, `**bold**`/links/inline code, and code block language identifiers (`` ```python` / ````js`). Whether the AI renders content as HTML or wraps it in a code block, both are handled correctly
- 📓 **Unified YAML metadata header**: every exported file has standard YAML frontmatter (title/source/author/created/tags/description, aligned with Obsidian Properties spec), complete and widely recognized by Jekyll/Hugo/Obsidian/VuePress, cross-editor compatible. Title uses standard `# heading`; if the body already contains h1, only metadata is added, no duplicate heading.
- ✨ **"Summary spell" auto-archive**: a normalized prompt is injected into the input box → auto-send → **auto-wait for AI to finish** → **auto-capture and save as `.md`** (i.e. the main icon's one-click export logic)
- 🧹 **Auto-fix export format**: skips DeepSeek code block header "copy/download/language label" UI shells; **identifies and unwraps "entire Markdown source wrapped in code fence" exports at extraction time** (common when DeepSeek is asked to output "pure Markdown"), restoring to renderable Markdown directly, no longer relying on fence balance — even when outer (4 backticks) and inner (3 backticks) lengths differ, stripping works correctly; nested code blocks get safe fence lengthening to prevent format corruption from fence nesting
- ☁️ **Optional push to IMA (official OpenAPI, enabled by default)**: after the script auto-saves, it also POSTs the Markdown to the local `ima_watcher.py` (must run with `--serve`), which then uses `ima_upload.py` via **IMA official OpenAPI** (create_media → COS upload → add_knowledge) to import directly into the knowledge base, no third-party CLI dependency; toggle in the Tampermonkey arrow menu "☁️ Auto-push IMA: on/off", state persisted
- 🎀 **Premium glassmorphism UI**: a "split button" floating widget at the bottom-right (square 📑 main button + slim ▴ arrow on the right as one whole), with hover animations, doesn't disrupt the original site style
- ⌨️ **Keyboard shortcuts**:
  - `Ctrl + Shift + S`: capture latest reply and download
  - `Ctrl + Shift + A`: capture all conversation and download
- 📁 **Unified file naming**: export filenames follow `[SoftwareName]_[AI vendor]_[timestamp]_[title].md` (e.g. `ChatDigest_DeepSeek_2026-07-14_2259_title.md`). Title derivation has two scenarios:
  - **📚 Export all → directly use the page's `document.title`**, no h1 fallback (a full conversation may contain AI-generated article h1, so page title fits "conversation topic" better; e.g. DeepSeek's "History of Heart Sutra English Translation - DeepSeek" auto-strips the " - DeepSeek" vendor suffix to "History of Heart Sutra English Translation"); empty page title means leave empty (omit trailing segment).
  - **📥 Export / 📋 Copy "Latest reply", 📑 One-click export → original logic preserved**: **prefer the first h1 in the captured content**, fallback to page title if no h1, leave empty if neither exists.
  - Software name is a switchable Chinese/English variable (`SOFTWARE_NAME`); timestamp uses `YYYY-MM-DD_HHMM`

## Supported Sites

| AI site          | URL                     | Status         | One-click export (📑 FAB) | Export all (📚) |
| ---------------- | ----------------------- | -------------- | ------------------------- | --------------- |
| DeepSeek         | `chat.deepseek.com`     | ✅ Supported   | ✅                        | ✅              |
| ChatGPT          | `chatgpt.com`           | ✅ Supported   | ✅                        | ✅              |
| Kimi             | `www.kimi.com`          | ✅ Supported   | ✅                        | ✅              |
| Claude           | `claude.ai`             | ✅ Supported   | ✅                        | ✅              |
| Doubao (豆包)    | `www.doubao.com`        | ✅ Supported   | ✅                        | ✅              |
| Yuanbao (元宝)   | `yuanbao.tencent.com`   | ✅ Supported   | ✅                        | ✅              |
| Gemini           | `gemini.google.com`     |                |                           |                 |
| Tongyi Qianwen   | `tongyi.aliyun.com`     |                |                           |                 |
| Wenxin Yiyan     | `yiyan.baidu.com`       |                |                           |                 |
| Zhipu Qingyan    | `chatglm.cn`            |                |                           |                 |
| Xunfei Spark     | `xinghuo.xfyun.cn`      |                |                           |                 |
| Perplexity       | `perplexity.ai`         |                |                           |                 |
| Grok             | `grok.com` / `x.com`    |                |                           |                 |

> "One-click export" = inject summary spell + auto-send + wait for generation + auto-save (single-message path); "Export all" = scroll through virtual list to collect full history (multi-message path). Other entry points (Export latest / Copy latest / Auto-push IMA) use the same path and apply to all sites, so they are not listed separately. Open an issue (with site URL + DOM screenshot preferred) to request a new site, or add an adapter yourself per "Adding a new site" below.

## Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Click the Tampermonkey icon → "Dashboard" → "New script"
3. Clear the default content, paste the entire `chatdigest.user.js` file (since v1.15.9 the project is renamed to ChatDigest / 聊摘; **since v1.15.10 the script filename also changed from `chat2knowledge.user.js` to `chatdigest.user.js`** — zero cost rename for users who haven't published yet)
4. `Ctrl + S` to save and activate

## Usage

1. Chat normally on any supported AI site
2. To archive, **just click the 📑 main icon at the bottom-right** → one-click export: the script auto-injects the "summary spell" → auto-sends → waits for AI to finish → **auto-captures and saves as `.md` with YAML metadata header**
3. For finer granularity, click the **▴ arrow** on the right side of the main icon to expand the menu (from bottom to top):
   - **📋 Copy latest reply** → copy to clipboard
   - **📥 Export latest reply** → directly download the current latest reply (no regeneration)
   - **📚 Export all** → download the entire conversation (auto-scrolls to collect from first to last message, including user prompts and AI thinking; thinking is shown as a quote block `> **💭 思考过程**` distinct from final reply, please wait a moment)
4. Once the file is saved locally, you can manually import it into IMA / Obsidian / any knowledge base

## Config options (script header)

```js
const SOFTWARE_NAME   = 'ChatDigest'; // Filename prefix [SoftwareName], switchable (e.g. Chinese distribution: '聊摘')
const IMA_ENDPOINT    = 'http://127.0.0.1:8765/ingest'; // Local bridge address (must match ima_watcher.py --serve port)
```
> **Auto-push IMA toggle**: `AUTO_PUSH_IMA` is no longer hardcoded in the source. If the Tampermonkey storage has no record (first use), **enabled by default** and persisted; thereafter you can toggle "☁️ Auto-push IMA: on/off" anytime in the **Tampermonkey arrow menu (script commands)**, state is persisted. No source change needed.

### Filename convention `[SoftwareName]_[AI vendor]_[timestamp]_[title].md`

| Segment        | Source                                                                                  | Example                                |
| -------------- | --------------------------------------------------------------------------------------- | -------------------------------------- |
| SoftwareName   | `SOFTWARE_NAME` constant (**since v1.15.10 auto-switches by locale**)                   | Chinese system `聊摘` / other `ChatDigest` |
| AI vendor      | Current site brand `SITE.name`                                                          | `DeepSeek` / `ChatGPT` / `Kimi`       |
| Timestamp      | Existing format `YYYY-MM-DD_HHMM`                                                      | `2026-07-14_2259`                      |
| Title          | Priority: content h1 → page title → empty                                                | `knowledge-base-naming-convention`     |

- Title empty means omit trailing segment: `ChatDigest_DeepSeek_2026-07-14_2259.md`
- Title is auto-cleaned of illegal filename characters (`\ / : * ? " < > |` etc.) and truncated to 60 chars
- The H1 in the file body matches the filename title, and if the body already contains h1, no duplicate is added (avoid two H1 in one file)

## Optional: Auto-push to IMA after save (official OpenAPI)

**Enabled by default.** After the script "📑 One-click export (or 📥 Export latest)" auto-saves, it also POSTs the Markdown to the local `ima_watcher.py` (must run with `--serve`), which then uses `ima_upload.py` via **IMA official OpenAPI** (create_media → COS upload → add_knowledge) to import directly into the knowledge base, no third-party CLI dependency.

### 0. One-time setup
1. Apply for free **Client ID / API Key** at https://ima.qq.com/agent-interface (Key shown only once, can be reset if leaked).
2. Configure credentials (pick one):

   **Option A: environment variables (recommended)**

   Windows (CMD, `set` is session-only; for permanent use `setx IMA_CLIENT_ID yourClientID`, needs a new window):
   ```cmd
   set IMA_CLIENT_ID=your Client ID
   set IMA_API_KEY=your API Key
   ```
   Mac / Linux (bash, `export` is session-only; for permanent use add these two lines to `~/.bashrc` / `~/.zshrc`):
   ```bash
   export IMA_CLIENT_ID="your Client ID"
   export IMA_API_KEY="your API Key"
   ```

   **Option B: file (script auto-reads, path `%USERPROFILE%\.config\ima\...`)**

   Windows (CMD):
   ```cmd
   mkdir "%USERPROFILE%\.config\ima"
   echo your Client ID>"%USERPROFILE%\.config\ima\IMA_CLIENT_ID"
   echo your API Key>"%USERPROFILE%\.config\ima\IMA_API_KEY"
   ```
   Mac / Linux (bash):
   ```bash
   mkdir -p ~/.config/ima
   echo "your Client ID"  > ~/.config/ima/IMA_CLIENT_ID
   echo "your API Key"    > ~/.config/ima/IMA_API_KEY
   ```
   Note: `%USERPROFILE%` (Windows) = `~` / `$HOME` (Mac / Linux), all three point to the current user's home directory.
3. Install dependencies (Windows works the same way, run the same commands in CMD / PowerShell): `pip install -r tools/requirements.txt`
4. Copy your **knowledge base ID** from the IMA knowledge base settings (looks like a long base64 string). Must be a library the current account can **write to** (personal library / shared library with write access); upload auto-validates, wrong or unauthorized will error immediately and list available options.

### 1. Script-side toggle (enabled by default, no source change)
- On first use, the script defaults to **enabled** and persists this; thereafter you can toggle "☁️ Auto-push IMA: on/off" anytime in the **Tampermonkey arrow menu (script commands)**, state persisted via `GM_setValue`/`GM_getValue`.
- Bridge address defaults to `http://127.0.0.1:8765/ingest` (constant `IMA_ENDPOINT`), must match the receiver's `--serve` port; usually no change needed.

### 2. Start the receiver bridge (ima_watcher.py --serve)
```bash
python tools/ima_watcher.py --serve            # default: reads KB_ID from ima_config.ini, port 8765
python tools/ima_watcher.py --serve --port 8765 --kb-id "your knowledge base ID"   # explicit override
```
Windows (CMD): `python tools\ima_watcher.py --serve`
> `--kb-id` can be omitted; if omitted, it auto-reads `KB_ID` from `ima_config.ini` in the same directory; explicit CLI value takes priority.
Then click "📑 One-click export"; after saving the `.md`, it's also pushed to the IMA knowledge base (push failure just shows a toast; the local `.md` is still saved, no data loss).
For full parameters and the alternative "directory monitor" usage, see "Connecting IMA Knowledge Base → ima_watcher.py two usage modes" below.

## Adding a new site

The `ADAPTERS` object at the top of the script centralizes all site configs. To add a new site, copy one entry and change the three selectors:

```js
mysite: {
    name: 'MySite',
    assistantSel: '.ai-reply',          // AI reply container
    titleSel:     '.chat-title',        // conversation title
    inputSel:     'textarea',           // input box
}
```

Then use F12 DevTools "select element" arrow to point at the AI reply area, and fill the highlighted class into `assistantSel`.

## Connecting IMA knowledge base (optional, official OpenAPI)

The browser sandbox cannot directly call IMA, so this repo includes an independent bridge: `tools/ima_watcher.py` (local receiver / monitor) + `tools/ima_upload.py` (actual uploader). `ima_upload.py` uses **IMA official OpenAPI** (`https://ima.qq.com/openapi/wiki/v1`): create media for COS temp credentials → upload file to Tencent Cloud COS → `add_knowledge` for final import, **no third-party CLI dependency throughout**.

> First use requires applying for and configuring credentials and installing dependencies: see "Optional: Auto-push IMA → 0. One-time setup" above.

### ima_watcher.py two usage modes

`ima_watcher.py` is a long-running local receiver offering two modes, pick by your workflow:

#### Mode 1: HTTP bridge (--serve) — receive script push
Use with "Auto-push after save" above: the script POSTs the content to the bridge when exporting `.md`, the watcher receives, saves, and uploads.
```bash
python tools/ima_watcher.py --serve                 # default: reads KB_ID from ima_config.ini, port 8765
python tools/ima_watcher.py --serve --port 8765 --kb-id "your knowledge base ID"   # explicit override
```
Windows (CMD): `python tools\ima_watcher.py --serve`
- `--kb-id` can be omitted; if omitted, it auto-reads `KB_ID` from `ima_config.ini`; explicit CLI value takes priority.
- Bridge address `http://127.0.0.1:8765/ingest` must match the script's `IMA_ENDPOINT` (default matches, usually no change).
- Upload is **serial + throttled**: unified in `ima_upload.py`'s `upload_file_to_kb` (in-process lock ensures only one upload at a time, minimum 1.5s between adjacent uploads, configurable via `--min-interval`), smooths requests, reduces rate-limit risk.

#### Mode 2: Directory monitor mode — watch folder for auto-import
No browser push dependency: you (or a script) drop `.md` files into a folder, the watcher monitors and uploads new ones. Suits "already have .md on disk, want to import them too" scenarios.
```bash
python tools/ima_watcher.py "C:/Users/you/Downloads"          # explicit directory, KB_ID reads ini
python tools/ima_watcher.py                                   # omitted: directory reads ini's SRC (else %USERPROFILE%\Downloads; Mac / Linux: ~/Downloads), KB_ID reads ini
```
Windows (CMD): `python tools\ima_watcher.py "C:\Users\you\Downloads"`
- Both directory and `--kb-id` can be omitted: directory reads `SRC` from `ima_config.ini` (else `%USERPROFILE%\Downloads`; Mac / Linux: `~/Downloads`), `--kb-id` reads `KB_ID`.
- Browser "atomic save" compatible: files first written as `.md.part`/`.crdownload` temp names, then renamed to `.md` after completion; the watcher monitors both "direct save" and "rename save" events, so browser-exported `.md` is captured correctly (see log: `[WATCH] detected .md: ...`).
- Upload is also serial + throttled (same as Mode 1), especially helpful for batch saves to avoid instant concurrent triggers of risk control.
- Both scripts support `--version` to view version (current `ima_upload.py` / `ima_watcher.py` = v1.2.1).

#### Windows one-click launchers (double-click bat, no command needed)

If you don't want to open a terminal, use the two launchers in `tools/` (**double-click to run**):

| Launcher                       | Mode                                     | Description |
| ------------------------------ | ---------------------------------------- | ----------- |
| `ima_watcher_bridge.bat`       | Mode 1 (HTTP bridge `--serve`)           | Double-click to start the bridge, waits for script push; close window to stop. |
| `ima_watcher_monitor.bat`      | Mode 2 (directory monitor)               | Double-click to monitor `ima_config.ini`'s `SRC` (else `%USERPROFILE%\Downloads`; Mac / Linux: `~/Downloads`); **you can also drop a folder onto this bat** to monitor that folder instead. Close window to stop. |

Both bat files read `PY` from the same directory's `ima_config.ini` (Python executable, solves the issue of Miniconda not registered in PATH), no need to manually configure environment; `KB_ID` / `SRC` are still read by `ima_watcher.py` itself from the ini. Logs are printed directly in the console window (long-running process, close window to exit).

### Pure command-line single upload (ima_upload.py)
   ```bash
   python tools/ima_upload.py --kb-id "your knowledge base ID" --file ./xxx.md
   ```
   Windows (CMD): `python tools\ima_upload.py --kb-id "your knowledge base ID" --file .\xxx.md`
   > `--kb-id` can be omitted; if omitted, it auto-reads `KB_ID` from `ima_config.ini` in the same directory; explicit CLI value takes priority. `--title` can specify the import title (default extracts the real title from the filename, see below).

### Auto-validate write permission before upload

Every upload (the `ima_upload.py` CLI and `ima_watcher.py` share the same core function, one change covers both) **first calls the official `get_addable_knowledge_base_list`**, confirms `--kb-id` belongs to a knowledge base the current account can **write to**, and only proceeds with `create_media → COS → add_knowledge` after validation; if not writable, it errors immediately and lists all writable knowledge bases of the account, for easy `--kb-id` reconciliation. Validation result is cached in-process, **only one API call per kb-id** (the long-running watcher only validates once on the first file).

- Writable scope = knowledge bases your account has write permission on: **your own personal library** / **shared libraries you created** / **shared libraries where you're a "write-permission member"**.
- `shareId` share links (e.g. `ima.qq.com/wiki/?shareId=...`) are **read-only views** (visitor limit 3 chat turns), **not equal to** the writable `knowledge_base_id`; to write into someone else's shared library, the library owner must add your account as a write-permission member, then use that library's official **knowledge base ID** to import.

### Auto-extract import title

If you don't pass `--title` explicitly on upload, the script **auto-extracts the real title from the filename**, stripping the ChatDigest naming prefix:

- Filename convention: `[SoftwareName]_[AI vendor]_[timestamp]_[title].md`, e.g. `ChatDigest_DeepSeek_2026-07-15_2225_heart-sutra-translation-history.md`
- Extraction rule: use the **timestamp segment** (`YYYY-MM-DD_HHMM`, with one underscore inside) as the anchor, take the **following** segment as the title → above example extracts `heart-sutra-translation-history`
- If the title contains underscores (e.g. `A_B_C title`) due to cleaning, they are **preserved as-is**
- **Fallback to original filename** (with `.md`) in these cases: filename doesn't match the convention (file not exported by ChatDigest), or there's no title content after the timestamp (e.g. `ChatDigest_DeepSeek_2026-07-15_2225.md` with omitted trailing segment)
- **Old `Chat2Knowledge_*.md` files from pre-v1.15.9 also work** — `derive_title` uses the timestamp anchor and takes the content after it, doesn't depend on the prefix string, so old files need zero migration
- Explicit `--title "..."` takes priority, no processing

> ⚠️ **IMA hard rule**: after import, the knowledge base's display title is jointly determined by `title` and `file_name`, **both must be exactly equal (including extension)**, otherwise it always falls back to the original `file_name`. So the script unifies the extracted title to "`title.md`" (adds `.md` if missing) as the final write value, and **passes the same value as both `create_media`'s `file_name` and `add_knowledge`'s `title`**. Above example's final import title: `heart-sutra-translation-history.md`.

> Extraction logic is in `derive_title()` in `tools/ima_upload.py`, shared by CLI and `ima_watcher.py`, one change covers both.

### One-click batch import (ima_upload.bat, Windows)

If typing commands each time is annoying, `tools/` includes `ima_upload.bat`, double-click or drag-and-drop to import:

- **Double-click (no drag)**: imports all `.md` (one level, no recursion) from the source folder specified by `SRC` in `ima_config.ini`.
- **Drag files / folders onto the bat**: imports `.md` from the dropped item — drop files and only `.md` are imported, non-`.md` auto-skipped; drop folders and all `.md` inside are imported (one level).
- Drag-and-drop supports single file / multiple files / folder, paths with spaces or special characters (`&`, `()` etc.) are stable.

**One-time config before use** (config moved to standalone ini, the bat itself writes no config):

1. Copy `tools/ima_config_sample.ini` to `ima_config.ini` in the same directory
2. Open `ima_config.ini` with a text editor, fill in the three items below (lines starting with `;` are comments, ignore them; spaces around `=` are OK, no quotes around values):

```ini
KB_ID = your knowledge base ID   ; required, found in ima.qq.com knowledge base settings
SRC   = C:\your\export\dir    ; used for double-click mode, leave empty to require drag
PY    = C:\path\to\python.exe ; optional; only needed if python is not in PATH (see below)
```

- `ima_config.ini` is in `.gitignore`, won't be committed to the repo, won't leak your knowledge base ID; the repo only keeps the `ima_config_sample.ini` template.
- If `KB_ID` is empty, double-click/drag will error first, won't mis-upload.
- **`PY` is the Python executable** (command name or full path). Default auto-detects `python` → fallback to `py` if not found; if your Python is **Miniconda and not registered as default `python`** (no `python` in PATH), just put the full path in `PY`, e.g. `PY = C:\Users\your-username\miniconda3\python.exe` (or some virtualenv `…\envs\myenv\python.exe`).
- Credentials follow the same mechanism as `ima_upload.py` (env vars `IMA_CLIENT_ID`/`IMA_API_KEY` or `%USERPROFILE%\.config\ima\` files), **no credentials in config**.
- Detailed usage, version log, and "drag-and-drop flash-close" troubleshooting in the same directory **`ima_upload_notes.txt`** (Chinese characters are forbidden in `.bat` — including echo and comments — otherwise Chinese Windows will flash-close, so the doc is separate).

> The bat is essentially just a wrapper for `ima_upload.py` — pre-upload permission validation, title auto-extraction, etc. are all identical to the CLI (shared `upload_file_to_kb`).

## File structure

```
CHATDIGEST/
├── chatdigest.user.js        # main script (Tampermonkey; renamed from chat2knowledge.user.js since v1.15.10)
├── README.md                 # this file (English)
├── README.zh.md              # Chinese version of this file
├── CHANGELOG.md              # history changelog (script / Python toolchain versions and troubleshooting)
└── tools/
    ├── ima_watcher.py           # optional: local IMA import monitor / HTTP bridge (official OpenAPI)
    ├── ima_upload.py            # optional: IMA official OpenAPI uploader (create_media→COS→add_knowledge)
    ├── ima_upload.bat           # optional: Windows one-click batch import (double-click=SRC dir / drag=selected)
    ├── ima_watcher_bridge.bat   # optional: Windows double-click start HTTP bridge mode (--serve), waits for script push
    ├── ima_watcher_monitor.bat  # optional: Windows double-click start directory monitor mode (drop a folder on it to specify watch dir)
    ├── ima_config_sample.ini    # one-click import config template (copy to ima_config.ini then fill; ima_config.ini is gitignored)
    ├── requirements.txt         # Python toolchain dependencies (pip install -r tools/requirements.txt)
    └── ima_upload_notes.txt     # ima_upload.bat usage notes and version log (Chinese forbidden in .bat, so notes are separate)
```

### Export metadata (YAML frontmatter / Obsidian Properties)

Every exported file has **the same** YAML frontmatter block at the top, aligned with Obsidian Properties and Web Clipper article template spec, and widely recognized by Jekyll/Hugo/VuePress static site generators:

| Field         | Source                                                                                  | Format |
| ------------- | --------------------------------------------------------------------------------------- | ------ |
| `title`       | `resolveTitle()` title (auto-quoted if contains special chars)                          | text   |
| `source`      | Conversation URL `location.href` (must quote)                                           | quoted URL |
| `author`      | Current AI vendor `SITE.name` (e.g. `DeepSeek` / `Doubao`)                              | text   |
| `created`     | Capture date                                                                            | `YYYY-MM-DD` |
| `description` | Auto-extract summary from body's first paragraph (≤200 chars, append `…` if exceeded)   | text (omit if no body) |
| `tags`        | Software name only (e.g. `ChatDigest`); vendor is carried by `author`, no duplication  | list (block `- item`) |

Spec: lowercase keys; `tags` must be a list, plain text without `#`; URL and values containing `:` `#` must be quoted; use `created` not `date` to avoid duplication; single frontmatter block, blank line after closure.

> `published` has no real publish time in AI conversation scenarios, so it's not written (modify to capture time if needed).

## Changelog

The full historical changelog (including each version of `chat2knowledge.user.js`, Python toolchain `ima_upload.py` / `ima_watcher.py` / `ima_upload.bat` versions and troubleshooting) is separately maintained in **[CHANGELOG.md](./CHANGELOG.md)**.
