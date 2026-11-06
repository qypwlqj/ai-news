import { Button, Text, View } from '@tarojs/components';
import type { FeedState } from '../domain/feed';
import { NewsCard } from './NewsCard';

export function FeedContent({
  state,
  retry,
  loadMore,
  featured = false,
}: {
  state: FeedState;
  retry: () => void;
  loadMore: () => void;
  featured?: boolean;
}) {
  if (state.phase === 'loading' && state.items.length === 0)
    return (
      <View className="feed-skeleton" aria-label="正在加载资讯">
        {[1, 2, 3].map((i) => (
          <View key={i} className="skeleton-card">
            <View className="skeleton skeleton-tag" />
            <View className="skeleton skeleton-title" />
            <View className="skeleton skeleton-copy" />
            <View className="skeleton skeleton-copy short" />
          </View>
        ))}
      </View>
    );
  if (state.items.length === 0)
    return (
      <View className="empty-state text-center">
        <Text className="empty-symbol">
          {state.phase === 'error' ? '↻' : '✳'}
        </Text>
        <Text className="empty-title">
          {state.phase === 'error' ? '暂时没能读到资讯' : '这里还没有新的故事'}
        </Text>
        <Text className="empty-copy">
          {state.error || '试试其他分类或关键词，稍后再来发现新内容。'}
        </Text>
        <Button className="secondary-button" onClick={retry}>
          {state.phase === 'error' ? '重新加载' : '刷新看看'}
        </Button>
      </View>
    );
  const first = featured ? state.items[0] : null;
  const items = featured ? state.items.slice(1) : state.items;
  return (
    <View>
      {first && <NewsCard item={first} featured />}
      {featured && (
        <View className="section-heading flex items-center justify-between">
          <Text>
            资讯速递 <Text className="section-count">{state.total}</Text>
          </Text>
          <Text className="meta">按发布时间</Text>
        </View>
      )}
      {state.phase === 'loading' && (
        <Text className="refresh-note">正在更新资讯…</Text>
      )}
      {items.map((item) => (
        <NewsCard key={item.id} item={item} />
      ))}
      {state.error && (
        <View className="feed-error">
          <Text>{state.error}</Text>
          <Button
            className="text-button"
            onClick={state.phase === 'error' ? retry : loadMore}
          >
            重试
          </Button>
        </View>
      )}
      {state.hasNext ? (
        <Button
          className="load-more"
          disabled={state.loadingMore || state.phase === 'loading'}
          onClick={loadMore}
        >
          {state.loadingMore ? '正在加载…' : '继续阅读 ↓'}
        </Button>
      ) : (
        <View className="end-note">
          <Text>·</Text>
          <Text>阅读到这里，好奇不止于此</Text>
          <Text>✳</Text>
        </View>
      )}
    </View>
  );
}
