import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(
  new URL('../apps/miniapp/dist/weapp/', import.meta.url),
);
const config = JSON.parse(await readFile(path.join(root, 'app.json'), 'utf8'));
assert.equal(config.pages.length, 5, 'Expected all five mini-program pages');
assert.equal(config.tabBar.list.length, 3, 'Expected three native tabs');
for (const page of config.pages) {
  for (const suffix of ['.js', '.json', '.wxml'])
    await stat(path.join(root, page + suffix));
}
for (const tab of config.tabBar.list) {
  await stat(path.join(root, tab.iconPath));
  await stat(path.join(root, tab.selectedIconPath));
}

const files = await readdir(root, { recursive: true });
let bytes = 0;
let css = '';
let js = '';
for (const relative of files) {
  const filename = path.join(root, relative);
  const info = await stat(filename);
  if (!info.isFile()) continue;
  bytes += info.size;
  if (relative.endsWith('.wxss')) css += await readFile(filename, 'utf8');
  if (relative.endsWith('.js')) js += await readFile(filename, 'utf8');
}
assert(!css.includes('@tailwind'), 'Tailwind directives must compile to WXSS');
assert(
  /\.flex\s*\{\s*display:\s*flex/.test(css),
  'Tailwind layout utilities are missing',
);
assert(
  /\.mt-4\s*\{\s*margin-top:\s*32rpx/.test(css),
  'Spacing must use the mini-program design scale',
);
assert(
  !/\b(?:LLM_API_KEY|CRON_SECRET|DATABASE_URL|InMemoryNewsRepository)\b/.test(
    js,
  ),
  'Server implementation or secret configuration leaked into the client',
);
assert(
  !/从回答问题，到完成任务|sample-1|demoNews/.test(js),
  'Default release build must exclude demo articles',
);
console.log(
  `WeChat build verified: ${config.pages.length} pages, ${config.tabBar.list.length} tabs, ${(bytes / 1024).toFixed(1)} KiB. Tailwind, assets and client/server isolation passed.`,
);
