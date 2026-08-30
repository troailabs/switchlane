import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { authMiddleware } from './auth.js';
import { agentsRouter } from './routes/agents.js';
import { routeRouter } from './routes/route.js';
import { feedbackRouter } from './routes/feedback.js';
import { taxonomyRouter } from './routes/taxonomy.js';
import { billingRouter } from './billing/stripe.js';

export function createApp() {
  const app = new Hono();

  app.use('*', logger());
  app.use('*', cors());

  app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

  app.use('/v1/*', authMiddleware);
  app.route('/v1/agents', agentsRouter);
  app.route('/v1/route', routeRouter);
  app.route('/v1/feedback', feedbackRouter);
  app.route('/v1/tasks', taxonomyRouter);
  app.route('/v1/billing', billingRouter);

  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  app.onError((err, c) => {
    console.error('Unhandled error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}

const app = createApp();

export default app;