import { describe, expect, it } from 'vitest';
import { POST } from '../src/app/api/cron/collect/route';

const ENDPOINT = 'http://localhost/api/cron/collect';

function post(init: RequestInit = {}): Promise<Response> {
  return POST(new Request(ENDPOINT, { method: 'POST', ...init }));
}

type ErrorBody = { error?: { code?: string; message?: string } };

describe('POST /api/cron/collect 鉴权边界', () => {
  it('缺少 Authorization 返回 401/403 且为统一错误信封', async () => {
    const response = await post();
    expect([401, 403]).toContain(response.status);
    const body = (await response.json()) as ErrorBody;
    expect(typeof body.error?.code).toBe('string');
    expect((body.error?.code ?? '').length).toBeGreaterThan(0);
    expect(typeof body.error?.message).toBe('string');
  });

  it('错误令牌被拒绝，且响应不回显令牌或环境变量名', async () => {
    const response = await post({ headers: { authorization: 'Bearer wrong-secret-value' } });
    expect([401, 403]).toContain(response.status);
    const text = await response.text();
    expect(text).not.toContain('wrong-secret-value');
    expect(text).not.toContain('CRON_SECRET');
  });
});
