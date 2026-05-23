#!/usr/bin/env bash
# Tiny wrapper agents can shell out to.
# Usage:
#   report.sh register    --id alpha --name "Alpha" --tag "webapp:main"
#   report.sh start       --id alpha --task "Refactor auth"
#   report.sh done        --id alpha --tokens-in 1200 --tokens-out 500 --result ok
#   report.sh ask         --id alpha --prompt "OK to drop legacy index?"
#   report.sh log         --id alpha --message "tests passed"
#   report.sh resolved    --id alpha
#   report.sh bye         --id alpha
#
# AV_URL defaults to http://localhost:4317.

set -eu
URL="${AV_URL:-http://192.168.1.68:4317}"
cmd="${1:-}"; shift || true

declare -A flags=()
while (( $# )); do
  key="$1"; val="${2:-}"; shift; shift || true
  case "$key" in
    --id)         flags[agentId]="\"$val\"" ;;
    --name)       flags[name]="\"$val\"" ;;
    --tag)        flags[tag]="\"$val\"" ;;
    --task)       flags[title]="\"$val\"" ;;
    --detail)     flags[detail]="\"$val\"" ;;
    --prompt)     flags[prompt]="\"$val\"" ;;
    --url)        flags[url]="\"$val\"" ;;
    --message)    flags[message]="\"$val\"" ;;
    --level)      flags[level]="\"$val\"" ;;
    --result)     flags[result]="\"$val\"" ;;
    --summary)    flags[summary]="\"$val\"" ;;
    --tokens-in)  flags[tokensIn]="$val" ;;
    --tokens-out) flags[tokensOut]="$val" ;;
    --stall-after-ms) flags[stallAfterMs]="$val" ;;
    --task-id)    flags[taskId]="\"$val\"" ;;
    *) echo "unknown flag: $key" >&2; exit 2 ;;
  esac
done

case "$cmd" in
  register)  type="register"      ;;
  hello)     type="register"      ;;
  start)     type="task_start"    ;;
  update)    type="task_update"   ;;
  done)      type="task_complete" ;;
  ask)       type="needs_input"   ;;
  resolved)  type="input_resolved";;
  heartbeat) type="heartbeat"     ;;
  log)       type="log"           ;;
  bye)       type="goodbye"       ;;
  *) echo "usage: report.sh <register|start|update|done|ask|resolved|heartbeat|log|bye> [--flag value ...]" >&2; exit 2 ;;
esac

# Resolve agentId. Precedence:
#   --id flag > $AV_ID > Claude Code session id > per-project state file > auto-generate
#
# Session id beats the state file because a single Claude Code session can `cd` into
# different project subdirs mid-session — each tool call's hook event reports a
# different cwd, which would otherwise auto-generate a new id per cwd and fragment
# the session across multiple dashboard cards. Session id is stable per session.
if [ -z "${flags[agentId]:-}" ] && [ -n "${AV_ID:-}" ]; then
  flags[agentId]="\"$AV_ID\""
fi
if [ -z "${flags[agentId]:-}" ] && [ -n "${CLAUDE_CODE_SESSION_ID:-}" ]; then
  clean=$(printf '%s' "$CLAUDE_CODE_SESSION_ID" | tr -cd 'A-Za-z0-9')
  short=$(printf '%s' "$clean" | cut -c1-8)
  flags[agentId]="\"cc-$short\""
fi
if [ -z "${flags[agentId]:-}" ]; then
  project_dir="${CLAUDE_PROJECT_DIR:-$PWD}"
  state_dir="$project_dir/.claude"
  state_file="$state_dir/.agent-view-id"
  if [ -f "$state_file" ]; then
    av_id=$(cat "$state_file" 2>/dev/null | tr -d '\n\r ')
  else
    av_id=""
  fi
  if [ -z "$av_id" ]; then
    base_name=$(basename "$project_dir" | tr -c 'a-zA-Z0-9_-' '-')
    [ -z "$base_name" ] && base_name="session"
    rand=$(od -An -N4 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n' || echo $$)
    av_id="cc-$base_name-$rand"
    mkdir -p "$state_dir" 2>/dev/null && printf '%s' "$av_id" > "$state_file" 2>/dev/null || true
  fi
  flags[agentId]="\"$av_id\""
fi
[ -n "${flags[agentId]:-}" ] || exit 0

# Fall back to AV_NAME / AV_TAG env vars when --name / --tag aren't passed.
# This lets a heartbeat hook refresh the friendly name on every tool call
# without re-issuing a register.
[ -z "${flags[name]:-}" ] && [ -n "${AV_NAME:-}" ] && flags[name]="\"$AV_NAME\""
[ -z "${flags[tag]:-}"  ] && [ -n "${AV_TAG:-}"  ] && flags[tag]="\"$AV_TAG\""

# Final fallback for --name: read the Claude Code session transcript and pull
# the latest custom-title (user-set via /rename) or ai-title (auto-named).
# This lets the dashboard reflect /rename without any settings/env edits.
#
# Transcript lives at:
#   $HOME/.claude/projects/<cwd-slug>/<CLAUDE_CODE_SESSION_ID>.jsonl
# where <cwd-slug> is the absolute project path with `:\/` replaced by `-`.
if [ -z "${flags[name]:-}" ] && [ -n "${CLAUDE_CODE_SESSION_ID:-}" ]; then
  project_dir="${CLAUDE_PROJECT_DIR:-$PWD}"
  # Slugify: replace `:`, `\`, `/` (one or more) with a single `-`, then strip trailing.
  slug=$(echo "$project_dir" | sed -E 's#[:\\/]+#-#g; s#-+$##')
  transcript="$HOME/.claude/projects/$slug/$CLAUDE_CODE_SESSION_ID.jsonl"
  if [ -f "$transcript" ]; then
    # tac scans newest-first; fall back if tac is unavailable.
    if command -v tac >/dev/null 2>&1; then
      reader="tac"
    else
      reader="tail -r"
    fi
    title=$(tail -n 500 "$transcript" 2>/dev/null | $reader 2>/dev/null \
      | grep -m1 -oE '"type"[[:space:]]*:[[:space:]]*"custom-title"[^}]*"customTitle"[[:space:]]*:[[:space:]]*"[^"]+"' \
      | grep -oE '"customTitle"[[:space:]]*:[[:space:]]*"[^"]+"' \
      | sed -E 's/.*"customTitle"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
    if [ -z "$title" ]; then
      title=$(tail -n 500 "$transcript" 2>/dev/null | $reader 2>/dev/null \
        | grep -m1 -oE '"type"[[:space:]]*:[[:space:]]*"ai-title"[^}]*"aiTitle"[[:space:]]*:[[:space:]]*"[^"]+"' \
        | grep -oE '"aiTitle"[[:space:]]*:[[:space:]]*"[^"]+"' \
        | sed -E 's/.*"aiTitle"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
    fi
    if [ -n "$title" ]; then
      # JSON-escape any embedded quotes/backslashes.
      esc=$(printf '%s' "$title" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
      flags[name]="\"$esc\""
    fi
    # Remote-control URL: latest claude.ai/code/session_* in the transcript.
    remote_url=$(tail -n 500 "$transcript" 2>/dev/null | $reader 2>/dev/null \
      | grep -m1 -oE 'https://claude\.ai/code/session_[A-Za-z0-9]+' | head -n1)
    if [ -n "$remote_url" ]; then
      flags[remoteUrl]="\"$remote_url\""
    fi
  fi
fi

# Build JSON
json="{\"type\":\"$type\""
for k in "${!flags[@]}"; do
  json="$json,\"$k\":${flags[$k]}"
done
json="$json}"

curl -sf -X POST "$URL/api/events" \
  -H 'Content-Type: application/json' \
  -d "$json" >/dev/null || exit 0
