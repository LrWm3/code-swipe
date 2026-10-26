import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { after, before, test, type TestContext } from 'node:test';
import { createApp } from '../server.ts';
import { createDemoLesson } from '../server/demo.ts';
import { TutorService } from '../server/service.ts';
import { DEFAULT_SETTINGS, LocalStore } from '../server/store.ts';
import type { AppState, ProposedLesson, ReviewSession } from '../src/types.ts';
import type { Server } from 'node:http';
import { request } from 'node:http';

let server: Server;
let base: string;
let service: TutorService;
const directory = mkdtempSync(join(tmpdir(), 'code-swipe-api-test-'));
before(async () => {
  service = new TutorService(new LocalStore(directory), [{ id: 'demo', available: true, version: '1', detail: 'Offline' }]);
  server = createApp(service).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  await service.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
});
const json = (path: string, method = 'GET', body?: unknown) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

async function isolatedAPI(t: TestContext, generate?: ConstructorParameters<typeof TutorService>[2]) {
  const path = mkdtempSync(join(tmpdir(), 'code-swipe-feedback-api-test-'));
  const store = new LocalStore(path);
  store.saveSettings({ ...DEFAULT_SETTINGS, provider: 'demo' });
  const tutor = new TutorService(store, [
    { id: 'demo', available: true, version: '1', detail: 'Offline' },
    { id: 'codex', available: true, version: 'test', detail: 'Injected provider' },
  ], generate);
  const listener = createApp(tutor).listen(0, '127.0.0.1');
  await once(listener, 'listening');
  t.after(async () => {
    await tutor.close();
    await new Promise<void>(resolve => listener.close(() => resolve()));
    rmSync(path, { recursive: true, force: true });
  });
  const address = listener.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  return { store, tutor, request: (route: string, body?: unknown) => fetch(origin + route, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) };
}

test('given a local API, when a website or rebound hostname calls it, then requests are refused', async () => {
  for (const headers of [{ Origin: 'https://example.com' }, { Host: 'attacker.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const status = await new Promise<number>(resolve => {
      request(base + '/api/state', { headers }, response => { response.resume(); resolve(response.statusCode!); }).end();
    });
    assert.equal(status, 403, JSON.stringify(headers));
  }
  assert.equal((await fetch(base + '/api/plan', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await fetch(base + '/api/state', { headers: { Origin: base } })).status, 200);
});

test('given malformed requests, when parsed, then errors remain JSON and no state changes', async () => {
  const bad = await fetch(base + '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(bad.status, 400);
  assert.ok((await bad.json()).error);
  assert.equal((await json('/api/settings', 'PUT', { provider: 'oops' })).status, 400);
  assert.equal((await json('/api/no-such-route')).status, 404);
  assert.equal((await json('/api/answers', 'POST', {})).status, 400);
});

test('given demo setup, when a lesson is played through the API, then answers persist and predictions stay hidden until answered', async () => {
  assert.equal((await json('/api/settings', 'PUT', { provider: 'demo', model: '', interests: 'networks', batchSize: 6, tutorMode: 'reflective' })).status, 200);
  assert.equal((await json('/api/plan', 'POST', {})).status, 202);
  await service.settled();
  const response = await json('/api/state');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const state = await response.json();
  assert.equal(state.job.status, 'ready');
  assert.equal(state.currentLesson.total, 6);
  assert.ok(state.question.code);
  assert.equal(state.question.verdict, undefined);
  assert.equal(state.question.prediction, undefined);
  assert.equal(state.currentLesson.reflection, null);
  assert.equal((await json('/api/plan', 'POST', {})).status, 409);
  const answer = await json('/api/answers', 'POST', { exerciseId: state.question.id, answer: 'buggy', elapsedMs: 1000 });
  const recorded = await answer.json();
  assert.equal(answer.status, 200);
  assert.equal(recorded.review.question.prediction.pCorrect, 0.5);
  assert.notEqual(recorded.state.question.id, state.question.id);
  const flag = await json(`/api/attempts/${recorded.review.attempt.id}/flag`, 'POST', { flagged: true });
  assert.equal((await flag.json()).metrics.count, 0);
  const exported = await json('/api/export');
  assert.match(exported.headers.get('content-disposition')!, /attachment/);
  const data = await exported.json();
  assert.equal(data.lessons.length, 1);
  assert.equal(data.attempts.length, 1);
  assert.equal(data.attempts[0].flagged, true);
  assert.equal(data.attempts[0].exclusionReason, 'flawed-question');
  assert.equal(new LocalStore(directory).snapshot().attempts[0].id, data.attempts[0].id);
});

test('given a completed API lesson with IDK and review time, when feedback marks an accidental answer, then state and exports preserve evidence and exclude only scored accidents', async t => {
  const api = await isolatedAPI(t);
  assert.equal((await api.request('/api/plan', {})).status, 202);
  await api.tutor.settled();
  const lesson = api.store.snapshot().lessons[0];
  const uncertainResponse = await api.request('/api/answers', { exerciseId: lesson.questions[0].id, answer: 'idk', elapsedMs: 2_000 });
  assert.equal(uncertainResponse.status, 200);
  const uncertain = await uncertainResponse.json();
  assert.equal(uncertain.review.attempt.correct, null);
  assert.equal(uncertain.state.question.id, lesson.questions[1].id);
  assert.equal(uncertain.state.metrics.count, 0);
  const sessionId = randomUUID();
  const route = `/api/attempts/${uncertain.review.attempt.id}/review`;
  const opened = await api.request(route, { sessionId, activeMs: 0, closed: false });
  assert.equal(opened.status, 200);
  assert.equal((await opened.json()).session.attemptId, uncertain.review.attempt.id);
  const closedResponse = await api.request(route, { sessionId, activeMs: 3_750, closed: true });
  assert.equal(closedResponse.status, 200);
  const closed = await closedResponse.json() as { session: ReviewSession };
  assert.equal(closed.session.activeMs, 3_750);
  assert.equal(closed.session.closed, true);
  for (const question of lesson.questions.slice(1)) {
    assert.equal((await api.request('/api/answers', { exerciseId: question.id, answer: question.verdict, elapsedMs: 1_000 })).status, 200);
  }
  const accidental = api.store.snapshot().attempts[1];
  const feedbackResponse = await api.request(`/api/lessons/${lesson.id}/feedback`, {
    text: 'I guessed the first one; the second swipe was accidental.', accidentalAttemptIds: [accidental.id],
  });
  assert.equal(feedbackResponse.status, 200);
  const state = await feedbackResponse.json() as AppState;
  assert.equal(state.currentLesson?.complete, true);
  assert.equal(state.metrics.count, lesson.questions.length - 2);
  assert.equal(state.metrics.accuracy, 1);
  assert.equal(state.feedback.length, 1);
  assert.deepEqual(state.currentLesson?.feedback, state.feedback[0]);
  assert.deepEqual(state.reviewSessions, [closed.session]);
  assert.equal(state.reviews.find(item => item.attempt.id === accidental.id)?.attempt.exclusionReason, 'accidental-input');
  assert.equal(state.reviews.find(item => item.attempt.id === accidental.id)?.attempt.answer, accidental.answer);
  const exported = await (await api.request('/api/export')).json();
  assert.deepEqual(exported.feedback, state.feedback);
  assert.deepEqual(exported.reviewSessions, state.reviewSessions);
  assert.equal(exported.attempts[0].answer, 'idk');
  assert.equal(exported.attempts[0].correct, null);
  assert.deepEqual(new LocalStore(api.store.directory).snapshot(), exported);
});

test('given malformed review and feedback API requests, when submitted, then errors are JSON and notebook evidence stays unchanged', async t => {
  const api = await isolatedAPI(t);
  api.tutor.plan();
  await api.tutor.settled();
  const lesson = api.store.snapshot().lessons[0];
  const attempt = api.store.answer(lesson.questions[0].id, 'correct', 1_000).attempt;
  const before = api.store.snapshot();
  const cases: [string, unknown, number][] = [
    [`/api/lessons/${lesson.id}/feedback`, { text: 'Too soon', accidentalAttemptIds: [] }, 409],
    [`/api/attempts/${attempt.id}/review`, {}, 400],
    [`/api/attempts/${attempt.id}/review`, { sessionId: randomUUID(), activeMs: 100, closed: false }, 409],
    [`/api/attempts/${randomUUID()}/review`, { sessionId: randomUUID(), activeMs: 0, closed: false }, 404],
    [`/api/attempts/${attempt.id}/flag`, { flagged: true, reason: 'other' }, 400],
  ];
  for (const [route, body, status] of cases) {
    const response = await api.request(route, body);
    assert.equal(response.status, status, route);
    assert.ok((await response.json()).error);
    assert.deepEqual(api.store.snapshot(), before);
  }
});

test('given a tutor run in progress, when review telemetry or lesson feedback arrives, then timing persists while evidence edits wait until the run finishes', async t => {
  let release!: (lesson: ProposedLesson) => void;
  const pending = new Promise<ProposedLesson>(resolve => { release = resolve; });
  const api = await isolatedAPI(t, async () => pending);
  api.tutor.plan();
  await api.tutor.settled();
  const lesson = api.store.snapshot().lessons[0];
  for (const question of lesson.questions) api.store.answer(question.id, question.verdict, 1_000);
  const attempt = api.store.snapshot().attempts[0];
  api.tutor.saveSettings({ ...api.store.snapshot().settings, provider: 'codex' });
  const nextLesson = createDemoLesson(api.store.context());
  api.tutor.plan();
  try {
    assert.equal(api.tutor.job?.status, 'running');
    const telemetry = await api.request(`/api/attempts/${attempt.id}/review`, { sessionId: randomUUID(), activeMs: 0, closed: false });
    assert.equal(telemetry.status, 200);
    assert.equal(api.store.snapshot().reviewSessions?.length, 1);
    const blocked = await api.request(`/api/lessons/${lesson.id}/feedback`, { text: 'Do not change the active tutor evidence.', accidentalAttemptIds: [attempt.id] });
    assert.equal(blocked.status, 409);
    assert.ok((await blocked.json()).error);
    assert.deepEqual(api.store.snapshot().feedback, []);
    assert.equal(api.store.snapshot().attempts[0].flagged, false);
  } finally {
    release(nextLesson);
    await api.tutor.settled();
  }
  assert.equal(api.tutor.job?.status, 'ready');
  const saved = await api.request(`/api/lessons/${lesson.id}/feedback`, { text: 'Saved after generation.', accidentalAttemptIds: [attempt.id] });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).feedback[0].text, 'Saved after generation.');
});
