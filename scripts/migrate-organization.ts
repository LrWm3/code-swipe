import { readFileSync, mkdirSync, copyFileSync, cpSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrateOrganization } from '../server/organization-migration.ts';
import { lessonHash } from '../server/store.ts';
import type { Lesson, StoreData } from '../src/types.ts';

const args = process.argv.slice(2);
if (args.some((value, index) => !['--apply', '--data-dir'].includes(value) && args[index - 1] !== '--data-dir')) throw new Error('Use --data-dir PATH and optional --apply. Stop the server before applying.');
const directory = resolve(args.includes('--data-dir') ? args[args.indexOf('--data-dir') + 1] : '.code-swipe');
const file = join(directory, 'state.json');
const original = readFileSync(file, 'utf8');
const data: StoreData = JSON.parse(original);
for (const lesson of data.lessons) {
  const artifact: Lesson = JSON.parse(readFileSync(join(directory, 'plans', `${lesson.id}.json`), 'utf8'));
  if (lessonHash(lesson) !== lesson.predictionHash || lessonHash(artifact) !== lesson.predictionHash) throw new Error(`Plan integrity check failed: ${lesson.id}`);
}
const backupDirectory = join(directory, 'backups', `organization-v2-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const migration = migrateOrganization(data, backupDirectory);
console.log(JSON.stringify({ ...migration.report, applied: args.includes('--apply') && migration.report.needed }, null, 2));
if (args.includes('--apply') && migration.report.needed) {
  if (readFileSync(file, 'utf8') !== original) throw new Error('Notebook changed; stop the server and rerun the migration.');
  mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  copyFileSync(file, join(backupDirectory, 'state.json'));
  cpSync(join(directory, 'plans'), join(backupDirectory, 'plans'), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(migration.data, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, file);
}
