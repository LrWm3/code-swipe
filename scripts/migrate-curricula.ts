import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { lessonHash, LocalStore } from '../server/store.ts';
import type { Lesson, StoreData } from '../src/types.ts';

const args = process.argv.slice(2);
if (args.some((value, index) => !['--apply', '--restart', '--data-dir'].includes(value) && args[index - 1] !== '--data-dir')) throw new Error('Use --data-dir PATH, optional --apply and --restart. Stop the server before applying.');
if (args.includes('--data-dir') && !args[args.indexOf('--data-dir') + 1]) throw new Error('Supply a data directory.');
const directory = resolve(args.includes('--data-dir') ? args[args.indexOf('--data-dir') + 1] : '.code-swipe');
const original = readFileSync(join(directory, 'state.json'), 'utf8');
const data: StoreData = JSON.parse(original);
for (const lesson of data.lessons) {
  const artifact: Lesson = JSON.parse(readFileSync(join(directory, 'plans', `${lesson.id}.json`), 'utf8'));
  if (lessonHash(lesson) !== lesson.predictionHash || lessonHash(artifact) !== lesson.predictionHash) throw new Error(`Plan integrity check failed: ${lesson.id}`);
}
const current = data.activeLessonId === null ? undefined : data.lessons.find(item => item.id === data.activeLessonId) ?? data.lessons.at(-1);
const cancel = args.includes('--restart') && current && !data.attempts.some(item => item.lessonId === current.id) ? current.id : null;
console.log(JSON.stringify({ fromVersion: data.version, toVersion: 4, migrationNeeded: data.version < 4, legacySessions: data.learning?.arcs.find(item => item.status === 'legacy')?.lessons.length ?? data.lessons.length,
  answersPreserved: data.attempts.length, cancelledUnansweredLesson: cancel, resetToDirections: args.includes('--restart'), apply: args.includes('--apply') }, null, 2));
if (args.includes('--apply')) {
  if (readFileSync(join(directory, 'state.json'), 'utf8') !== original) throw new Error('Notebook changed. Stop the server and retry.');
  const store = new LocalStore(directory);
  if (args.includes('--restart')) store.restartAtDirections();
}
