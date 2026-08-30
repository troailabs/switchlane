import { query } from '../db/client.js';

interface ProbeResult {
  agent_id: string;
  source_url: string;
  latency_ms: number | null;
  status: 'healthy' | 'degraded' | 'dead';
  error?: string;
  checked_at: string;
}

const PROBE_TIMEOUT_MS = 15000;
const CONCURRENT_PROBES = 5;
const DELAY_BETWEEN_BATCHES_MS = 1000;

/**
 * Probe a single agent's source URL for availability and latency.
 * For MCP servers: tries to connect via the source URL.
 * For HTTP endpoints: sends a HEAD/GET request.
 */
async function probeAgent(agentId: string, sourceUrl: string): Promise<ProbeResult> {
  const checkedAt = new Date().toISOString();

  if (!sourceUrl || sourceUrl.startsWith('https://github.com') || sourceUrl.startsWith('https://www.npmjs.com')) {
    // Can't probe GitHub/npm pages for SLA — skip with neutral result
    return { agent_id: agentId, source_url: sourceUrl, latency_ms: null, status: 'healthy', checked_at: checkedAt };
  }

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    const res = await fetch(sourceUrl, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': 'Switchlane-SLA-Prober/0.1' },
    });

    clearTimeout(timeout);
    const latency = Date.now() - start;

    if (res.ok || res.status === 405 || res.status === 404) {
      // 405/404 means server is up but doesn't support HEAD/path — still "healthy"
      return {
        agent_id: agentId,
        source_url: sourceUrl,
        latency_ms: latency,
        status: latency > 10000 ? 'degraded' : 'healthy',
        checked_at: checkedAt,
      };
    }

    return {
      agent_id: agentId,
      source_url: sourceUrl,
      latency_ms: latency,
      status: res.status >= 500 ? 'dead' : 'degraded',
      error: `HTTP ${res.status}`,
      checked_at: checkedAt,
    };
  } catch (err: any) {
    const latency = Date.now() - start;
    const isTimeout = err.name === 'AbortError';
    return {
      agent_id: agentId,
      source_url: sourceUrl,
      latency_ms: isTimeout ? PROBE_TIMEOUT_MS : latency,
      status: 'dead',
      error: isTimeout ? 'timeout' : (err.message || 'connection_failed'),
      checked_at: checkedAt,
    };
  }
}

/**
 * Store probe results in sla_probes table and update agent latency fields.
 */
async function storeProbeResult(result: ProbeResult): Promise<void> {
  // Insert probe record
  await query(
    `INSERT INTO sla_probes (agent_id, latency_ms, status, error, checked_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [result.agent_id, result.latency_ms, result.status, result.error || null, result.checked_at]
  );

  // Update agent latency from recent probes (rolling window: last 24h)
  await query(
    `UPDATE agents SET
       latency_p50_ms = sub.p50,
       latency_p99_ms = sub.p99,
       status = CASE
         WHEN $2 = 'dead' AND (
           SELECT COUNT(*) FROM sla_probes
           WHERE agent_id = $1 AND status = 'dead' AND checked_at > NOW() - INTERVAL '24 hours'
         ) >= 3 THEN 'dead'
         WHEN $2 = 'degraded' THEN 'stale'
         ELSE agents.status
       END,
       updated_at = NOW()
     FROM (
       SELECT
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
         PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms) AS p99
       FROM sla_probes
       WHERE agent_id = $1 AND latency_ms IS NOT NULL AND checked_at > NOW() - INTERVAL '24 hours'
     ) sub
     WHERE agents.id = $1`,
    [result.agent_id, result.status]
  );
}

/**
 * Run SLA probes for all active agents with a probeable URL.
 */
export async function runSlaProbes(): Promise<{ probed: number; healthy: number; degraded: number; dead: number }> {
  console.log('Starting SLA probe run...');

  // Get agents with probeable URLs (not GitHub/npm links)
  const { rows: agents } = await query<{ id: string; source_url: string }>(
    `SELECT id, source_url FROM agents
     WHERE status != 'dead'
       AND source_url != ''
       AND source_url NOT LIKE 'https://github.com%'
       AND source_url NOT LIKE 'https://www.npmjs.com%'
     ORDER BY last_crawled DESC NULLS LAST`
  );

  console.log(`  ${agents.length} agents to probe`);

  const stats = { probed: 0, healthy: 0, degraded: 0, dead: 0 };

  for (let i = 0; i < agents.length; i += CONCURRENT_PROBES) {
    const batch = agents.slice(i, i + CONCURRENT_PROBES);

    const results = await Promise.all(
      batch.map((a) => probeAgent(a.id, a.source_url))
    );

    for (const result of results) {
      try {
        await storeProbeResult(result);
        stats.probed++;
        stats[result.status]++;
      } catch (err) {
        console.warn(`  Failed to store probe for ${result.agent_id}:`, err);
      }
    }

    if (i + CONCURRENT_PROBES < agents.length) {
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  console.log(`SLA probe complete: ${stats.probed} probed, ${stats.healthy} healthy, ${stats.degraded} degraded, ${stats.dead} dead`);
  return stats;
}

/**
 * Quick probe for a single agent (used on-demand during routing).
 */
export async function probeAgentById(agentId: string): Promise<ProbeResult | null> {
  const { rows } = await query<{ id: string; source_url: string }>(
    'SELECT id, source_url FROM agents WHERE id = $1',
    [agentId]
  );
  if (rows.length === 0) return null;

  const result = await probeAgent(rows[0].id, rows[0].source_url);
  await storeProbeResult(result);
  return result;
}

// CLI runner
if (process.argv[1]?.includes('sla-prober')) {
  runSlaProbes()
    .then((stats) => {
      console.log('Done.', stats);
      process.exit(0);
    })
    .catch((err) => {
      console.error('SLA probe failed:', err);
      process.exit(1);
    });
}
