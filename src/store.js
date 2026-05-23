import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.AGENT_VIEW_DATA_DIR || path.join(process.cwd(), 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.jsonl');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

const agents = new Map();
const tasks = new Map();
const completed = [];
const MAX_COMPLETED = 500;

function loadAgents() {
  if (!fs.existsSync(AGENTS_FILE)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
    for (const a of raw) agents.set(a.id, a);
  } catch (e) {
    console.warn('agents.json unreadable, ignoring:', e.message);
  }
}

const BURN_WINDOW_MS = 5 * 60 * 1000;

function persistAgents() {
  // Strip in-memory-only fields (token window samples) before writing to disk.
  // _heartbeats ARE persisted (they're useful across restarts).
  const out = [...agents.values()].map(a => {
    const { _tokenWindow, ...rest } = a;
    return rest;
  });
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(out, null, 2));
}

function burnRate(agent) {
  const w = agent._tokenWindow;
  if (!w || !w.length) return 0;
  const cutoff = Date.now() - BURN_WINDOW_MS;
  while (w.length && w[0].t < cutoff) w.shift();
  const sum = w.reduce((acc, s) => acc + s.tokens, 0);
  return Math.round(sum / (BURN_WINDOW_MS / 60000)); // tokens per minute
}

function withDerived(agent) {
  if (!agent) return agent;
  const { _tokenWindow, _heartbeats, ...rest } = agent;
  return { ...rest, burnRate: burnRate(agent), heartbeats: _heartbeats || [] };
}

export function recordTokens(agentId, tokens) {
  const a = agents.get(agentId);
  if (!a || !tokens) return;
  a._tokenWindow = a._tokenWindow || [];
  a._tokenWindow.push({ t: Date.now(), tokens });
  // prune to keep memory bounded
  const cutoff = Date.now() - BURN_WINDOW_MS;
  while (a._tokenWindow.length && a._tokenWindow[0].t < cutoff) a._tokenWindow.shift();
}

export function recordHeartbeat(agentId) {
  const a = agents.get(agentId);
  if (!a) return;
  const pings = a._heartbeats || [];
  pings.push(Date.now());
  // Keep last 48 pings
  if (pings.length > 48) pings.splice(0, pings.length - 48);
  a._heartbeats = pings;
  persistAgents();
}

export function getHeartbeats(agentId) {
  const a = agents.get(agentId);
  return a?._heartbeats || [];
}

function loadCompleted() {
  if (!fs.existsSync(TASKS_FILE)) return;
  const lines = fs.readFileSync(TASKS_FILE, 'utf8').split('\n').filter(Boolean);
  const recent = lines.slice(-MAX_COMPLETED);
  for (const line of recent) {
    try { completed.push(JSON.parse(line)); } catch {}
  }
}

function appendCompleted(task) {
  fs.appendFileSync(TASKS_FILE, JSON.stringify(task) + '\n');
  completed.push(task);
  if (completed.length > MAX_COMPLETED) completed.shift();
}

loadAgents();
loadCompleted();

export function listAgents() {
  return [...agents.values()]
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
    .map(withDerived);
}

export function getAgent(id) {
  return agents.get(id);
}

export function getAgentForClient(id) {
  return withDerived(agents.get(id));
}

export function upsertAgent(id, patch) {
  const now = Date.now();
  const existing = agents.get(id) || {
    id,
    name: id,
    status: 'idle',
    currentTask: null,
    needsInput: null,
    firstSeen: now,
    lastSeen: now,
    totalTokens: 0,
    completedCount: 0,
    tag: null,
    lastLog: null,
  };
  // Preserve the in-memory token window and heartbeats when patching.
  const _tokenWindow = existing._tokenWindow;
  const _heartbeats = existing._heartbeats;
  const next = { ...existing, ...patch, lastSeen: now };
  if (_tokenWindow) next._tokenWindow = _tokenWindow;
  if (_heartbeats) next._heartbeats = _heartbeats;
  agents.set(id, next);
  persistAgents();
  return withDerived(next);
}

export function removeAgent(id) {
  agents.delete(id);
  persistAgents();
}

export function startTask(agentId, task) {
  tasks.set(`${agentId}:${task.taskId}`, { ...task, agentId, startedAt: Date.now() });
}

export function updateTask(agentId, taskId, patch) {
  const key = `${agentId}:${taskId}`;
  const existing = tasks.get(key);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  tasks.set(key, next);
  return next;
}

export function completeTask(agentId, taskId, patch) {
  const key = `${agentId}:${taskId}`;
  const existing = tasks.get(key) || { agentId, taskId, startedAt: Date.now() };
  const finishedAt = Date.now();
  const record = {
    ...existing,
    ...patch,
    agentId,
    taskId,
    finishedAt,
    durationMs: finishedAt - (existing.startedAt || finishedAt),
  };
  tasks.delete(key);
  appendCompleted(record);
  return record;
}

export function listCompleted({ limit = 100, agentId } = {}) {
  let out = completed;
  if (agentId) out = out.filter(t => t.agentId === agentId);
  return out.slice(-limit).reverse();
}

export function snapshot() {
  return {
    agents: listAgents(),
    completed: listCompleted({ limit: 50 }),
    serverTime: Date.now(),
    burnWindowMs: BURN_WINDOW_MS,
  };
}
