import { readFileSync, readdirSync, mkdirSync, copyFileSync, cpSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrateKnowledge } from '../server/knowledge-migration.ts';
import { lessonHash } from '../server/store.ts';
import type { Lesson, StoreData } from '../src/types.ts';

const args = process.argv.slice(2);
if (args.some(value => !['--apply', '--data-dir'].includes(value) && args[args.indexOf(value) - 1] !== '--data-dir')) throw new Error('Use --data-dir PATH and optional --apply. Stop the server before applying.');
const directory = resolve(args.includes('--data-dir') ? args[args.indexOf('--data-dir') + 1] : '.code-swipe');
const state = join(directory, 'state.json');
const original = readFileSync(state, 'utf8');
const data: StoreData = JSON.parse(original);
if (![1, 2, 3, 4].includes(data.version)) throw new Error('Unsupported notebook version.');
for (const lesson of data.lessons) {
  const saved: Lesson = JSON.parse(readFileSync(join(directory, 'plans', `${lesson.id}.json`), 'utf8'));
  if (lessonHash(lesson) !== lesson.predictionHash || lessonHash(saved) !== lesson.predictionHash) throw new Error(`Plan integrity check failed: ${lesson.id}`);
}
const backupDirectory = join(directory, 'backups', `knowledge-v1-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const migrated = migrateKnowledge(data, backupDirectory);
console.log(JSON.stringify({ ...migrated.report, applied: args.includes('--apply') && migrated.report.needed, planFiles: readdirSync(join(directory, 'plans')).length }, null, 2));
if (args.includes('--apply') && migrated.report.needed) {
  if (readFileSync(state, 'utf8') !== original) throw new Error('Notebook changed during migration; stop the server and retry.');
  mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  copyFileSync(state, join(backupDirectory, 'state.json'));
  cpSync(join(directory, 'plans'), join(backupDirectory, 'plans'), { recursive: true });
  const temporary = `${state}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(migrated.data, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, state);
}
