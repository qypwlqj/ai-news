import { stdin as input } from 'node:process';
import { bootstrapServer } from './lib/bootstrap';
import { getNewsRepository } from './lib/db/repository';
import {
  ingestXBatch,
  mapCandidateFeedToIngestDocument,
  parseXIngestDocument,
} from './lib/x-ingest';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const rawText = await readStdin();
  if (!rawText.trim()) {
    console.error(JSON.stringify({ ok: false, error: 'empty stdin' }));
    process.exit(2);
  }
  let raw: unknown;
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

  const env: Record<string, string | undefined> = {
    ...process.env,
    AI_NEWS_STORAGE: process.env.AI_NEWS_STORAGE || 'postgres',
    NODE_ENV: process.env.NODE_ENV || 'production',
  };
  const runtime = await bootstrapServer(env);
  try {
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
