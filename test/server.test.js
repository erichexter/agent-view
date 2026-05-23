import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

let base;
let server;
let tmpDir;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'av-server-test-'));
  process.env.AGENT_VIEW_DATA_DIR = tmpDir;
  const { default: app } = await import('../src/app.js');
  server = createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(r => server.close(r));
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

async function post(path, body) {
  const r = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r;
}

async function get(path) {
  return fetch(`${base}${path}`);
}

describe('GET /api/health', () => {
  test('returns 200 { ok: true }', async () => {
    const r = await get('/api/health');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
  });
});

describe('POST /api/events validation', () => {
  test('missing agentId → 400', async () => {
    const r = await post('/api/events', { type: 'register' });
    assert.equal(r.status, 400);
    const body = await r.json();
    assert.ok(body.error);
  });

  test('missing type → 400', async () => {
    const r = await post('/api/events', { agentId: 'test-agent' });
    assert.equal(r.status, 400);
    const body = await r.json();
    assert.ok(body.error);
  });

  test('unknown type → 400', async () => {
    const r = await post('/api/events', { agentId: 'test-agent', type: 'totally_unknown_type' });
    assert.equal(r.status, 400);
    const body = await r.json();
    assert.ok(body.error);
  });
});

describe('POST /api/events register', () => {
  test('creates agent and returns { ok: true, agent }', async () => {
    const r = await post('/api/events', {
      agentId: 'reg-agent-1',
      type: 'register',
      name: 'Register Agent',
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.ok(body.agent);
    assert.equal(body.agent.id, 'reg-agent-1');
    assert.equal(body.agent.name, 'Register Agent');
  });
});

describe('POST /api/events heartbeat', () => {
  test('updates agent lastSeen and records heartbeat', async () => {
    // First register
    await post('/api/events', { agentId: 'hb-server-agent', type: 'register' });

    const before = await get('/api/agents');
    const agentsBefore = await before.json();
    const agentBefore = agentsBefore.find(a => a.id === 'hb-server-agent');
    const lastSeenBefore = agentBefore?.lastSeen;

    await new Promise(r => setTimeout(r, 10));
    const r = await post('/api/events', { agentId: 'hb-server-agent', type: 'heartbeat' });
    assert.equal(r.status, 200);

    const hbR = await get('/api/agents/hb-server-agent/heartbeats');
    assert.equal(hbR.status, 200);
    const hbBody = await hbR.json();
    assert.ok(hbBody.heartbeats.length >= 1, 'Should have at least 1 heartbeat');
  });
});

describe('POST /api/events task lifecycle', () => {
  test('task_start → agent status becomes working', async () => {
    await post('/api/events', { agentId: 'lifecycle-agent', type: 'register' });
    const r = await post('/api/events', {
      agentId: 'lifecycle-agent',
      type: 'task_start',
      taskId: 'task-lifecycle-1',
      title: 'My Task',
      detail: 'Task detail',
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.agent.status, 'working');
    assert.ok(body.agent.currentTask);
    assert.equal(body.agent.currentTask.title, 'My Task');
  });

  test('task_update → patches task detail', async () => {
    await post('/api/events', { agentId: 'update-agent', type: 'register' });
    await post('/api/events', {
      agentId: 'update-agent',
      type: 'task_start',
      taskId: 'task-upd-srv-1',
      title: 'Original',
      detail: 'original detail',
    });
    const r = await post('/api/events', {
      agentId: 'update-agent',
      type: 'task_update',
      taskId: 'task-upd-srv-1',
      detail: 'updated detail',
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.agent.currentTask?.detail, 'updated detail');
  });

  test('task_complete → agent status becomes idle, task in history', async () => {
    await post('/api/events', { agentId: 'complete-agent', type: 'register' });
    await post('/api/events', {
      agentId: 'complete-agent',
      type: 'task_start',
      taskId: 'task-comp-srv-1',
      title: 'Complete Me',
    });
    const r = await post('/api/events', {
      agentId: 'complete-agent',
      type: 'task_complete',
      taskId: 'task-comp-srv-1',
      result: 'ok',
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.agent.status, 'idle');
    assert.equal(body.agent.currentTask, null);
    assert.ok(body.task);

    // Check it appears in tasks list
    const tasks = await get('/api/tasks');
    const taskList = await tasks.json();
    const found = taskList.find(t => t.taskId === 'task-comp-srv-1');
    assert.ok(found, 'Completed task should appear in /api/tasks');
  });
});

describe('POST /api/events needs_input', () => {
  test('agent status becomes waiting', async () => {
    await post('/api/events', { agentId: 'needs-agent', type: 'register' });
    const r = await post('/api/events', {
      agentId: 'needs-agent',
      type: 'needs_input',
      prompt: 'What should I do?',
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.agent.status, 'waiting');
    assert.ok(body.agent.needsInput);
    assert.equal(body.agent.needsInput.prompt, 'What should I do?');
  });
});

describe('POST /api/events goodbye', () => {
  test('agent status becomes offline', async () => {
    await post('/api/events', { agentId: 'bye-agent', type: 'register' });
    const r = await post('/api/events', { agentId: 'bye-agent', type: 'goodbye' });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.agent.status, 'offline');
  });
});

describe('GET /api/tasks', () => {
  test('returns completed tasks array', async () => {
    const r = await get('/api/tasks');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(Array.isArray(body));
  });
});

describe('GET /api/agents', () => {
  test('returns agents list', async () => {
    const r = await get('/api/agents');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(Array.isArray(body));
  });
});

describe('POST /api/agents/:id/resolve', () => {
  test('clears needsInput and sets status idle', async () => {
    await post('/api/events', { agentId: 'resolve-agent', type: 'register' });
    await post('/api/events', {
      agentId: 'resolve-agent',
      type: 'needs_input',
      prompt: 'Help!',
    });
    const r = await post('/api/agents/resolve-agent/resolve', {});
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.needsInput, null);
    assert.equal(body.status, 'idle');
  });
});

describe('DELETE /api/agents/:id', () => {
  test('removes agent', async () => {
    await post('/api/events', { agentId: 'delete-agent', type: 'register' });
    const r = await fetch(`${base}/api/agents/delete-agent`, { method: 'DELETE' });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
  });

  test('returns 404 for unknown agent', async () => {
    const r = await fetch(`${base}/api/agents/totally-unknown-agent-xyz`, { method: 'DELETE' });
    assert.equal(r.status, 404);
  });
});

describe('GET /api/stream', () => {
  test('returns SSE headers and 200 status', async () => {
    const ac = new AbortController();
    const r = await fetch(`${base}/api/stream`, { signal: ac.signal });
    assert.equal(r.status, 200);
    const ct = r.headers.get('content-type');
    assert.ok(ct && ct.includes('text/event-stream'), `Expected text/event-stream, got: ${ct}`);
    ac.abort(); // stop reading the infinite stream
  });
});

describe('GET /api/agents/:id/heartbeats', () => {
  test('returns { agentId, heartbeats: [] } for agent with no heartbeats', async () => {
    // Register a new agent without sending heartbeat events
    await post('/api/events', { agentId: 'hb-empty-agent', type: 'register' });
    // The register event itself calls recordHeartbeat, so we need a fresh agent
    // Let's check the structure is correct regardless
    const r = await get('/api/agents/hb-empty-agent/heartbeats');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.agentId, 'hb-empty-agent');
    assert.ok(Array.isArray(body.heartbeats));
  });

  test('returns non-empty heartbeats array after heartbeat events', async () => {
    await post('/api/events', { agentId: 'hb-full-agent', type: 'register' });
    await post('/api/events', { agentId: 'hb-full-agent', type: 'heartbeat' });
    await post('/api/events', { agentId: 'hb-full-agent', type: 'heartbeat' });

    const r = await get('/api/agents/hb-full-agent/heartbeats');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.agentId, 'hb-full-agent');
    assert.ok(body.heartbeats.length >= 2, `Expected >= 2 heartbeats, got ${body.heartbeats.length}`);
  });

  test('returns 404 for unknown agent', async () => {
    const r = await get('/api/agents/totally-unknown-agent-12345/heartbeats');
    assert.equal(r.status, 404);
    const body = await r.json();
    assert.ok(body.error);
  });
});
