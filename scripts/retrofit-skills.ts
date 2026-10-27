import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LocalStore } from '../server/store.ts';
import { archiveHash, validateRetrofit } from '../server/skill-evidence.ts';
import { buildCurriculumMemory } from '../server/curriculum-memory.ts';
import type { SkillRetrofit } from '../src/types.ts';

// Run with the local server stopped: it holds an in-memory copy of state.json.
const args = process.argv.slice(2);
const argument = (flag: string) => args[args.indexOf(flag) + 1];
if (!args.includes('--data-dir')) throw new Error('Usage: npm run retrofit:skills -- --data-dir PATH [--review FILE] [--apply]');
const directory = resolve(argument('--data-dir'));
const store = new LocalStore(directory);
const before = store.snapshot();
if (!args.includes('--review')) {
  console.log(JSON.stringify({ archiveHash: archiveHash(before), lessons: before.lessons.length, answers: before.attempts.length,
    concepts: buildCurriculumMemory(before).concepts.map(({ id, name }) => ({ id, name })) }, null, 2));
} else {
  const review = JSON.parse(readFileSync(resolve(argument('--review')), 'utf8')) as SkillRetrofit;
  const existing = before.skillRetrofits?.find(item => item.id === review.id);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(review)) throw new Error('A saved retrofit cannot be overwritten.');
    console.log('Already imported; no changes.');
  } else {
    validateRetrofit(review, before);
    const memory = buildCurriculumMemory({ ...before, skillRetrofits: [...before.skillRetrofits ?? [], review] });
    const report = { reviewId: review.id, questions: review.questions.length, newConcepts: review.concepts.length,
      concepts: memory.concepts.map(({ id, familiarity, practice }) => ({ id, familiarity, practice })) };
    if (args.includes('--apply')) {
      const backup = join(directory, 'backups', `skill-retrofit-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      mkdirSync(join(backup, 'plans'), { recursive: true, mode: 0o700 });
      copyFileSync(join(directory, 'state.json'), join(backup, 'state.json'));
      for (const lesson of before.lessons) copyFileSync(join(directory, 'plans', `${lesson.id}.json`), join(backup, 'plans', `${lesson.id}.json`));
      store.importSkillRetrofit(review);
      // Re-open to check every original commitment and the appended annotation.
      const after = new LocalStore(directory).snapshot();
      const { skillRetrofits: _before, ...original } = before;
      const { skillRetrofits: _after, ...preserved } = after;
      if (JSON.stringify(original) !== JSON.stringify(preserved)) throw new Error(`Archive preservation failed; backup: ${backup}`);
      writeFileSync(join(backup, 'review.json'), JSON.stringify(review, null, 2) + '\n', { mode: 0o600 });
      writeFileSync(join(backup, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
      console.log(JSON.stringify({ applied: true, backup, ...report }, null, 2));
    } else console.log(JSON.stringify({ applied: false, ...report }, null, 2));
  }
}
