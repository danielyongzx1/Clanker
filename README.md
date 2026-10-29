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

## Agent tools

With **Settings → File & code tools** on (the default), models get tools that work on a private workspace folder on the phone:

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

For formats with no built-in reader, the model is told to write a script that handles the file. Attached files are copied into the workspace. Files the agent writes show up as chips under its reply (tap to open, long-press to share), and in **Settings → Workspace files**.

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
- `src/lib/workspace.ts` – the sandboxed workspace folder the tools work in
- `modules/clanker-shell/` – native Android module that runs shell commands
- `src/store/` – zustand stores persisted to JSON files

Checks: `npx tsc --noEmit` and `npx expo lint`.
