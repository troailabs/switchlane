import { query } from '../db/client.js';
import { callMcpTool, type McpCallResult } from './mcp-client.js';
import type { RankedAgent } from '../scorer/ranker.js';

export interface ExecutionResult {
  agent_id: string;
  agent_name: string;
  success: boolean;
  content: any;
  error?: string;
  latency_ms: number;
  tool_used: string | null;
}

/**
 * Execute a task via the best-ranked agent.
 * For MCP agents: connect to server, pick best matching tool, forward input.
 */
export async function executeViaAgent(
  agent: RankedAgent,
  taskText: string,
  input: Record<string, unknown> = {},
  timeoutMs: number = 30000
): Promise<ExecutionResult> {
  // Get agent's tools from DB
  const toolsResult = await query<{ name: string; description: string; input_schema: any }>(
    'SELECT name, description, input_schema FROM tools WHERE agent_id = $1',
    [agent.agent_id]
  );

  if (toolsResult.rows.length === 0) {
    return {
      agent_id: agent.agent_id,
      agent_name: agent.name,
      success: false,
      content: null,
      error: 'Agent has no registered tools',
      latency_ms: 0,
      tool_used: null,
    };
  }

  // Pick the best tool: simple heuristic — match task text against tool descriptions
  const taskLower = taskText.toLowerCase();
  let bestTool = toolsResult.rows[0];
  let bestScore = 0;

  for (const tool of toolsResult.rows) {
    const toolText = `${tool.name} ${tool.description}`.toLowerCase();
    const words = taskLower.split(/\s+/);
    const score = words.filter((w) => w.length > 3 && toolText.includes(w)).length;
    if (score > bestScore) {
      bestScore = score;
      bestTool = tool;
    }
  }

  // Get deployment URL
  const agentResult = await query<{ source_url: string }>(
    'SELECT source_url FROM agents WHERE id = $1',
    [agent.agent_id]
  );

  const sourceUrl = agentResult.rows[0]?.source_url;
  if (!sourceUrl) {
    return {
      agent_id: agent.agent_id,
      agent_name: agent.name,
      success: false,
      content: null,
      error: 'No endpoint URL for agent',
      latency_ms: 0,
      tool_used: bestTool.name,
    };
  }

  // For MCP agents, call via MCP protocol
  if (agent.provider === 'mcp') {
    const mcpResult = await callMcpTool(sourceUrl, bestTool.name, input, timeoutMs);

    // Record execution metrics
    await recordExecution(agent.agent_id, mcpResult);

    return {
      agent_id: agent.agent_id,
      agent_name: agent.name,
      success: mcpResult.success,
      content: mcpResult.content,
      error: mcpResult.error,
      latency_ms: mcpResult.latency_ms,
      tool_used: bestTool.name,
    };
  }

  // Only MCP execution is supported in this release. Other providers can
  // still be recommended, but execution fails explicitly and safely.
  return {
    agent_id: agent.agent_id,
    agent_name: agent.name,
    success: false,
    content: null,
    error: `Proxy not implemented for provider: ${agent.provider}`,
    latency_ms: 0,
    tool_used: bestTool.name,
  };
}

/**
 * Record execution metrics (latency, success) for Bayesian scoring.
 */
async function recordExecution(agentId: string, result: McpCallResult): Promise<void> {
  try {
    // Update latency stats
    if (result.success) {
      await query(
        `UPDATE agents SET
           latency_p50_ms = COALESCE(
             (latency_p50_ms + $2) / 2,
             $2
           ),
           updated_at = NOW()
         WHERE id = $1`,
        [agentId, result.latency_ms]
      );
    }

    // Auto-feedback: success = 0.7, failure = 0.2
    const autoScore = result.success ? 0.7 : 0.2;
    await query(
      'INSERT INTO feedback (agent_id, score, comment) VALUES ($1, $2, $3)',
      [agentId, autoScore, `Auto: ${result.success ? 'success' : 'error'} in ${result.latency_ms}ms`]
    );
  } catch (err) {
    console.warn('Failed to record execution metrics:', err);
  }
}
