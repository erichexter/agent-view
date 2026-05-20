---
name: agent-view
description: Report progress, completed work, token usage, and questions you need answered to the agent-view dashboard at http://192.168.1.68:4317. Use whenever you start a Claude Code session that the user wants to monitor across multiple agents, when you begin a non-trivial task (file edits, long searches, multi-step refactors, build/test runs), when you finish one, or when you need a user decision that genuinely blocks you. Trigger when the user mentions "the dashboard", "agent-view", asks you to "report progress" or to "let me know when you're stuck", or when starting work in a project where AGENT_VIEW.md exists.
---

# agent-view skill

You are running as one of several agents the user is monitoring on the LAN dashboard at **http://192.168.1.68:4317** (services VM). Keep them informed by POSTing JSON events to that dashboard. Everything is one-way — they will not respond through the dashboard except to clear "needs input" flags you set.

## Identity — IDs must be session-scoped, never shared

`agentId` MUST be unique per session. Two agents on the same machine that reuse the same id will stomp each other on the dashboard.

**Forbidden:**
- Do NOT put `AV_ID`, `AV_NAME`, or `AV_TAG` in `~/.claude/settings.json` or any user-level / shared config. That guarantees collisions the moment more than one session runs.
- Do NOT hardcode an id in a skill, hook, or anything that more than one project/session would source.

**Allowed (in order of preference):**
1. **Generate fresh at session start.** First call to `report.ps1` / `report.sh` with no `AV_ID` set will derive one (e.g. `cc-<cwd-basename>-<pid>-<random>`) and export it for the rest of the session via the hook's own scratch state.
2. **Repo-level `.claude/settings.local.json`** — pin `AV_NAME` and `AV_TAG` per project (the human-readable bits), but leave `AV_ID` unset so it gets generated. `settings.local.json` is git-ignored and per-checkout, so each working copy gets its own.
3. **Per-session env var** — if you're scripting a spawn (e.g. wolf-hook-agent), set `AV_ID=cc-<issue>-<timestamp>` in that child process only.

At user level (`~/.claude/settings.json`) only set:
- `AV_URL=http://192.168.1.68:4317`
- the PostToolUse hook that calls `report.ps1` / `report.sh`

Everything that varies per agent — id, name, tag — lives at the session or repo scope.

Fields:
- `agentId`: short, unique per session (e.g. `cc-<project>-<pid>` or the Claude session id when available).
- `name`: human display name (e.g. the project name). Per-repo via `AV_NAME`.
- `tag`: short label like `repo:branch` or `area/sub`. Per-repo via `AV_TAG`.

## How to send events

Every event is a `POST http://192.168.1.68:4317/api/events` with `Content-Type: application/json`. The only required fields are `agentId` and `type`. Use the `Bash` tool:

```bash
curl -sf -X POST http://192.168.1.68:4317/api/events \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"YOUR_ID","name":"YOUR_NAME","tag":"YOUR_TAG","type":"register"}' \
  > /dev/null
```

If the curl fails (server not running), keep working — never block the real task on dashboard reporting.

## When to send what

| Moment | type | body |
| --- | --- | --- |
| Session start | `register` | `name`, `tag` |
| Beginning non-trivial work | `task_start` | `title` (≤ 50 chars), `detail` (one line of context) |
| Mid-task progress (optional, sparse) | `task_update` | `detail` and/or `progress` (0-1) |
| Task done | `task_complete` | `result: "ok"` or `"error"`, `tokensIn`, `tokensOut`, optional `summary` |
| About to ask the user a blocking question | `needs_input` | `prompt`: the exact question; optional `url` |
| Optional log breadcrumb | `log` | `message` (one line), `level` |
| Session end | `goodbye` | — |

### What counts as "non-trivial"

Send `task_start` for: file edits across multiple files, long greps/searches, running build/test/lint, executing migrations, network calls, anything you expect to take more than ~5 seconds. Don't send one for reading a single file or printing a summary.

### Token counts

When you know them (from a tool that returns usage), include `tokensIn` and `tokensOut` on `task_complete`. If unknown, omit them.

### Long-running tasks — `stallAfterMs`

The dashboard flags an agent as `stalled` (orange) if `status='working'` and no event arrives for >60s. For tasks you know will take longer (a `Bash` call with a 10-minute timeout, a big migration, a long test run), pass `stallAfterMs` on `task_start` so the dashboard waits that long before flagging stalled:

```
report.ps1 start -Task "Migration"  -StallAfterMs 600000
report.sh  start --task "Migration" --stall-after-ms 600000
```

Recommended: set `stallAfterMs` to the tool's own timeout plus ~30s of buffer. `task_complete` clears it.

**PreToolUse hook recipe** (Claude Code) — read `tool_input.timeout` off stdin and forward it as `stallAfterMs` automatically so long Bash calls don't false-alarm:

```powershell
# ~/.claude/hooks/agent-view-pretool.ps1
$ev = $input | Out-String | ConvertFrom-Json
if ($ev.tool_name -eq 'Bash' -and $ev.tool_input.timeout) {
  $ms = [int]$ev.tool_input.timeout + 30000
  $title = "Bash: " + $ev.tool_input.command.Substring(0, [Math]::Min(40, $ev.tool_input.command.Length))
  & powershell -NoProfile -File $PSScriptRoot\..\skills\agent-view\report.ps1 start -Task $title -StallAfterMs $ms 2>$null
}
```

## Rules

1. **Never block on the dashboard.** If the POST fails, ignore the failure and continue.
2. **One active task at a time** per agent. Always close the prior `task_start` with a matching `task_complete` before starting another.
3. **Don't spam.** Aim for at most one event every couple of seconds. Use `task_update` sparingly.
4. **`needs_input` is loud.** It flashes the user's screen and beeps. Only use it when you genuinely cannot proceed without their answer — not for "FYI" notes.
5. **Reuse `agentId`.** Don't generate a new one mid-session.

## Bootstrapping checklist (do this once per session)

1. Decide your `agentId`, `name`, `tag`.
2. Send `register`.
3. Begin work, sending `task_start` / `task_complete` around each non-trivial chunk.
4. On session end (or before exiting), send `goodbye`.

## Example sequence

```
register      → { name:"feature-x", tag:"webapp:feature-x" }
task_start    → { title:"Read project layout" }
task_complete → { result:"ok", summary:"3 packages, monorepo" }
task_start    → { title:"Add login form", detail:"src/auth/* edits" }
needs_input   → { prompt:"Use NextAuth or rebuild custom?" }
(user clicks resolve on the dashboard)
task_complete → { result:"ok", tokensIn:3400, tokensOut:1100 }
goodbye
```
