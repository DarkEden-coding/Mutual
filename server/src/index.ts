import { serve } from '@hono/node-server';
import { createApp } from './app.js';
const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
const runtime = createApp();
const server = serve({ fetch: runtime.app.fetch, port }, () => console.log(`Mutual listening on http://localhost:${port}`));
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  runtime.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
