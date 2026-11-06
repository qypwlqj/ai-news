import { CATEGORIES } from '@ai-news/contracts';
import { jsonResponse } from '../../lib/runtime';

/** GET /api/categories：固定 5 项 value/label/order，顺序稳定。 */
export async function GET(): Promise<Response> {
  return jsonResponse({ items: CATEGORIES.map((item) => ({ ...item })) });
}
