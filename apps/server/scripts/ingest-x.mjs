#!/usr/bin/env node
/**
 * Internal X ingest CLI. Reads one JSON document from stdin.
 * Stable contract: { items: [{ postId, url, authorHandle, authorDisplayName, publishedAt, text, summary, category, title? }] }
 * Pass --candidate to accept parent candidate feed snake_case and map without fabricating fields.
 * Requires DATABASE_URL / AI_NEWS_STORAGE=postgres in the process environment (via container --env-file).
 */
import { stdin as input } from 'node:process';
import { bootstrapServer } from '../src/lib/bootstrap.ts';
import {
  ingestXBatch,
  mapCandidateFeedToIngestDocument,
  parseXIngestDocument,
} from '../src/lib/x-ingest.ts';

async function readStdin() {
  const chunks = [];
  for await (const chunk of input) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const rawText = await readStdin();
  if (!rawText.trim()) {
    console.error(JSON.stringify({ ok: false, error: 'empty stdin' }));
    process.exit(2);
  }
  let raw;
  try {
    raw = JSON.parse(rawText);
  } catch {
    console.error(JSON.stringify({ ok: false, error: 'stdin must be valid JSON' }));
    process.exit(2);
  }

  const candidate = process.argv.includes('--candidate');
  let document;
  try {
    document = candidate ? mapCandidateFeedToIngestDocument(raw) : parseXIngestDocument(raw);
  } catch (error) {
    console.error(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : 'invalid document',
      }),
    );
    process.exit(2);
  }

  const env = {
    ...process.env,
    AI_NEWS_STORAGE: process.env.AI_NEWS_STORAGE || 'postgres',
    NODE_ENV: process.env.NODE_ENV || 'production',
  };
  const runtime = await bootstrapServer(env);
  try {
    const { getNewsRepository } = await import('../src/lib/db/repository.ts');
    const receipt = await ingestXBatch(getNewsRepository(), document.items);
    console.log(JSON.stringify({ ok: receipt.errors.length === 0, ...receipt }));
    process.exit(receipt.errors.length === 0 ? 0 : 1);
  } finally {
    await runtime.close();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : 'ingest failed',
    }),
  );
  process.exit(1);
});
