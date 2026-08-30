import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIN_ROUTING_CONFIDENCE,
  evaluateAbstention,
  type RankedAgent,
} from '../src/scorer/ranker.js';

function candidate(qualityScore: number): RankedAgent {
  return {
    agent_id: 'candidate',
    name: 'Candidate',
    description: '',
    provider: 'mcp',
    quality_score: qualityScore,
    estimated_cost_usd: null,
    estimated_latency_ms: null,
    rank_score: qualityScore,
    match_reason: 'test',
    source_url: '',
  };
}

describe('routing abstention', () => {
  it('abstains when no candidates exist', () => {
    expect(evaluateAbstention([], 0)).toEqual({
      abstained: true,
      reason: 'no_candidates',
      confidence: null,
    });
  });

  it('reports when constraints remove every candidate', () => {
    expect(evaluateAbstention([], 3).reason).toBe('constraints_filtered_all_candidates');
  });

  it('abstains below the confidence threshold', () => {
    const decision = evaluateAbstention([candidate(DEFAULT_MIN_ROUTING_CONFIDENCE - 0.001)], 1);
    expect(decision.abstained).toBe(true);
    expect(decision.reason).toBe('top_candidate_below_confidence_threshold');
  });

  it('routes candidates at the confidence threshold', () => {
    expect(evaluateAbstention([candidate(DEFAULT_MIN_ROUTING_CONFIDENCE)], 1)).toEqual({
      abstained: false,
      reason: null,
      confidence: DEFAULT_MIN_ROUTING_CONFIDENCE,
    });
  });
});