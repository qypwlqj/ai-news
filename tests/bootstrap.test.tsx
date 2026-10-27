import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import RootLayout from '../src/app/layout';

it('renders the App Router document with its page content', () => {
  const html = renderToStaticMarkup(<RootLayout><main>AI 资讯</main></RootLayout>);
  expect(html).toContain('<html lang="zh-CN">');
  expect(html).toContain('<body><main>AI 资讯</main></body>');
});
