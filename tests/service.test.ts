import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createDemoLesson } from '../server/demo.ts';
import { TutorService } from '../server/service.ts';
import { AppError, DEFAULT_SETTINGS, lessonHash, LocalStore } from '../server/store.ts';
import type { ProposedLesson, ProviderStatus, TutorContext } from '../src/types.ts';

const AVAILABLE: ProviderStatus[] = [
  { id: 'codex', available: true, version: 'test', detail: 'Injected test provider.' },
  { id: 'opencode', available: true, version: 'test', detail: 'Injected test provider.' },
  { id: 'demo', available: true, version: '1', detail: 'Curated demo.' },
];

function temporaryStore(t: TestContext): LocalStore {
  const directory = mkdtempSync(join(tmpdir(), 'code-swipe-service-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return new LocalStore(directory);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

test('given a cancelled slow generation, when a replacement completes and stale work later returns, then only the replacement can publish or change job state', async t => {
  const store = temporaryStore(t);
  const old = deferred<ProposedLesson>();
  const replacement = deferred<ProposedLesson>();
  const calls: { context: TutorContext; signal: AbortSignal; progress: (message: string) => void }[] = [];
  const service = new TutorService(store, AVAILABLE, async (context, options) => {
    calls.push({ context: structuredClone(context), signal: options.signal, progress: options.onProgress });
    return calls.length === 1 ? old.promise : replacement.promise;
  });
  service.plan();
  const oldJobId = service.job!.id;
  const oldSettled = service.settled();
  assert.equal(calls.length, 1);
  service.cancel();
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(service.job?.status, 'cancelled');
  assert.equal(store.snapshot().lessons.length, 0);
  service.plan();
  const newJobId = service.job!.id;
  assert.notEqual(newJobId, oldJobId);
  assert.equal(calls.length, 2);
  calls[0].progress('STALE_PROGRESS_MUST_NOT_APPEAR');
  assert.doesNotMatch(service.job!.message, /STALE/);
  const current = createDemoLesson(calls[1].context);
  current.objective = 'Replacement lesson only';
  replacement.resolve(current);
  await service.settled();
  assert.equal(service.job?.status, 'ready');
  assert.equal(store.snapshot().lessons.length, 1);
  assert.equal(store.snapshot().lessons[0].objective, 'Replacement lesson only');
  const stale = createDemoLesson(calls[0].context);
  stale.objective = 'Stale lesson must never publish';
  old.resolve(stale);
  await oldSettled;
  assert.equal(service.job?.id, newJobId);
  assert.equal(service.job?.status, 'ready');
  assert.equal(store.snapshot().lessons.length, 1);
  assert.equal(readdirSync(join(store.directory, 'plans')).length, 1);
  assert.equal(JSON.parse(readFileSync(join(store.directory, 'runs', `${oldJobId}.json`), 'utf8')).status, 'cancelled');
});

test('given an invalid first proposal, when one repair returns a valid lesson, then validation errors and draft reach the tutor before any plan becomes public', async t => {
  const store = temporaryStore(t);
  const contexts: TutorContext[] = [];
  const service = new TutorService(store, AVAILABLE, async context => {
    contexts.push(structuredClone(context));
    assert.equal(store.snapshot().lessons.length, 0);
    assert.equal(service.state().question, null);
    assert.equal(readdirSync(join(store.directory, 'plans')).length, 0);
    const proposal = createDemoLesson(context);
    if (contexts.length === 1) proposal.questions[0].verdict = 'correct';
    return proposal;
  });
  service.plan();
  await service.settled();
  assert.equal(contexts.length, 2);
  assert.equal(contexts[0].repair, undefined);
  assert.match(contexts[1].repair![0], /labelled correct but failed/);
  assert.equal(contexts[1].draft!.questions[0].verdict, 'correct');
  assert.equal(service.job?.status, 'ready');
  const committed = store.snapshot().lessons[0];
  assert.equal(committed.questions[0].verdict, 'buggy');
  assert.equal(committed.questions[0].validation.failures.length, 2);
  assert.equal(committed.predictionHash, lessonHash(committed));
  const artifact = JSON.parse(readFileSync(join(store.directory, 'plans', `${committed.id}.json`), 'utf8'));
  assert.deepEqual(artifact, committed);
  assert.equal(service.state().question?.id, committed.questions[0].id);
  assert.equal(service.state().reviews.length, 0);
});

test('given two invalid proposals, when the one permitted repair also fails, then no plan is published and further automatic retries stop', async t => {
  const store = temporaryStore(t);
  let calls = 0;
  const service = new TutorService(store, AVAILABLE, async context => {
    calls++;
    const invalid = createDemoLesson(context);
    invalid.questions[0].verdict = 'correct';
    return invalid;
  });
  service.plan();
  await service.settled();
  assert.equal(calls, 2);
  assert.equal(service.job?.status, 'error');
  assert.match(service.job!.message, /failed validation.*No exercises were published/);
  assert.deepEqual(store.snapshot().lessons, []);
  assert.equal(service.state().question, null);
  assert.deepEqual(readdirSync(join(store.directory, 'plans')), []);
});

test('given a provider failure, when lesson generation rejects, then the error remains visible without retrying or silently publishing demo exercises', async t => {
  const store = temporaryStore(t);
  let calls = 0;
  const service = new TutorService(store, AVAILABLE, async () => { calls++; throw new Error('codex needs authentication. Run codex login.'); });
  service.plan();
  await service.settled();
  assert.equal(calls, 1);
  assert.equal(service.job?.status, 'error');
  assert.match(service.job!.message, /needs authentication/);
  assert.equal(service.state().settings.provider, 'codex');
  assert.equal(service.state().question, null);
  assert.equal(store.snapshot().lessons.length, 0);
  const job = JSON.parse(readFileSync(join(store.directory, 'runs', `${service.job!.id}.json`), 'utf8'));
  assert.equal(job.status, 'error');
});

test('given an unavailable selected provider, when planning, then the request fails before starting work or recording a lesson', t => {
  const store = temporaryStore(t);
  let calls = 0;
  const service = new TutorService(store, AVAILABLE.map(provider => ({ ...provider, available: provider.id !== 'codex' })), async context => { calls++; return createDemoLesson(context); });
  assert.throws(() => service.plan(), error => error instanceof AppError && error.status === 503 && /codex is unavailable/.test(error.message));
  assert.equal(calls, 0);
  assert.equal(service.job, null);
  assert.deepEqual(readdirSync(join(store.directory, 'plans')), []);
});

test('given generation in progress, when changing settings or starting another run, then conflicts preserve the original request until cancellation', async t => {
  const store = temporaryStore(t);
  const pending = deferred<ProposedLesson>();
  const service = new TutorService(store, AVAILABLE, async () => pending.promise);
  const originalSettings = store.snapshot().settings;
  service.plan();
  assert.throws(() => service.saveSettings({ ...DEFAULT_SETTINGS, provider: 'demo' }), error => error instanceof AppError && error.status === 409);
  assert.throws(() => service.plan(), error => error instanceof AppError && error.status === 409);
  assert.deepEqual(store.snapshot().settings, originalSettings);
  service.cancel();
  service.saveSettings({ ...DEFAULT_SETTINGS, provider: 'demo', interests: '  local arrays  ' });
  assert.equal(store.snapshot().settings.provider, 'demo');
  assert.equal(store.snapshot().settings.interests, 'local arrays');
  pending.resolve(createDemoLesson(store.context()));
  await service.settled();
  assert.equal(service.job?.status, 'cancelled');
  assert.equal(store.snapshot().lessons.length, 0);
  assert.throws(() => service.saveSettings({ ...DEFAULT_SETTINGS, batchSize: 3 }), AppError);
  assert.equal(store.snapshot().settings.provider, 'demo');
});

test('given an unfinished lesson, when planning again after publication, then the current questions cannot be replaced', async t => {
  const store = temporaryStore(t);
  store.saveSettings({ ...DEFAULT_SETTINGS, provider: 'demo' });
  const service = new TutorService(store, AVAILABLE, async () => { throw new Error('Demo must not invoke the CLI provider.'); });
  service.plan();
  await service.settled();
  const current = service.state().question;
  assert.equal(service.job?.status, 'ready');
  assert.throws(() => service.plan(), error => error instanceof AppError && error.status === 409 && /Finish the current lesson/.test(error.message));
  assert.deepEqual(service.state().question, current);
  assert.equal(store.snapshot().lessons.length, 1);
});

test('given baseline demo settings, when publishing a local lesson, then it contains no persistent learner hypotheses', async t => {
  const store = temporaryStore(t);
  store.saveSettings({ ...DEFAULT_SETTINGS, provider: 'demo', tutorMode: 'baseline' });
  const service = new TutorService(store, AVAILABLE);
  service.plan();
  await service.settled();
  assert.equal(service.job?.status, 'ready');
  const committed = store.snapshot().lessons[0];
  assert.deepEqual(committed.hypotheses, []);
  assert.ok(committed.questions.every(question => question.hypothesisId === null));
});

test('given paired probes sharing a specification, when their implementations differ, then the tutor can publish both verified judgments', async t => {
  const store = temporaryStore(t);
  const service = new TutorService(store, AVAILABLE, async context => {
    const proposal = createDemoLesson(context);
    proposal.questions[1] = {
      ...structuredClone(proposal.questions[0]),
      title: 'Nonnegative readings with the inclusive boundary',
      code: proposal.questions[0].referenceCode,
      verdict: 'correct',
      explanation: 'The inclusive comparison keeps zero while removing negative values.',
    };
    return proposal;
  });
  service.plan();
  await service.settled();
  assert.equal(service.job?.status, 'ready');
  const [first, paired] = store.snapshot().lessons[0].questions;
  assert.equal(first.specification, paired.specification);
  assert.notEqual(first.code, paired.code);
  assert.equal(first.verdict, 'buggy');
  assert.equal(paired.verdict, 'correct');
  assert.equal(paired.validation.passedCount, paired.validation.testCount);
});
