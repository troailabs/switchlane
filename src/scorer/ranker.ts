import { query } from '../db/client.js';

export interface RankingWeights {
  quality: number;
  cost: number;
  latency: number;
}

export interface RankedAgent {
  agent_id: string;
  name: string;
  description: string;
  provider: string;
  quality_score: number;
  estimated_cost_usd: number | null;
  estimated_latency_ms: number | null;
  rank_score: number;
  match_reason: string;
  source_url: string;
}

export interface Constraints {
  max_latency_ms?: number;
  max_cost_usd?: number;
  min_quality_score?: number;
  quality_weight?: number;
  cost_weight?: number;
  latency_weight?: number;
  min_routing_confidence?: number;
}

export type AbstentionReason =
  | 'no_candidates'
  | 'constraints_filtered_all_candidates'
  | 'top_candidate_below_confidence_threshold';

export interface AbstentionDecision {
  abstained: boolean;
  reason: AbstentionReason | null;
  confidence: number | null;
}

export const DEFAULT_MIN_ROUTING_CONFIDENCE = 0.35;

export function evaluateAbstention(
  ranked: RankedAgent[],
  candidateCount: number,
  minimumConfidence: number = DEFAULT_MIN_ROUTING_CONFIDENCE
): AbstentionDecision {
  if (ranked.length === 0) {
    return {
      abstained: true,
      reason: candidateCount > 0 ? 'constraints_filtered_all_candidates' : 'no_candidates',
      confidence: null,
    };
  }

  const confidence = ranked[0].quality_score;
  if (confidence < minimumConfidence) {
    return {
      abstained: true,
      reason: 'top_candidate_below_confidence_threshold',
      confidence,
    };
  }

  return { abstained: false, reason: null, confidence };
}

const DEFAULT_WEIGHTS: RankingWeights = {
  quality: 0.5,
  cost: 0.3,
  latency: 0.2,
};

const DEFAULT_RELEVANCE_WINDOW = 0.08;

/**
 * Multi-factor ranker.
 * With rerank scores: quality = rerank * 0.7 + popularity * 0.2 + bayesian * 0.1
 * Without rerank: quality = similarity * 0.5 + popularity * 0.3 + bayesian * 0.2
 */
export async function rankAgents(
  agentIds: string[],
  matchReasons: Map<string, string>,
  matchSimilarities: Map<string, number>,
  constraints: Constraints = {},
  rerankScores?: Map<string, number>
): Promise<RankedAgent[]> {
  if (agentIds.length === 0) return [];

  const weights: RankingWeights = {
    quality: constraints.quality_weight ?? DEFAULT_WEIGHTS.quality,
    cost: constraints.cost_weight ?? DEFAULT_WEIGHTS.cost,
    latency: constraints.latency_weight ?? DEFAULT_WEIGHTS.latency,
  };

  // Normalize weights to sum to 1
  const sum = weights.quality + weights.cost + weights.latency;
  weights.quality /= sum;
  weights.cost /= sum;
  weights.latency /= sum;

  // Fetch agent data with use_count for popularity signal
  const result = await query<{
    id: string;
    name: string;
    description: string;
    provider: string;
    combined_score: string;
    benchmark_score: string;
    pricing_unit_cost_usd: string | null;
    latency_p50_ms: number | null;
    source_url: string;
    use_count: number;
    feedback_sample_count: number;
  }>(
    `SELECT id, name, description, provider, combined_score, benchmark_score,
            pricing_unit_cost_usd, latency_p50_ms, source_url, use_count, feedback_sample_count
     FROM agents WHERE id = ANY($1) AND status = 'active'`,
    [agentIds]
  );

  // Find max values for normalization
  const agents = result.rows;
  const maxCost = Math.max(...agents.map((a) => parseFloat(a.pricing_unit_cost_usd || '0')), 0.01);
  const maxLatency = Math.max(...agents.map((a) => a.latency_p50_ms || 0), 1);
  const hasRerank = rerankScores && rerankScores.size > 0;

  let ranked: RankedAgent[] = agents.map((a) => {
    const combinedScore = parseFloat(a.combined_score);
    const benchmarkScore = parseFloat(a.benchmark_score);
    const cost = parseFloat(a.pricing_unit_cost_usd || '0');
    const latency = a.latency_p50_ms || 0;
    const similarity = matchSimilarities.get(a.id) || 0;
    const rerank = rerankScores?.get(a.id);

    // Popularity score: log-scaled, 0-1 range (already encoded in benchmark_score)
    // benchmark_score ranges from 0.30 (0 uses) to 0.70 (100K+ uses)
    const popularityNorm = (benchmarkScore - 0.30) / 0.40; // normalize to 0-1

    let effectiveQuality: number;
    if (rerank !== undefined) {
      // With LLM rerank: trust it heavily, add popularity + Bayesian feedback boost
      const feedbackBoost = a.feedback_sample_count > 0 ? combinedScore : benchmarkScore;
      effectiveQuality = rerank * 0.70 + popularityNorm * 0.15 + feedbackBoost * 0.15;
    } else {
      // Without rerank: similarity + popularity + Bayesian
      effectiveQuality = similarity * 0.50 + popularityNorm * 0.25 + combinedScore * 0.25;
    }

    const normalizedCost = maxCost > 0 ? cost / maxCost : 0;
    const normalizedLatency = maxLatency > 0 ? latency / maxLatency : 0;

    const rankScore =
      weights.quality * effectiveQuality +
      weights.cost * (1 - normalizedCost) +
      weights.latency * (1 - normalizedLatency);

    return {
      agent_id: a.id,
      name: a.name,
      description: a.description,
      provider: a.provider,
      quality_score: Math.round(effectiveQuality * 1000) / 1000,
      estimated_cost_usd: cost || null,
      estimated_latency_ms: latency || null,
      rank_score: Math.round(rankScore * 1000) / 1000,
      match_reason: matchReasons.get(a.id) || 'Unknown',
      source_url: a.source_url,
    };
  });

  // Capability first: cost and latency may choose among similarly relevant
  // candidates, but must never promote a cheap unrelated agent.
  const bestQuality = Math.max(...ranked.map((agent) => agent.quality_score));
  ranked = ranked.filter(
    (agent) => agent.quality_score >= bestQuality - DEFAULT_RELEVANCE_WINDOW
  );

  // Apply hard constraints (filter)
  if (constraints.min_quality_score != null) {
    ranked = ranked.filter((a) => a.quality_score >= constraints.min_quality_score!);
  }
  if (constraints.max_cost_usd != null) {
    ranked = ranked.filter((a) => a.estimated_cost_usd === null || a.estimated_cost_usd <= constraints.max_cost_usd!);
  }
  if (constraints.max_latency_ms != null) {
    ranked = ranked.filter((a) => a.estimated_latency_ms === null || a.estimated_latency_ms <= constraints.max_latency_ms!);
  }

  // Sort by rank score descending
  ranked.sort((a, b) => b.rank_score - a.rank_score);

  return ranked;
}
