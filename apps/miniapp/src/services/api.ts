import Taro from '@tarojs/taro';
import type { NewsItem, NewsQuery } from '@ai-news/contracts';
import { isNewsItem, parseNewsPage, queryString } from '../domain/news';

export const demoMode = __DEMO_MODE__;

async function get(path: string): Promise<unknown> {
  try {
    const response = await Taro.request<unknown>({
      url: `${__API_BASE_URL__}${path}`,
      method: 'GET',
      timeout: 12000,
    });
    if (response.statusCode === 404) throw new Error('这条资讯不存在或已下线');
    if (response.statusCode !== 200)
      throw new Error('资讯服务暂时不可用，请稍后重试');
    return response.data;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error('网络连接失败，请检查网络后重试');
  }
}

export async function getNews(query: NewsQuery) {
  if (__DEMO_MODE__) {
    const { getDemoPage } = await import('./demo');
    return getDemoPage(query);
  }
  return parseNewsPage(
    await get(`/api/news?${queryString(query as Record<string, unknown>)}`),
  );
}

export async function getNewsDetail(id: string): Promise<NewsItem> {
  if (__DEMO_MODE__) {
    const { demoNews } = await import('./demo');
    const item = demoNews.find((item) => item.id === id);
    if (!item) throw new Error('这条资讯不存在或已下线');
    return item;
  }
  const item = await get(`/api/news/${encodeURIComponent(id)}`);
  if (!isNewsItem(item)) throw new Error('资讯数据暂时无法读取');
  return item;
}
