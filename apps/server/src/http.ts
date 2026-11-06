import { GET as news } from './api/news/route';
import { GET as detail } from './api/news/[id]/route';
import { GET as categories } from './api/categories/route';
import { GET as health } from './api/health/route';
import { GET as runs } from './api/collect-runs/route';
import { GET as runDetail } from './api/collect-runs/[runId]/route';
import { POST as collect } from './api/cron/collect/route';
import { errorResponse, jsonResponse } from './lib/runtime';

type Handler = (request: Request, id?: string) => Promise<Response> | Response;
const routes: Array<{ path: RegExp; method: string; handle: Handler }> = [
  {
    path: /^\/$/,
    method: 'GET',
    handle: () => jsonResponse({ service: 'AI DAILY API', version: '0.2.0' }),
  },
  { path: /^\/api\/news\/?$/, method: 'GET', handle: news },
  {
    path: /^\/api\/news\/([^/]+)\/?$/,
    method: 'GET',
    handle: (request, id) =>
      detail(request, { params: Promise.resolve({ id: id ?? '' }) }),
  },
  { path: /^\/api\/categories\/?$/, method: 'GET', handle: categories },
  { path: /^\/api\/health\/?$/, method: 'GET', handle: health },
  { path: /^\/api\/collect-runs\/?$/, method: 'GET', handle: runs },
  {
    path: /^\/api\/collect-runs\/([^/]+)\/?$/,
    method: 'GET',
    handle: (request, id) =>
      runDetail(request, { params: Promise.resolve({ runId: id ?? '' }) }),
  },
  { path: /^\/api\/cron\/collect\/?$/, method: 'POST', handle: collect },
];

/** Reuses the existing Request/Response contracts without a frontend framework. */
export async function handleRequest(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  const route = routes.find((route) => route.path.test(path));
  if (!route) return errorResponse('NOT_FOUND', 'endpoint not found', 404);
  if (request.method !== route.method) {
    const response = errorResponse(
      'METHOD_NOT_ALLOWED',
      'method not allowed',
      405,
    );
    response.headers.set('Allow', route.method);
    return response;
  }
  try {
    const id = route.path.exec(path)?.[1];
    return await route.handle(request, id ? decodeURIComponent(id) : undefined);
  } catch {
    return errorResponse('INTERNAL_ERROR', 'request failed', 500);
  }
}
