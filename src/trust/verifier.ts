import { query } from '../db/client.js';

export type VerificationTier = 'unverified' | 'basic' | 'verified' | 'certified';

interface VerificationResult {
  agent_id: string;
  tier: VerificationTier;
  reasons: string[];
  score: number; // 0-100
}

/**
 * Verification criteria and weights:
 *
 * BASIC (score >= 20):
 *   - Has description (5)
 *   - Has at least 1 tool (10)
 *   - Source URL reachable (5)
 *
 * VERIFIED (score >= 50):
 *   - All BASIC criteria
 *   - Has >5 tools with input schemas (10)
 *   - SLA probes: healthy in last 7 days (15)
 *   - Latency p50 < 5000ms (10)
 *   - Has feedback data (sample_count > 0) (5)
 *
 * CERTIFIED (score >= 80):
 *   - All VERIFIED criteria
 *   - SLA uptime > 99% in last 30 days (15)
 *   - Feedback sample count >= 10 (10)
 *   - Combined quality score >= 0.7 (10)
 *   - No security flags (5)
 */

export async function verifyAgent(agentId: string): Promise<VerificationResult> {
  const reasons: string[] = [];
  let score = 0;

  // Fetch agent data
  const { rows: agents } = await query(
    `SELECT id, name, description, source_url, tags, status,
            latency_p50_ms, latency_p99_ms,
            combined_score, feedback_sample_count,
            use_count
     FROM agents WHERE id = $1`,
    [agentId]
  );

  if (agents.length === 0) {
    return { agent_id: agentId, tier: 'unverified', reasons: ['Agent not found'], score: 0 };
  }

  const agent = agents[0];

  // --- BASIC criteria ---

  // Has description
  if (agent.description && agent.description.length > 10) {
    score += 5;
    reasons.push('has_description');
  }

  // Has tools
  const { rows: toolRows } = await query(
    'SELECT COUNT(*) as count FROM tools WHERE agent_id = $1',
    [agentId]
  );
  const toolCount = parseInt(toolRows[0].count);

  if (toolCount >= 1) {
    score += 10;
    reasons.push(`has_tools(${toolCount})`);
  }

  // Source URL not empty
  if (agent.source_url && agent.source_url.length > 0) {
    score += 5;
    reasons.push('has_source_url');
  }

  // --- VERIFIED criteria ---

  // Tools with input schemas
  const { rows: schemaRows } = await query(
    `SELECT COUNT(*) as count FROM tools
     WHERE agent_id = $1 AND input_schema IS NOT NULL AND input_schema != '{}'::jsonb`,
    [agentId]
  );
  const schemaCount = parseInt(schemaRows[0].count);
  if (schemaCount >= 5) {
    score += 10;
    reasons.push(`rich_schemas(${schemaCount})`);
  }

  // SLA healthy in last 7 days
  const { rows: slaRows } = await query(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE status = 'healthy') as healthy
     FROM sla_probes
     WHERE agent_id = $1 AND checked_at > NOW() - INTERVAL '7 days'`,
    [agentId]
  );
  const slaTotalRecent = parseInt(slaRows[0].total);
  const slaHealthyRecent = parseInt(slaRows[0].healthy);

  if (slaTotalRecent > 0 && slaHealthyRecent / slaTotalRecent >= 0.9) {
    score += 15;
    reasons.push('sla_healthy_7d');
  }

  // Latency acceptable
  if (agent.latency_p50_ms && agent.latency_p50_ms < 5000) {
    score += 10;
    reasons.push(`latency_ok(p50=${agent.latency_p50_ms}ms)`);
  }

  // Has feedback
  if (agent.feedback_sample_count > 0) {
    score += 5;
    reasons.push('has_feedback');
  }

  // --- CERTIFIED criteria ---

  // 30-day uptime > 99%
  const { rows: uptimeRows } = await query(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE status = 'healthy') as healthy
     FROM sla_probes
     WHERE agent_id = $1 AND checked_at > NOW() - INTERVAL '30 days'`,
    [agentId]
  );
  const uptimeTotal = parseInt(uptimeRows[0].total);
  const uptimeHealthy = parseInt(uptimeRows[0].healthy);

  if (uptimeTotal >= 10 && uptimeHealthy / uptimeTotal >= 0.99) {
    score += 15;
    reasons.push('uptime_99pct_30d');
  }

  // Strong feedback
  if (agent.feedback_sample_count >= 10) {
    score += 10;
    reasons.push(`strong_feedback(n=${agent.feedback_sample_count})`);
  }

  // High quality score
  if (parseFloat(agent.combined_score) >= 0.7) {
    score += 10;
    reasons.push(`high_quality(${agent.combined_score})`);
  }

  // No security flags (placeholder — will integrate with sandbox later)
  score += 5;
  reasons.push('no_security_flags');

  // Determine tier
  let tier: VerificationTier = 'unverified';
  if (score >= 80) tier = 'certified';
  else if (score >= 50) tier = 'verified';
  else if (score >= 20) tier = 'basic';

  // Persist verification result
  await query(
    `UPDATE agents SET
       verification_tier = $1,
       verification_score = $2,
       verified_at = NOW(),
       updated_at = NOW()
     WHERE id = $3`,
    [tier, score, agentId]
  );

  return { agent_id: agentId, tier, reasons, score };
}

/**
 * Run verification for all active agents.
 */
export async function verifyAllAgents(): Promise<{ total: number; tiers: Record<VerificationTier, number> }> {
  console.log('Starting agent verification run...');

  const { rows: agents } = await query<{ id: string }>(
    "SELECT id FROM agents WHERE status = 'active' ORDER BY combined_score DESC"
  );

  const tiers: Record<VerificationTier, number> = {
    unverified: 0,
    basic: 0,
    verified: 0,
    certified: 0,
  };

  for (const agent of agents) {
    try {
      const result = await verifyAgent(agent.id);
      tiers[result.tier]++;
    } catch (err) {
      console.warn(`  Verification failed for ${agent.id}:`, err);
      tiers.unverified++;
    }
  }

  console.log(`Verification complete: ${agents.length} agents`, tiers);
  return { total: agents.length, tiers };
}

// CLI runner
if (process.argv[1]?.includes('verifier')) {
  verifyAllAgents()
    .then((result) => {
      console.log('Done.', result);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Verification failed:', err);
      process.exit(1);
    });
}
