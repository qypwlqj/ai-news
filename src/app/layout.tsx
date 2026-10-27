import React, { type ReactNode } from 'react';

export const metadata = { title: 'ai-news · AI 资讯', description: '每日 AI 资讯汇总' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
