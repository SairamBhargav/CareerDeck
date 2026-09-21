/*
 * Regenerates types/database.ts from the running local database.
 *
 * Wraps `supabase gen types` only to stamp a "generated" header on the output — without
 * one the file looks hand-written, and someone eventually edits it and loses the change
 * on the next migration.
 *
 * Requires `npx supabase start` to be running. Run it after every migration.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const generated = execFileSync(
  'npx',
  ['--yes', 'supabase', 'gen', 'types', 'typescript', '--local', '--schema', 'public'],
  { encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 16 * 1024 * 1024 },
);

const header = [
  '// Generated from the local database by `npm run types:generate` — do not edit by hand.',
  '// Regenerate after every migration; the client is typed against this file.',
  '',
  '',
].join('\n');

const outputPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'types', 'database.ts');
writeFileSync(outputPath, header + generated, 'utf8');

console.log(`Wrote ${outputPath}`);
