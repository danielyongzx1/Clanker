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
- `src/lib/chat.ts` – send / stream / stop / regenerate / title generation
- `src/store/` – zustand stores persisted to JSON files

Checks: `npx tsc --noEmit` and `npx expo lint`.
