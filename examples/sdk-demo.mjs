// Example of using the AgentView SDK from a Node script.
//   node examples/sdk-demo.mjs
//
// Override defaults with envs:
//   AV_URL=http://192.168.1.10:4317 AV_ID=my-agent node examples/sdk-demo.mjs

import { AgentView } from '../src/client.js';

const av = new AgentView({
  id: process.env.AV_ID || 'sdk-demo',
  name: process.env.AV_NAME || 'SDK Demo',
  tag: 'examples/sdk',
});

await av.register({ cronsActive: 2, nextCronName: 'nightly', nextCronAt: Date.now() + 60_000 });
console.log('registered. open the dashboard to see this agent.');

// Pattern 1: wrap an async function as a task.
await av.task('Warm caches', async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 800));
    await av.updateTask({ detail: `warming ${i + 1}/3` });
    await av.log(`cache ${i + 1} warmed`);
  }
  av.addTokens({ in: 1200, out: 600 });
}, { detail: 'preflight before main work' });

// Pattern 2: manual start/update/complete.
await av.startTask({ title: 'Build artifacts', detail: 'npm run build && tar' });
await new Promise(r => setTimeout(r, 1500));
await av.log('built in 1.4s');
await av.completeTask({ tokensIn: 2400, tokensOut: 1100, summary: 'shipped to staging' });

// Pattern 3: ask the user and wait for them to click "resolve".
console.log('asking the user a question — go click resolve on the dashboard.');
try {
  await av.ask('OK to publish v0.2.0?', { url: 'http://localhost:3000/release', timeoutMs: 60_000 });
  console.log('user resolved.');
  await av.task('Publish', async () => {
    await new Promise(r => setTimeout(r, 1000));
  });
} catch (e) {
  console.log('ask() timed out — continuing without permission.');
}

await av.goodbye();
console.log('done.');
