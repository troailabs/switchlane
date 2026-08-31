import { BENCHMARK_CASES } from './fixtures.js';

async function main() {
  process.env.NODE_ENV = 'development';
  process.env.LLM_BASE_URL = '';
  process.env.LLM_MODEL = '';
  const [{ default: app }, { closeCache }, { closeDb }] = await Promise.all([
    import('../app.js'),
    import('../cache.js'),
    import('../db/client.js'),
  ]);

  console.log('Switchlane deterministic routing demo\n');
  for (const item of BENCHMARK_CASES) {
    const response = await app.request('/v1/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: item.task, limit: 3 }),
    });
    const result = await response.json() as any;
    const selected = result.meta.abstained
      ? `ABSTAIN (${result.meta.abstention_reason})`
      : `${result.recommendations[0]?.agent_id} (${result.meta.confidence})`;
    console.log(`Task: ${item.task}`);
    console.log(`  Decision: ${selected}\n`);
  }

  await closeCache();
  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
