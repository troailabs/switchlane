import { serve } from '@hono/node-server';
import { config } from './config.js';
import app from './app.js';

console.log(`Switchlane starting on port ${config.PORT}...`);

serve({
  fetch: app.fetch,
  port: config.PORT,
}, (info) => {
  console.log(`Switchlane running at http://localhost:${info.port}`);
});
