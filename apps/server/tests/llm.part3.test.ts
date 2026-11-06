import { describe, expect, it } from 'vitest';
import { createHttpLlmClient, DEFAULT_LLM_BASE_URL, LlmError } from '../src/lib/llm';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('LLM HTTP 客户端', () => {
  it('成功时返回模型文本，并打满请求头与报文', async () => {
    const client = createHttpLlmClient({
      apiKey: 'test-token',
      model: 'test-model',
      baseUrl: 'https://llm.example/v1/',
      fetchImpl: async (url, init) => {
        expect(url).toBe('https://llm.example/v1/chat/completions');
        expect((init?.headers as Record<string, string>).authorization).toBe('Bearer test-token');
        const body = JSON.parse(String(init?.body)) as { model: string; messages: Array<{ content: string }> };
        expect(body.model).toBe('test-model');
        expect(body.messages[0]?.content).toBe('hello');
        return jsonResponse({ choices: [{ message: { content: '{"summary":"ok","category":"model_release"}' } }] });
      },
    });
    await expect(client.complete('hello')).resolves.toContain('model_release');
  });

  it('缺省 baseUrl 使用默认地址', async () => {
    let seen = '';
    const client = createHttpLlmClient({
      apiKey: 'test-token',
      model: 'test-model',
      fetchImpl: async (url) => {
        seen = url;
        return jsonResponse({ choices: [{ message: { content: 'x' } }] });
      },
    });
    await client.complete('p');
    expect(seen).toBe(`${DEFAULT_LLM_BASE_URL}/chat/completions`);
  });

  it('HTTP 失败抛 LLM_HTTP_ERROR 且不泄露凭据', async () => {
    const client = createHttpLlmClient({
      apiKey: 'secret-value',
      model: 'test-model',
      fetchImpl: async () => jsonResponse({ error: 'boom' }, 500),
    });
    const error = (await client.complete('p').catch((cause: unknown) => cause)) as LlmError;
    expect(error).toBeInstanceOf(LlmError);
    expect(error.code).toBe('LLM_HTTP_ERROR');
    expect(error.message).not.toContain('secret-value');
  });

  it('超时中断降级为 LLM_TIMEOUT', async () => {
    const client = createHttpLlmClient({
      apiKey: 'test-token',
      model: 'test-model',
      timeoutMs: 5,
      fetchImpl: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });
    await expect(client.complete('p')).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
  });

  it('响应结构异常与缺凭据均直接报错，便于上层降级', async () => {
    const bad = createHttpLlmClient({
      apiKey: 'test-token',
      model: 'test-model',
      fetchImpl: async () => jsonResponse({ choices: [] }),
    });
    await expect(bad.complete('p')).rejects.toMatchObject({ code: 'LLM_BAD_RESPONSE' });
    expect(() => createHttpLlmClient({ apiKey: '', model: 'test-model' })).toThrow(LlmError);
  });
});
