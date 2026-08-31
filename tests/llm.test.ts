import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  LLM_BASE_URL: 'https://llm.example/v1/',
  LLM_API_KEY: 'test-api-key',
  LLM_MODEL: 'test-model',
  LLM_TIMEOUT_MS: 15000,
}));

vi.mock('../src/config.js', () => ({ config: mockConfig }));

import { isLlmAvailable, llmComplete } from '../src/llm/openai-compatible.js';

function completion(content: string) {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

describe('OpenAI-compatible LLM client', () => {
  beforeEach(() => {
    mockConfig.LLM_BASE_URL = 'https://llm.example/v1/';
    mockConfig.LLM_API_KEY = 'test-api-key';
    mockConfig.LLM_MODEL = 'test-model';
    mockConfig.LLM_TIMEOUT_MS = 15000;
    vi.restoreAllMocks();
  });

  it('is available only when base URL and model are configured', () => {
    expect(isLlmAvailable()).toBe(true);
    mockConfig.LLM_MODEL = '';
    expect(isLlmAvailable()).toBe(false);
    mockConfig.LLM_MODEL = 'test-model';
    mockConfig.LLM_BASE_URL = '';
    expect(isLlmAvailable()).toBe(false);
  });

  it('calls the configured chat completions endpoint once', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(completion('hello'));

    const result = await llmComplete([{ role: 'user', content: 'Say hello' }]);

    expect(result).toBe('hello');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://llm.example/v1/chat/completions');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer test-api-key');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Say hello' }],
      stream: false,
    });
  });

  it('supports a per-call model override', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(completion('override'));
    await llmComplete([{ role: 'user', content: 'Test' }], { model: 'other-model' });
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)).model).toBe('other-model');
  });

  it('supports local endpoints without an API key', async () => {
    mockConfig.LLM_API_KEY = '';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(completion('local'));
    await llmComplete([{ role: 'user', content: 'Test' }]);
    expect((fetchSpy.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('rejects calls when the optional LLM is not configured', async () => {
    mockConfig.LLM_BASE_URL = '';
    await expect(llmComplete([{ role: 'user', content: 'Test' }]))
      .rejects.toThrow('Optional LLM is not configured');
  });

  it('returns an empty string when the provider has no message content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(completion(''));
    await expect(llmComplete([{ role: 'user', content: 'Test' }])).resolves.toBe('');
  });

  it('surfaces provider errors without a token exchange', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
    await expect(llmComplete([{ role: 'user', content: 'Test' }]))
      .rejects.toThrow('LLM completion failed: 429 rate limited');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});