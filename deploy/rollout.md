# agent-view: install/update on this machine

You are being asked to wire this Claude Code agent into the **agent-view** dashboard at **http://192.168.1.68:4317**, or to upgrade an existing wiring to the current version.

Be idempotent. If the hook is already correct, say so and stop. Otherwise, fix it.

## Goal — end state

1. `~/.claude/skills/agent-view/` contains the current `SKILL.md`, `report.ps1`, `report.sh` from `https://github.com/erichexter/agent-view` (path `skills/agent-view/`).
2. `~/.claude/settings.json` has a **PostToolUse** hook that calls `report.ps1` (Windows) or `report.sh` (Linux/macOS) with command `heartbeat`, **with NO `if ($env:AV_ID)` guard** — the script handles ID resolution itself.
3. `~/.claude/settings.json` env block sets `AV_URL=http://192.168.1.68:4317`.
4. **Do NOT** put `AV_ID`, `AV_NAME`, or `AV_TAG` in `~/.claude/settings.json` — those are session/project-scoped, never user-level. The script auto-generates a stable per-project ID and persists it to `<cwd>/.claude/.agent-view-id`.

## Steps

### 1. Pull the latest skill files

```bash
# Linux / macOS
mkdir -p ~/.claude/skills/agent-view
cd /tmp && rm -rf agent-view-tmp && git clone --depth 1 https://github.com/erichexter/agent-view agent-view-tmp
cp agent-view-tmp/skills/agent-view/SKILL.md  ~/.claude/skills/agent-view/
cp agent-view-tmp/skills/agent-view/report.ps1 ~/.claude/skills/agent-view/
cp agent-view-tmp/skills/agent-view/report.sh  ~/.claude/skills/agent-view/
chmod +x ~/.claude/skills/agent-view/report.sh
rm -rf agent-view-tmp
```

```powershell
# Windows
New-Item -ItemType Directory -Force -Path "$HOME\.claude\skills\agent-view" | Out-Null
$tmp = "$env:TEMP\agent-view-tmp"
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
git clone --depth 1 https://github.com/erichexter/agent-view $tmp
Copy-Item "$tmp\skills\agent-view\SKILL.md"  "$HOME\.claude\skills\agent-view\" -Force
Copy-Item "$tmp\skills\agent-view\report.ps1" "$HOME\.claude\skills\agent-view\" -Force
Copy-Item "$tmp\skills\agent-view\report.sh"  "$HOME\.claude\skills\agent-view\" -Force
Remove-Item -Recurse -Force $tmp
```

### 2. Patch `~/.claude/settings.json`

Read the file. Treat missing as `{}`. Then make these changes (and only these):

**a) Add or update the PostToolUse hook.**

Linux/macOS command:
```
bash ~/.claude/skills/agent-view/report.sh heartbeat 2>/dev/null
```

Windows command (PowerShell hook):
```
& powershell -NoProfile -File C:\Users\<user>\.claude\skills\agent-view\report.ps1 heartbeat 2>$null
```

Hook entry shape:
```json
{
  "hooks": {
    "PostToolUse": [
      { "hooks": [ { "type": "command", "command": "<command from above>", "shell": "bash" } ] }
    ]
  }
}
```
(use `"shell": "powershell"` on Windows)

If a PostToolUse entry for agent-view already exists but contains `if ($env:AV_ID)` or `if [ -n "$AV_ID" ]` — **replace it** with the new no-guard version. The old guard silently drops events when AV_ID isn't pre-set.

**b) Set `env.AV_URL`:**
```json
{ "env": { "AV_URL": "http://192.168.1.68:4317" } }
```

**c) Remove any of these keys from the user-level settings if present** (they're per-project, not user-level):
- `env.AV_ID`
- `env.AV_NAME`
- `env.AV_TAG`

Leave all other settings untouched.

### 3. Smoke test

```bash
# Linux/macOS
AV_URL=http://192.168.1.68:4317 bash ~/.claude/skills/agent-view/report.sh heartbeat && \
  cat .claude/.agent-view-id 2>/dev/null && echo " ← generated id"
curl -s http://192.168.1.68:4317/api/agents | grep -o "\"id\":\"$(cat .claude/.agent-view-id)\"" && echo "OK: visible on dashboard"
```

```powershell
# Windows
$env:AV_URL = "http://192.168.1.68:4317"
& powershell -NoProfile -File "$HOME\.claude\skills\agent-view\report.ps1" heartbeat
$id = (Get-Content "$HOME\.claude\.agent-view-id" -ErrorAction SilentlyContinue).Trim()
"id: $id"
(Invoke-RestMethod "http://192.168.1.68:4317/api/agents") | Where-Object { $_.id -eq $id } | Select id,status,lastSeen
```

### 4. (Optional) Pin a friendly name for this project

If this project should show a specific name/tag on the dashboard (instead of an auto-generated `cc-<cwd>-<hash>`), add to the project's `.claude/settings.json` (NOT user-level):

```json
{
  "env": {
    "AV_NAME": "MyProject",
    "AV_TAG": "repo:branch"
  }
}
```

The ID still auto-generates and persists to `<project>/.claude/.agent-view-id`.

## Report back

When done, post one line:
- What changed (e.g. "added PostToolUse hook + AV_URL"; "upgraded — removed AV_ID guard"; "already current, no changes")
- The auto-generated agent id from `<cwd>/.claude/.agent-view-id`
- Whether the smoke test showed the agent on the dashboard
