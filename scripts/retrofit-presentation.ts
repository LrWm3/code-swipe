import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { LocalStore } from '../server/store.ts';
import { presentationArchiveHash, verifyPresentationBehavior } from '../server/presentation-revisions.ts';
import type { PresentationRevision } from '../src/types.ts';

// Stop the app before --apply: its running process keeps state in memory.
const args = process.argv.slice(2);
function argument(flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value.`);
  return value;
}
const dataDir = argument('--data-dir');
if (!dataDir || args.some((arg, i) => arg.startsWith('--') && !['--data-dir', '--review', '--apply'].includes(arg) && !['--data-dir', '--review'].includes(args[i - 1]))) {
  throw new Error('Usage: npm run retrofit:presentation -- --data-dir PATH [--review FILE] [--apply]');
}
const directory = resolve(dataDir);
const store = new LocalStore(directory);
const before = store.snapshot();
const reviewFile = argument('--review');
if (!reviewFile) {
  if (args.includes('--apply')) throw new Error('--apply requires --review.');
  console.log(JSON.stringify({ archiveHash: presentationArchiveHash(before), lessons: before.lessons.length, answers: before.attempts.length }, null, 2));
} else {
  const review = JSON.parse(readFileSync(resolve(reviewFile), 'utf8')) as PresentationRevision;
  const existing = before.presentationRevisions?.find(item => item.id === review.id);
  if (existing) {
    if (!isDeepStrictEqual(existing, review)) throw new Error('A saved presentation revision cannot be overwritten.');
    console.log('Already imported; no changes.');
  } else if (args.includes('--apply')) {
    const backup = join(directory, 'backups', `presentation-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    mkdirSync(join(backup, 'plans'), { recursive: true, mode: 0o700 });
    copyFileSync(join(directory, 'state.json'), join(backup, 'state.json'));
    for (const lesson of before.lessons) copyFileSync(join(directory, 'plans', `${lesson.id}.json`), join(backup, 'plans', `${lesson.id}.json`));
    const report = await store.importPresentationRevision(review);
    const { presentationRevisions: _before, ...original } = before;
    const { presentationRevisions: _after, ...preserved } = new LocalStore(directory).snapshot();
    if (!isDeepStrictEqual(original, preserved)) throw new Error(`Archive preservation failed; backup: ${backup}`);
    writeFileSync(join(backup, 'review.json'), JSON.stringify(review, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ ...report, questions: review.questions.length, backup }, null, 2));
  } else {
    const fixtures = await verifyPresentationBehavior(review, before);
    console.log(JSON.stringify({ applied: false, questions: review.questions.length, fixtures }, null, 2));
  }
}
