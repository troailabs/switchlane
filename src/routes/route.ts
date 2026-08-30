import { Hono } from 'hono';
import { z } from 'zod';
import { schemaMatch, dedupeByAgent } from '../mapper/schema-match.js';
import { extractTaskProfile, matchByProfile, rerankAgents, type RerankResult } from '../mapper/llm-intent.js';
import { rankAgents, type Constraints } from '../scorer/ranker.js';
import { executeViaAgent } from '../proxy/executor.js';
import { incrementUsage, type ApiKeyInfo } from '../auth.js';
import { reportStripeUsage } from '../billing/stripe.js';
import { query } from '../db/client.js';
import {
  getCachedProfile, setCachedProfile,
  getCachedRerank, setCachedRerank,
  getCachedEmbedding, setCachedEmbedding,
} from '../cache.js';

export const routeRouter = new Hono();

const routeRequestSchema = z.object({
  task: z.string().min(1).max(2000),
  input: z.record(z.any()).optional(),
  constraints: z.object({
    max_latency_ms: z.number().positive().optional(),
    max_cost_usd: z.number().positive().optional(),
    min_quality_score: z.number().min(0).max(1).optional(),
    quality_weight: z.number().min(0).max(1).optional(),
    cost_weight: z.number().min(0).max(1).optional(),
    latency_weight: z.number().min(0).max(1).optional(),
  }).optional(),
  execute: z.boolean().default(false),
  limit: z.number().min(1).max(20).default(5),
});

// POST /v1/route — main routing endpoint
routeRouter.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = routeRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
  }

  const req = parsed.data;
  const startTime = Date.now();

  // === Stage 1: PARALLEL — embedding search + LLM classify (both cached) ===
  const [embeddingMatches, taskProfile] = await Promise.all([
    (async () => {
      const cached = await getCachedEmbedding(req.task, '');
      if (cached) return cached;
      const results = await schemaMatch(req.task, { limit: 30 });
      setCachedEmbedding(req.task, '', results);
      return results;
    })(),
    (async () => {
      const cached = await getCachedProfile(req.task);
      if (cached) return cached;
      const profile = await extractTaskProfile(req.task);
      setCachedProfile(req.task, profile);
      return profile;
    })(),
  ]);

  const dedupedEmbedding = dedupeByAgent(embeddingMatches);

  // === Stage 2: Category-filtered embedding search ===
  // Use LLM-extracted category + keywords to find agents the unfiltered search missed
  let categoryMatches: typeof dedupedEmbedding = [];
  const categoryTags = [
    taskProfile.category,
    taskProfile.subcategory,
    ...taskProfile.keywords.slice(0, 5),
  ].filter(Boolean) as string[];

  if (categoryTags.length > 0) {
    const cacheKey = categoryTags.sort().join(',');
    const cached = await getCachedEmbedding(req.task, cacheKey);
    if (cached) {
      categoryMatches = dedupeByAgent(cached);
    } else {
      const filtered = await schemaMatch(req.task, {
        limit: 20,
        threshold: 0.35,
        categoryTags,
      });
      setCachedEmbedding(req.task, cacheKey, filtered);
      categoryMatches = dedupeByAgent(filtered);
    }
  }

  // === Stage 3: Merge all candidates ===
  const allMatches = dedupeByAgent([...dedupedEmbedding, ...categoryMatches]);

  // Also add LLM tag-based matches
  const llmTagMatches = await matchByProfile(taskProfile, 20);

  // Build candidate maps
  const matchReasons = new Map<string, string>();
  const matchSimilarities = new Map<string, number>();

  for (const m of allMatches) {
    matchReasons.set(m.agent_id, m.match_reason);
    matchSimilarities.set(m.agent_id, m.similarity);
  }
  for (const m of llmTagMatches) {
    if (!matchReasons.has(m.agent_id)) {
      matchReasons.set(m.agent_id, m.match_reason);
      matchSimilarities.set(m.agent_id, m.score * 0.7);
    }
  }

  // Determine match path
  const hasEmbeddingHit = dedupedEmbedding.length > 0 && dedupedEmbedding[0].similarity >= 0.55;
  let matchPath = hasEmbeddingHit && llmTagMatches.length > 0
    ? 'hybrid'
    : hasEmbeddingHit ? 'schema_match' : 'llm_intent';

  // === Stage 4: LLM Rerank top-20 candidates ===
  const allAgentIds = [...new Set([...matchReasons.keys()])];
  const top20Ids = allAgentIds.slice(0, 20);

  // Fetch candidate details for rerank
  let rerankScores = new Map<string, number>();
  if (top20Ids.length > 0) {
    // Check cache first
    const cachedRerank = await getCachedRerank(req.task, top20Ids);
    if (cachedRerank) {
      rerankScores = cachedRerank;
      matchPath = matchPath + '+rerank';
    } else {
      const candidateInfo = await query<{
      id: string; name: string; description: string; use_count: number;
    }>(
      `SELECT id, name, description, use_count FROM agents WHERE id = ANY($1) AND status = 'active'`,
      [top20Ids]
    );

    // Get tool names + input schema params per agent
    const toolInfo = await query<{ agent_id: string; tools: string[]; schemas: string[] }>(
      `SELECT agent_id,
              array_agg(name) as tools,
              array_agg(
                CASE WHEN input_schema IS NOT NULL AND input_schema != '{}'::jsonb
                THEN name || '(' || (SELECT string_agg(key, ',') FROM jsonb_object_keys(COALESCE(input_schema->'properties', '{}'::jsonb)) AS key) || ')'
                ELSE name END
              ) as schemas
       FROM tools WHERE agent_id = ANY($1) GROUP BY agent_id`,
      [top20Ids]
    );
    const toolMap = new Map(toolInfo.rows.map((r) => [r.agent_id, r.schemas || r.tools || []]));

    const candidates = candidateInfo.rows.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      tools: toolMap.get(a.id) || [],
      use_count: a.use_count,
    }));

    const rerankResults = await rerankAgents(req.task, candidates);
    for (const r of rerankResults) {
      rerankScores.set(r.agent_id, r.score);
    }
    if (rerankScores.size > 0) {
      matchPath = matchPath + '+rerank';
      setCachedRerank(req.task, top20Ids, rerankScores);
    }
    } // end else (cache miss)
  }

  // === Stage 5: Final ranking ===
  const constraints: Constraints = req.constraints || {};
  const ranked = await rankAgents(allAgentIds, matchReasons, matchSimilarities, constraints, rerankScores);
  const recommendations = ranked.slice(0, req.limit);

  const elapsed = Date.now() - startTime;

  // === Track usage ===
  const apiKey = (c as any).get('apiKey') as ApiKeyInfo | null;
  if (apiKey) {
    await incrementUsage(apiKey.id);
    if (apiKey.stripe_customer_id && apiKey.tier === 'paid') {
      reportStripeUsage(apiKey.stripe_customer_id, 1).catch(() => {});
    }
  }

  // === Log route request ===
  try {
    await query(
      `INSERT INTO route_logs (api_key_id, task_text, task_profile, recommended_agents, executed)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        apiKey?.id || null,
        req.task,
        JSON.stringify(taskProfile),
        recommendations.map((r) => r.agent_id),
        req.execute,
      ]
    );
  } catch {}

  // === Execute mode ===
  if (req.execute && recommendations.length > 0) {
    const bestAgent = recommendations[0];
    const execution = await executeViaAgent(bestAgent, req.task, req.input || {});

    return c.json({
      execution: {
        agent_id: execution.agent_id,
        agent_name: execution.agent_name,
        tool_used: execution.tool_used,
        success: execution.success,
        content: execution.content,
        error: execution.error,
        latency_ms: execution.latency_ms,
      },
      recommendations: recommendations.map((r) => ({
        agent_id: r.agent_id,
        provider: r.provider,
        quality_score: r.quality_score,
        estimated_cost_usd: r.estimated_cost_usd,
        estimated_latency_ms: r.estimated_latency_ms,
        match_reason: r.match_reason,
        endpoint: r.source_url,
      })),
      task_profile: taskProfile,
      meta: {
        match_path: matchPath,
        candidates_evaluated: allAgentIds.length,
        elapsed_ms: Date.now() - startTime,
      },
    });
  }

  return c.json({
    recommendations: recommendations.map((r) => ({
      agent_id: r.agent_id,
      provider: r.provider,
      quality_score: r.quality_score,
      estimated_cost_usd: r.estimated_cost_usd,
      estimated_latency_ms: r.estimated_latency_ms,
      match_reason: r.match_reason,
      endpoint: r.source_url,
    })),
    task_profile: taskProfile,
    meta: {
      match_path: matchPath,
      candidates_evaluated: allAgentIds.length,
      elapsed_ms: elapsed,
    },
  });
});
