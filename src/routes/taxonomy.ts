import { Hono } from 'hono';
import { query } from '../db/client.js';

export const taxonomyRouter = new Hono();

// GET /v1/tasks/taxonomy — emergent task taxonomy from indexed tools
taxonomyRouter.get('/taxonomy', async (c) => {
  // Build taxonomy from agent tags and tool names
  const tagsResult = await query(
    `SELECT UNNEST(tags) as tag, COUNT(*) as count 
     FROM agents WHERE status = 'active' 
     GROUP BY tag ORDER BY count DESC LIMIT 100`
  );

  const toolCategoriesResult = await query(
    `SELECT 
       SPLIT_PART(t.name, '_', 1) as category,
       COUNT(DISTINCT t.agent_id) as agent_count,
       COUNT(*) as tool_count
     FROM tools t
     JOIN agents a ON a.id = t.agent_id
     WHERE a.status = 'active'
     GROUP BY category
     ORDER BY agent_count DESC
     LIMIT 50`
  );

  return c.json({
    tags: tagsResult.rows,
    tool_categories: toolCategoriesResult.rows,
    total_agents: (await query("SELECT COUNT(*) FROM agents WHERE status = 'active'")).rows[0].count,
    total_tools: (await query("SELECT COUNT(*) FROM tools")).rows[0].count,
  });
});
