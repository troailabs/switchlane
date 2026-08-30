import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app.js';
import { closeCache } from '../src/cache.js';
import { closeDb } from '../src/db/client.js';
import { seedDemoCatalog } from '../src/demo/seed.js';

async function api(method: string, path: string, body?: unknown, apiKey?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  const res = await app.request(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() as any };
}

describe('Switchlane API', () => {
  let testApiKey: string;

  beforeAll(async () => {
    await seedDemoCatalog();
  }, 120_000);

  afterAll(async () => {
    await closeCache();
    await closeDb();
  });

  describe('Health', () => {
    it('returns ok', async () => {
      const { status, data } = await api('GET', '/health');
      expect(status).toBe(200);
      expect(data.status).toBe('ok');
    });
  });

  describe('Billing', () => {
    it('registers and returns API key', async () => {
      const { status, data } = await api('POST', '/v1/billing/register', { email: 'test@vitest.dev' });
      expect(status).toBe(200);
      expect(data.api_key).toMatch(/^sl_live_/);
      expect(data.tier).toBe('free');
      expect(data.monthly_limit).toBe(1000);
      testApiKey = data.api_key;
    });

    it('returns usage stats', async () => {
      const { status, data } = await api('GET', '/v1/billing/usage', undefined, testApiKey);
      expect(status).toBe(200);
      expect(data.tier).toBe('free');
      expect(data.requests_this_month).toBeTypeOf('number');
    });
  });

  describe('Agents', () => {
    it('lists agents with pagination', async () => {
      const { status, data } = await api('GET', '/v1/agents?limit=5');
      expect(status).toBe(200);
      expect(data.agents).toBeInstanceOf(Array);
      expect(data.agents.length).toBeLessThanOrEqual(5);
      expect(data.pagination.total).toBeGreaterThan(0);
    });

    it('searches agents', async () => {
      const { status, data } = await api('GET', '/v1/agents?search=Math Solver');
      expect(status).toBe(200);
      expect(data.agents.some((a: any) => a.name.toLowerCase().includes('math'))).toBe(true);
    });

    it('returns agent detail', async () => {
      const { status, data } = await api('GET', '/v1/agents/demo-math-solver');
      expect(status).toBe(200);
      expect(data.id).toBe('demo-math-solver');
      expect(data.tools).toBeInstanceOf(Array);
      expect(data.tools.length).toBeGreaterThan(0);
    });

    it('returns 404 for unknown agent', async () => {
      const { status } = await api('GET', '/v1/agents/nonexistent-agent-xyz');
      expect(status).toBe(404);
    });
  });

  describe('Routing', () => {
    it('routes a math task to math agent', async () => {
      const { status, data } = await api('POST', '/v1/route', {
        task: 'Calculate compound interest for this principal and annual rate',
        limit: 5,
      }, testApiKey);
      expect(status).toBe(200);
      expect(data.recommendations).toBeInstanceOf(Array);
      expect(data.task_profile).toBeDefined();
      expect(data.meta.elapsed_ms).toBeTypeOf('number');
      expect(data.meta.abstained).toBe(false);
      expect(data.recommendations[0].agent_id).toBe('demo-math-solver');
    });

    it('routes a search task', async () => {
      const { status, data } = await api('POST', '/v1/route', {
        task: 'Research the latest browser automation tools and cite sources',
        limit: 3,
      }, testApiKey);
      expect(status).toBe(200);
      expect(data.recommendations.length).toBeGreaterThan(0);
      expect(data.recommendations[0].agent_id).toBe('demo-web-researcher');
      expect(data.meta.match_path).toMatch(/schema_match|llm_intent|hybrid/);
    });

    it('routes a Slack task via schema match', async () => {
      const { status, data } = await api('POST', '/v1/route', {
        task: 'Send a message on Slack',
        limit: 3,
      }, testApiKey);
      expect(status).toBe(200);
      const slackAgent = data.recommendations.find((r: any) => r.agent_id.includes('slack'));
      expect(slackAgent).toBeDefined();
    });

    it('rejects invalid request', async () => {
      const { status } = await api('POST', '/v1/route', { task: '' });
      expect(status).toBe(400);
    });

    it('respects constraints', async () => {
      const { status, data } = await api('POST', '/v1/route', {
        task: 'Analyze this code',
        constraints: { min_quality_score: 0.99 },
        limit: 5,
      }, testApiKey);
      expect(status).toBe(200);
      expect(data.recommendations).toEqual([]);
      expect(data.meta.abstained).toBe(true);
      expect(data.meta.abstention_reason).toBe('constraints_filtered_all_candidates');
    });

    it('abstains rather than returning an unrelated agent', async () => {
      const { status, data } = await api('POST', '/v1/route', {
        task: 'Book a dental appointment near me for tomorrow morning',
      }, testApiKey);
      expect(status).toBe(200);
      expect(data.meta.abstained).toBe(true);
      expect(data.recommendations).toEqual([]);
    });
  });

  describe('Feedback', () => {
    it('accepts feedback and updates Bayesian score', async () => {
      const { status, data } = await api('POST', '/v1/feedback', {
        agent_id: 'demo-math-solver',
        score: 0.95,
        comment: 'Vitest: excellent',
      }, testApiKey);
      expect(status).toBe(200);
      expect(data.accepted).toBe(true);
      expect(data.new_combined_score).toBeGreaterThan(0);
      expect(data.sample_count).toBeGreaterThan(0);
    });

    it('rejects feedback for unknown agent', async () => {
      const { status } = await api('POST', '/v1/feedback', {
        agent_id: 'nonexistent-xyz',
        score: 0.5,
      });
      expect(status).toBe(404);
    });
  });

  describe('Taxonomy', () => {
    it('returns tags and categories', async () => {
      const { status, data } = await api('GET', '/v1/tasks/taxonomy');
      expect(status).toBe(200);
      expect(data.tags).toBeInstanceOf(Array);
      expect(data.tags.length).toBeGreaterThan(0);
      expect(parseInt(data.total_agents)).toBeGreaterThan(0);
    });
  });

  describe('Auth', () => {
    it('rejects invalid API key', async () => {
      const { status } = await api('GET', '/v1/agents', undefined, 'sl_live_invalid_key_123');
      expect(status).toBe(401);
    });

    it('tracks usage per API key', async () => {
      const { data: before } = await api('GET', '/v1/billing/usage', undefined, testApiKey);
      await api('POST', '/v1/route', { task: 'test usage tracking' }, testApiKey);
      const { data: after } = await api('GET', '/v1/billing/usage', undefined, testApiKey);
      expect(after.requests_this_month).toBeGreaterThan(before.requests_this_month);
    });
  });
});
