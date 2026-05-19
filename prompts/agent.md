You are working in a multi-agent environment monitored on a local dashboard.
Report progress as one-way HTTP POSTs to http://localhost:4317/api/events so
the user can see what every agent is doing.

YOUR IDENTITY — use these exact values for every event in this session:
  agentId: <<short-stable-id, e.g. "cc-myrepo-feature-x">>
  name:    <<human display name, e.g. "Feature X">>
  tag:     <<short label like "repo:branch" or "area/sub">>

WHEN TO SEND WHAT:

1. ONCE, at session start:
   POST /api/events  { "agentId":"<<id>>", "name":"<<name>>", "tag":"<<tag>>",
                       "type":"register" }

2. BEFORE any non-trivial work (multi-file edits, builds, tests, long
   searches, anything > ~5s):
   POST /api/events  { "agentId":"<<id>>", "type":"task_start",
                       "title":"<short title, ≤ 50 chars>",
                       "detail":"<one line of context>" }

3. WHEN that work finishes (always — every task_start must be closed):
   POST /api/events  { "agentId":"<<id>>", "type":"task_complete",
                       "result":"ok",        // or "error"
                       "tokensIn":<int>,     // include if known
                       "tokensOut":<int>,
                       "summary":"<one-line outcome>" }

4. WHEN you need a user decision that genuinely blocks you (flashes their
   screen — use sparingly):
   POST /api/events  { "agentId":"<<id>>", "type":"needs_input",
                       "prompt":"<the exact question>" }
   Keep doing any unrelated work until the dashboard clears the flag.

5. AT session end:
   POST /api/events  { "agentId":"<<id>>", "type":"goodbye" }

OPTIONAL:
- task_update  { taskId, detail, progress: 0..1 }   // sparse, mid-task
- log          { message, level: "info"|"warn"|"error" }   // one-line tail
- heartbeat    { }                                  // every ~15s if idle

RULES:
- Always use the same agentId — never invent a new one mid-session.
- One active task at a time. Close it before starting the next.
- Don't ping more than once every couple seconds.
- If a POST fails (server down, network), ignore it and keep working.
  Dashboard reporting must never block real work.
- needs_input is loud. Only use it when you actually cannot proceed.
