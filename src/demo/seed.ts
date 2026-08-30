import { fileURLToPath } from 'url';
import { closeDb, transaction } from '../db/client.js';
import { embed, toPgVector } from '../mapper/embeddings.js';
import { DEMO_AGENTS } from './fixtures.js';

export async function seedDemoCatalog(): Promise<void> {
  for (const agent of DEMO_AGENTS) {
    const content = `${agent.name}. ${agent.description} Tool: ${agent.tool.name}. ${agent.tool.description}`;
    const embedding = toPgVector(await embed(content));

    await transaction(async (client) => {
      await client.query(
        `INSERT INTO agents (
           id, name, description, provider, source_url, pricing_model,
           pricing_unit_cost_usd, benchmark_score, combined_score,
           latency_p50_ms, tags, status, last_crawled, use_count
         ) VALUES ($1, $2, $3, 'mcp', $4, 'per_call', $5, 0.700, 0.700, $6, $7, 'active', NOW(), 100)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           source_url = EXCLUDED.source_url,
           pricing_model = EXCLUDED.pricing_model,
           pricing_unit_cost_usd = EXCLUDED.pricing_unit_cost_usd,
           benchmark_score = EXCLUDED.benchmark_score,
           combined_score = EXCLUDED.combined_score,
           latency_p50_ms = EXCLUDED.latency_p50_ms,
           tags = EXCLUDED.tags,
           status = 'active',
           last_crawled = NOW(),
           use_count = EXCLUDED.use_count,
           updated_at = NOW()`,
        [
          agent.id,
          agent.name,
          agent.description,
          `https://example.invalid/${agent.id}`,
          agent.costUsd,
          agent.latencyMs,
          agent.tags,
        ]
      );

      await client.query('DELETE FROM tools WHERE agent_id = $1', [agent.id]);
      const tool = await client.query<{ id: number }>(
        `INSERT INTO tools (agent_id, name, description, input_schema)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [agent.id, agent.tool.name, agent.tool.description, JSON.stringify(agent.tool.inputSchema)]
      );
      await client.query(
        `INSERT INTO tool_embeddings (tool_id, agent_id, content, embedding)
         VALUES ($1, $2, $3, $4::vector)`,
        [tool.rows[0].id, agent.id, content, embedding]
      );
    });
  }
}

async function main() {
  await seedDemoCatalog();
  console.log(`Seeded ${DEMO_AGENTS.length} deterministic demo agents.`);
  await closeDb();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
