import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must mock before importing the module
vi.mock('../src/config.js', () => ({
  config: {
    GITHUB_TOKEN: 'ghp_test_token_123',
    DATABASE_URL: '',
    REDIS_URL: '',
    PORT: 3001,
    NODE_ENV: 'test',
    STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
  },
}));

import { _clearSessionCache, copilotComplete, isCopilotAvailable } from '../src/llm/copilot.js';

const FAKE_TOKEN = 'tid=abc123;proxy-ep=proxy.individual.githubcopilot.com;exp=9999999999';
const FAKE_EXPIRES = 9999999999;

function mockTokenExchange() {
  return new Response(
    JSON.stringify({ token: FAKE_TOKEN, expires_at: FAKE_EXPIRES }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function mockCompletion(content: string) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', content } }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

describe('Copilot LLM Client', () => {
  beforeEach(() => {
    _clearSessionCache();
    vi.restoreAllMocks();
  });

  it('isCopilotAvailable returns true when GITHUB_TOKEN set', () => {
    expect(isCopilotAvailable()).toBe(true);
  });

  it('exchanges token and makes completion request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockTokenExchange())
      .mockResolvedValueOnce(mockCompletion('Hello from Copilot'));

    const result = await copilotComplete([
      { role: 'user', content: 'Say hello' },
    ]);

    expect(result).toBe('Hello from Copilot');
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Verify token exchange call
    const exchangeCall = fetchSpy.mock.calls[0];
    expect(exchangeCall[0]).toBe('https://api.github.com/copilot_internal/v2/token');
    expect((exchangeCall[1] as any).headers['Authorization']).toBe('token ghp_test_token_123');
    expect((exchangeCall[1] as any).headers['Editor-Version']).toBe('vscode/1.96.2');
    expect((exchangeCall[1] as any).headers['User-Agent']).toBe('GitHubCopilotChat/0.26.7');

    // Verify completion call
    const completionCall = fetchSpy.mock.calls[1];
    expect(completionCall[0]).toBe('https://api.individual.githubcopilot.com/chat/completions');
    expect((completionCall[1] as any).headers['Authorization']).toBe(`Bearer ${FAKE_TOKEN}`);
    expect((completionCall[1] as any).headers['Openai-Intent']).toBe('conversation-edits');
  });

  it('caches session token across calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockTokenExchange())
      .mockResolvedValueOnce(mockCompletion('First'))
      .mockResolvedValueOnce(mockCompletion('Second'));

    await copilotComplete([{ role: 'user', content: 'First call' }]);
    await copilotComplete([{ role: 'user', content: 'Second call' }]);

    // Token exchange should happen only once
    expect(fetchSpy).toHaveBeenCalledTimes(3); // 1 exchange + 2 completions
  });

  it('sends Claude header for Claude models', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockTokenExchange())
      .mockResolvedValueOnce(mockCompletion('Claude response'));

    await copilotComplete(
      [{ role: 'user', content: 'Test' }],
      { model: 'claude-sonnet-4' }
    );

    const completionCall = fetchSpy.mock.calls[1];
    expect((completionCall[1] as any).headers['Copilot-Integration-Id']).toBe('vscode-chat');
  });

  it('does not send Claude header for non-Claude models', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockTokenExchange())
      .mockResolvedValueOnce(mockCompletion('GPT response'));

    await copilotComplete(
      [{ role: 'user', content: 'Test' }],
      { model: 'gpt-4o' }
    );

    const completionCall = fetchSpy.mock.calls[1];
    expect((completionCall[1] as any).headers['Copilot-Integration-Id']).toBeUndefined();
  });

  it('extracts base URL from proxy-ep in token', async () => {
    const enterpriseToken = 'tid=xyz;proxy-ep=proxy.enterprise.githubcopilot.com;exp=9999999999';
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ token: enterpriseToken, expires_at: FAKE_EXPIRES }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ))
      .mockResolvedValueOnce(mockCompletion('Enterprise response'));

    await copilotComplete([{ role: 'user', content: 'Test' }]);

    const completionCall = fetchSpy.mock.calls[1];
    expect((completionCall[0] as string)).toBe('https://api.enterprise.githubcopilot.com/chat/completions');
  });

  it('clears cache on 401 and throws', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockTokenExchange())
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    await expect(
      copilotComplete([{ role: 'user', content: 'Test' }])
    ).rejects.toThrow('Copilot completion failed: 401');
  });

  it('throws when token exchange fails', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));

    await expect(
      copilotComplete([{ role: 'user', content: 'Test' }])
    ).rejects.toThrow('Copilot token exchange failed: 403');
  });
});
