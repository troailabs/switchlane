import { query } from '../db/client.js';
import { embed, toPgVector } from './embeddings.js';

export interface SchemaMatch {
  agent_id: string;
  agent_name: string;
  agent_description: string;
  tool_name: string;
  tool_description: string;
  similarity: number;
  match_reason: string;
}

const DEFAULT_THRESHOLD = 0.45;
const DEFAULT_LIMIT = 10;

/**
 * Path A: Schema Match — fast, free embedding similarity search.
 * Embeds the task text and finds the closest tool descriptions via pgvector cosine similarity.
 * Optional categoryTags filter narrows search to agents matching specific tags.
 */
export async function schemaMatch(
  taskText: string,
  options: { threshold?: number; limit?: number; categoryTags?: string[] } = {}
): Promise<SchemaMatch[]> {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const categoryTags = options.categoryTags;

  // Embed the task text
  const taskEmbedding = await embed(taskText);
  const pgVec = toPgVector(taskEmbedding);

  // Cosine similarity search via pgvector
  // If categoryTags provided, filter agents by tag overlap
  const result = await query<{
    agent_id: string;
    agent_name: string;
    agent_description: string;
    tool_name: string;
    tool_description: string;
    similarity: number;
  }>(
    `SELECT
       te.agent_id,
       a.name as agent_name,
       a.description as agent_description,
       t.name as tool_name,
       t.description as tool_description,
       1 - (te.embedding <=> $1::vector) as similarity
     FROM tool_embeddings te
     JOIN agents a ON a.id = te.agent_id
     JOIN tools t ON t.id = te.tool_id
     WHERE a.status = 'active'
       AND 1 - (te.embedding <=> $1::vector) >= $2
       AND ($4::text[] IS NULL OR a.tags && $4)
     ORDER BY te.embedding <=> $1::vector
     LIMIT $3`,
    [pgVec, threshold, limit, categoryTags || null]
  );

  return result.rows.map((row) => ({
    ...row,
    similarity: parseFloat(String(row.similarity)),
    match_reason: `Embedding match on tool: ${row.tool_name} (${(parseFloat(String(row.similarity)) * 100).toFixed(1)}% similarity)`,
  }));
}

/**
 * Deduplicate matches by agent_id, keeping highest similarity per agent.
 */
export function dedupeByAgent(matches: SchemaMatch[]): SchemaMatch[] {
  const best = new Map<string, SchemaMatch>();
  for (const m of matches) {
    const existing = best.get(m.agent_id);
    if (!existing || m.similarity > existing.similarity) {
      best.set(m.agent_id, m);
    }
  }
  return Array.from(best.values()).sort((a, b) => b.similarity - a.similarity);
}
