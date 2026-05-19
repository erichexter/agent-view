// Orchestrates a few "agents" posting to the dashboard so the UI has life.
// Usage: node examples/multi-demo.mjs
const URL = (process.env.AV_URL || 'http://localhost:4317').replace(/\/$/, '');
async function post(agent, ev) {
  await fetch(`${URL}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: agent.id, name: agent.name, ...ev }),
  }).catch(e => console.error('post failed', e.message));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];

const AGENTS = [
  { id: 'alpha',   name: 'alpha',   tag: 'web/main',     cronsActive: 3, nextCronName: 'nightly-report' },
  { id: 'beta',    name: 'beta',    tag: 'api/release',  cronsActive: 1, nextCronName: 'health-check'   },
  { id: 'gamma',   name: 'gamma',   tag: 'infra/iac',    cronsActive: 0, nextCronName: null             },
  { id: 'delta',   name: 'delta',   tag: 'data/etl',     cronsActive: 5, nextCronName: 'index-rebuild'  },
  { id: 'epsilon', name: 'epsilon', tag: 'mobile/ios',   cronsActive: 2, nextCronName: 'crash-digest'   },
  { id: 'zeta',    name: 'zeta',    tag: 'mobile/and',   cronsActive: 2, nextCronName: 'play-publish'   },
  { id: 'eta',     name: 'eta',     tag: 'ml/training',  cronsActive: 1, nextCronName: 'eval-sweep'     },
  { id: 'theta',   name: 'theta',   tag: 'ops/observ',   cronsActive: 4, nextCronName: 'slo-rollup'     },
  { id: 'iota',    name: 'iota',    tag: 'docs/site',    cronsActive: 0, nextCronName: null             },
  { id: 'kappa',   name: 'kappa',   tag: 'sec/scan',     cronsActive: 6, nextCronName: 'cve-sweep'      },
];

const LOGS = [
  'tests: 142 passed, 0 failed',
  'fetched 320 records from upstream',
  'cache hit ratio 0.83',
  'rerun retry 1/3 after 502',
  'lint clean',
  'compiled in 4.1s',
  'git push origin HEAD → ok',
  'released v0.7.3 to staging',
];

function cronFields(agent) {
  if (!agent.cronsActive) return { cronsActive: 0 };
  // Next fire 5–180s from now, jittered. In real life this is the agent's scheduler talking.
  return {
    cronsActive: agent.cronsActive,
    nextCronName: agent.nextCronName,
    nextCronAt: Date.now() + Math.floor(rand(5_000, 180_000)),
  };
}

const WORK = [
  ['Refactor auth middleware',     'splitting token validation from parsing'],
  ['Migrate users table',          'backfill preferences column'],
  ['Triage failing tests',         'three flaky tests since last deploy'],
  ['Build release artifacts',      'tagging v2.4.1 and pushing assets'],
  ['Wire up health endpoint',      'adds /health for the load balancer'],
  ['Sweep unused exports',         'using ts-prune across packages'],
  ['Regenerate API client',        'from updated OpenAPI spec'],
  ['Patch dependency CVE',         'lodash 4.17.20 → 4.17.21'],
];

const QUESTIONS = [
  'OK to drop legacy session_index?',
  'Confirm destructive migration on production?',
  'Two test names collide — keep both?',
  'Bump major version? (breaking change)',
  'Found 2 secrets in .env.example — redact?',
];

async function runAgent(agent) {
  await post(agent, { type: 'register', tag: agent.tag, ...cronFields(agent) });
  // small jitter so they don't all start in lockstep
  await sleep(rand(200, 1500));
  let stalledNext = Math.random() < 0.25; // one agent (≈) will stall once
  setInterval(() => {
    if (stalledNext) return; // skip heartbeats to simulate stall
    post(agent, { type: 'heartbeat', tag: agent.tag, ...cronFields(agent) });
  }, 15000);

  while (true) {
    const [title, detail] = pick(WORK);
    const taskId = `t_${Date.now()}_${Math.random().toString(36).slice(2,5)}`;
    await post(agent, { type: 'task_start', taskId, title, detail });

    const steps = 3 + Math.floor(Math.random() * 4);
    for (let i = 1; i <= steps; i++) {
      await sleep(rand(1500, 3500));
      await post(agent, { type: 'task_update', taskId, detail: `step ${i}/${steps}`, progress: i / steps });
      if (Math.random() < 0.4) await post(agent, { type: 'log', message: pick(LOGS) });
    }

    if (Math.random() < 0.4) {
      await post(agent, {
        type: 'needs_input',
        prompt: pick(QUESTIONS),
        url: 'http://localhost:3000/approve',
      });
      // wait until externally resolved OR auto-resolve after 12-25s
      await sleep(rand(12000, 25000));
      await post(agent, { type: 'input_resolved' });
    }

    const tokensIn = Math.floor(rand(400, 5000));
    const tokensOut = Math.floor(rand(150, 1800));
    await post(agent, {
      type: 'task_complete',
      taskId,
      tokensIn, tokensOut,
      result: Math.random() < 0.92 ? 'ok' : 'error',
      summary: Math.random() < 0.5 ? '' : 'looks good',
    });
    await sleep(rand(1000, 4000));
  }
}

console.log(`Driving ${AGENTS.length} demo agents against ${URL}`);
await Promise.all(AGENTS.map(runAgent));
