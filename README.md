# Agent View

A tiny LAN dashboard for monitoring local agents (Claude Code or anything else).
Agents POST events to one HTTP endpoint, the dashboard updates live over SSE,
and waiting agents flash + optionally beep / push a desktop notification.

## What you see

- **Active agents** grid — name, status (idle/working/waiting/offline), current task, last heartbeat, completed count, total tokens.
- **Needs-input flag** — agents marked `waiting` flash red and trigger a beep / browser notification. Click *mark resolved* once you've answered.
- **Recent completed tasks** table — timestamp, agent, task title, duration, tokens, result.

## Run

```powershell
cd C:\Users\eric\Documents\github\erichexter\agent-view
npm install
npm start
```

Default URL: `http://localhost:4317`. Bind to all LAN interfaces by default
(override with `HOST=127.0.0.1 npm start`). Set a different port with `PORT=...`.

Open the dashboard from any machine on your LAN: `http://<host-ip>:4317`.

## Try it

In another shell:

```powershell
node examples\demo-agent.mjs
# or run several with different ids:
$env:AV_ID="alpha"; $env:AV_NAME="Alpha"; node examples\demo-agent.mjs
```

## Wire your agents

Three drop-in entry points depending on what kind of agent you have:

### 1. Node SDK — `src/client.js`

For agents written in Node/Bun:

```js
import { AgentView } from 'agent-view';   // or '../src/client.js' if not installed

const av = new AgentView({
  id: 'my-agent', name: 'My Agent', tag: 'webapp:main',
  // url defaults to AV_URL env or http://localhost:4317
});

await av.register();

// Wrap any unit of work as a task — auto-reports start, complete, and errors.
await av.task('Build artifacts', async () => {
  await runBuild();
}, { detail: 'tar + push to s3' });

// Or do it manually with token counts:
await av.startTask({ title: 'Generate plan', detail: 'with claude-opus-4-7' });
av.addTokens({ in: 1200, out: 500 });
await av.completeTask({ result: 'ok', summary: '3 file edits' });

// Ask the user something and wait for them to click "resolve":
await av.ask('OK to drop legacy index?');

await av.goodbye();
```

Heartbeats + clean goodbye on SIGINT/SIGTERM are handled for you. Failed POSTs
never throw — dashboard reporting will not break your agent.

A full example is at [`examples/sdk-demo.mjs`](examples/sdk-demo.mjs).

### 2. Claude Code skill — `skills/agent-view/`

Copy `skills/agent-view/` into your Claude Code skills directory:

```powershell
# user-wide (applies in every project)
Copy-Item -Recurse skills\agent-view "$HOME\.claude\skills\agent-view"

# or project-only
Copy-Item -Recurse skills\agent-view .claude\skills\agent-view
```

The skill tells Claude when to call `register` / `task_start` / `task_complete`
/ `needs_input`, and includes `report.sh` + `report.ps1` so it can shell out
without assembling JSON by hand.

### 3. Drop-in prompt — `prompts/system-prompt.md`

For any other LLM/agent: paste [`prompts/system-prompt.md`](prompts/system-prompt.md)
into the system prompt. Replace the three `<<...>>` placeholders with a stable
id, display name, and tag.

### 4. Or the raw protocol

Everything is a single POST to `/api/events` with JSON. The only required fields
are `agentId` and `type`.

| `type`           | required body                                            | what it does                                          |
| ---------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| `register`       | `name?`, `status?`                                       | Adds the agent to the grid.                           |
| `heartbeat`      | -                                                        | Marks the agent still alive.                          |
| `task_start`     | `taskId?`, `title`, `detail?`                            | Sets the current task; agent becomes `working`.       |
| `task_update`    | `taskId?`, `title?`, `detail?`, `progress?`              | Updates the in-flight task card.                      |
| `task_complete`  | `taskId?`, `tokensIn?`, `tokensOut?`, `result?`, `summary?` | Moves task to history with duration + tokens.      |
| `needs_input`    | `prompt`, `url?`                                         | Flashes the card red, beeps, notifies.                |
| `input_resolved` | -                                                        | Clears the flag (the dashboard's button does this too). |
| `goodbye`        | -                                                        | Marks agent `offline`.                                |
| `log`            | `message`, `level?`                                      | Broadcasts a log line (not persisted).                |

### From the shell (CLI helper)

```powershell
node bin\agentv.mjs hello --id alpha --name "Alpha"
node bin\agentv.mjs start --id alpha --task "Refactor auth" --detail "splitting token check"
node bin\agentv.mjs update --id alpha --detail "tests green"
node bin\agentv.mjs ask --id alpha --prompt "OK to drop legacy index?"
node bin\agentv.mjs done --id alpha --tokens-in 1842 --tokens-out 905 --result ok
```

### From a Claude Code hook

Drop something like this in `.claude/settings.json` to mark "needs input" when
Claude is about to ask for permission, and clear it when it stops:

```json
{
  "hooks": {
    "Notification": [
      { "matcher": "*", "hooks": [{ "type": "command",
        "command": "node C:/path/to/agent-view/bin/agentv.mjs ask --id $CLAUDE_PROJECT_DIR --prompt \"Claude needs input\"" }] }
    ],
    "Stop": [
      { "matcher": "*", "hooks": [{ "type": "command",
        "command": "node C:/path/to/agent-view/bin/agentv.mjs resolved --id $CLAUDE_PROJECT_DIR" }] }
    ]
  }
}
```

#### Auto-heartbeat after every tool call

Without something pinging the dashboard, an idle Claude session goes `stalled`
(red glow) after ~60s. The cleanest fix is a `PostToolUse` hook that ticks a
heartbeat on every tool call.

Split the config across two files so multiple agents on the same machine don't
overwrite each other:

**User-level (`~/.claude/settings.json`)** — identical for every agent on this
machine. Contains the hook and the dashboard URL only:

```json
{
  "env": {
    "AV_URL": "http://localhost:4317"
  },
  "hooks": {
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "if ($env:AV_ID) { & powershell -NoProfile -File \"$env:USERPROFILE\\.claude\\skills\\agent-view\\report.ps1\" heartbeat -Id $env:AV_ID 2>$null }",
            "shell": "powershell"
          }
        ]
      }
    ]
  }
}
```

On macOS / Linux, the hook command becomes:

```
"[ -n \"$AV_ID\" ] && \"$HOME/.claude/skills/agent-view/report.sh\" heartbeat --id \"$AV_ID\" >/dev/null 2>&1 || true"
```

**Repo-level (`<repo>/.claude/settings.local.json`)** — unique per agent. This
file is gitignored by default, so it's the right home for per-clone identity:

```json
{
  "env": {
    "AV_ID":   "cc-my-session",
    "AV_NAME": "My Session",
    "AV_TAG":  "myrepo:main"
  }
}
```

Claude Code merges repo-level over user-level, so each session keeps its own
identity. Without this split, every agent that opens
`~/.claude/settings.json` will overwrite the previous one's `AV_ID` and they'll
all stomp each other on the dashboard.

Notes:
- Pick a unique `AV_ID` per agent (`cc-frontend`, `cc-api`, `cc-platform`, …) so
  each agent gets its own card on the dashboard.
- `AV_NAME` and `AV_TAG` are picked up automatically by `report.ps1` /
  `report.sh` when `-Name` / `--name` aren't passed. Every heartbeat then
  refreshes the friendly name on the board — no separate `register` call
  needed.
- `AV_URL` defaults to `http://localhost:4317`; set it explicitly if the
  dashboard lives on another host.
- The hook silently no-ops if `AV_ID` is unset, so the user-level config is
  safe to ship to agents that aren't being monitored.
- Settings reload live — no Claude restart needed once both files are in
  place. The dashboard updates on the next tool call.

### From any HTTP client

```powershell
curl -X POST http://localhost:4317/api/events `
  -H "Content-Type: application/json" `
  -d '{"agentId":"alpha","type":"needs_input","prompt":"Should I rebase onto main?"}'
```

## API

- `GET  /api/snapshot` — current agents + recent history.
- `GET  /api/agents` — agents list.
- `GET  /api/tasks?limit=100&agentId=X` — completed tasks.
- `GET  /api/stream` — Server-Sent Events stream (the dashboard uses this).
- `POST /api/events` — single ingest endpoint (see above).
- `POST /api/agents/:id/resolve` — clear the needs-input flag.
- `DELETE /api/agents/:id` — forget an agent.

## Storage

Everything is files under `./data/`:
- `agents.json` — current agents.
- `tasks.jsonl` — completed-task log (capped to the last 500 in memory).

Delete the folder to reset.

## Notes

- Designed for trusted LAN use. There's no auth; don't expose to the internet.
- The dashboard reconnects automatically and refreshes "x ago" labels every 15s.
- Browser notifications require clicking the toggle once (per-origin permission prompt).
