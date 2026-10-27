import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoLesson } from '../server/demo.ts';
import { LocalStore } from '../server/store.ts';
import { validateLesson } from '../server/validation.ts';
import { presentationArchiveHash, validatePresentationRevision } from '../server/presentation-revisions.ts';
import type { PresentationRevision } from '../src/types.ts';

async function archive(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'swipe-presentation-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  const context = store.context();
  const proposal = createDemoLesson(context);
  const question = proposal.questions[0];
  delete question.signature;
  question.code = 'function solve(input) { return input.counts.findIndex(count => count < input.threshold) || -1; }';
  question.referenceCode = 'function solve(input) { return input.counts.findIndex(count => count < input.threshold); }';
  question.specification = 'Return the first index below the threshold, or -1. Counts and threshold are nonnegative integers.';
  question.tests = [
    { input: { counts: [1, 3], threshold: 2 }, expected: 0, note: 'Match at zero' },
    { input: { counts: [3, 1], threshold: 2 }, expected: 1, note: 'Later match' },
    { input: { counts: [], threshold: 0 }, expected: -1, note: 'No counts' },
    { input: { counts: [3, 4], threshold: 2 }, expected: -1, note: 'No matches' },
  ];
  const lesson = store.commitLesson(await validateLesson(proposal, context), context.settings);
  for (const item of lesson.questions) store.answer(item.id, item.verdict, 1000);
  const doc = '/**\n * @param {number[]} counts - Nonnegative integer stock counts. Do not modify.\n * @param {number} threshold - Nonnegative integer stock threshold.\n * @returns {number} Index of the first matching count, or -1.\n */\n';
  const review: PresentationRevision = {
    id: 'wording-review', createdAt: new Date().toISOString(), archiveHash: presentationArchiveHash(store.snapshot()), method: 'Manual wording and identifier review; fixture comparison.',
    questions: [{ lessonId: lesson.id, exerciseId: lesson.questions[0].id, predictionHash: lesson.predictionHash,
      signature: { name: 'firstLowStockIndex', parameters: ['counts', 'threshold'] }, parameterSources: ['counts', 'threshold'],
      specification: 'Return the index of the first stock count below the threshold, or -1 if none qualifies.',
      code: doc + 'function firstLowStockIndex(counts, threshold) { return counts.findIndex(count => count < threshold) || -1; }',
      referenceCode: doc + 'function firstLowStockIndex(counts, threshold) { return counts.findIndex(count => count < threshold); }',
      note: 'Only wording, documentation, and parameter bindings changed.',
    }],
  };
  return { store, review, lesson };
}

test('given an answered legacy question, when revising presentation and reopening, then calls improve while original answers plans and tutor evidence remain unchanged', async t => {
  const { store, review, lesson } = await archive(t);
  const before = store.snapshot();
  const context = store.context();
  const plan = readFileSync(join(store.directory, 'plans', `${lesson.id}.json`), 'utf8');
  assert.deepEqual(await store.importPresentationRevision(review), { imported: true, fixtures: 4 });
  const reopened = new LocalStore(store.directory);
  const { presentationRevisions, ...after } = reopened.snapshot();
  assert.deepEqual(after, before);
  assert.deepEqual(presentationRevisions, [review]);
  assert.deepEqual(reopened.context(), context);
  assert.equal(readFileSync(join(store.directory, 'plans', `${lesson.id}.json`), 'utf8'), plan);
  const displayed = reopened.publicState([], null).reviews.find(item => item.question.id === lesson.questions[0].id)!;
  assert.equal(displayed.originalPresentation?.code, lesson.questions[0].code);
  assert.equal(displayed.question.code, review.questions[0].code);
  assert.deepEqual(displayed.question.tests[0].input, [[1, 3], 2]);
  assert.deepEqual(displayed.question.validation.failures[0], { input: [[1, 3], 2], expected: 0, actual: -1, error: null });
  assert.equal(displayed.question.verdict, lesson.questions[0].verdict);
  assert.deepEqual(displayed.question.prediction, lesson.questions[0].prediction);
  assert.deepEqual(await reopened.importPresentationRevision(review), { imported: false, fixtures: 0 });
  await assert.rejects(reopened.importPresentationRevision({ ...review, method: 'Changed' }), /cannot be overwritten/);
});

test('given a revision that repairs the intentional bug, when importing, then changed behavior is rejected without modifying history', async t => {
  const { store, review } = await archive(t);
  const before = store.snapshot();
  review.questions[0].code = review.questions[0].referenceCode;
  await assert.rejects(store.importPresentationRevision(review), /changed behavior/);
  assert.deepEqual(store.snapshot(), before);
});

test('given stale or inconsistent revision mappings, when importing, then no partial revision is saved', async t => {
  const { store, review } = await archive(t);
  const stale = structuredClone(review);
  stale.archiveHash = '0'.repeat(64);
  await assert.rejects(store.importPresentationRevision(stale), /Archive changed/);
  for (const mutate of [
    item => { item.predictionHash = '0'.repeat(64); },
    item => { item.parameterSources = ['unknown', 'threshold']; },
    item => { item.parameterSources = ['counts']; },
    item => { item.exerciseId = 'unanswered'; },
  ] as ((item: PresentationRevision['questions'][number]) => void)[]) {
    const invalid = structuredClone(review);
    mutate(invalid.questions[0]);
    assert.throws(() => validatePresentationRevision(invalid, store.snapshot()), /sealed legacy|own field|Parameter sources/);
  }
  const duplicate = structuredClone(review);
  duplicate.questions.push(duplicate.questions[0]);
  await assert.rejects(store.importPresentationRevision(duplicate), /already has/);
  assert.equal(store.snapshot().presentationRevisions, undefined);
});
