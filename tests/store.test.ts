import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createDemoLesson } from '../server/demo.ts';
import { AppError, calculateMetrics, DEFAULT_SETTINGS, lessonHash, LocalStore, parseSettings } from '../server/store.ts';
import { validateLesson } from '../server/validation.ts';
import type { Lesson, Settings, StoreData } from '../src/types.ts';

function temporaryStore(t: TestContext): LocalStore {
  const directory = mkdtempSync(join(tmpdir(), 'code-swipe-store-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  store.saveSettings({ ...DEFAULT_SETTINGS, provider: 'demo' });
  return store;
}

async function commitDemo(store: LocalStore): Promise<Lesson> {
  const context = store.context();
  return store.commitLesson(await validateLesson(createDemoLesson(context), context), context.settings);
}

function finish(store: LocalStore, lesson: Lesson): void {
  for (const question of lesson.questions) store.answer(question.id, question.verdict, 1_000);
}

function appError(status: number, message: RegExp): (error: unknown) => boolean {
  return error => error instanceof AppError && error.status === status && message.test(error.message);
}

test('given a checked lesson, when committing answering and restarting, then its sealed plan and predictions remain byte-for-byte unchanged', async t => {
  const store = temporaryStore(t);
  const context = store.context();
  const proposal = await validateLesson(createDemoLesson(context), context);
  const committed = store.commitLesson(proposal, context.settings);
  const expected = structuredClone(committed);
  const artifactPath = join(store.directory, 'plans', `${committed.id}.json`);
  const originalArtifact = readFileSync(artifactPath, 'utf8');
  assert.deepEqual(JSON.parse(originalArtifact), expected);
  assert.equal(statSync(artifactPath).mode & 0o777, 0o400);
  assert.equal(lessonHash(committed), committed.predictionHash);

  // Neither provider-owned data nor returned copies can rewrite the commitment.
  proposal.questions[0].prediction.pCorrect = 0.99;
  committed.questions[0].prediction.pCorrect = 0.01;
  const copy = store.snapshot();
  copy.lessons[0].questions[0].verdict = 'correct';
  const history = store.context();
  history.history[0].lesson.questions[0].code = 'changed';
  assert.deepEqual(store.snapshot().lessons[0], expected);

  const question = expected.questions[0];
  const review = store.answer(question.id, question.verdict, 42.4);
  review.question.prediction.pCorrect = 0.2;
  assert.equal(readFileSync(artifactPath, 'utf8'), originalArtifact);
  const restarted = new LocalStore(store.directory);
  assert.deepEqual(restarted.snapshot().lessons[0], expected);
  assert.equal(restarted.snapshot().attempts.length, 1);
  assert.equal(restarted.snapshot().attempts[0].elapsedMs, 42);
  assert.equal(restarted.pendingQuestion()?.id, expected.questions[1].id);
  assert.equal(readFileSync(artifactPath, 'utf8'), originalArtifact);
});

test('given an unattempted question, when a store consumer changes its returned copy, then the sealed exercise cannot mutate', async t => {
  const store = temporaryStore(t);
  const committed = await commitDemo(store);
  const pending = store.pendingQuestion()!;
  pending.code = 'function solve() { return "tampered"; }';
  pending.prediction.pCorrect = 0.99;
  pending.verdict = 'correct';
  assert.deepEqual(store.snapshot().lessons[0], committed);
  assert.equal(store.pendingQuestion()?.code, committed.questions[0].code);
});

test('given a modified state or artifact, when reopening history, then corruption is reported without resetting user data', async t => {
  for (const target of ['state', 'artifact'] as const) {
    const store = temporaryStore(t);
    const committed = await commitDemo(store);
    const path = target === 'state' ? join(store.directory, 'state.json') : join(store.directory, 'plans', `${committed.id}.json`);
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (target === 'state') data.lessons[0].questions[0].prediction.pCorrect = 0.99;
    else data.questions[0].prediction.pCorrect = 0.99;
    chmodSync(path, 0o600);
    const tampered = JSON.stringify(data);
    writeFileSync(path, tampered);
    assert.throws(() => new LocalStore(store.directory), /Nothing was reset/);
    assert.equal(readFileSync(path, 'utf8'), tampered);
  }
});

test('given an unanswered lesson, when requesting public state, then future verdicts fixtures and predictions remain hidden until their answers', async t => {
  const store = temporaryStore(t);
  const context = store.context();
  const proposal = await validateLesson(createDemoLesson(context), context);
  proposal.reflection = 'PRIVATE_REFLECTION_UNTIL_COMPLETE';
  proposal.assumptions = ['PRIVATE_ASSUMPTION_UNTIL_COMPLETE'];
  proposal.hypotheses[0].claim = 'PRIVATE_HYPOTHESIS_UNTIL_COMPLETE';
  proposal.questions.forEach((question, index) => {
    question.explanation = `PRIVATE_EXPLANATION_${index}`;
    question.prediction.rationale = `PRIVATE_PREDICTION_${index}`;
    question.ifCorrect = `PRIVATE_IF_CORRECT_${index}`;
    question.ifIncorrect = `PRIVATE_IF_INCORRECT_${index}`;
    question.referenceCode += `\n// PRIVATE_REFERENCE_${index}`;
  });
  const committed = store.commitLesson(proposal, context.settings);
  const before = store.publicState([], null);
  assert.deepEqual(Object.keys(before.question!).sort(), ['id', 'title', 'specification', 'code', 'purpose', 'testCount'].sort());
  assert.deepEqual(before.reviews, []);
  assert.deepEqual(before.hypotheses, []);
  assert.equal(before.currentLesson?.reflection, null);
  assert.deepEqual(before.currentLesson?.hypotheses, []);
  assert.doesNotMatch(JSON.stringify(before), /PRIVATE_/);

  store.answer(committed.questions[0].id, 'buggy', 900);
  const during = store.publicState([], null);
  assert.equal(during.reviews.length, 1);
  assert.equal(during.reviews[0].question.explanation, 'PRIVATE_EXPLANATION_0');
  assert.equal(during.reviews[0].question.prediction.rationale, 'PRIVATE_PREDICTION_0');
  assert.doesNotMatch(JSON.stringify(during), /PRIVATE_(?:EXPLANATION|PREDICTION|REFERENCE|IF_CORRECT|IF_INCORRECT)_[123]|PRIVATE_.*_UNTIL_COMPLETE/);
  assert.equal(during.currentLesson?.complete, false);
  for (const question of committed.questions.slice(1)) store.answer(question.id, question.verdict, 1_000);
  const after = store.publicState([], null);
  assert.equal(after.question, null);
  assert.equal(after.currentLesson?.complete, true);
  assert.equal(after.currentLesson?.reflection, 'PRIVATE_REFLECTION_UNTIL_COMPLETE');
  assert.equal(after.hypotheses[0].claim, 'PRIVATE_HYPOTHESIS_UNTIL_COMPLETE');
});

test('given a recorded answer, when the same request is retried across restart, then it is idempotent and conflicting changes are rejected', async t => {
  const store = temporaryStore(t);
  const lesson = await commitDemo(store);
  assert.throws(() => store.answer(lesson.questions[1].id, 'correct', 100), appError(409, /no longer current/));
  const first = store.answer(lesson.questions[0].id, 'buggy', 1_234);
  assert.deepEqual(store.answer(lesson.questions[0].id, 'buggy', 8_888), first);
  const restarted = new LocalStore(store.directory);
  assert.deepEqual(restarted.answer(lesson.questions[0].id, 'buggy', 99), first);
  assert.equal(restarted.snapshot().attempts.length, 1);
  assert.throws(() => restarted.answer(lesson.questions[0].id, 'correct', 1_234), appError(409, /already been recorded/));
  assert.equal(restarted.snapshot().attempts[0].answer, 'buggy');
});

test('given invalid elapsed times or answer labels, when recording a response, then no attempt or lesson change is persisted', async t => {
  const store = temporaryStore(t);
  const lesson = await commitDemo(store);
  for (const elapsed of [-1, NaN, Infinity, 86_400_001]) assert.throws(() => store.answer(lesson.questions[0].id, 'buggy', elapsed), appError(400, /Invalid exercise response/));
  assert.throws(() => store.answer(lesson.questions[0].id, 'maybe' as never, 1_000), appError(400, /Choose buggy or correct/));
  assert.equal(store.snapshot().attempts.length, 0);
  assert.equal(readdirSync(join(store.directory, 'plans')).length, 1);
});

test('given a flagged attempt, when calculating calibration and next tutor context, then it is excluded while review and sealed evidence remain auditable', async t => {
  const store = temporaryStore(t);
  const firstLesson = await commitDemo(store);
  finish(store, firstLesson);
  const firstAttempt = store.snapshot().attempts[0];
  const context = store.context();
  const next = createDemoLesson(context);
  next.hypotheses[0].status = 'supported';
  next.hypotheses[0].supportingAttemptIds = [firstAttempt.id];
  const secondLesson = store.commitLesson(await validateLesson(next, context), context.settings);
  finish(store, secondLesson);
  const before = store.publicState([], null).metrics;
  assert.equal(before.count, 8);
  assert.equal(before.brier, 0.25);
  store.flagAttempt(firstAttempt.id, true);
  const state = store.publicState([], null);
  assert.equal(state.metrics.count, 7);
  assert.equal(state.reviews.find(review => review.attempt.id === firstAttempt.id)?.attempt.flagged, true);
  const refreshed = store.context();
  assert.ok(refreshed.history.every(item => item.attempts.every(attempt => attempt.id !== firstAttempt.id)));
  assert.equal(refreshed.hypotheses[0].status, 'tentative');
  assert.deepEqual(refreshed.hypotheses[0].supportingAttemptIds, []);
  assert.equal(store.snapshot().lessons[1].hypotheses[0].status, 'supported');
  assert.deepEqual(store.snapshot().lessons[1].hypotheses[0].supportingAttemptIds, [firstAttempt.id]);
  store.flagAttempt(firstAttempt.id, false);
  assert.equal(store.publicState([], null).metrics.count, 8);
  assert.equal(store.context().hypotheses[0].status, 'supported');
  assert.throws(() => store.flagAttempt('missing', true), appError(404, /not found/));
});

test('given forecasts from several provider and tutor-mode groups, when scoring them, then Brier accuracy bins and purposes use only the selected unflagged observations', async t => {
  const store = temporaryStore(t);
  const template = await commitDemo(store);
  const definitions: { provider: Settings['provider']; tutorMode: Settings['tutorMode']; p: number; correct: boolean; flagged?: boolean; purpose: 'diagnostic' | 'practice' }[] = [
    { provider: 'codex', tutorMode: 'reflective', p: 0.8, correct: true, purpose: 'diagnostic' },
    { provider: 'codex', tutorMode: 'reflective', p: 0.3, correct: false, purpose: 'practice' },
    { provider: 'codex', tutorMode: 'reflective', p: 0.1, correct: true, flagged: true, purpose: 'diagnostic' },
    { provider: 'codex', tutorMode: 'baseline', p: 1, correct: false, purpose: 'practice' },
    { provider: 'opencode', tutorMode: 'reflective', p: 0, correct: true, purpose: 'diagnostic' },
  ];
  const data: StoreData = { version: 1, settings: { ...DEFAULT_SETTINGS }, lessons: [], attempts: [] };
  definitions.forEach((item, index) => {
    const lesson = structuredClone(template);
    lesson.id = `lesson-${index}`;
    lesson.provider = item.provider;
    lesson.tutorMode = item.tutorMode;
    lesson.questions = [lesson.questions[0]];
    lesson.questions[0].id = `question-${index}`;
    lesson.questions[0].prediction.pCorrect = item.p;
    lesson.questions[0].purpose = item.purpose;
    data.lessons.push(lesson);
    data.attempts.push({ id: `attempt-${index}`, lessonId: lesson.id, exerciseId: lesson.questions[0].id, answer: item.correct ? 'buggy' : 'correct', correct: item.correct, answeredAt: new Date().toISOString(), elapsedMs: 1_000, flagged: item.flagged ?? false });
  });
  const selected = calculateMetrics(data, { provider: 'codex', tutorMode: 'reflective' });
  assert.equal(selected.count, 2);
  assert.ok(Math.abs(selected.brier! - 0.065) < 1e-12);
  assert.equal(selected.accuracy, 0.5);
  assert.deepEqual(selected.calibration[1], { label: '20–40%', count: 1, predicted: 0.3, actual: 0 });
  assert.deepEqual(selected.calibration[4], { label: '80–100%', count: 1, predicted: 0.8, actual: 1 });
  assert.deepEqual(selected.byPurpose.slice(0, 2), [{ purpose: 'diagnostic', count: 1, accuracy: 1 }, { purpose: 'practice', count: 1, accuracy: 0 }]);
  const all = calculateMetrics(data);
  assert.equal(all.count, 4);
  assert.ok(Math.abs(all.brier! - 0.5325) < 1e-12);
  assert.equal(all.accuracy, 0.5);
  assert.equal(all.calibration[0].count, 1);
  assert.equal(all.calibration[4].count, 2);
  assert.equal(calculateMetrics(data, { provider: 'codex', tutorMode: 'baseline' }).brier, 1);
  const empty = calculateMetrics(data, { provider: 'demo', tutorMode: 'baseline' });
  assert.equal(empty.count, 0);
  assert.equal(empty.brier, null);
  assert.equal(empty.accuracy, null);
});

test('given accumulated reflective history, when switching to baseline, then tutor context contains no prior attempts hypotheses or performance feedback', async t => {
  const store = temporaryStore(t);
  finish(store, await commitDemo(store));
  assert.equal(store.context().history.length, 1);
  store.saveSettings({ ...store.snapshot().settings, tutorMode: 'baseline' });
  const baseline = store.context();
  assert.deepEqual(baseline.history, []);
  assert.deepEqual(baseline.hypotheses, []);
  assert.equal(baseline.metrics.count, 0);
  assert.equal(baseline.metrics.brier, null);
  assert.equal(store.publicState([], null).metrics.count, 0);
  assert.equal(store.snapshot().attempts.length, 4);
});

test('given a retention proposal, when its cited observation is recent missing or flagged, then only a real delayed unflagged observation permits retention', async t => {
  const store = temporaryStore(t);
  finish(store, await commitDemo(store));
  const context = store.context();
  const observation = context.history[0].attempts[0];
  const proposal = createDemoLesson(context);
  proposal.questions[0].purpose = 'retention';
  proposal.rationale = `Revisit the skill assessed by attempt ${observation.id} after a delay.`;
  await assert.rejects(validateLesson(proposal, context), /retention requires.*24 hours/);
  observation.answeredAt = new Date(Date.now() - 25 * 60 * 60 * 1_000).toISOString();
  assert.equal((await validateLesson(proposal, context)).questions[0].purpose, 'retention');
  observation.flagged = true;
  await assert.rejects(validateLesson(proposal, context), /retention requires/);
  observation.flagged = false;
  proposal.rationale = 'Retest an earlier skill without citing its evidence.';
  await assert.rejects(validateLesson(proposal, context), /retention requires/);
});

test('given malformed settings, when parsing or saving them, then invalid provider model mode and batch values cannot replace saved preferences', t => {
  const store = temporaryStore(t);
  const before = store.snapshot().settings;
  for (const invalid of [null, [], { ...before, provider: 'remote' }, { ...before, model: '--exec' }, { ...before, model: 'name; echo secret' }, { ...before, batchSize: '4' }, { ...before, batchSize: 5 }, { ...before, interests: 'x'.repeat(2_001) }, { ...before, tutorMode: 'adaptive' }]) {
    assert.throws(() => parseSettings(invalid), AppError);
    assert.throws(() => store.saveSettings(invalid as Settings), AppError);
    assert.deepEqual(store.snapshot().settings, before);
  }
  assert.equal(parseSettings({ ...before, interests: '  Arrays and finance  ' }).interests, 'Arrays and finance');
});

test('given a large lesson archive, when preparing bounded tutor context, then recent evidence survives without deleting history or keeping dropped citations', async t => {
  const store = temporaryStore(t);
  const context = store.context();
  const draft = createDemoLesson(context);
  for (const question of draft.questions) {
    question.code += '\n/*' + 'x'.repeat(5_000) + '*/';
    question.referenceCode += '\n/*' + 'x'.repeat(5_000) + '*/';
  }
  const validated = await validateLesson(draft, context);
  let firstAttempt = '';
  let lastLesson = '';
  for (let index = 0; index < 9; index++) {
    if (firstAttempt) {
      validated.hypotheses[0].status = 'supported';
      validated.hypotheses[0].supportingAttemptIds = [firstAttempt];
    }
    const lesson = store.commitLesson(validated, context.settings);
    finish(store, lesson);
    firstAttempt ||= store.snapshot().attempts[0].id;
    lastLesson = lesson.id;
  }
  const bounded = store.context();
  assert.ok(bounded.history.length < 9);
  assert.equal(bounded.history.at(-1)!.lesson.id, lastLesson);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded.history)) <= 280_000);
  assert.equal(store.snapshot().lessons.length, 9);
  assert.deepEqual(bounded.hypotheses[0].supportingAttemptIds, []);
  assert.equal(bounded.hypotheses[0].status, 'tentative');
  assert.deepEqual(store.snapshot().lessons.at(-1)!.hypotheses[0].supportingAttemptIds, [firstAttempt]);
});
