import { describe, expect, it, vi } from 'vitest';
import { HttpError, fetchText } from '../src/lib/http';

const response = (status: number, body = 'ok') => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});

describe('fetchText', () => {
  it('returns body on success', async () => {
    const fetchImpl = vi.fn(async () => response(200, 'hello'));
    await expect(fetchText('https://a.test', { fetchImpl })).resolves.toBe('hello');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries 5xx up to 3 attempts then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(500))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200, 'ok'));
    await expect(fetchText('https://a.test', { fetchImpl, retryDelayMs: 0 })).resolves.toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry 4xx', async () => {
    const fetchImpl = vi.fn(async () => response(404));
    await expect(fetchText('https://a.test', { fetchImpl })).rejects.toBeInstanceOf(HttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws the last error after exhausting retries', async () => {
    const fetchImpl = vi.fn(async () => response(500));
    await expect(fetchText('https://a.test', { fetchImpl, retryDelayMs: 0 })).rejects.toMatchObject({
      status: 500,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
