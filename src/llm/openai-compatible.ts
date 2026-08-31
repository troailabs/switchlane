import { config } from '../config.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

function completionUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

export function isLlmAvailable(): boolean {
  return Boolean(config.LLM_BASE_URL && config.LLM_MODEL);
}

export async function llmComplete(
  messages: ChatMessage[],
  options: CompletionOptions = {}
): Promise<string> {
  const model = options.model || config.LLM_MODEL;
  if (!config.LLM_BASE_URL || !model) {
    throw new Error('Optional LLM is not configured; set LLM_BASE_URL and LLM_MODEL');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.LLM_API_KEY) {
    headers.Authorization = `Bearer ${config.LLM_API_KEY}`;
  }

  const response = await fetch(completionUrl(config.LLM_BASE_URL), {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(config.LLM_TIMEOUT_MS),
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.max_tokens ?? 300,
      stream: false,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM completion failed: ${response.status} ${body.slice(0, 500)}`);
  }

  const data = await response.json() as ChatCompletionResponse;
  return data.choices?.[0]?.message?.content || '';
}
