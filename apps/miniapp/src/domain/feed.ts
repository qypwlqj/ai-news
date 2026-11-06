import type {
  NewsFilters,
  NewsItem,
  NewsPage,
  NewsQuery,
} from '@ai-news/contracts';
import { normalizeFilters } from './news';

export interface FeedState {
  items: NewsItem[];
  total: number;
  page: number;
  hasNext: boolean;
  phase: 'loading' | 'ready' | 'error';
  loadingMore: boolean;
  error: string;
}
export type PageFetcher = (query: NewsQuery) => Promise<NewsPage>;

/** Owns refresh/pagination races, keeping React pages free of request bookkeeping. */
export class NewsFeed {
  private state: FeedState = {
    items: [],
    total: 0,
    page: 0,
    hasNext: false,
    phase: 'loading',
    loadingMore: false,
    error: '',
  };
  private filters: NewsFilters = {};
  private generation = 0;
  private listeners = new Set<() => void>();
  constructor(
    private fetchPage: PageFetcher,
    private limit = 10,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<FeedState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  async setFilters(filters: NewsFilters) {
    this.filters = normalizeFilters(filters as Record<string, unknown>);
    await this.refresh(true);
  }
  async refresh(clear = false) {
    const generation = ++this.generation;
    this.update({
      phase: 'loading',
      loadingMore: false,
      error: '',
      ...(clear ? { items: [], page: 0, hasNext: false, total: 0 } : {}),
    });
    try {
      const result = await this.fetchPage({
        ...this.filters,
        page: 1,
        limit: this.limit,
      });
      if (generation !== this.generation) return;
      this.update({
        items: result.items,
        total: result.total,
        page: 1,
        hasNext: result.hasNext,
        phase: 'ready',
      });
    } catch (error) {
      if (generation !== this.generation) return;
      this.update({
        phase: 'error',
        error:
          error instanceof Error ? error.message : '暂时无法连接，请再试一次',
      });
    }
  }
  async loadMore() {
    if (
      this.state.phase === 'loading' ||
      this.state.loadingMore ||
      !this.state.hasNext
    )
      return;
    const generation = this.generation;
    const next = this.state.page + 1;
    this.update({ loadingMore: true, error: '' });
    try {
      const result = await this.fetchPage({
        ...this.filters,
        page: next,
        limit: this.limit,
      });
      if (generation !== this.generation) return;
      const ids = new Set(this.state.items.map((item) => item.id));
      this.update({
        items: [
          ...this.state.items,
          ...result.items.filter((item) => !ids.has(item.id)),
        ],
        total: result.total,
        page: next,
        hasNext: result.hasNext,
        phase: 'ready',
        loadingMore: false,
      });
    } catch (error) {
      if (generation !== this.generation) return;
      this.update({
        loadingMore: false,
        error: error instanceof Error ? error.message : '加载失败，请重试',
      });
    }
  }
  dispose() {
    this.generation++;
    this.listeners.clear();
  }
}
