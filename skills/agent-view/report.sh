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

# Resolve agentId. Precedence: --id flag > $AV_ID > per-project state file > auto-generate.
# IDs must be session/project-scoped, never shared at user level.
if [ -z "${flags[agentId]:-}" ] && [ -n "${AV_ID:-}" ]; then
  flags[agentId]="\"$AV_ID\""
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

# Build JSON
json="{\"type\":\"$type\""
for k in "${!flags[@]}"; do
  json="$json,\"$k\":${flags[$k]}"
done
json="$json}"

curl -sf -X POST "$URL/api/events" \
  -H 'Content-Type: application/json' \
  -d "$json" >/dev/null || exit 0
