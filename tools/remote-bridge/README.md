# Clanker remote bridge

Runs beside **Hermes Agent** or **DeepSeek Harness** and exposes a common API for Clanker's mobile chat interface. The agent executes its own tools on that device. The bridge transfers actual files, retains run receipts, and serves immutable versions of generated or edited files.

Use one bridge process, port, state directory and workspace root per backend. Node **24.9 or newer** is required. Copy this directory to the remote device; the Expo app and its dependencies are not needed there.

## Install

```sh
cd tools/remote-bridge
npm ci
```

If you copied only this directory, run these commands from that copied directory instead. Copy `bridge.config.example.json` to `bridge.config.json`:

```json
{
  "kind": "hermes",
  "host": "0.0.0.0",
  "port": 8787,
  "upstreamUrl": "http://127.0.0.1:8642",
  "workspaceRoot": "./workspaces",
  "stateDir": "./.clanker-bridge"
}
```

Paths resolve against the bridge process's working directory. Keep that directory consistent across restarts, or use absolute paths. The bridge refuses to reuse saved state with a different upstream address or workspace root. Run only one process against a state directory.

Generate a random bridge token once. Keep it in your password manager and reuse it on subsequent starts; changing it requires updating the token on the phone.

PowerShell:

```powershell
$env:BRIDGE_TOKEN = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
Set-Clipboard $env:BRIDGE_TOKEN
```

POSIX shell:

```sh
export BRIDGE_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
```

Enter this value in Clanker's **Bridge token** field. Do not use the agent's upstream key in the phone app. Environment variables below are examples to replace with your own values; credentials are not written to bridge configuration or state.

## Hermes setup

1. Configure Hermes's model provider and tools using its normal setup. File reading/editing tools must be enabled, and any libraries needed for the requested documents must be installed on the agent device.
2. In the Hermes profile's `~/.hermes/.env`, set:

   ```dotenv
   API_SERVER_ENABLED=true
   API_SERVER_HOST=127.0.0.1
   API_SERVER_PORT=8642
   API_SERVER_KEY=replace-with-a-separate-strong-upstream-key
   ```

3. Start Hermes in another terminal:

   ```sh
   hermes gateway
   ```

4. Keep `kind` as `hermes` and `upstreamUrl` as `http://127.0.0.1:8642`. Supply that same upstream key to the bridge and start it:

   PowerShell:

   ```powershell
   $env:HERMES_API_KEY = 'your-Hermes-API_SERVER_KEY'
   npm start
   ```

   POSIX shell:

   ```sh
   export HERMES_API_KEY='your-Hermes-API_SERVER_KEY'
   npm start
   ```

The bridge uses authenticated session and Runs APIs, including event replay, approvals, clarification and cancellation. Connection testing verifies the required API features. Use a current Hermes release supporting these endpoints; older servers return an upgrade/setup error. The model list combines the compatibility aliases with the full authenticated provider catalogue from `/api/model/options`. Routes appear as `provider/model`; the exact provider and model are forwarded together, so models with the same name on two providers remain distinct. Existing `hermes-agent` chats keep the default alias. Select other models before a new chat's first message, using its header picker or the backend editor.

Hermes's API does not upload document files. The bridge writes them to a chat-specific directory and gives Hermes absolute paths in its session instructions and prompts. **Hermes's file and terminal tools must see those paths.** A local terminal backend on the same machine works directly. If using containers, mount the workspace root into both services at the same absolute path. An SSH/container tool backend with a different filesystem is not automatically synchronized or remapped.

File transfer and model selection need no Hermes source changes. Hermes 0.22.5's Runs endpoint omits its live reasoning callback even though the agent produces reasoning. For that revision, the included compatibility tool forwards those emitted deltas without changing admission, tools or permissions:

```powershell
python compat/hermes_runs_reasoning.py "$env:HERMES_HOME/hermes-agent/gateway/platforms/api_server_runs.py" --check
python compat/hermes_runs_reasoning.py "$env:HERMES_HOME/hermes-agent/gateway/platforms/api_server_runs.py" --apply
hermes gateway restart
```

Run the restart when the gateway is idle. The installer first preserves a timestamped backup, validates the new Python syntax, is safe to rerun, and refuses unknown callback layouts. A Hermes update can replace this fix; recheck afterward. Restore the printed backup if needed, then restart the idle gateway. Only reasoning actually emitted by the selected model is shown; the bridge does not invent or infer thoughts. [Official API documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/).

### Reasoning effort and usage meters

Update/restart the bridge after copying new bridge code, then reload Clanker. Backend capabilities refresh when opening a remote chat; **Settings → Backends → Test connection → Save** also refreshes them. The composer exposes Hermes's effort vocabulary for models with reasoning enabled in its catalogue. Hermes can clamp effort for known providers; custom serving APIs can reject unsupported levels, and some models only toggle thinking. Models marked as unable to disable reasoning omit the **No thinking** stop. Existing chats keep their model and have their own effort selection. Each turn and queued follow-up captures its effort before network submission; changing the slider cannot change an accepted or uncertain turn.

If a serving API accepts fewer levels than Hermes advertises, set their exact names per route in `bridge.config.json`. For example, this Qwen deployment accepts `low`, `medium` and `xhigh`:

```json
"modelEfforts": {
  "llama-swap/qwen3.8-flash-next-mxfp4": ["low", "medium", "xhigh"]
}
```

Add this property alongside `kind`/`upstreamUrl`, restart the idle bridge, and reopen the chat. The `hermes-agent` default alias inherits the active configured model's levels. An empty array hides the effort control. The bridge rejects unsupported configured levels before submitting a turn. It never retries an agent turn with another effort following a provider error.

Hermes 0.22.5 exposes its native context meter, rolling tokens/second and session cache counters internally, but omits these from Runs. Enable the additional metrics projection:

```powershell
python compat/hermes_runs_metrics.py "$env:HERMES_HOME/hermes-agent/gateway/platforms/api_server_runs.py" --check
python compat/hermes_runs_metrics.py "$env:HERMES_HOME/hermes-agent/gateway/platforms/api_server_runs.py" --apply
hermes gateway restart
```

On POSIX, pass the actual checkout path containing `gateway/platforms/api_server_runs.py` (often `~/.hermes/hermes-agent/gateway/platforms/api_server_runs.py`). As with the reasoning fix, apply to an idle gateway, retain the printed backup, and recheck after Hermes upgrades. The script refuses unknown layouts and never changes turn admission, model execution or permissions. It forwards only the native status-bar projection, including periodic updates during Runs and final pollable metrics.

The context meter uses the backend's current occupancy and configured context window, including its system/tools, with an estimate marker when Hermes reports an estimate. Cumulative prompt tokens across tool steps are **never** treated as context occupancy. Remote history/compression stays under Hermes's control. Reply speed is Hermes's native rolling throughput (API latency can include prefill); cache hit is its session cache-read/prompt ratio. These may differ from a provider's pure decode benchmark. The app's **Context usage**, **Decode speed** and **Cache hits** settings control visibility. Missing measurements remain hidden; they are not manufactured from reply length or zero-filled. Native Hermes cache counters reporting zero display **0% cached**. Saved replies keep their reported measurements; older replies are not backfilled.

## DeepSeek Harness setup

This bridge pins the generated client contracts to **0.2.1-rc.5**. Use the matching Harness release:

```sh
npx @deepseek-ai/dsh@0.2.1-rc.5 web --no-open
```

Configure its model provider through its usual Web UI first. Keep Harness running. Its startup prints an application URL containing `?token=...`; provide the **token value** to the bridge. Change `bridge.config.json` to:

```json
{
  "kind": "harness",
  "host": "0.0.0.0",
  "port": 8787,
  "upstreamUrl": "http://127.0.0.1:3080",
  "workspaceRoot": "./workspaces",
  "stateDir": "./.clanker-bridge"
}
```

PowerShell:

```powershell
$env:HARNESS_LAUNCH_TOKEN = 'token-from-the-Harness-launch-URL'
npm start
```

POSIX shell:

```sh
export HARNESS_LAUNCH_TOKEN='token-from-the-Harness-launch-URL'
npm start
```

The bridge pairs through `/connect`, keeps the returned API cookie on the host, and uses the published Node Connection/Gateway clients and generated session contracts. HTTP and WebSocket requests share that authenticated peer. New chats become Harness sessions with the chat directory as their working directory. Models appear as `provider/model`.

Harness launch tokens change when Harness restarts. Update `HARNESS_LAUNCH_TOKEN` and restart the bridge after restarting Harness. Keep the bridge's state directory and token. Run the bridge in the same environment/filesystem as Harness, such as the same WSL distribution or shared container mount. Different Harness contracts can require a bridge update; failures identify the supported release rather than falling back to a raw model API.

No Harness source changes or external bind changes are required. [Official connection documentation](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/connection/README.md).

### Harness effort and usage meters

#### Using the official desktop app

The official Harness Desktop **0.2.1-rc.5** can serve the same authenticated API. It uses a random loopback port rather than Web's default `3080`.

**New Desktop installations:** use the standalone MIT-licensed [dsh-clanker-bridge](https://github.com/danielyongzx1/dsh-clanker-bridge). In Harness's **Plugins → Add plugin**, install `github:danielyongzx1/dsh-clanker-bridge`, then fully quit/reopen Desktop if requested. It bundles the bridge and uses Harness's runtime; no Clanker checkout, separate Node installation or copied host token is required. Open `%USERPROFILE%\.dsh\integrations\clanker-bridge\desktop\pairing.html` on the PC for its locally generated bridge token and LAN addresses (`DSH_HOME` or a custom data directory changes that location). Follow its README to pair Clanker. The prebuilt release is also installable directly. The dshmarket catalog submission is prepared separately; publication of this repository does not mean the listing has been accepted.

**Existing checkout-based installations:** the following development plugin keeps the current bridge token, identity, session mappings and workspace. Publishing the standalone plugin does not replace or disable it. Installing the standalone plugin with fresh defaults creates a separate backend identity; do not run both on port `8788`, or assume it imports existing chats. Keep your current installation until you migrate its token, state and workspace together.

On Windows, first complete the manual pairing below and save the current `BRIDGE_TOKEN` and `HARNESS_LAUNCH_TOKEN` in `.env.harness`. Keep Desktop open and let Clanker's active remote turns finish. From the bridge directory, run:

```powershell
npm.cmd run desktop:install
```

The installer uses the running Desktop's own published plugin manager and generated contract. It packages `desktop-plugin`, installs the local bundle with its exact supported runtime range, and preserves the bridge token, identity, saved session mappings and workspace. It never uses a compatibility exemption. If Desktop reports `restart-required`, fully quit through its tray menu and reopen with your normal shortcut once. No console launch is needed afterward.

On each launch, the plugin obtains the current origin and token through Harness's own `webServer` and `connection.authenticatedUrl` services. It writes them atomically to a local discovery file, starts the Node bridge with a hidden console, and restarts its child if it exits. Quit stops its child; closing the window keeps both Desktop and the bridge running. An occupied bridge port is left alone rather than taking over another process.

The bridge binds discovery to the configured Desktop profile identity, so fresh ports and tokens do not retarget an existing chat. It refreshes its authenticated client and model catalogue after a new Desktop generation. Missing discovery reports **Open Harness Desktop**; there is no fallback to stale credentials or a guessed port. The phone keeps the same address (for example port `8788`) and bridge token. The plugin publishes no token to the phone or logs.

Keep the bridge directory, its Node installation and `desktop-plugin/local.config.json` paths available. Moving them requires reinstalling/updating the plugin. Desktop versions other than `0.2.1-rc.5` need a compatible plugin/bridge update. Disable or remove **clanker-harness-desktop-bridge** in Desktop's Plugins page to undo automatic startup. For manual operation afterward, restore the enrollment configuration backup and enter current host credentials. [Plugin installation](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/plugin-manager/README.md).

For initial manual pairing, when its tasks are finished, fully quit through the Windows tray's **Quit DeepSeek Harness** command, then launch it from PowerShell to capture its startup URL:

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\DeepSeek Harness.exe" | Out-Host
```

Closing the window hides the app; launching another instance while it is running reactivates the existing one without printing a new startup URL. In the `dsh web: http://127.0.0.1:PORT/?token=...` line, use the actual origin as `upstreamUrl` and the token value as `HARNESS_LAUNCH_TOKEN`. Never assume Desktop uses `3080`. The bridge can print its listening message before authenticating upstream; **Test connection** verifies the actual host connection and model catalogue.

Desktop restarts change the port and token. Automatic mode handles this through the profile-bound discovery file. Manual mode keeps its original upstream-address binding; configure a fixed Desktop port before creating chats or use the Web launch for a stable address. [Desktop lifecycle](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md#closing-the-window-and-quitting).

When running beside Hermes, use a separate Harness configuration, port (for example `8788`), workspace root and state directory. If you save host credentials in `.env.harness`, the Node startup command explicitly loads that file:

```powershell
node --env-file=.env.harness .\src\main.mjs .\bridge.harness.json
```

That file and the local Harness configuration/state/workspaces are ignored by Git. Keep the bridge token unchanged when restarting. Existing shell environment variables override values in the environment file.

#### Hermes automatic startup on Windows

Hermes's configured `API_SERVER_KEY` and API port persist across gateway restarts. It does not need Harness's per-launch discovery. Keep its existing gateway service/login task enabled. To start the companion bridge at Windows sign-in, save its existing `BRIDGE_TOKEN` in the bridge's `.env`, set `HERMES_HOME` to the active Hermes profile, and run:

```powershell
npm.cmd run hermes:autostart
```

This installs a per-user **Clanker Hermes Bridge** shortcut in the Windows Startup folder. The hidden helper reads `API_SERVER_KEY` from the configured Hermes profile's `.env` and the bridge token from its own `.env`; it does not copy upstream credentials into Clanker. It waits if the bridge port is already occupied, retries a child that exits, and works regardless of whether the gateway or bridge starts first. Hermes's own gateway/service startup is unchanged.

Remove the Startup shortcut to undo sign-in startup. Stop its running `src/run-hermes.mjs` helper as well when disabling it for the current login. The configured paths are in the ignored `hermes-startup.json`. Logs remain under the existing bridge state directory. A Windows sign-in is not required to test the shortcut; opening it runs the same helper.

#### Controls and measurements

Copy the updated bridge to the Harness device, run `npm ci`, and restart the idle bridge with its existing configuration, bridge token, and state directory. Reload Clanker and reopen the Harness chat (or use **Test connection → Save** in the backend editor). No Hermes compatibility scripts apply to Harness. Use the documented **0.2.1-rc.5** Harness release and Node **24.9+**; an older global `dsh` command is not a substitute for the pinned startup command above.

The bridge reads each model's selectable reasoning efforts and default from `session.modelCatalog()`. The slider appears only for models advertising effort choices. Before each prompt, the bridge applies the captured selection using `session.selectModel({ provider, model, reasoningEffort })`. Submitted and queued messages keep their own effort through reconnects; another chat's settings cannot change them.

Enable **Context meter**, **Decode speed**, and **Cache hits** in Clanker's Settings. New replies expose the measurements available from Harness:

- **Context:** the host's `contextPressure` projection and model context window, including compression and surface edits. `projectedTokens` is shown as an estimate; reported prompt pressure is used when no projection estimate is present. With a custom composition lacking `dsh-token-meter`, the bridge can use the latest reported prompt and `request/context` capacity when both are available. It never uses lifetime token totals as occupancy.
- **Speed:** reported output tokens divided by the recorded interval from the first generated text/reasoning/tool-call chunk to the end of that model stream, weighted across the reply's timed attempts. Tool execution and prefill before the first token are excluded. Untimed output is omitted from this rate.
- **Cache:** cache-read tokens divided by the full prompt count for the reply's attempts with known cache accounting. Harness's uncached input, cache reads, and cache writes are separate buckets; the bridge includes all input in the denominator. Missing cache accounting stays hidden; a reported zero displays **0% cached**.

Durable event sequence identities replace repeated usage samples, so replaying the journal cannot count a model response twice. The bridge retains the final metrics, and Clanker saves them with the reply and chat. No token estimates based on reply character counts are substituted for missing speed/cache measurements. [Session API](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/api/session-controller/README.md), [token-meter semantics](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/token-meter/README.md).

## Connect the phone

1. Allow the bridge port through the host firewall for your LAN/private VPN. Keep upstream agent ports on localhost.
2. In Clanker, open **Settings → Backends → Add remote backend**.
3. Enter a name, the bridge address (for example `http://192.168.1.10:8787`) and bridge token. A phone's `localhost` refers to the phone.
4. Tap **Test connection**, select a model, and **Save**.
5. Open a new chat and tap **Choose backend** before sending the first message. The chat's backend and model provider are locked after it starts; from the chat title it can still switch to another model from the same provider, from the next message on. In the backend editor, tap a model's eye to hide it from the model picker.

In the backend editor, use **Add alternative address** to save LAN, VPN and HTTPS addresses for this same bridge. All addresses use the same bridge token and must return the same bridge identity. The app selects a reachable authenticated address and rechecks when the network changes. It can safely retry uploads and submissions under their existing receipt identities; approvals are not automatically repeated after uncertain delivery. Save alternatives before leaving the LAN. An alternative address must already route to the bridge through your VPN or HTTPS access setup; saving a URL does not establish that route.

Use HTTPS for internet connections, through your own TLS reverse proxy or private access service. Preserve the API path and allow streaming responses. `0.0.0.0` is a listen address, not an address to enter on the phone. Multiple backend devices work independently; two agents on one device need different bridge ports and state/workspace directories.

## Files, retention and recovery

- Uploads preserve actual document bytes, including text documents. Photos retain Clanker's normal image resizing behavior. Files are limited to **20 MB** each. Oversized host files are not offered for transfer.
- Each chat gets a separate host directory. These directories organize work; they **do not sandbox the remote agent's tools**.
- Before a turn, attachments upload atomically. After it finishes, new and changed workspace files appear below the reply. **Remote files** lists the current workspace. Tap a file to download, preview or share it.
- Downloaded versions have their own local cache. The bridge also keeps content-addressed versions, so a later host edit does not change a file attached to an earlier reply.
- Remote agents own history, compression and memory. Clanker's phone tools, helper requests and temporary-chat guarantees do not apply. Project instructions are captured when the remote chat starts; local project files are not automatically uploaded. Attach files explicitly.
- Follow-ups queue until the current turn completes. Stop requests cancellation on the host and remains pending until confirmed. Regeneration is unavailable because it could repeat agent actions.
- Reconnect uses persisted run receipts and upstream event cursors. An uncertain acceptance is never automatically resubmitted. If the app shows **unknown execution**, inspect/stop the task on the host, then use **I stopped this task on the host**. This acknowledges interruption and unlocks the chat without repeating the turn.
- Deleting a chat clears its local history and downloaded files. Removing a connection clears its phone credential. **Neither deletes host sessions, workspaces or bridge objects.** Restoring the same bridge connection recovers its saved chats. Clean up retained data explicitly on the host when it is no longer needed; stop the bridge before deleting its state or object files.
- Back up `stateDir` and `workspaceRoot` together. Losing bridge state changes its identity; the app refuses to bind existing chats to a replacement server. Do not reuse an old state directory for another agent.

## API and development

Every endpoint requires `Authorization: Bearer <bridge token>`. After pairing, the app also sends `X-Clanker-Bridge` with the saved bridge identity.

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/capabilities` | Protocol version, stable identity, kind, models, per-model effort choices/defaults and file limit |
| `POST /v1/sessions` | Idempotent creation by Clanker chat ID |
| `PUT /v1/sessions/:id/files/:uploadId?name=...` | Binary upload; upload IDs are immutable retry identities |
| `GET /v1/sessions/:id/files` | Current transferable files |
| `GET /v1/sessions/:id/files/:fileId?version=...` | Immutable binary download |
| `POST /v1/sessions/:id/runs` | Reserve a turn using its persisted submission ID |
| `GET /v1/runs/:id` | Full snapshot with cursor, content, controls, artifacts and reported metrics |
| `GET /v1/runs/:id/events` | SSE snapshots of the same run |
| `POST /v1/runs/:id/stop` | Request upstream cancellation |
| `POST /v1/sessions/:id/submissions/:submissionId/stop` | Cancel a submission, including one still uploading |
| `POST /v1/runs/:id/controls` | Answer an exact current approval/clarification |
| `POST /v1/runs/:id/acknowledge` | Acknowledge an unknown execution after host inspection |

The mobile client polls snapshots every 750 ms while active, replacing content by cursor instead of appending replayed tokens. The host consumes upstream streams. Reopening the chat or foregrounding the app resumes reconciliation; the server continues execution when the phone disconnects.

Harness also refreshes its durable follow snapshot every five seconds while a run is active. This recovers a completion or tool event missed by the live stream without repeating the prompt. Bridge state replacement retries transient Windows sharing violations while preserving the previous complete state.

```sh
npm run check
npm test
python -m unittest discover -s compat -p 'test_*.py'
```

Tests use local HTTP/WebSocket fixtures and the actual published Harness client packages. They do not launch an agent, execute remote commands, or incur model charges. From the app repository root, `npm run test:remote` checks actual app store migration, backend locking and queue routing. Run root `npm run typecheck` and `npm run lint` as well.

For a live smoke test, upload a small spreadsheet, ask the agent to edit it and save a copy, then download/open the result. Continue the chat after reconnecting and test Stop during a longer request. A passing fixture suite does not establish that a particular host's tools, document libraries, filesystem mounts or phone networking are configured correctly.
