import app from './app.js';

const PORT = Number(process.env.PORT || 4317);
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`agent-view listening on http://localhost:${PORT}  (bound ${HOST}:${PORT})`);
});
