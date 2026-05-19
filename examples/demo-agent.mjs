// Tiny demo agent. Run multiple copies with different AV_ID / AV_NAME envs:
//   AV_ID=alpha AV_NAME=Alpha node examples/demo-agent.mjs
//   AV_ID=beta  AV_NAME=Beta  node examples/demo-agent.mjs
//
// It registers, starts a task, occasionally asks for input, then completes.

const URL = (process.env.AV_URL || 'http://localhost:4317').replace(/\/$/, '');
const id = process.env.AV_ID || `demo_${Math.random().toString(36).slice(2, 6)}`;
const name = process.env.AV_NAME || id;

async function post(event) {
  await fetch(`${URL}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: id, name, ...event }),
  }).catch(e => console.error('post failed', e.message));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const tasks = [
  ['Refactor auth middleware', 'Splitting token validation from request parsing'],
  ['Wire up health endpoint', 'Adds /health for the load balancer'],
  ['Migrate users table', 'Adding nullable preferences column'],
  ['Triage failing tests', 'Three flaky tests since last deploy'],
];

await post({ type: 'register' });
console.log(`[${name}] registered as ${id} at ${URL}`);

const heart = setInterval(() => post({ type: 'heartbeat' }), 15000);
process.on('SIGINT', async () => {
  clearInterval(heart);
  await post({ type: 'goodbye' });
  process.exit(0);
});

while (true) {
  const [title, detail] = tasks[Math.floor(Math.random() * tasks.length)];
  const taskId = `t_${Date.now()}`;
  await post({ type: 'task_start', taskId, title, detail });

  const steps = 3 + Math.floor(Math.random() * 3);
  for (let i = 1; i <= steps; i++) {
    await sleep(2000 + Math.random() * 3000);
    await post({ type: 'task_update', taskId, detail: `step ${i}/${steps}`, progress: i / steps });
  }

  if (Math.random() < 0.35) {
    await post({
      type: 'needs_input',
      prompt: 'Confirm: continue with destructive migration?',
      url: 'http://localhost:3000/approval',
    });
    console.log(`[${name}] asked for input, waiting…`);
    await sleep(8000 + Math.random() * 4000);
    await post({ type: 'input_resolved' });
  }

  const tokensIn = 500 + Math.floor(Math.random() * 4000);
  const tokensOut = 200 + Math.floor(Math.random() * 1500);
  await post({
    type: 'task_complete',
    taskId,
    tokensIn, tokensOut,
    result: Math.random() < 0.9 ? 'ok' : 'error',
    summary: 'Demo run complete',
  });
  await sleep(2000 + Math.random() * 4000);
}
