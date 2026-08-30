import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface McpCallResult {
  success: boolean;
  content: any;
  error?: string;
  latency_ms: number;
}

/**
 * Generic MCP server caller.
 * Connects to any MCP server via Streamable HTTP transport, calls a tool, returns result.
 */
export async function callMcpTool(
  serverUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs: number = 30000
): Promise<McpCallResult> {
  const start = Date.now();
  const client = new Client({ name: 'switchlane-proxy', version: '0.1.0' });

  try {
    // Connect to MCP server
    const transport = new StreamableHTTPClientTransport(new URL(serverUrl));
    await client.connect(transport);

    // Call the tool with timeout
    const result = await Promise.race([
      client.callTool({ name: toolName, arguments: args }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`MCP call timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);

    const latency = Date.now() - start;

    return {
      success: !result.isError,
      content: result.content,
      error: result.isError ? String(result.content) : undefined,
      latency_ms: latency,
    };
  } catch (err: any) {
    return {
      success: false,
      content: null,
      error: err.message || 'Unknown MCP call error',
      latency_ms: Date.now() - start,
    };
  } finally {
    try {
      await client.close();
    } catch {}
  }
}

/**
 * Discover tools available on an MCP server.
 */
export async function listMcpTools(serverUrl: string): Promise<{ name: string; description?: string }[]> {
  const client = new Client({ name: 'switchlane-discovery', version: '0.1.0' });

  try {
    const transport = new StreamableHTTPClientTransport(new URL(serverUrl));
    await client.connect(transport);

    const result = await client.listTools();
    return result.tools.map((t) => ({ name: t.name, description: t.description }));
  } finally {
    try {
      await client.close();
    } catch {}
  }
}
