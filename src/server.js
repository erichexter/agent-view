import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listAgents, getAgent, getAgentForClient, upsertAgent, removeAgent,
  startTask, updateTask, completeTask, listCompleted, snapshot, recordTokens,
} from './store.js';
import { addClient, broadcast } from './bus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4317);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use((req, _res, next) => {
  if (process.env.AV_LOG === '1') console.log(req.method, req.url);
  next();
});

// Static UI
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health
app.get('/api/health', (_req, res) => res.json({ ok: true, time: Date.now() }));

// Snapshot
app.get('/api/snapshot', (_req, res) => res.json(snapshot()));
app.get('/api/agents', (_req, res) => res.json(listAgents()));
app.get('/api/tasks', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const agentId = req.query.agentId || undefined;
  res.json(listCompleted({ limit, agentId }));
});

// SSE stream
app.get('/api/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ type: 'hello', snapshot: snapshot() })}\n\n`);
  addClient(res);
  const keepalive = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch {}
  }, 25000);
  req.on('close', () => clearInterval(keepalive));
});

// Resolve "needs input" from the dashboard
app.post('/api/agents/:id/resolve', (req, res) => {
  const id = req.params.id;
  const a = getAgent(id);
  if (!a) return res.status(404).json({ error: 'unknown agent' });
  const next = upsertAgent(id, { needsInput: null, status: a.currentTask ? 'working' : 'idle' });
  broadcast({ type: 'agent', agent: next });
  res.json(next);
});

// Forget an agent
app.delete('/api/agents/:id', (req, res) => {
  removeAgent(req.params.id);
  broadcast({ type: 'agent_removed', id: req.params.id });
  res.json({ ok: true });
});

// Single ingest endpoint for agents
// Body: { agentId, name?, type, ... }
app.post('/api/events', (req, res) => {
  const ev = req.body || {};
  const { agentId, type } = ev;
  if (!agentId || !type) return res.status(400).json({ error: 'agentId and type required' });

  const existing = getAgent(agentId);
  const name = ev.name || existing?.name || agentId;
  // Metadata that can ride along on any event.
  const cronPatch = {};
  if (ev.cronsActive !== undefined) cronPatch.cronsActive = ev.cronsActive;
  if (ev.nextCronAt !== undefined)  cronPatch.nextCronAt  = ev.nextCronAt;
  if (ev.nextCronName !== undefined) cronPatch.nextCronName = ev.nextCronName;
  if (ev.tag !== undefined) cronPatch.tag = ev.tag;
  let agent;
  let task;

  switch (type) {
    case 'register':
    case 'heartbeat': {
      const prev = getAgent(agentId);
      // Don't clobber a 'waiting' state — needsInput overrides the derived status.
      const derived = prev?.needsInput ? 'waiting'
                    : (prev?.currentTask ? 'working' : 'idle');
      agent = upsertAgent(agentId, {
        name,
        status: ev.status || derived,
        meta: ev.meta || prev?.meta,
        ...cronPatch,
      });
      break;
    }
    case 'goodbye': {
      agent = upsertAgent(agentId, { status: 'offline', currentTask: null, needsInput: null, ...cronPatch });
      break;
    }
    case 'task_start': {
      const t = {
        taskId: ev.taskId || `t_${Date.now()}`,
        title: ev.title || 'Untitled task',
        detail: ev.detail || '',
        startedAt: Date.now(),
      };
      startTask(agentId, t);
      agent = upsertAgent(agentId, {
        name, status: 'working', currentTask: t, needsInput: null, ...cronPatch,
      });
      task = t;
      break;
    }
    case 'task_update': {
      const cur = getAgent(agentId)?.currentTask;
      if (cur && ev.taskId && cur.taskId !== ev.taskId) {
        // Allow updating a known task even if not current; otherwise no-op
      }
      const patched = updateTask(agentId, ev.taskId || cur?.taskId, {
        title: ev.title ?? cur?.title,
        detail: ev.detail ?? cur?.detail,
        progress: ev.progress,
      });
      const newCurrent = patched ? {
        taskId: patched.taskId,
        title: patched.title,
        detail: patched.detail,
        progress: patched.progress,
        startedAt: patched.startedAt,
      } : cur;
      agent = upsertAgent(agentId, { name, currentTask: newCurrent, ...cronPatch });
      task = newCurrent;
      break;
    }
    case 'task_complete': {
      const cur = getAgent(agentId)?.currentTask;
      const taskId = ev.taskId || cur?.taskId;
      const record = completeTask(agentId, taskId, {
        title: ev.title ?? cur?.title ?? 'Untitled task',
        detail: ev.detail ?? cur?.detail ?? '',
        tokensIn: ev.tokensIn ?? null,
        tokensOut: ev.tokensOut ?? null,
        tokens: ev.tokens ?? (((ev.tokensIn || 0) + (ev.tokensOut || 0)) || null),
        result: ev.result || 'ok',
        summary: ev.summary || '',
      });
      const prev = getAgent(agentId) || {};
      if (record.tokens) recordTokens(agentId, record.tokens);
      agent = upsertAgent(agentId, {
        name,
        status: 'idle',
        currentTask: null,
        needsInput: null,
        completedCount: (prev.completedCount || 0) + 1,
        totalTokens: (prev.totalTokens || 0) + (record.tokens || 0),
        ...cronPatch,
      });
      task = record;
      broadcast({ type: 'task_complete', agent, task: record });
      return res.json({ ok: true, agent, task: record });
    }
    case 'needs_input': {
      const needs = {
        prompt: ev.prompt || ev.message || 'Agent needs input',
        url: ev.url || null,
        raisedAt: Date.now(),
      };
      agent = upsertAgent(agentId, { name, status: 'waiting', needsInput: needs, ...cronPatch });
      broadcast({ type: 'needs_input', agent });
      return res.json({ ok: true, agent });
    }
    case 'input_resolved': {
      agent = upsertAgent(agentId, { name, needsInput: null, status: getAgent(agentId)?.currentTask ? 'working' : 'idle', ...cronPatch });
      break;
    }
    case 'log': {
      const lastLog = { message: ev.message || '', level: ev.level || 'info', ts: Date.now() };
      agent = upsertAgent(agentId, { name, lastLog, ...cronPatch });
      broadcast({ type: 'log', agentId, name, ...lastLog });
      broadcast({ type: 'agent', agent });
      return res.json({ ok: true, agent });
    }
    default:
      return res.status(400).json({ error: `unknown event type: ${type}` });
  }

  broadcast({ type: 'agent', agent, task });
  res.json({ ok: true, agent, task });
});

app.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`agent-view listening on ${url}  (bound ${HOST}:${PORT})`);
});
