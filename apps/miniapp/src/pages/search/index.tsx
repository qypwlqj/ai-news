import { useState } from 'react';
import { Button, Input, Picker, Text, View } from '@tarojs/components';
import { useRouter } from '@tarojs/taro';
import {
  SOURCE_VALUES,
  sourceLabel,
  type NewsFilters,
} from '@ai-news/contracts';
import { normalizeFilters } from '../../domain/news';
import { useNews } from '../../hooks/useNews';
import { CategoryTabs } from '../../components/CategoryTabs';
import { FeedContent } from '../../components/FeedContent';
import { PreviewNotice } from '../../components/PreviewNotice';

const sources = ['全部来源', ...SOURCE_VALUES.map(sourceLabel)];

export default function Search() {
  const router = useRouter();
  const [filters, setFilters] = useState<NewsFilters>(() =>
    normalizeFilters(router.params),
  );
  const [input, setInput] = useState(filters.q ?? '');
  const feed = useNews(filters);
  const filtered = Object.values(filters).some(Boolean);
  const submit = () =>
    setFilters((current) => ({ ...current, q: input.trim() || undefined }));
  return (
    <View className="screen search-screen">
      <PreviewNotice />
      <View className="search-form flex items-center">
        <View className="search-icon" />
        <Input
          className="search-input flex-1"
          value={input}
          placeholder="搜索标题或摘要"
          maxlength={120}
          confirmType="search"
          onInput={(event) => setInput(event.detail.value)}
          onConfirm={submit}
          aria-label="搜索标题或摘要"
        />
        <Button className="search-submit" onClick={submit}>
          搜索
        </Button>
      </View>
      <CategoryTabs
        value={filters.category}
        onChange={(category) =>
          setFilters((current) => ({ ...current, category }))
        }
      />
      <View className="filter-row flex items-center">
        <Picker
          mode="selector"
          range={sources}
          value={filters.source ? SOURCE_VALUES.indexOf(filters.source) + 1 : 0}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              source: SOURCE_VALUES[Number(event.detail.value) - 1],
            }))
          }
        >
          <View className="filter-control">
            {filters.source ? sourceLabel(filters.source) : '全部来源'}{' '}
            <Text className="filter-chevron">⌄</Text>
          </View>
        </Picker>
        <Picker
          mode="date"
          value={filters.date || ''}
          onChange={(event) =>
            setFilters((current) => ({ ...current, date: event.detail.value }))
          }
        >
          <View className="filter-control">
            {filters.date || '全部日期'}{' '}
            <Text className="filter-chevron">⌄</Text>
          </View>
        </Picker>
        {filtered && (
          <Button
            className="text-button ml-auto"
            onClick={() => {
              setInput('');
              setFilters({});
            }}
          >
            重置
          </Button>
        )}
      </View>
      <View className="results-heading flex items-center justify-between">
        <Text>
          {feed.phase === 'loading' ? '正在查找…' : `找到 ${feed.total} 条资讯`}
        </Text>
        <Text>北京时间 · 最新优先</Text>
      </View>
      <FeedContent state={feed} retry={feed.refresh} loadMore={feed.loadMore} />
    </View>
  );
}
