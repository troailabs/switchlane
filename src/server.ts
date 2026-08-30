import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { config } from './config.js';
import { authMiddleware } from './auth.js';
import { agentsRouter } from './routes/agents.js';
import { routeRouter } from './routes/route.js';
import { feedbackRouter } from './routes/feedback.js';
import { taxonomyRouter } from './routes/taxonomy.js';
import { billingRouter } from './billing/stripe.js';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors());

// Health check (no auth)
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Auth middleware for API routes
app.use('/v1/*', authMiddleware);

// API routes
app.route('/v1/agents', agentsRouter);
app.route('/v1/route', routeRouter);
app.route('/v1/feedback', feedbackRouter);
app.route('/v1/tasks', taxonomyRouter);
app.route('/v1/billing', billingRouter);

// 404
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

console.log(`Switchlane starting on port ${config.PORT}...`);

serve({
  fetch: app.fetch,
  port: config.PORT,
}, (info) => {
  console.log(`Switchlane running at http://localhost:${info.port}`);
});

export default app;
