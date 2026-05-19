// agent-view client SDK
//
// Usage:
//   import { AgentView } from 'agent-view/src/client.js';
//   const av = new AgentView({ id: 'my-agent', name: 'My Agent', tag: 'web/main' });
//   await av.register();
//   await av.task('Refactor auth', async () => { ... });
//   await av.completeTask({ tokensIn: 1200, tokensOut: 500 });
//
// Everything is one-way HTTP POSTs to /api/events. Safe to use anywhere fetch() exists.

const DEFAULT_URL = process.env.AV_URL || 'http://localhost:4317';

export class AgentView {
  constructor({
    url = DEFAULT_URL,
    id,
    name,
    tag,
    autoHeartbeatMs = 15_000,
    handleSignals = true,
  } = {}) {
    if (!id) throw new Error('AgentView: id is required');
    this.base = String(url).replace(/\/$/, '');
    this.id = id;
    this.name = name || id;
    this.tag = tag || null;
    this.activeTaskId = null;
    this._tokensIn = 0;
    this._tokensOut = 0;
    this._closed = false;

    if (autoHeartbeatMs > 0) {
      this._hb = setInterval(() => this.heartbeat().catch(() => {}), autoHeartbeatMs);
      this._hb.unref?.();
    }
    if (handleSignals && typeof process !== 'undefined') {
      const onExit = (sig) => {
        if (this._closed) return;
        this.goodbye().catch(() => {}).finally(() => {
          if (sig) process.exit(sig === 'SIGINT' ? 130 : 0);
        });
      };
      process.once('SIGINT', () => onExit('SIGINT'));
      process.once('SIGTERM', () => onExit('SIGTERM'));
      process.once('beforeExit', () => onExit());
    }
  }

  async _post(type, extra = {}) {
    const body = {
      agentId: this.id,
      name: this.name,
      tag: this.tag ?? undefined,
      type,
      ...extra,
    };
    try {
      const res = await fetch(`${this.base}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`agent-view ${type} failed: ${res.status} ${text}`);
      }
      return await res.json().catch(() => ({}));
    } catch (e) {
      // Never let dashboard reporting break the agent. Surface via _lastError for debugging.
      this._lastError = e;
      return null;
    }
  }

  register(extra) { return this._post('register', extra); }
  heartbeat(extra) { return this._post('heartbeat', extra); }
  async goodbye() {
    this._closed = true;
    if (this._hb) clearInterval(this._hb);
    return this._post('goodbye');
  }

  startTask({ title, detail, taskId } = {}) {
    this.activeTaskId = taskId || `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this._tokensIn = 0;
    this._tokensOut = 0;
    return this._post('task_start', { taskId: this.activeTaskId, title, detail });
  }

  updateTask({ title, detail, progress } = {}) {
    return this._post('task_update', {
      taskId: this.activeTaskId, title, detail, progress,
    });
  }

  addTokens({ in: inTok = 0, out: outTok = 0 } = {}) {
    this._tokensIn += inTok;
    this._tokensOut += outTok;
  }

  completeTask({ tokensIn, tokensOut, result = 'ok', summary } = {}) {
    const taskId = this.activeTaskId;
    this.activeTaskId = null;
    return this._post('task_complete', {
      taskId,
      tokensIn: tokensIn ?? this._tokensIn,
      tokensOut: tokensOut ?? this._tokensOut,
      result,
      summary,
    });
  }

  log(message, level = 'info') { return this._post('log', { message, level }); }

  /** Flag this agent as waiting on a user decision and resolve immediately afterwards. Fire-and-forget. */
  notify(prompt, options = {}) { return this._post('needs_input', { prompt, ...options }); }
  resolved() { return this._post('input_resolved'); }

  /** Cron metadata (any field is optional). */
  setCron({ cronsActive, nextCronAt, nextCronName } = {}) {
    return this._post('heartbeat', { cronsActive, nextCronAt, nextCronName });
  }

  /**
   * Run an async function as a task: auto-reports start, complete, and error.
   *   const result = await av.task('Build artifacts', async () => doBuild());
   */
  async task(title, fn, { detail, tokensIn, tokensOut } = {}) {
    await this.startTask({ title, detail });
    try {
      const result = await fn(this);
      await this.completeTask({ tokensIn, tokensOut, result: 'ok' });
      return result;
    } catch (err) {
      await this.completeTask({ tokensIn, tokensOut, result: 'error', summary: err?.message || String(err) });
      throw err;
    }
  }

  /**
   * Ask the user a question and wait until the dashboard marks it resolved.
   *   await av.ask('OK to drop table users?');
   * Polls /api/agents every `pollMs`. Times out after `timeoutMs`.
   */
  async ask(prompt, { url, pollMs = 1000, timeoutMs = 30 * 60 * 1000 } = {}) {
    await this.notify(prompt, { url });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, pollMs));
      try {
        const list = await fetch(`${this.base}/api/agents`).then(r => r.json());
        const me = list.find(a => a.id === this.id);
        if (!me || !me.needsInput) return;
      } catch { /* keep polling */ }
    }
    throw new Error(`AgentView.ask("${prompt}") timed out`);
  }
}

export default AgentView;
