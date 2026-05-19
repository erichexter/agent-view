#!/usr/bin/env node
// Tiny CLI to post events from any agent/script:
//   agentv start  --id alpha --task "Refactor module X" --detail "..."
//   agentv update --id alpha --detail "halfway"
//   agentv done   --id alpha --tokens-in 1200 --tokens-out 800
//   agentv ask    --id alpha --prompt "Confirm deletion of users table"
//   agentv heartbeat --id alpha
//   agentv log    --id alpha --message "hello"
//
// Env: AV_URL (default http://localhost:4317), AV_NAME (display name)

import { argv, env } from 'node:process';

const URL = (env.AV_URL || 'http://localhost:4317').replace(/\/$/, '');
const args = parse(argv.slice(2));
const cmd = args._[0];
if (!cmd) usageExit();

const id = args.id || env.AV_ID;
const name = args.name || env.AV_NAME || id;
if (!id) die('Missing --id (or AV_ID env)');

const map = {
  start:     { type: 'task_start',     fields: ['task->title', 'detail', 'taskId'] },
  update:    { type: 'task_update',    fields: ['task->title', 'detail', 'progress', 'taskId'] },
  done:      { type: 'task_complete',  fields: ['summary', 'tokens', 'tokens-in->tokensIn', 'tokens-out->tokensOut', 'result', 'taskId'] },
  ask:       { type: 'needs_input',    fields: ['prompt', 'url', 'message'] },
  resolved:  { type: 'input_resolved', fields: [] },
  heartbeat: { type: 'heartbeat',      fields: ['status'] },
  hello:     { type: 'register',       fields: ['status'] },
  bye:       { type: 'goodbye',        fields: [] },
  log:       { type: 'log',            fields: ['message', 'level'] },
};
const cfg = map[cmd];
if (!cfg) usageExit();

const body = { agentId: id, name, type: cfg.type };
for (const f of cfg.fields) {
  const [from, to] = f.includes('->') ? f.split('->') : [f, f];
  const v = args[from];
  if (v !== undefined) body[to] = coerce(v);
}

try {
  const res = await fetch(`${URL}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) die(`HTTP ${res.status}: ${text}`);
  console.log(text);
} catch (e) {
  die(`Request failed: ${e.message}`);
}

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}
function coerce(v) {
  if (v === true || v === false) return v;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}
function die(msg) { console.error(msg); process.exit(1); }
function usageExit() {
  console.error(`Usage: agentv <command> --id <agent-id> [opts]

Commands:
  hello       Register/show up in the dashboard.
  heartbeat   Mark agent still alive.
  start       Start a task. --task "title" [--detail "..."] [--taskId X]
  update      Update active task. [--task] [--detail] [--progress 0.5]
  done        Complete current task. [--tokens-in N] [--tokens-out N] [--result ok|error] [--summary "..."]
  ask         Flag this agent as needing input. --prompt "question" [--url http://...]
  resolved    Mark input as resolved (also done automatically when the dashboard clicks "mark resolved").
  bye         Mark agent offline.
  log         --message "..." [--level info|warn|error]

Env:
  AV_URL   (default http://localhost:4317)
  AV_ID    default agent id
  AV_NAME  default display name
`);
  process.exit(2);
}
