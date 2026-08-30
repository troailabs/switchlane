import { Hono } from 'hono';
import { query } from '../db/client.js';

export const agentsRouter = new Hono();

// GET /v1/agents — list agents with pagination and filtering
agentsRouter.get('/', async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = (page - 1) * limit;
  const provider = c.req.query('provider');
  const status = c.req.query('status') || 'active';
  const search = c.req.query('search');

  let whereClause = 'WHERE status = $1';
  const params: any[] = [status];
  let paramIdx = 2;

  if (provider) {
    whereClause += ` AND provider = $${paramIdx}`;
    params.push(provider);
    paramIdx++;
  }

  if (search) {
    whereClause += ` AND (name ILIKE $${paramIdx} OR description ILIKE $${paramIdx})`;
    params.push(`%${search}%`);
    paramIdx++;
  }

  const countResult = await query(
    `SELECT COUNT(*) FROM agents ${whereClause}`,
    params
  );

  params.push(limit, offset);
  const result = await query(
    `SELECT id, name, description, provider, tags, combined_score, 
            pricing_model, pricing_unit_cost_usd, latency_p50_ms, status
     FROM agents ${whereClause}
     ORDER BY combined_score DESC
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    params
  );

  return c.json({
    agents: result.rows,
    pagination: {
      page,
      limit,
      total: parseInt(countResult.rows[0].count),
      pages: Math.ceil(parseInt(countResult.rows[0].count) / limit),
    },
  });
});

// GET /v1/agents/:id — agent detail with tools
agentsRouter.get('/:id', async (c) => {
  const id = c.req.param('id');

  const agentResult = await query('SELECT * FROM agents WHERE id = $1', [id]);
  if (agentResult.rows.length === 0) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const toolsResult = await query(
    'SELECT name, description, input_schema, output_schema FROM tools WHERE agent_id = $1',
    [id]
  );

  const agent = agentResult.rows[0];
  return c.json({
    ...agent,
    tools: toolsResult.rows,
    quality: {
      benchmark_score: parseFloat(agent.benchmark_score),
      usage_score: agent.usage_score ? parseFloat(agent.usage_score) : null,
      combined_score: parseFloat(agent.combined_score),
      sample_count: agent.feedback_sample_count,
    },
    latency: {
      p50_ms: agent.latency_p50_ms,
      p99_ms: agent.latency_p99_ms,
    },
  });
});

// GET /v1/agents/:id/benchmark — benchmark results
agentsRouter.get('/:id/benchmark', async (c) => {
  const id = c.req.param('id');

  const agentResult = await query(
    'SELECT id, name, benchmark_score, combined_score, feedback_sample_count FROM agents WHERE id = $1',
    [id]
  );
  if (agentResult.rows.length === 0) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const feedbackResult = await query(
    `SELECT score, created_at FROM feedback 
     WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [id]
  );

  const agent = agentResult.rows[0];
  return c.json({
    agent_id: agent.id,
    name: agent.name,
    benchmark_score: parseFloat(agent.benchmark_score),
    combined_score: parseFloat(agent.combined_score),
    sample_count: agent.feedback_sample_count,
    recent_feedback: feedbackResult.rows,
  });
});
