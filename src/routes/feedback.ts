import { Hono } from 'hono';
import { z } from 'zod';
import { query } from '../db/client.js';

export const feedbackRouter = new Hono();

const feedbackSchema = z.object({
  agent_id: z.string().min(1),
  task_id: z.string().optional(),
  score: z.number().min(0).max(1),
  comment: z.string().max(1000).optional(),
});

const PRIOR_WEIGHT = 10;

// POST /v1/feedback
feedbackRouter.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = feedbackSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
  }

  const { agent_id, task_id, score, comment } = parsed.data;

  // Check agent exists
  const agentResult = await query('SELECT id, benchmark_score, feedback_sample_count FROM agents WHERE id = $1', [agent_id]);
  if (agentResult.rows.length === 0) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  // Insert feedback
  await query(
    'INSERT INTO feedback (agent_id, task_id, score, comment) VALUES ($1, $2, $3, $4)',
    [agent_id, task_id || null, score, comment || null]
  );

  // Bayesian update
  const agent = agentResult.rows[0];
  const newSampleCount = agent.feedback_sample_count + 1;

  // Calculate new usage_score as running average of all feedback
  const avgResult = await query(
    'SELECT AVG(score) as avg_score FROM feedback WHERE agent_id = $1',
    [agent_id]
  );
  const usageScore = parseFloat(avgResult.rows[0].avg_score);

  // combined = (benchmark * prior_weight + usage_score * sample_count) / (prior_weight + sample_count)
  const benchmarkScore = parseFloat(agent.benchmark_score);
  const combinedScore = (benchmarkScore * PRIOR_WEIGHT + usageScore * newSampleCount) / (PRIOR_WEIGHT + newSampleCount);

  await query(
    `UPDATE agents SET 
       usage_score = $1, 
       combined_score = $2, 
       feedback_sample_count = $3,
       updated_at = NOW()
     WHERE id = $4`,
    [usageScore, combinedScore, newSampleCount, agent_id]
  );

  return c.json({
    accepted: true,
    agent_id,
    new_combined_score: Math.round(combinedScore * 1000) / 1000,
    sample_count: newSampleCount,
  });
});
