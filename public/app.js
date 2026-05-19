const grid = document.getElementById('agentGrid');
const empty = document.getElementById('emptyAgents');
const tabs = document.getElementById('agentTabs');
const triage = document.getElementById('triage');
const hiddenHint = document.getElementById('hiddenHint');
const histBody = document.querySelector('#historyTable tbody');
const connDot = document.getElementById('connDot');
const agentCount = document.getElementById('agentCount');
const waitingCount = document.getElementById('waitingCount');
const compactToggle = document.getElementById('compactToggle');
const soundToggle = document.getElementById('soundToggle');
const notifyToggle = document.getElementById('notifyToggle');
const clockEl = document.getElementById('clock');
const footerStatus = document.getElementById('footerStatus');

const STALL_MS    = 60 * 1000;
const BURN_HOT    = 50_000;  // tok/min — threshold for "hot" highlight
const COMPACT_KEY = 'av.compact.v1';

compactToggle.checked = localStorage.getItem(COMPACT_KEY) === '1';
applyCompact();
compactToggle.addEventListener('change', () => {
  localStorage.setItem(COMPACT_KEY, compactToggle.checked ? '1' : '0');
  applyCompact();
  render();
});
function applyCompact() {
  document.body.classList.toggle('compact', compactToggle.checked);
}

function effectiveStatus(a) {
  if (a.status === 'working' && a.lastSeen && (Date.now() - a.lastSeen) > STALL_MS) return 'stalled';
  return a.status;
}
function statusLabel(s) {
  return s === 'stalled' ? 'stalled' : s;
}
document.getElementById('refreshHistory').addEventListener('click', loadHistory);

const ORDER_KEY = 'av.order.v1';
const state = {
  agents: new Map(),
  prevWaiting: new Set(),
  order: JSON.parse(localStorage.getItem(ORDER_KEY) || '[]'),
};
function persistOrder() { localStorage.setItem(ORDER_KEY, JSON.stringify(state.order)); }
function reconcileOrder(ids) {
  // Keep known order; append any new ids; drop ids no longer present.
  const present = new Set(ids);
  state.order = state.order.filter(id => present.has(id));
  for (const id of ids) if (!state.order.includes(id)) state.order.push(id);
}
function moveOrder(dragId, targetId, position /* 'before' | 'after' */) {
  if (dragId === targetId) return;
  const from = state.order.indexOf(dragId);
  if (from < 0) return;
  state.order.splice(from, 1);
  let to = state.order.indexOf(targetId);
  if (to < 0) to = state.order.length;
  if (position === 'after') to += 1;
  state.order.splice(to, 0, dragId);
  persistOrder();
  render();
}

function statusGlyph(s) {
  return s === 'working' ? '●'
       : s === 'waiting' ? '⚠'
       : s === 'stalled' ? '✕'
       : s === 'idle'    ? '○'
       :                   '·';
}
function scrollToAgent(id) {
  const el = grid.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('jump');
  setTimeout(() => el.classList.remove('jump'), 1200);
}

/* ── Web Audio beep ── */
let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    [880, 660].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square'; osc.frequency.value = freq;
      const start = now + i * 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start); osc.stop(start + 0.16);
    });
  } catch {}
}

/* ── Notifications ── */
notifyToggle.addEventListener('change', async () => {
  if (notifyToggle.checked && 'Notification' in window) {
    if (Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') notifyToggle.checked = false;
    }
  }
});

/* ── Keyboard shortcuts ── */
document.addEventListener('keydown', e => {
  // Bail on text fields, but NOT on checkboxes / buttons — those steal focus
  // after a click and would otherwise swallow our shortcuts.
  if (e.target.matches('input[type="text"], input[type="search"], textarea, [contenteditable]')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 's' || e.key === 'S') { soundToggle.checked = !soundToggle.checked; flash('sound: ' + (soundToggle.checked ? 'on' : 'off')); }
  if (e.key === 'n' || e.key === 'N') { notifyToggle.checked = !notifyToggle.checked; notifyToggle.dispatchEvent(new Event('change')); flash('notify: ' + (notifyToggle.checked ? 'on' : 'off')); }
  if (e.key === 'r' || e.key === 'R') { loadHistory(); flash('history reloaded'); }
  if (e.key === 'c' || e.key === 'C') {
    compactToggle.checked = !compactToggle.checked;
    compactToggle.dispatchEvent(new Event('change'));
    flash('compact: ' + (compactToggle.checked ? 'on' : 'off'));
  }
  if (e.key === 'j' || e.key === 'J') stepTriage(+1);
  if (e.key === 'k' || e.key === 'K') stepTriage(-1);
  if (e.key === 'Enter') {
    const list = waitingList();
    const focus = list[state.triageIdx] || list[0];
    if (focus) {
      fetch(`/api/agents/${encodeURIComponent(focus.id)}/resolve`, { method: 'POST' });
      flash(`resolved ${focus.id}`);
    }
  }
});

function waitingList() {
  return [...state.agents.values()].filter(a => a.needsInput);
}
function stepTriage(dir) {
  const list = waitingList();
  if (!list.length) { flash('no agents waiting'); return; }
  state.triageIdx = ((state.triageIdx ?? -1) + dir + list.length) % list.length;
  const a = list[state.triageIdx];
  scrollToAgent(a.id);
  flash(`focus: ${a.id}  (${state.triageIdx + 1}/${list.length})`);
  renderTriage();
}

let flashTimer = null;
function flash(msg) {
  footerStatus.textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { footerStatus.textContent = 'ready'; }, 2000);
}

/* ── Helpers ── */
function fmtRel(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 1000) return 'now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleString();
}
function fmtDur(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
}
function fmtCountdown(ts) {
  if (!ts) return null;
  let ms = ts - Date.now();
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
function fmtTokens(n) {
  if (n == null) return '—';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1) + 'k';
  return (n / 1_000_000).toFixed(2) + 'M';
}
function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false });
}
function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

/* ── Clock ── */
function tickClock() {
  const d = new Date();
  clockEl.textContent = d.toLocaleTimeString([], { hour12: false });
}
setInterval(tickClock, 1000); tickClock();

/* ── Rendering ── */
function renderTriage() {
  const list = waitingList();
  if (!list.length) { triage.hidden = true; triage.innerHTML = ''; state.triageIdx = null; return; }
  if (state.triageIdx == null || state.triageIdx >= list.length) state.triageIdx = 0;
  const focus = list[state.triageIdx];
  triage.hidden = false;
  triage.innerHTML = `
    <span class="bang">!</span>
    <span class="label">${list.length} waiting</span>
    <span class="chips">${list.map((a, i) => `
      <button class="triage-chip${i === state.triageIdx ? ' on' : ''}" data-id="${escapeHTML(a.id)}" data-idx="${i}">
        ${escapeHTML(a.name || a.id)}
      </button>`).join('')}</span>
    <span class="keys"><span class="k">[j]</span> next  <span class="k">[k]</span> prev  <span class="k">[⏎]</span> resolve</span>
    <span class="focus">${escapeHTML(focus.needsInput?.prompt || '')}</span>
    <span class="actions">
      <button data-action="resolve" data-id="${escapeHTML(focus.id)}"><span class="k">⏎</span> resolve ${escapeHTML(focus.id)}</button>
    </span>
  `;
}
triage.addEventListener('click', e => {
  const chip = e.target.closest('.triage-chip');
  if (chip) {
    state.triageIdx = Number(chip.dataset.idx);
    scrollToAgent(chip.dataset.id);
    renderTriage();
    return;
  }
  const btn = e.target.closest('button[data-action="resolve"]');
  if (btn) {
    fetch(`/api/agents/${encodeURIComponent(btn.dataset.id)}/resolve`, { method: 'POST' });
    flash(`resolved ${btn.dataset.id}`);
  }
});

function render() {
  renderTriage();
  // Stable order: user-defined drag order, falling back to registration time.
  const all = [...state.agents.values()];
  all.sort((a, b) => (a.firstSeen || 0) - (b.firstSeen || 0) || a.id.localeCompare(b.id));
  reconcileOrder(all.map(a => a.id));
  const rank = new Map(state.order.map((id, i) => [id, i]));
  const agents = all.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));

  agentCount.textContent = `${agents.length} agent${agents.length === 1 ? '' : 's'}`;
  const waiting = agents.filter(a => a.needsInput).length;
  waitingCount.textContent = waiting ? `${waiting} WAITING` : `0 waiting`;
  waitingCount.classList.toggle('alert', waiting > 0);
  empty.style.display = agents.length ? 'none' : 'block';

  // Tab strip (always renders ALL agents)
  tabs.innerHTML = agents.map(a => {
    const eff = effectiveStatus(a);
    return `
    <button class="tab status-${eff}" data-id="${escapeHTML(a.id)}"
            draggable="true"
            title="${escapeHTML(eff)} — click to jump, drag to reorder">
      <span class="glyph">${statusGlyph(eff)}</span>
      <span class="name">${escapeHTML(a.name || a.id)}</span>
      <span class="count">${a.completedCount || 0}</span>
    </button>`; }).join('');

  hiddenHint.style.display = 'none';

  if (compactToggle.checked) { renderCompact(agents); return; }

  grid.innerHTML = agents.map(a => {
    const cur = a.currentTask;
    const needs = a.needsInput;
    const eff = effectiveStatus(a);
    const klass = ['card', `is-${eff}`, needs ? 'needs-input' : ''].filter(Boolean).join(' ');
    const taskBlock = cur
      ? `<span class="label">task: </span><span class="title">${escapeHTML(cur.title)}</span>${cur.detail ? `<span class="detail">${escapeHTML(cur.detail)}</span>` : ''}`
      : `<span class="label">last: </span><span class="title">${escapeHTML(a.lastTaskTitle || '—')}</span>`;
    const needsBlock = needs
      ? `<div class="prompt">${escapeHTML(needs.prompt)}</div>` : '';
    const linkBtn = needs?.url
      ? `<a class="link" href="${escapeHTML(needs.url)}" target="_blank" rel="noopener">open ↗</a>` : '';
    const since = cur?.startedAt
      ? `<span><span class="k">since</span> <span data-rel-ts="${cur.startedAt}">${fmtRel(cur.startedAt)}</span></span>` : '';
    const lastSeen = `<span><span class="k">⏱</span> <span data-rel-ts="${a.lastSeen}">${fmtRel(a.lastSeen)}</span></span>`;
    const cronCount = a.cronsActive
      ? `<span><span class="k">⏲</span> ${a.cronsActive} cron${a.cronsActive === 1 ? '' : 's'}</span>` : '';
    const nextCron = a.nextCronAt
      ? `<span><span class="k">next</span> <span data-countdown-ts="${a.nextCronAt}">${fmtCountdown(a.nextCronAt)}</span>${a.nextCronName ? ` <span class="k">·</span> ${escapeHTML(a.nextCronName)}` : ''}</span>` : '';
    const tagChip = a.tag ? `<span class="tag" title="tag">${escapeHTML(a.tag)}</span>` : '';
    const burn = a.burnRate || 0;
    const burnSpan = burn
      ? `<span class="${burn > BURN_HOT ? 'hot' : ''}"><span class="k">↯</span> ${fmtTokens(burn)}/min</span>` : '';
    const log = a.lastLog?.message
      ? `<div class="logline" data-rel-ts="${a.lastLog.ts}" title="${escapeHTML(new Date(a.lastLog.ts).toLocaleString())}">
           <span class="k">log</span> ${escapeHTML(a.lastLog.message)}
         </div>` : '';
    return `
      <div class="${klass}" data-id="${escapeHTML(a.id)}" draggable="true">
        <div class="barhead">
          <span class="grip" title="drag to reorder">⋮⋮</span>
          <span class="name">${escapeHTML(a.name || a.id)}</span>
          ${tagChip}
          <span class="status ${eff}">${statusLabel(eff)}</span>
        </div>
        <div class="body">
          <div class="task">${taskBlock}</div>
          ${log}
          ${needsBlock}
          <div class="meta-row">
            ${since || lastSeen}
            <span><span class="k">✓</span> ${a.completedCount || 0} done</span>
            <span><span class="k">∑</span> ${fmtTokens(a.totalTokens || 0)} tok</span>
            ${burnSpan}
            ${cronCount}${nextCron}
          </div>
          <div class="actions">
            ${needs ? `<button data-action="resolve"><span class="key">⏎</span>resolve</button>` : ''}
            ${linkBtn}
            <button data-action="forget">forget</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderCompact(agents) {
  grid.innerHTML = `
    <table class="compact-table">
      <thead><tr>
        <th></th><th>agent</th><th>tag</th><th>task</th>
        <th>last log</th><th>tokens</th><th>↯/min</th><th>next cron</th><th>seen</th><th></th>
      </tr></thead>
      <tbody>
        ${agents.map(a => {
          const eff = effectiveStatus(a);
          const cur = a.currentTask;
          const needs = a.needsInput;
          const next = a.nextCronAt ? `<span data-countdown-ts="${a.nextCronAt}">${fmtCountdown(a.nextCronAt)}</span>${a.nextCronName ? ` <span class="k">·</span> ${escapeHTML(a.nextCronName)}` : ''}` : '—';
          const burn = a.burnRate || 0;
          return `
            <tr class="row is-${eff}${needs ? ' needs-input' : ''}" data-id="${escapeHTML(a.id)}" draggable="true">
              <td class="status-cell"><span class="status ${eff}">${statusLabel(eff)}</span></td>
              <td class="agent">${escapeHTML(a.name || a.id)}</td>
              <td class="tag-cell">${a.tag ? `<span class="tag">${escapeHTML(a.tag)}</span>` : ''}</td>
              <td class="task">${cur ? escapeHTML(cur.title) : (a.lastTaskTitle ? `<span class="dim">${escapeHTML(a.lastTaskTitle)}</span>` : '—')}${needs ? ` <span class="needs-mark">⚠ ${escapeHTML(needs.prompt)}</span>` : ''}</td>
              <td class="logcell dim">${a.lastLog?.message ? escapeHTML(a.lastLog.message) : ''}</td>
              <td class="tokens">${fmtTokens(a.totalTokens || 0)}</td>
              <td class="burn ${burn > BURN_HOT ? 'hot' : ''}">${burn ? fmtTokens(burn) : '—'}</td>
              <td class="next">${next}</td>
              <td class="seen dim" data-rel-ts="${a.lastSeen}">${fmtRel(a.lastSeen)}</td>
              <td class="row-actions">
                ${needs ? `<button data-action="resolve">⏎</button>` : ''}
                <button data-action="forget">×</button>
              </td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

tabs.addEventListener('click', e => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  scrollToAgent(btn.dataset.id);
});

/* ── Drag-to-reorder (tabs + cards share the same order) ── */
let dragId = null;
function attachDnD(container, itemSelector, axis /* 'x' | 'y' */) {
  container.addEventListener('dragstart', e => {
    const el = e.target.closest(itemSelector);
    if (!el) return;
    // Don't start a drag from inner action buttons or links inside a card/row.
    if ((el.classList.contains('card') || el.classList.contains('row')) &&
        e.target.closest('.actions, .row-actions, a')) {
      e.preventDefault(); return;
    }
    dragId = el.dataset.id;
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragId); } catch {}
  });
  container.addEventListener('dragend', e => {
    const el = e.target.closest(itemSelector);
    if (el) el.classList.remove('dragging');
    container.querySelectorAll('.drop-before, .drop-after').forEach(n => n.classList.remove('drop-before', 'drop-after'));
    dragId = null;
  });
  container.addEventListener('dragover', e => {
    if (!dragId) return;
    const over = e.target.closest(itemSelector);
    if (!over || over.dataset.id === dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    container.querySelectorAll('.drop-before, .drop-after').forEach(n => n.classList.remove('drop-before', 'drop-after'));
    const r = over.getBoundingClientRect();
    const before = axis === 'x'
      ? (e.clientX - r.left) < r.width / 2
      : (e.clientY - r.top) < r.height / 2;
    over.classList.add(before ? 'drop-before' : 'drop-after');
  });
  container.addEventListener('drop', e => {
    const over = e.target.closest(itemSelector);
    if (!over || !dragId || over.dataset.id === dragId) return;
    e.preventDefault();
    const r = over.getBoundingClientRect();
    const before = axis === 'x'
      ? (e.clientX - r.left) < r.width / 2
      : (e.clientY - r.top) < r.height / 2;
    moveOrder(dragId, over.dataset.id, before ? 'before' : 'after');
  });
}
attachDnD(tabs, '.tab', 'x');
attachDnD(grid, '.card, .row', 'y');

grid.addEventListener('click', async e => {
  const btn = e.target.closest('button, a');
  if (!btn) return;
  const host = e.target.closest('.card, .row');
  const id = host?.dataset.id;
  if (!id) return;
  const action = btn.dataset.action;
  if (action === 'resolve') {
    await fetch(`/api/agents/${encodeURIComponent(id)}/resolve`, { method: 'POST' });
    flash(`resolved ${id}`);
  } else if (action === 'forget') {
    if (!confirm(`Forget agent "${id}"?`)) return;
    await fetch(`/api/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.agents.delete(id);
    render();
  }
});

function alertWaiting(agent) {
  if (state.prevWaiting.has(agent.id)) return;
  state.prevWaiting.add(agent.id);
  if (soundToggle.checked) beep();
  if (notifyToggle.checked && 'Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(`${agent.name || agent.id} needs input`, {
      body: agent.needsInput?.prompt || '',
      requireInteraction: true,
    });
    n.onclick = () => { window.focus(); n.close(); };
  }
  document.title = '! agent-view (needs input)';
  flash(`! ${agent.id} needs input`);
}
function clearAlert(id) {
  state.prevWaiting.delete(id);
  if (![...state.agents.values()].some(a => a.needsInput)) {
    document.title = 'agent-view';
  }
}

function applyAgent(a) {
  const before = state.agents.get(a.id);
  // Preserve a "lastTaskTitle" so idle/offline cards still show something useful
  if (before?.currentTask && !a.currentTask) a.lastTaskTitle = before.currentTask.title;
  else if (before?.lastTaskTitle && !a.currentTask) a.lastTaskTitle = before.lastTaskTitle;
  state.agents.set(a.id, a);
  if (a.needsInput) alertWaiting(a);
  else if (before?.needsInput) clearAlert(a.id);
}

async function loadHistory() {
  const r = await fetch('/api/tasks?limit=100').then(r => r.json());
  histBody.innerHTML = r.map(t => `
    <tr>
      <td class="when">${escapeHTML(fmtTime(t.finishedAt))}</td>
      <td class="agent">${escapeHTML(t.agentId)}</td>
      <td>${escapeHTML(t.title || '')}${t.summary ? `<div style="color:var(--fg-muted);font-size:11px">${escapeHTML(t.summary)}</div>` : ''}</td>
      <td class="dur">${fmtDur(t.durationMs)}</td>
      <td class="tokens">${fmtTokens(t.tokens)}</td>
      <td class="${t.result === 'error' ? 'result-error' : 'result-ok'}">${escapeHTML(t.result || 'ok')}</td>
    </tr>
  `).join('');
}

function connect() {
  const es = new EventSource('/api/stream');
  es.onopen = () => { connDot.classList.add('live'); flash('connected'); };
  es.onerror = () => { connDot.classList.remove('live'); footerStatus.textContent = 'disconnected — retrying…'; };
  es.onmessage = e => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'hello') {
      state.agents.clear();
      for (const a of msg.snapshot.agents) applyAgent(a);
      render();
      loadHistory();
      return;
    }
    if (msg.type === 'agent' || msg.type === 'needs_input') {
      applyAgent(msg.agent);
      render();
    } else if (msg.type === 'task_complete') {
      applyAgent(msg.agent);
      render();
      loadHistory();
    } else if (msg.type === 'agent_removed') {
      state.agents.delete(msg.id);
      render();
    }
  };
}
connect();

/* Targeted ticker: rewrites time-sensitive spans without re-rendering the grid.
   Safe to run during a drag. */
setInterval(() => {
  document.querySelectorAll('[data-countdown-ts]').forEach(el => {
    const ts = Number(el.dataset.countdownTs);
    el.textContent = fmtCountdown(ts);
  });
  document.querySelectorAll('[data-rel-ts]').forEach(el => {
    const ts = Number(el.dataset.relTs);
    el.textContent = fmtRel(ts);
  });
}, 1000);
