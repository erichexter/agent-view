import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir;
let store;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'av-store-test-'));
  process.env.AGENT_VIEW_DATA_DIR = tmpDir;
  store = await import('../src/store.js');
});

after(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe('upsertAgent', () => {
  test('creates agent with default fields', () => {
    const a = store.upsertAgent('agent-1', {});
    assert.equal(a.id, 'agent-1');
    assert.equal(a.name, 'agent-1');
    assert.equal(a.status, 'idle');
    assert.equal(a.currentTask, null);
    assert.equal(a.needsInput, null);
    assert.equal(a.totalTokens, 0);
    assert.equal(a.completedCount, 0);
    assert.ok(typeof a.firstSeen === 'number');
    assert.ok(typeof a.lastSeen === 'number');
  });

  test('merges patch into existing agent', () => {
    store.upsertAgent('agent-2', { name: 'My Agent' });
    const updated = store.upsertAgent('agent-2', { status: 'working', name: 'Updated Agent' });
    assert.equal(updated.id, 'agent-2');
    assert.equal(updated.name, 'Updated Agent');
    assert.equal(updated.status, 'working');
  });
});

describe('getAgent', () => {
  test('returns agent by id', () => {
    store.upsertAgent('agent-get-1', { name: 'GetMe' });
    const a = store.getAgent('agent-get-1');
    assert.ok(a);
    assert.equal(a.name, 'GetMe');
  });

  test('returns undefined for unknown id', () => {
    const a = store.getAgent('nonexistent-xyz');
    assert.equal(a, undefined);
  });
});

describe('removeAgent', () => {
  test('deletes agent by id', () => {
    store.upsertAgent('agent-remove-1', {});
    assert.ok(store.getAgent('agent-remove-1'));
    store.removeAgent('agent-remove-1');
    assert.equal(store.getAgent('agent-remove-1'), undefined);
  });
});

describe('listAgents', () => {
  test('returns agents sorted by lastSeen descending', async () => {
    store.upsertAgent('sort-a', { name: 'A' });
    // Add a tiny delay to ensure different lastSeen timestamps
    await new Promise(r => setTimeout(r, 5));
    store.upsertAgent('sort-b', { name: 'B' });
    const list = store.listAgents();
    const ids = list.map(a => a.id);
    const idxA = ids.indexOf('sort-a');
    const idxB = ids.indexOf('sort-b');
    assert.ok(idxA > -1, 'sort-a should be in list');
    assert.ok(idxB > -1, 'sort-b should be in list');
    assert.ok(idxB < idxA, 'sort-b (more recent) should come before sort-a');
  });
});

describe('startTask + completeTask', () => {
  test('creates a completed record with duration', () => {
    const agentId = 'task-agent-1';
    store.upsertAgent(agentId, {});
    const task = { taskId: 'task-001', title: 'Do something', detail: 'details here' };
    store.startTask(agentId, task);
    const record = store.completeTask(agentId, 'task-001', { result: 'ok', summary: 'done' });
    assert.equal(record.agentId, agentId);
    assert.equal(record.taskId, 'task-001');
    assert.equal(record.title, 'Do something');
    assert.equal(record.result, 'ok');
    assert.ok(typeof record.finishedAt === 'number');
    assert.ok(typeof record.durationMs === 'number');
    assert.ok(record.durationMs >= 0);
  });
});

describe('updateTask', () => {
  test('patches title and detail on in-flight task', () => {
    const agentId = 'task-agent-update';
    store.upsertAgent(agentId, {});
    store.startTask(agentId, { taskId: 'task-upd-1', title: 'Original', detail: 'orig detail' });
    const patched = store.updateTask(agentId, 'task-upd-1', { title: 'Updated', detail: 'new detail' });
    assert.ok(patched);
    assert.equal(patched.title, 'Updated');
    assert.equal(patched.detail, 'new detail');
  });

  test('returns null for unknown task', () => {
    const result = store.updateTask('nonexistent', 'no-task', { title: 'x' });
    assert.equal(result, null);
  });
});

describe('listCompleted', () => {
  test('returns recent tasks, most recent first', () => {
    const agentId = 'list-comp-1';
    store.upsertAgent(agentId, {});
    store.startTask(agentId, { taskId: 'lc-t1', title: 'Task 1' });
    store.completeTask(agentId, 'lc-t1', { result: 'ok' });
    store.startTask(agentId, { taskId: 'lc-t2', title: 'Task 2' });
    store.completeTask(agentId, 'lc-t2', { result: 'ok' });

    const list = store.listCompleted({ limit: 10 });
    assert.ok(list.length >= 2);
    // Most recent first
    const t1idx = list.findIndex(t => t.taskId === 'lc-t1');
    const t2idx = list.findIndex(t => t.taskId === 'lc-t2');
    assert.ok(t1idx > -1 && t2idx > -1);
    assert.ok(t2idx < t1idx, 'lc-t2 (completed later) should appear before lc-t1');
  });

  test('filters by agentId', () => {
    const agentA = 'filter-agent-a';
    const agentB = 'filter-agent-b';
    store.upsertAgent(agentA, {});
    store.upsertAgent(agentB, {});
    store.startTask(agentA, { taskId: 'fa-t1', title: 'A task' });
    store.completeTask(agentA, 'fa-t1', { result: 'ok' });
    store.startTask(agentB, { taskId: 'fb-t1', title: 'B task' });
    store.completeTask(agentB, 'fb-t1', { result: 'ok' });

    const listA = store.listCompleted({ agentId: agentA });
    assert.ok(listA.every(t => t.agentId === agentA));
    const listB = store.listCompleted({ agentId: agentB });
    assert.ok(listB.every(t => t.agentId === agentB));
  });
});

describe('recordTokens', () => {
  test('populates burnRate > 0', () => {
    const agentId = 'burn-agent-1';
    store.upsertAgent(agentId, {});
    store.recordTokens(agentId, 10000);
    const a = store.getAgentForClient(agentId);
    assert.ok(a.burnRate > 0, `burnRate should be > 0 but got ${a.burnRate}`);
  });
});

describe('snapshot', () => {
  test('returns agents + completed + serverTime', () => {
    const snap = store.snapshot();
    assert.ok(Array.isArray(snap.agents));
    assert.ok(Array.isArray(snap.completed));
    assert.ok(typeof snap.serverTime === 'number');
    assert.ok(typeof snap.burnWindowMs === 'number');
  });
});

describe('recordHeartbeat', () => {
  test('adds timestamp to heartbeats array', () => {
    const agentId = 'hb-agent-1';
    store.upsertAgent(agentId, {});
    const before = store.getHeartbeats(agentId);
    assert.equal(before.length, 0);
    store.recordHeartbeat(agentId);
    const after = store.getHeartbeats(agentId);
    assert.equal(after.length, 1);
    assert.ok(typeof after[0] === 'number');
  });

  test('caps ring buffer at 48 entries', () => {
    const agentId = 'hb-agent-cap';
    store.upsertAgent(agentId, {});
    for (let i = 0; i < 60; i++) {
      store.recordHeartbeat(agentId);
    }
    const hbs = store.getHeartbeats(agentId);
    assert.ok(hbs.length <= 48, `Expected <= 48 but got ${hbs.length}`);
    assert.equal(hbs.length, 48);
  });

  test('does nothing for unknown agent', () => {
    // Should not throw
    store.recordHeartbeat('unknown-hb-agent-xyz');
  });
});

describe('getHeartbeats', () => {
  test('returns timestamps array', () => {
    const agentId = 'hb-get-agent-1';
    store.upsertAgent(agentId, {});
    store.recordHeartbeat(agentId);
    store.recordHeartbeat(agentId);
    const hbs = store.getHeartbeats(agentId);
    assert.ok(Array.isArray(hbs));
    assert.equal(hbs.length, 2);
    assert.ok(hbs.every(ts => typeof ts === 'number'));
  });

  test('returns empty array for unknown agent', () => {
    const hbs = store.getHeartbeats('totally-unknown-xyz');
    assert.deepEqual(hbs, []);
  });
});

describe('heartbeats persistence', () => {
  test('heartbeats survive through upsertAgent', () => {
    const agentId = 'hb-persist-agent';
    store.upsertAgent(agentId, { name: 'Persist Test' });
    store.recordHeartbeat(agentId);
    store.recordHeartbeat(agentId);

    // upsertAgent should preserve heartbeats
    store.upsertAgent(agentId, { status: 'working' });
    const hbs = store.getHeartbeats(agentId);
    assert.ok(hbs.length >= 2, `Expected >= 2 heartbeats after upsert but got ${hbs.length}`);
  });

  test('heartbeats are exposed in withDerived output', () => {
    const agentId = 'hb-derived-agent';
    store.upsertAgent(agentId, {});
    store.recordHeartbeat(agentId);
    const a = store.getAgentForClient(agentId);
    assert.ok(Array.isArray(a.heartbeats));
    assert.ok(a.heartbeats.length >= 1);
  });
});
