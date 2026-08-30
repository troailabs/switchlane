import { query } from '../db/client.js';

const PRIOR_WEIGHT = 10;

/**
 * Bayesian quality scorer.
 * combined = (benchmark * prior_weight + usage_score * n) / (prior_weight + n)
 * After ~10 feedback samples, real usage data dominates.
 */
export function computeCombinedScore(
  benchmarkScore: number,
  usageScore: number | null,
  sampleCount: number
): number {
  if (usageScore === null || sampleCount === 0) {
    return benchmarkScore;
  }
  return (benchmarkScore * PRIOR_WEIGHT + usageScore * sampleCount) / (PRIOR_WEIGHT + sampleCount);
}

/**
 * Get quality info for an agent from DB.
 */
export async function getAgentQuality(agentId: string): Promise<{
  benchmark_score: number;
  usage_score: number | null;
  combined_score: number;
  sample_count: number;
}> {
  const result = await query(
    `SELECT benchmark_score, usage_score, combined_score, feedback_sample_count
     FROM agents WHERE id = $1`,
    [agentId]
  );

  if (result.rows.length === 0) {
    return { benchmark_score: 0.5, usage_score: null, combined_score: 0.5, sample_count: 0 };
  }

  const row = result.rows[0];
  return {
    benchmark_score: parseFloat(row.benchmark_score),
    usage_score: row.usage_score ? parseFloat(row.usage_score) : null,
    combined_score: parseFloat(row.combined_score),
    sample_count: row.feedback_sample_count,
  };
}
