import path from 'node:path';
import { defineConfig } from '@tarojs/cli';
import { UnifiedViteWeappTailwindcssPlugin } from 'weapp-tailwindcss/vite';

const isH5 = process.env.TARO_ENV === 'h5';
const demo = process.env.TARO_APP_DEMO === 'true';
const apiBase = (
  process.env.TARO_APP_API_BASE_URL || 'http://127.0.0.1:3000'
).replace(/\/$/, '');

export default defineConfig<'vite'>({
  projectName: 'ai-daily-miniapp',
  date: '2026-11-06',
  designWidth: 750,
  deviceRatio: { 375: 2, 640: 2.34 / 2, 750: 1, 828: 1.81 / 2 },
  sourceRoot: 'src',
  outputRoot: `dist/${isH5 ? 'h5' : 'weapp'}`,
  framework: 'react',
  compiler: {
    type: 'vite',
    vitePlugins: [
      UnifiedViteWeappTailwindcssPlugin({ rem2rpx: true, disabled: isH5 }),
    ],
  },
  alias: {
    '@': path.resolve(__dirname, '../src'),
    // The H5 platform imports this peer from a hoisted dependency in npm workspaces.
    '@tarojs/plugin-framework-react': path.dirname(
      require.resolve('@tarojs/plugin-framework-react/package.json'),
    ),
  },
  defineConstants: {
    __API_BASE_URL__: JSON.stringify(apiBase),
    __DEMO_MODE__: JSON.stringify(demo),
  },
  mini: {
    postcss: {
      pxtransform: { enable: true },
      htmltransform: { enable: false },
      tailwindcss: {
        enable: true,
        config: { config: path.resolve(__dirname, '../tailwind.config.cjs') },
      },
      cssModules: { enable: false },
    },
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    router: { mode: 'hash' },
    devServer: {
      host: '127.0.0.1',
      port: 5173,
      proxy: { '/api': { target: apiBase, changeOrigin: true } },
    },
    postcss: {
      pxtransform: { enable: true },
      tailwindcss: {
        enable: true,
        config: { config: path.resolve(__dirname, '../tailwind.config.cjs') },
      },
      cssModules: { enable: false },
    },
  },
});
