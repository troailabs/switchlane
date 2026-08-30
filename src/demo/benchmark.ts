import { BENCHMARK_CASES, DEMO_AGENTS } from './fixtures.js';

function words(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2));
}

function lexicalBaseline(task: string): string | null {
  const taskWords = words(task);
  let best: { id: string; score: number } | null = null;

  for (const agent of DEMO_AGENTS) {
    const candidateWords = words([
      agent.name,
      agent.description,
      agent.tags.join(' '),
      agent.tool.name,
      agent.tool.description,
    ].join(' '));
    const hits = [...taskWords].filter((word) => candidateWords.has(word)).length;
    const score = hits / Math.max(taskWords.size, 1);
    if (!best || score > best.score) best = { id: agent.id, score };
  }

  return best && best.score >= 0.2 ? best.id : null;
}

async function main() {
  process.env.NODE_ENV = 'development';
  process.env.GITHUB_TOKEN = '';
  const [{ default: app }, { closeCache }, { closeDb }] = await Promise.all([
    import('../app.js'),
    import('../cache.js'),
    import('../db/client.js'),
  ]);

  let baselineCorrect = 0;
  let switchlaneCorrect = 0;
  const startedAt = performance.now();
  const confidenceOverride = process.env.SWITCHLANE_BENCHMARK_MIN_CONFIDENCE;

  for (const item of BENCHMARK_CASES) {
    const baseline = lexicalBaseline(item.task);
    if (baseline === item.expectedAgentId) baselineCorrect++;

    const response = await app.request('/v1/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: item.task,
        limit: 1,
        constraints: confidenceOverride === undefined
          ? undefined
          : { min_routing_confidence: Number(confidenceOverride) },
      }),
    });
    const result = await response.json() as any;
    const selected = result.meta.abstained ? null : result.recommendations[0]?.agent_id ?? null;
    if (selected === item.expectedAgentId) switchlaneCorrect++;

    console.log(`${selected === item.expectedAgentId ? 'PASS' : 'FAIL'} ${item.task}`);
    console.log(`  expected=${item.expectedAgentId ?? 'ABSTAIN'} baseline=${baseline ?? 'ABSTAIN'} switchlane=${selected ?? 'ABSTAIN'}`);
  }

  const elapsedMs = Math.round(performance.now() - startedAt);
  console.log('\nBenchmark summary');
  console.log(JSON.stringify({
    cases: BENCHMARK_CASES.length,
    lexical_baseline_accuracy: baselineCorrect / BENCHMARK_CASES.length,
    switchlane_accuracy: switchlaneCorrect / BENCHMARK_CASES.length,
    elapsed_ms: elapsedMs,
    external_llm_used: false,
  }, null, 2));

  await closeCache();
  await closeDb();

  if (switchlaneCorrect < baselineCorrect) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
