import { ScrollView, Text, View } from '@tarojs/components';
import { CATEGORIES, type Category } from '@ai-news/contracts';

export function CategoryTabs({
  value,
  onChange,
}: {
  value?: Category;
  onChange: (value?: Category) => void;
}) {
  return (
    <ScrollView
      scrollX
      enhanced
      showScrollbar={false}
      className="category-scroll"
    >
      <View className="category-track">
        {[{ value: '', label: '全部' }, ...CATEGORIES].map((category) => (
          <View
            key={category.value}
            className={`category-pill ${category.value === (value || '') ? 'is-active' : ''}`}
            onClick={() => onChange((category.value as Category) || undefined)}
            role="button"
            aria-label={category.label}
          >
            <Text>{category.label}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
