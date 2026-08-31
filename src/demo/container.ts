import app from '../app.js';
import { closeCache } from '../cache.js';
import { closeDb } from '../db/client.js';
import { migrate } from '../db/migrate.js';
import { BENCHMARK_CASES, DEMO_AGENTS } from './fixtures.js';
import { seedDemoCatalog } from './seed.js';

async function main() {
  await migrate({ closePool: false });
  await seedDemoCatalog();

  console.log(`\nSwitchlane isolated demo: ${DEMO_AGENTS.length} candidates, ${BENCHMARK_CASES.length} tasks\n`);

  let correct = 0;
  for (const item of BENCHMARK_CASES) {
    const response = await app.request('/v1/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: item.task, limit: 3 }),
    });
    const result = await response.json() as any;
    const selected = result.meta.abstained
      ? null
      : result.recommendations[0]?.agent_id ?? null;
    const passed = selected === item.expectedAgentId;
    if (passed) correct++;

    console.log(`${passed ? 'PASS' : 'FAIL'} ${item.task}`);
    console.log(`  expected=${item.expectedAgentId ?? 'ABSTAIN'} selected=${selected ?? 'ABSTAIN'} confidence=${result.meta.confidence ?? 'n/a'}\n`);
  }

  console.log(`Demo result: ${correct}/${BENCHMARK_CASES.length} decisions matched the fixture.`);
  if (correct !== BENCHMARK_CASES.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeCache().catch(() => {});
    await closeDb().catch(() => {});
  });
