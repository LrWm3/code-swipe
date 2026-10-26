import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createApp } from '../server.ts';
import { createDemoLesson } from '../server/demo.ts';
import { TutorService } from '../server/service.ts';
import { AppError, DEFAULT_SETTINGS, lessonHash, LocalStore } from '../server/store.ts';
import { validateLesson } from '../server/validation.ts';
import type { AppState, DiscussionContext, Lesson, ProposedDiscussion, ProviderStatus, TutorContext } from '../src/types.ts';

const AVAILABLE: ProviderStatus[] = [
  { id: 'codex', available: true, version: 'test', detail: 'Injected test provider.' },
  { id: 'demo', available: true, version: '1', detail: 'Offline practice.' },
];
const PROPOSAL: ProposedDiscussion = {
  reflection: 'You prefer practical examples. Your note does not yet establish how you reasoned about boundaries.',
  questions: ['Which practical examples would you like next?', 'Would you like to explain any uncertainty about boundaries?'],
};

function temporaryStore(t: TestContext): LocalStore {
  const directory = mkdtempSync(join(tmpdir(), 'code-swipe-discussion-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return new LocalStore(directory);
}

async function commitLesson(store: LocalStore, complete = true): Promise<Lesson> {
  const context = store.context();
  const lesson = store.commitLesson(await validateLesson(createDemoLesson(context), context), context.settings);
  if (complete) finish(store, lesson);
  return lesson;
}

function finish(store: LocalStore, lesson: Lesson) {
  for (const question of lesson.questions) store.answer(question.id, question.verdict, 1_000);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

const appError = (status: number) => (error: unknown) => error instanceof AppError && error.status === status;

test('given arbitrary learner feedback, when reflection and optional replies survive restart, then sealed lessons and recorded answers remain unchanged', async t => {
  const store = temporaryStore(t);
  const lesson = await commitLesson(store);
  const feedback = 'I prefer audio examples.\nPlease use café inventory next; I am tired today.';
  store.saveFeedback(lesson.id, { text: feedback, accidentalAttemptIds: [] });
  const before = store.snapshot();
  const artifactPath = join(store.directory, 'plans', `${lesson.id}.json`);
  const artifact = readFileSync(artifactPath, 'utf8');
  const seen: DiscussionContext[] = [];
  const service = new TutorService(store, AVAILABLE, async context => createDemoLesson(context), async context => {
    seen.push(structuredClone(context));
    return structuredClone(PROPOSAL);
  });
  service.discuss(lesson.id);
  await service.settled();
  assert.equal(service.job?.status, 'ready');
  assert.equal(service.job?.kind, 'discussion');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].feedback?.text, feedback);
  assert.deepEqual(seen[0].attempts, before.attempts);
  const discussion = service.state().discussions[0];
  assert.equal(discussion.lessonId, lesson.id);
  assert.equal(discussion.feedbackText, feedback);
  assert.equal(discussion.reflection, PROPOSAL.reflection);
  assert.deepEqual(discussion.questions.map(question => question.text), PROPOSAL.questions);
  assert.equal(new Set(discussion.questions.map(question => question.id)).size, 2);
  for (const question of discussion.questions) assert.match(question.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  store.saveDiscussionReplies(discussion.id, { replies: [
    { questionId: discussion.questions[0].id, answer: '  Café stock counts, please.  ' },
    { questionId: discussion.questions[1].id, answer: ' \n ' },
  ] });
  store.saveFeedback(lesson.id, { text: 'Later clarification.', accidentalAttemptIds: [] });
  const restarted = new LocalStore(store.directory);
  const saved = restarted.publicState(AVAILABLE, null).discussions[0];
  assert.equal(saved.feedbackText, feedback);
  assert.equal(saved.questions[0].answer, 'Café stock counts, please.');
  assert.equal(saved.questions[0].skipped, false);
  assert.equal(saved.questions[1].answer, null);
  assert.equal(saved.questions[1].skipped, true);
  assert.ok(saved.repliedAt);
  assert.deepEqual(restarted.snapshot().discussions, [saved]);
  assert.deepEqual(restarted.context().discussions, [saved]);
  assert.deepEqual(restarted.snapshot().lessons, before.lessons);
  assert.deepEqual(restarted.snapshot().attempts, before.attempts);
  assert.equal(lessonHash(restarted.snapshot().lessons[0]), lesson.predictionHash);
  assert.equal(readFileSync(artifactPath, 'utf8'), artifact);
});

test('given answered skipped and untouched follow-ups, when starting another lesson, then planning retains replies and skips remaining questions', async t => {
  const store = temporaryStore(t);
  const lesson = await commitLesson(store);
  const answered = store.commitDiscussion(lesson.id, PROPOSAL);
  store.saveDiscussionReplies(answered.id, { replies: [
    { questionId: answered.questions[0].id, answer: 'Practice sensor readings.' },
    { questionId: answered.questions[1].id, answer: '' },
  ] });
  const untouched = store.commitDiscussion(lesson.id, { reflection: 'We can continue whenever you choose.', questions: ['Any other preference?'] });
  const contexts: TutorContext[] = [];
  const service = new TutorService(store, AVAILABLE, async context => {
    contexts.push(structuredClone(context));
    return createDemoLesson(context);
  });
  service.plan();
  await service.settled();
  assert.equal(service.job?.status, 'ready');
  assert.equal(store.snapshot().lessons.length, 2);
  assert.equal(contexts.length, 1);
  const previous = contexts[0].discussions!.find(item => item.id === answered.id)!;
  assert.equal(previous.questions[0].answer, 'Practice sensor readings.');
  assert.equal(previous.questions[0].skipped, false);
  assert.equal(previous.questions[1].skipped, true);
  const skipped = contexts[0].discussions!.find(item => item.id === untouched.id)!;
  assert.equal(skipped.questions[0].answer, null);
  assert.equal(skipped.questions[0].skipped, true);
  assert.deepEqual(new LocalStore(store.directory).snapshot().discussions, contexts[0].discussions);
  assert.throws(() => store.discussionContext(lesson.id), appError(409));
});

test('given saved follow-up answers, when malformed reply sets arrive, then memory and persisted history stay unchanged', async t => {
  const store = temporaryStore(t);
  const lesson = await commitLesson(store);
  const discussion = store.commitDiscussion(lesson.id, PROPOSAL);
  const [first, second] = discussion.questions;
  const valid = [{ questionId: first.id, answer: 'Original answer.' }, { questionId: second.id, answer: '' }];
  store.saveDiscussionReplies(discussion.id, { replies: valid });
  const before = store.snapshot();
  const disk = readFileSync(join(store.directory, 'state.json'), 'utf8');
  const invalid: unknown[] = [
    null, {}, { replies: 'wrong type' }, { replies: [] }, { replies: [valid[0]] },
    { replies: [valid[0], valid[0]] },
    { replies: [valid[0], { questionId: randomUUID(), answer: '' }] },
    { replies: [valid[0], { questionId: second.id, answer: 42 }] },
    { replies: [valid[0], { questionId: second.id, answer: 'x'.repeat(4_001) }] },
    { replies: [valid[0], null] },
  ];
  for (const input of invalid) {
    assert.throws(() => store.saveDiscussionReplies(discussion.id, input), appError(400));
    assert.deepEqual(store.snapshot(), before);
    assert.equal(readFileSync(join(store.directory, 'state.json'), 'utf8'), disk);
  }
  assert.throws(() => store.saveDiscussionReplies(randomUUID(), { replies: valid }), appError(404));
  assert.deepEqual(new LocalStore(store.directory).snapshot(), before);
});

test('given incomplete or baseline lessons, when discussion is requested, then no provider runs and baseline planning excludes saved conversations', async t => {
  const store = temporaryStore(t);
  const lesson = await commitLesson(store, false);
  let calls = 0;
  const service = new TutorService(store, AVAILABLE, async context => createDemoLesson(context), async () => { calls++; return PROPOSAL; });
  assert.throws(() => service.discuss(lesson.id), appError(409));
  assert.throws(() => service.discuss(randomUUID()), appError(404));
  assert.equal(service.job, null);
  finish(store, lesson);
  const discussion = store.commitDiscussion(lesson.id, PROPOSAL);
  service.saveSettings({ ...DEFAULT_SETTINGS, tutorMode: 'baseline' });
  assert.throws(() => service.discuss(lesson.id), appError(409));
  assert.throws(() => store.commitDiscussion(lesson.id, PROPOSAL), appError(409));
  assert.equal(calls, 0);
  assert.deepEqual(store.context().discussions, []);
  assert.deepEqual(store.context().history, []);
  assert.deepEqual(store.snapshot().discussions, [discussion]);
});

test('given a cancelled discussion, when the next lesson publishes before its stale response returns, then stale work cannot publish or replace current job state', async t => {
  const store = temporaryStore(t);
  const lesson = await commitLesson(store);
  const pending = deferred<ProposedDiscussion>();
  const requests: { signal: AbortSignal; onProgress: (message: string) => void }[] = [];
  const service = new TutorService(store, AVAILABLE, async context => createDemoLesson(context), async (_context, options) => {
    requests.push(options);
    return pending.promise;
  });
  service.discuss(lesson.id);
  const staleJobId = service.job!.id;
  const staleSettled = service.settled();
  assert.equal(service.job?.kind, 'discussion');
  service.cancel();
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(service.job?.status, 'cancelled');
  service.plan();
  const nextJobId = service.job!.id;
  await service.settled();
  assert.equal(service.job?.status, 'ready');
  const beforeLateResponse = service.state();
  requests[0].onProgress('STALE_DISCUSSION_PROGRESS');
  pending.resolve(PROPOSAL);
  await staleSettled;
  assert.equal(service.job?.id, nextJobId);
  assert.notEqual(nextJobId, staleJobId);
  assert.deepEqual(service.state(), beforeLateResponse);
  assert.deepEqual(store.snapshot().discussions, []);
  assert.equal(store.snapshot().lessons.length, 2);
  const staleJob = JSON.parse(readFileSync(join(store.directory, 'runs', `${staleJobId}.json`), 'utf8'));
  assert.equal(staleJob.status, 'cancelled');
});

test('given a discussion provider failure, when the learner proceeds to another lesson, then feedback survives and planning remains available', async t => {
  const store = temporaryStore(t);
  const lesson = await commitLesson(store);
  store.saveFeedback(lesson.id, { text: 'I want shorter questions next.', accidentalAttemptIds: [] });
  const before = store.snapshot();
  const contexts: TutorContext[] = [];
  const service = new TutorService(store, AVAILABLE, async context => {
    contexts.push(structuredClone(context));
    return createDemoLesson(context);
  }, async () => { throw new Error('Injected tutor connection failure.'); });
  service.discuss(lesson.id);
  await service.settled();
  assert.equal(service.job?.status, 'error');
  assert.match(service.job!.message, /Injected tutor connection failure/);
  assert.deepEqual(store.snapshot(), before);
  service.plan();
  await service.settled();
  assert.equal(service.job?.status, 'ready');
  assert.deepEqual(contexts[0].feedback, before.feedback);
  assert.deepEqual(store.snapshot().feedback, before.feedback);
  assert.equal(store.snapshot().lessons.length, 2);
});

test('given many lengthy conversations, when planning context is assembled, then recent complete replies fit its budget while exports preserve every conversation', async t => {
  const store = temporaryStore(t);
  const lesson = await commitLesson(store);
  for (let index = 0; index < 14; index++) {
    const discussion = store.commitDiscussion(lesson.id, { reflection: `Reflection ${index}: ${'r'.repeat(2_800)}`, questions: ['What would help next?', 'Any other preference?'] });
    store.saveDiscussionReplies(discussion.id, { replies: discussion.questions.map(question => ({ questionId: question.id, answer: 'x'.repeat(4_000) })) });
  }
  const archive = store.snapshot().discussions!;
  const context = store.context().discussions!;
  assert.equal(archive.length, 14);
  assert.ok(context.length > 0 && context.length < archive.length);
  assert.ok(Buffer.byteLength(JSON.stringify(context)) <= 48_000);
  assert.deepEqual(context, archive.slice(-context.length));
  assert.deepEqual(new LocalStore(store.directory).snapshot().discussions, archive);
});

test('given completed lesson feedback through the API, when discussion and replies are saved, then state export and restart agree and active runs reject reply changes', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'code-swipe-discussion-api-test-'));
  const store = new LocalStore(directory);
  const lesson = await commitLesson(store);
  const pending = deferred<ProposedDiscussion>();
  let calls = 0;
  const service = new TutorService(store, AVAILABLE, async context => createDemoLesson(context), async () => ++calls === 1 ? structuredClone(PROPOSAL) : pending.promise);
  const server = createApp(service).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    pending.resolve({ reflection: 'No further clarification needed.', questions: [] });
    await service.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const request = (path: string, body?: unknown) => fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal((await request(`/api/lessons/${lesson.id}/feedback`, { text: 'Try café stock examples.', accidentalAttemptIds: [] })).status, 200);
  assert.equal((await request(`/api/lessons/${lesson.id}/discuss`, {})).status, 202);
  await service.settled();
  const state = await (await request('/api/state')).json() as AppState;
  assert.equal(state.job?.kind, 'discussion');
  assert.equal(state.discussions.length, 1);
  const discussion = state.discussions[0];
  const replies = { replies: discussion.questions.map((question, index) => ({ questionId: question.id, answer: index === 0 ? 'Use inventory thresholds.' : '' })) };
  const savedResponse = await request(`/api/discussions/${discussion.id}/replies`, replies);
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json() as AppState;
  assert.equal(saved.discussions[0].questions[0].answer, 'Use inventory thresholds.');
  assert.equal(saved.discussions[0].questions[1].skipped, true);
  assert.equal((await request(`/api/lessons/${lesson.id}/discuss`, {})).status, 202);
  const beforeConflict = store.snapshot();
  const conflict = await request(`/api/discussions/${discussion.id}/replies`, replies);
  assert.equal(conflict.status, 409);
  assert.ok((await conflict.json()).error);
  assert.deepEqual(store.snapshot(), beforeConflict);
  pending.resolve({ reflection: 'No further clarification needed.', questions: [] });
  await service.settled();
  const exported = await (await request('/api/export')).json();
  assert.equal(exported.discussions.length, 2);
  assert.deepEqual(exported.discussions, service.state().discussions);
  assert.deepEqual(new LocalStore(directory).snapshot(), exported);
});
