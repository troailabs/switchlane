import { query } from '../db/client.js';
import { embed, toPgVector } from '../mapper/embeddings.js';

/**
 * Generate embeddings for all tools that don't have one yet.
 * Combines tool name + description + agent description for richer context.
 */
export async function generateToolEmbeddings(): Promise<number> {
  // Find tools without embeddings
  const result = await query<{ tool_id: number; agent_id: string; tool_name: string; tool_desc: string; agent_desc: string }>(
    `SELECT t.id as tool_id, t.agent_id, t.name as tool_name, t.description as tool_desc, a.description as agent_desc
     FROM tools t
     JOIN agents a ON a.id = t.agent_id
     LEFT JOIN tool_embeddings te ON te.tool_id = t.id
     WHERE te.id IS NULL
     ORDER BY t.id`
  );

  console.log(`Found ${result.rows.length} tools without embeddings`);

  let count = 0;
  for (const row of result.rows) {
    // Compose embedding text: tool name + tool description + agent context
    const content = `${row.tool_name}: ${row.tool_desc}. Agent: ${row.agent_desc}`.slice(0, 512);

    try {
      const embedding = await embed(content);

      await query(
        `INSERT INTO tool_embeddings (tool_id, agent_id, content, embedding)
         VALUES ($1, $2, $3, $4)`,
        [row.tool_id, row.agent_id, content, toPgVector(embedding)]
      );

      count++;
      if (count % 50 === 0) {
        console.log(`  Embedded ${count}/${result.rows.length} tools...`);
      }
    } catch (err) {
      console.error(`Failed to embed tool ${row.tool_id} (${row.tool_name}):`, err);
    }
  }

  console.log(`Embedding complete: ${count} tools embedded`);
  return count;
}

// CLI runner
if (process.argv[1]?.includes('generate-embeddings')) {
  generateToolEmbeddings()
    .then((count) => {
      console.log(`Done. ${count} embeddings generated.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Failed:', err);
      process.exit(1);
    });
}
