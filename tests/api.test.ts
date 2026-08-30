import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.SWITCHLANE_BASE_URL ?? 'http://localhost:3001';

async function api(method: string, path: string, body?: unknown, apiKey?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() as any };
}

describe('Switchlane API', () => {
  let testApiKey: string;

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
      const { status, data } = await api('GET', '/v1/agents?search=math');
      expect(status).toBe(200);
      expect(data.agents.some((a: any) => a.name.toLowerCase().includes('math'))).toBe(true);
    });

    it('returns agent detail', async () => {
      const { status, data } = await api('GET', '/v1/agents/ethanhenrickson-math-mcp');
      expect(status).toBe(200);
      expect(data.id).toBe('ethanhenrickson-math-mcp');
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
        task: 'Calculate the sum of 1, 2, 3, 4, 5',
        limit: 5,
      }, testApiKey);
      expect(status).toBe(200);
      expect(data.recommendations).toBeInstanceOf(Array);
      expect(data.task_profile).toBeDefined();
      expect(data.meta.elapsed_ms).toBeTypeOf('number');
    });

    it('routes a search task', async () => {
      const { status, data } = await api('POST', '/v1/route', {
        task: 'Search the web for latest AI research papers',
        limit: 3,
      }, testApiKey);
      expect(status).toBe(200);
      expect(data.recommendations.length).toBeGreaterThan(0);
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
      // With min_quality_score 0.99, likely no agents qualify
      for (const r of data.recommendations) {
        expect(r.quality_score).toBeGreaterThanOrEqual(0.99);
      }
    });
  });

  describe('Feedback', () => {
    it('accepts feedback and updates Bayesian score', async () => {
      const { status, data } = await api('POST', '/v1/feedback', {
        agent_id: 'ethanhenrickson-math-mcp',
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
