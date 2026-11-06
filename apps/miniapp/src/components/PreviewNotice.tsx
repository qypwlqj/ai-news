import { Text, View } from '@tarojs/components';
import { demoMode } from '../services/api';

export function PreviewNotice() {
  return demoMode ? (
    <View className="preview-notice">
      <Text>示例预览</Text>
      <Text>内容仅用于展示阅读体验</Text>
    </View>
  ) : null;
}
