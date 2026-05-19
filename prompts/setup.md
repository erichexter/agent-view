# agent-view setup — for a main/orchestrator agent

You are being asked to install the **agent-view** dashboard on this machine and
verify it's running. agent-view is a small Node web app that listens on
`http://localhost:4317`. Other agents will POST progress events to it so the
user can monitor everything from one screen.

Work through these steps in order. Skip a step only if its check already
passes. Stop and report to the user if a step fails after a single retry.

## 0. Prerequisites

- **Node.js ≥ 20** must be on PATH. Verify with `node --version`. If missing or
  too old, stop and tell the user to install Node 20+.
- **git** must be on PATH. Verify with `git --version`.
- The user's home directory must be writable.

## 1. Clone (or locate) the repo

The canonical repo is `https://github.com/erichexter/agent-view`.

- If a directory named `agent-view` already exists in the user's usual code
  workspace (ask if unclear; common spots: `~/code`, `~/Documents/github`,
  `~/src`), `cd` into it and skip to step 2.
- Otherwise clone it into the user's usual workspace:
  ```
  git clone https://github.com/erichexter/agent-view.git
  cd agent-view
  ```

## 2. Install dependencies

```
npm install
```

This should complete in under a minute and have zero vulnerabilities. If
`npm install` fails, retry once, then report the error to the user.

## 3. Start the server

agent-view binds to `0.0.0.0:4317` by default so other machines on the LAN can
reach it. If the user wants localhost-only, set `HOST=127.0.0.1`.

Check first whether it's already running:

```
curl -sf http://localhost:4317/api/health
```

If you get `{"ok":true,...}`, skip ahead to step 4.

Otherwise start it as a **detached background process** so it survives after
your turn ends:

- **Windows (PowerShell):**
  ```powershell
  Start-Process -FilePath "node" -ArgumentList "src/server.js" `
    -WindowStyle Hidden -PassThru | ForEach-Object { $_.Id } | Out-File .av.pid
  ```
- **macOS / Linux:**
  ```bash
  nohup node src/server.js > .av.log 2>&1 &
  echo $! > .av.pid
  ```

Then wait a couple seconds and re-check `curl -sf http://localhost:4317/api/health`.

Tell the user how to stop it:
- Windows: `Stop-Process -Id (Get-Content .av.pid)`
- Unix:    `kill $(cat .av.pid)`

If the user wants the dashboard to start on boot, that's a follow-up they can
ask about — don't set up Task Scheduler / systemd / launchd without being
asked.

## 4. Install the Claude Code skill (only if Claude Code is being used)

Copy the `skills/agent-view/` directory into the user's Claude Code skills
folder so every Claude Code session can pick it up automatically:

- **Windows:**
  ```powershell
  $dest = "$HOME\.claude\skills\agent-view"
  if (-not (Test-Path $dest)) {
    Copy-Item -Recurse skills\agent-view $dest
  }
  ```
- **macOS / Linux:**
  ```bash
  dest="$HOME/.claude/skills/agent-view"
  [ -d "$dest" ] || cp -R skills/agent-view "$dest"
  ```

If the directory already exists, ask the user whether to overwrite (don't
silently clobber a customized skill).

## 5. Smoke-test with a fake event

Confirm the full path works by posting one event and checking it appears:

```
curl -sf -X POST http://localhost:4317/api/events \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"setup-check","name":"setup-check","type":"register"}'
curl -sf http://localhost:4317/api/agents
```

The response should include the `setup-check` agent. Then clean it up:

```
curl -sf -X DELETE http://localhost:4317/api/agents/setup-check
```

## 6. Report back to the user

Give the user exactly these three pieces of information:

1. **Dashboard URL** (open in browser):
   - From this machine:   `http://localhost:4317`
   - From the LAN:        `http://<this-machine's-IP>:4317`
     (find it with `ipconfig` on Windows or `ifconfig`/`ip addr` on Unix)

2. **Where the skill was installed** (or "not installed; Claude Code not in use").

3. **The agent-prompt URL** they should give to any agent they want to appear
   on the dashboard:
   ```
   https://raw.githubusercontent.com/erichexter/agent-view/main/prompts/agent.md
   ```
   Each agent needs to be told a stable `agentId`, `name`, and `tag` when
   following that prompt.

Done. Do not invent extra steps or "improvements" beyond what's above unless
the user asks. agent-view is intentionally small.
