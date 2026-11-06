import { createServer } from 'node:http';
import { handleRequest } from './http';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173')
    .split(',')
    .map((value) => value.trim()),
);
const maxBodyBytes = 64 * 1024;

const server = createServer(async (incoming, outgoing) => {
  const origin = incoming.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    outgoing.setHeader('Access-Control-Allow-Origin', origin);
    outgoing.setHeader('Vary', 'Origin');
    outgoing.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    outgoing.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization',
    );
  }
  if (incoming.method === 'OPTIONS') {
    outgoing.writeHead(origin && allowedOrigins.has(origin) ? 204 : 403);
    outgoing.end();
    return;
  }
  try {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of incoming) {
      bytes += chunk.length;
      if (bytes > maxBodyBytes) {
        outgoing.writeHead(413);
        outgoing.end();
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value))
        value.forEach((entry) => headers.append(key, entry));
      else if (value !== undefined) headers.set(key, value);
    }
    const body = Buffer.concat(chunks);
    const request = new Request(
      `http://127.0.0.1:${port}${incoming.url || '/'}`,
      {
        method: incoming.method,
        headers,
        ...(body.length && !['GET', 'HEAD'].includes(incoming.method || 'GET')
          ? { body }
          : {}),
      },
    );
    const response = await handleRequest(request);
    response.headers.forEach((value, key) => outgoing.setHeader(key, value));
    outgoing.writeHead(response.status);
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    if (!outgoing.headersSent)
      outgoing.writeHead(500, { 'content-type': 'application/json' });
    outgoing.end(
      JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'request failed' },
      }),
    );
  }
});
server.requestTimeout = 30_000;
server.listen(port, host, () =>
  console.log(
    `AI DAILY API listening at http://${host}:${port} (local memory storage)`,
  ),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => server.close(() => process.exit(0)));
