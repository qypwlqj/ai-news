import { jsonResponse } from '../../../lib/runtime';

export const dynamic = 'force-dynamic';

/** 分类字典与 category_enum 一致（只增不删不改名），作为前端筛选项的唯一来源。 */
const CATEGORY_ITEMS = [
  { value: 'model_release', label: '模型发布', order: 1 },
  { value: 'research_paper', label: '研究论文', order: 2 },
  { value: 'product_application', label: '产品应用', order: 3 },
  { value: 'industry_news', label: '行业动态', order: 4 },
  { value: 'policy_funding', label: '政策融资', order: 5 },
];

/** GET /api/categories：固定 5 项 value/label/order，顺序稳定。 */
export async function GET(): Promise<Response> {
  return jsonResponse({ items: CATEGORY_ITEMS.map((item) => ({ ...item })) });
}
