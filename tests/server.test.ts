import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { createApp } from '../server.ts';
import { TutorService } from '../server/service.ts';
import { LocalStore } from '../server/store.ts';
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
  assert.equal((await json('/api/settings', 'PUT', { provider: 'demo', model: '', interests: 'networks', batchSize: 4, tutorMode: 'reflective' })).status, 200);
  assert.equal((await json('/api/plan', 'POST', {})).status, 202);
  await service.settled();
  const response = await json('/api/state');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const state = await response.json();
  assert.equal(state.job.status, 'ready');
  assert.equal(state.currentLesson.total, 4);
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
  assert.equal(new LocalStore(directory).snapshot().attempts[0].id, data.attempts[0].id);
});
