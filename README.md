# Clanker

A ChatGPT-style chat app for iOS and Android (Expo + React Native) that talks to **your own endpoints**.

Supported API formats:

| Format | Example base URL |
| --- | --- |
| OpenAI-compatible | `https://api.openai.com/v1`, `https://openrouter.ai/api/v1`, `http://192.168.1.10:1234/v1` (LM Studio) |
| Anthropic Messages | `https://api.anthropic.com` |
| Ollama | `http://192.168.1.10:11434` |
| Google Gemini | `https://generativelanguage.googleapis.com` |

Features: streaming replies with stop/regenerate, markdown with syntax-highlighted code blocks, image attachments for vision models, chat history drawer with search/rename/delete, model picker across all endpoints, auto-generated titles, light/dark/system theme. API keys live in the device keychain (`expo-secure-store`); chats and images are stored as files in the app's document directory.

## Remote agent backends

**Settings → Backends** adds named **Hermes Agent** and **DeepSeek Harness** connections alongside Clanker's built-in agent. Choose the backend on an empty chat before the first message; existing chats keep their backend and remote model. Each remote chat creates and resumes its own session rather than attaching to sessions created in another application.

Remote chats support streamed replies, tool progress, approvals/clarifications, Stop, actual file uploads and downloading files the agent creates or edits. Tools run on the remote device. Follow-ups queue; regeneration is disabled to avoid repeating remote actions. The remote agent owns its memory and history; Clanker's automatic titles, suggested prompts, memory extraction and temporary-chat mode do not apply.

Install the included [companion bridge](tools/remote-bridge/README.md) on each agent device. Hermes needs its API server enabled and an upstream key. Harness needs the matching `0.2.1-rc.5` release, its local web server and launch token. Both agents must see the bridge's workspace directory. The linked guide includes exact Windows/POSIX setup commands, networking, retention and recovery instructions, plus a backed-up compatibility fix for Hermes versions whose Runs endpoint omits streamed reasoning.

Hermes models include its authenticated provider catalogue, displayed as `provider/model`, with a searchable picker on empty remote chats. In **Settings → Backends**, use **Test connection** and **Save** to refresh an existing model list. Add alternative addresses there for the same bridge's LAN, VPN or HTTPS routes; the app verifies bridge identity before changing addresses and keeps the same remote session.

Hermes and Harness chats also use the composer's effort slider and context meter, and the usual reply tokens/second and cache-hit display settings. Effort is saved per chat and frozen for submitted/queued messages. Harness supplies its exact model-specific effort choices and default; Hermes providers may clamp levels or need the bridge's per-model constraints. The bridge guide includes the Hermes 0.22.5 compatibility update needed for its native usage statistics. Harness uses its existing APIs without a source patch. Metrics appear when the backend reports them; older replies are not backfilled. Remote agents manage compression. Harness speed/cache figures cover the reply's reported model attempts; Hermes uses its native rolling/session counters.

For a new Harness Desktop device, install the standalone MIT-licensed [dsh-clanker-bridge plugin](https://github.com/DANIE4588E/dsh-clanker-bridge). It includes the bridge, generates pairing credentials locally, and follows Desktop's changing port/token through the normal shortcut; no Clanker checkout or separate Node installation is required. Existing checkout-based plugin installations remain supported and are not migrated automatically. A Windows sign-in helper can start the Hermes bridge using its persistent API key. See the bridge guide for installation and removal commands. Harness periodically reconciles saved journal data so a missed completion event cannot leave a finished turn streaming indefinitely.

Documents preserve their original bytes; photos use the existing resize behavior. Transfers are limited to 20 MB per file. Remote files have a separate versioned phone cache. Deleting a chat removes its local cache but leaves host files and sessions in place for explicit host cleanup. Project instructions are captured at chat creation; attach project files explicitly.

Checks: root `npm run test:remote`, `npm run typecheck`, `npm run lint`; bridge `npm run check` and `npm test` from `tools/remote-bridge`.

**Suggested prompts.** New chats show four conversation starters based on recent chats. **Settings → Chats → Suggested prompts** turns them off, hides cached suggestions and cancels any request in progress. When enabled, the app makes at most one generation attempt every 24 hours across all models and projects, including failed or cancelled requests. The allowance and results are saved across restarts; changing models, opening new chats or turning suggestions off and on cannot bypass the limit. Once eligible, an open empty chat or returning to one can trigger a refresh. A request already started continues when you leave the empty chat so its result can be cached.

The selected model receives titles and up to three short text excerpts from each of the five most recent eligible chats, excluding temporary and archived chats, attachments, tool output and thinking. Project chats draw from that project's chats; general chats exclude projects with project-only memory. With memory off or in a temporary chat, suggestions use no history. Cached results stay separate for each project and history setting: a context without its own cache stays empty until the app-wide allowance is available. Cached results are hidden if a source chat is deleted, archived or moved outside that context. Each suggestion shows a short summary and a matching model-selected icon; tapping it puts the full prompt in the composer for editing. Generation is a separate, tool-free request with a 20-second timeout. If it fails, previous compatible suggestions remain available; another request waits for the daily allowance.

## Agent tools

With **Settings → File & code tools** on (the default), models get tools that work on a private workspace folder on the phone. Each chat has its own workspace; chats in a project share the project's (chats from before workspaces were per chat keep the one folder they all shared):

| Tool | What it does |
| --- | --- |
| `list_files`, `search_files` | List / glob the workspace, regex-search file contents |
| `read_file` | Text and code with line numbers; images (shown to the model); text from PDF, DOCX, XLSX, PPTX, ODT/ODS/ODP and EPUB |
| `write_file`, `edit_file`, `move_path`, `delete_path` | Create, edit, move, copy and delete files |
| `run_python` | Python 3 via Pyodide (WebAssembly). Imports install themselves: python-docx, openpyxl, python-pptx, pypdf, fpdf2, pandas, matplotlib, Pillow, ... |
| `run_javascript` | JS in a Web Worker with an `fs` API over the workspace; npm libraries via `import("https://esm.sh/...")` |
| `run_shell` | Android only: `/system/bin/sh` in the workspace (the phone's built-in utilities) |
| `job_output`, `job_kill` | Collect or stop background jobs (`background: true` on the three run tools) |
| `compress`, `decompress`, `search_context`, `context_status` | Let the model manage its own context window (below) |
| `memory_save`, `memory_update`, `memory_forget` | Remember facts about the user across chats (below) |
| `search_chats`, `read_chat` | Find and read the user's earlier chats |

`write_file` and `edit_file` refuse a file the model hasn't read in this chat, or one that changed since it did, so it can't overwrite something it hasn't seen.

Background jobs run in their own worker (or shell process) while the model keeps working; their status is listed in the system prompt on every step, and the tool row in the chat updates when they finish. They don't survive an app restart.

**Context.** Each user message and each step of a reply is tagged `[mN · ~size tokens]`. The model replaces ranges it is done with by its own summaries (`compress`). It can restore them (`decompress`, one level or fully) and search the full originals (`search_context`). The originals stay in the chat; only what is sent changes. The budget is set per model on the endpoint screen (tap a model's context budget and enter something like `128K`, `1M` or `32000`). Left on auto, it is 75% of the model's context window where the API reports it (OpenRouter, Groq, LM Studio, Gemini, Anthropic), 96K on other large-context hosted APIs, and otherwise 32K. Past 90% of it the app compresses the oldest history mechanically, and if a request still overflows it compresses harder and retries. The code is in [src/lib/context.ts](src/lib/context.ts).

**Memory.** Short facts about the user (at most 500 characters each, 12,000 in all) live in **Settings → Memory**, where they can be added, edited and deleted. Each chat freezes the memories it starts with into its system prompt, so prompts keep caching; later changes reach it through the `<context>` note. Models save memories with the memory tools, and after each reply a short extra request picks up anything worth remembering (this works without tool calling and can be turned off). With **Files & code** off, chats still see their memories but can't change them. The eye button on a new chat starts a temporary chat that neither uses nor saves memories, and that `search_chats` skips. The code is in [src/lib/memory.ts](src/lib/memory.ts) and [src/store/memory.ts](src/store/memory.ts).

**Projects.** **Projects** in the sidebar groups chats that should share a workspace. Long-press a project (or use its ⋮ menu) to start a chat in it, pin it to the sidebar, rename it, change its memory or edit its instructions. A project's page lists its chats, its sources (files you add for its chats to draw on, kept in `sources/` in its workspace) and the rest of its workspace. Typing in the composer at the bottom of the page starts a chat in the project. A project's chats open over its page, with a back button to it in place of the sidebar button. Long-press a chat (in the sidebar or a project) to pin, rename, archive or delete it, or to move it into, between or out of projects: a chat moving out of its own workspace takes all its files along, and one leaving a shared workspace takes copies of the files it used. Pinned chats and projects sit in a Pinned section at the top of the sidebar. Archived chats are hidden unless **Settings → Show archived chats** is on. Its instructions go into the system prompt of every chat in it. With **project-only memory** its chats see and save only the project's own memories, and `search_chats` / `read_chat` can't cross between the project and other chats in either direction. The code is in [src/lib/projects.ts](src/lib/projects.ts) and [src/store/projects.ts](src/store/projects.ts).

For formats with no built-in reader, the model is told to write a script that handles the file. Attached files are copied into the workspace. Files the agent writes show up as chips under its reply (tap to open, long-press to share), and in **Settings → Workspace files**, which lists every workspace.

The Python and JavaScript runtimes run in a hidden WebView and load Pyodide from jsDelivr on first use (cached afterwards). The shell is a local Expo module ([modules/clanker-shell](modules/clanker-shell)), so it needs a development build; it isn't in Expo Go, and iOS can't spawn processes at all.

## Run

```sh
npm install
npx expo start
```

Scan the QR code with Expo Go, then open **Settings → Add endpoint**.

For a local Ollama or LM Studio server, use your computer's LAN IP (not `localhost`) and make sure the server listens on all interfaces (`OLLAMA_HOST=0.0.0.0`). Plain-HTTP endpoints are allowed by the app config, which takes effect in development/production builds (`npx expo run:android` / `run:ios` or EAS).

## Layout

- `src/app/` – routes (chat screen in a drawer, settings stack)
- `src/components/` – UI (composer, message list, markdown/code rendering, sidebar, model picker)
- `src/lib/providers/` – one adapter per API format behind a shared `ProviderAdapter` interface
- `src/lib/chat.ts` – send / stream / stop / regenerate / title generation, and the tool-calling loop
- `src/lib/tools/` – agent tool definitions, document text extraction, read-before-write tracking, the agent system prompt
- `src/lib/context.ts` – history units, compression, and building the request history
- `src/lib/jobs.ts` – background jobs
- `src/lib/runtime/` – the Python/JavaScript WebView runtime and its bridge
- `src/lib/workspace.ts` – the sandboxed workspace folders the tools work in (one per chat or project)
- `src/lib/projects.ts` – which workspace and memory a chat uses, project sources, and the project part of the system prompt
- `modules/clanker-shell/` – native Android module that runs shell commands
- `src/store/` – zustand stores persisted to JSON files

Checks: `npx tsc --noEmit` and `npx expo lint`.
