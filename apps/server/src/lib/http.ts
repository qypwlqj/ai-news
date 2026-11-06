export interface HttpResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<HttpResponseLike>;

export interface FetchOptions {
  fetchImpl?: FetchLike;
  /** 单次请求超时，默认 10s */
  timeoutMs?: number;
  /** 额外重试次数，默认 2（最多 3 次尝试） */
  retries?: number;
  retryDelayMs?: number;
  headers?: Record<string, string>;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const retryable = (status: number) => status === 429 || status >= 500;

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retries = options.retries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 200;
  const fetchImpl: FetchLike =
    options.fetchImpl ??
    ((input, init) => {
      const native = (globalThis as unknown as { fetch?: FetchLike }).fetch;
      return native ? native(input, init) : Promise.reject(new HttpError(0, 'fetch is not available'));
    });

  let lastError: unknown = new HttpError(0, 'request failed');
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal, headers: options.headers });
      const body = await response.text();
      if (response.ok) return body;
      lastError = new HttpError(response.status, `HTTP ${response.status}`);
      if (!retryable(response.status)) throw lastError;
    } catch (error) {
      if (error instanceof HttpError && error.status > 0 && !retryable(error.status)) throw error;
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await sleep(retryDelayMs);
  }
  throw lastError instanceof Error ? lastError : new HttpError(0, 'request failed');
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  return JSON.parse(await fetchText(url, options)) as T;
}
