import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createDemoLesson } from '../server/demo.ts';
import { buildTutorPrompt, lessonSchemaForBatch, parseLessonOutput } from '../server/prompts.ts';
import { AppError, DEFAULT_SETTINGS, LocalStore } from '../server/store.ts';
import { validateLesson } from '../server/validation.ts';

function temporaryStore(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'code-swipe-sizes-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return new LocalStore(directory);
}

test('given a fresh notebook, when selecting lesson lengths, then eight is default and only six eight or twelve are saved', t => {
  const store = temporaryStore(t);
  assert.equal(store.snapshot().settings.batchSize, 8);
  for (const batchSize of [6, 8, 12]) {
    store.saveSettings({ ...DEFAULT_SETTINGS, batchSize });
    assert.equal(new LocalStore(store.directory).snapshot().settings.batchSize, batchSize);
  }
  for (const batchSize of [4, 10, 0, 13]) assert.throws(() => store.saveSettings({ ...DEFAULT_SETTINGS, batchSize }), AppError);
  assert.equal(store.snapshot().settings.batchSize, 12);
});

test('given a legacy four-card preference and unfinished lesson, when reopening, then future lessons default to eight without altering existing evidence', async t => {
  const store = temporaryStore(t);
  const context = store.context();
  const checked = await validateLesson(createDemoLesson(context), context);
  // Reproduce a previously committed four-card notebook, including its sealed artifact.
  const legacy = store.commitLesson({ ...checked, questions: checked.questions.slice(0, 4), reports: checked.reports.slice(0, 4) }, context.settings);
  store.answer(legacy.questions[0].id, legacy.questions[0].verdict, 1200);
  const before = store.snapshot();
  before.settings.batchSize = 4;
  writeFileSync(join(store.directory, 'state.json'), JSON.stringify(before));
  const artifact = readFileSync(join(store.directory, 'plans', `${legacy.id}.json`), 'utf8');

  const reopened = new LocalStore(store.directory);
  assert.equal(reopened.snapshot().settings.batchSize, 8);
  assert.deepEqual(reopened.snapshot().lessons, before.lessons);
  assert.deepEqual(reopened.snapshot().attempts, before.attempts);
  assert.equal(reopened.publicState([], null).currentLesson?.total, 4);
  assert.equal(reopened.pendingQuestion()?.id, legacy.questions[1].id);
  assert.equal(readFileSync(join(store.directory, 'plans', `${legacy.id}.json`), 'utf8'), artifact);
  reopened.answer(legacy.questions[1].id, 'idk', 2000);
  assert.equal(JSON.parse(readFileSync(join(store.directory, 'state.json'), 'utf8')).settings.batchSize, 8);
});

test('given a twelve-card lesson, when passing through the CLI response contract, then all questions survive and oversized batches fail', t => {
  const store = temporaryStore(t);
  store.saveSettings({ ...DEFAULT_SETTINGS, batchSize: 12 });
  const context = store.context();
  const proposal = createDemoLesson(context);
  const wire = { ...proposal, questions: proposal.questions.map(question => ({ ...question,
    tests: question.tests.map(test => ({ inputJson: JSON.stringify(test.input), expectedJson: JSON.stringify(test.expected), note: test.note })),
  })) };
  assert.equal(proposal.questions.length, 12);
  assert.deepEqual(parseLessonOutput(JSON.stringify(wire)), proposal);
  assert.equal(lessonSchemaForBatch(12).properties?.questions.minItems, 12);
  assert.equal(lessonSchemaForBatch(12).properties?.questions.maxItems, 12);
  assert.match(buildTutorPrompt(context), /Prepare exactly 12 cards/);
  wire.questions.push(structuredClone(wire.questions[0]));
  assert.throws(() => parseLessonOutput(JSON.stringify(wire)), /invalid item count/);
});
