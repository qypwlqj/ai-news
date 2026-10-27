import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

async function testFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await testFiles(path));
    else if (/\.test\.tsx?$/.test(path)) files.push(path);
  }
  return files.sort();
}

// The existing business PR uses both runners. Run every file with its own API.
const groups = { vitest: [], node: [] };
for (const file of await testFiles('tests')) {
  const source = await readFile(file, 'utf8');
  const runner = /from\s*['"]vitest['"]/.test(source) ? 'vitest'
    : /from\s*['"]node:test['"]/.test(source) ? 'node' : null;
  if (!runner) throw new Error(`No supported test runner declared in ${file}`);
  groups[runner].push(file);
}
if (!groups.vitest.length && !groups.node.length) throw new Error('No tests found');
let failed = false;
for (const [runner, files] of Object.entries(groups)) {
  if (!files.length) continue;
  console.log(`Running ${files.length} ${runner} test files`);
  const args = runner === 'vitest' ? ['node_modules/vitest/vitest.mjs', 'run', ...files]
    : ['--import', 'tsx', '--test', '--test-concurrency=1', ...files];
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  failed ||= result.status !== 0;
}
process.exitCode = failed ? 1 : 0;
