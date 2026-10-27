import { listNews } from '../../../lib/query';
import { errorResponse, jsonResponse } from '../../../lib/runtime';

export const dynamic = 'force-dynamic';

/** GET /api/news：date/category/source/page/limit 查询，默认 limit=20。 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const result = await listNews(searchParams);
  if (!result.ok) {
    const status = result.code === 'INTERNAL_ERROR' ? 500 : 400;
    return errorResponse(result.code, result.message, status);
  }
  return jsonResponse(result.value);
}
