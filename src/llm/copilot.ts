import { config } from '../config.js';

const COPILOT_HEADERS = {
  'Editor-Version': 'vscode/1.96.2',
  'User-Agent': 'GitHubCopilotChat/0.26.7',
  'X-Github-Api-Version': '2025-04-01',
};

const TOKEN_EXCHANGE_URL = 'https://api.github.com/copilot_internal/v2/token';
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000; // 5 minutes before expiry

interface CopilotSession {
  token: string;
  baseUrl: string;
  expiresAt: number; // ms
}

let cachedSession: CopilotSession | null = null;

function isTokenUsable(session: CopilotSession | null): session is CopilotSession {
  if (!session) return false;
  return session.expiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS;
}

function extractBaseUrl(token: string): string {
  // token format: "tid=abc;proxy-ep=proxy.individual.githubcopilot.com;exp=..."
  const match = token.match(/proxy-ep=([^;]+)/);
  if (match) {
    // proxy.xxx.githubcopilot.com → api.xxx.githubcopilot.com
    const host = match[1].replace(/^proxy\./, 'api.');
    return `https://${host}`;
  }
  return 'https://api.individual.githubcopilot.com';
}

/**
 * Exchange GitHub PAT for short-lived Copilot session token.
 */
async function exchangeToken(): Promise<CopilotSession> {
  const githubToken = config.GITHUB_TOKEN;
  if (!githubToken) {
    throw new Error('GITHUB_TOKEN not configured');
  }

  const res = await fetch(TOKEN_EXCHANGE_URL, {
    method: 'GET',
    headers: {
      ...COPILOT_HEADERS,
      'Authorization': `token ${githubToken}`,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Copilot token exchange failed: ${res.status} ${body}`);
  }

  const data = await res.json() as { token: string; expires_at: number };

  return {
    token: data.token,
    baseUrl: extractBaseUrl(data.token),
    expiresAt: data.expires_at * 1000, // unix seconds → ms
  };
}

/**
 * Get a valid Copilot session, refreshing if needed.
 */
async function getSession(): Promise<CopilotSession> {
  if (isTokenUsable(cachedSession)) {
    return cachedSession;
  }
  cachedSession = await exchangeToken();
  console.log(`Copilot session acquired (expires ${new Date(cachedSession.expiresAt).toISOString()})`);
  return cachedSession;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

/**
 * Call GitHub Copilot chat completions (OpenAI-compatible).
 */
export async function copilotComplete(
  messages: ChatMessage[],
  options: CompletionOptions = {}
): Promise<string> {
  const session = await getSession();
  const model = options.model || 'gpt-4o';

  const headers: Record<string, string> = {
    ...COPILOT_HEADERS,
    'Authorization': `Bearer ${session.token}`,
    'Content-Type': 'application/json',
    'Openai-Intent': 'conversation-edits',
  };

  // Claude models need extra header
  if (model.includes('claude')) {
    headers['Copilot-Integration-Id'] = 'vscode-chat';
  }

  const res = await fetch(`${session.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.max_tokens ?? 300,
      stream: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    // If 401, token might be stale — clear cache
    if (res.status === 401) {
      cachedSession = null;
    }
    throw new Error(`Copilot completion failed: ${res.status} ${body}`);
  }

  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Check if Copilot LLM is available (GITHUB_TOKEN set).
 */
export function isCopilotAvailable(): boolean {
  return !!config.GITHUB_TOKEN;
}

/** Exposed for testing */
export function _clearSessionCache(): void {
  cachedSession = null;
}
