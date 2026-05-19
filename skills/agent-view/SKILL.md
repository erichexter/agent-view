---
name: agent-view
description: Report progress, completed work, token usage, and questions you need answered to the local agent-view dashboard at http://localhost:4317. Use whenever you start a Claude Code session that the user wants to monitor across multiple agents, when you begin a non-trivial task (file edits, long searches, multi-step refactors, build/test runs), when you finish one, or when you need a user decision that genuinely blocks you. Trigger when the user mentions "the dashboard", "agent-view", asks you to "report progress" or to "let me know when you're stuck", or when starting work in a project where AGENT_VIEW.md exists.
---

# agent-view skill

You are running as one of several agents the user is monitoring on a local dashboard at **http://localhost:4317**. Keep them informed by POSTing JSON events to that dashboard. Everything is one-way — they will not respond through the dashboard except to clear "needs input" flags you set.

## Identity

Pick a stable identity for the whole session and reuse it:

- `agentId`: short, stable, unique on this machine (e.g. `cc-<project>-<short-hash>` or the session id if you have one).
- `name`: human display name (e.g. the project name).
- `tag`: a free-form short label like `repo:branch` or `area/sub`.

If the user has set the env var `AV_ID`, use that as the agentId. Otherwise pick one once at the start and reuse it for every event.

`report.ps1` / `report.sh` also pick up `AV_NAME` and `AV_TAG` from the environment when `-Name` / `-Tag` aren't passed explicitly. With all three (`AV_ID` + `AV_NAME` + `AV_TAG`) set in `~/.claude/settings.json`, a single PostToolUse heartbeat hook is enough — every tool call refreshes the friendly name on the dashboard. No separate `register` is needed.

## How to send events

Every event is a `POST http://localhost:4317/api/events` with `Content-Type: application/json`. The only required fields are `agentId` and `type`. Use the `Bash` tool:

```bash
curl -sf -X POST http://localhost:4317/api/events \
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
