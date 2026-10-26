import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flushReviewSessions, queueReviewSession, setReviewScope } from '../src/ui';

type Body = { sessionId: string; activeMs: number; closed: boolean };
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
} });
const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body)) as Body;
const responseFor = (body: Body) => Response.json({ session: { id: body.sessionId, attemptId: 'attempt', activeMs: body.activeMs, closed: body.closed, openedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' } });

test('given an offline review, when closing and reconnecting, then opening is acknowledged before cumulative timing', async (context) => {
  setReviewScope('/test/offline');
  const requests: Body[] = [];
  let offline = true;
  context.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    const body = bodyOf(init); requests.push(body);
    if (offline) throw new TypeError('offline');
    return responseFor(body);
  });
  queueReviewSession({ attemptId: 'attempt-offline', sessionId: 'session-offline', activeMs: 0, closed: false });
  assert.equal(await flushReviewSessions(), false);
  queueReviewSession({ attemptId: 'attempt-offline', sessionId: 'session-offline', activeMs: 4500, closed: true });
  offline = false;
  assert.equal(await flushReviewSessions(), true);
  assert.deepEqual(requests.map(({ activeMs, closed }) => ({ activeMs, closed })), [
    { activeMs: 0, closed: false }, { activeMs: 0, closed: false }, { activeMs: 4500, closed: true },
  ]);
  assert.equal(storage.get('code-swipe-review-writes:/test/offline'), '[]');
});

test('given a review closed during its opening request, when opening completes, then final time and close are preserved', async (context) => {
  setReviewScope('/test/inflight');
  const requests: Body[] = [];
  let release: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  context.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    const body = bodyOf(init); requests.push(body);
    if (requests.length === 1) await wait;
    return responseFor(body);
  });
  queueReviewSession({ attemptId: 'attempt-inflight', sessionId: 'session-inflight', activeMs: 0, closed: false });
  const pending = flushReviewSessions();
  queueReviewSession({ attemptId: 'attempt-inflight', sessionId: 'session-inflight', activeMs: 1250, closed: true });
  release!();
  assert.equal(await pending, true);
  assert.deepEqual(requests.map(({ activeMs, closed }) => ({ activeMs, closed })), [{ activeMs: 0, closed: false }, { activeMs: 1250, closed: true }]);
});

test('given a deleted attempt, when flushing later valid reviews, then the orphan is discarded without blocking them', async (context) => {
  setReviewScope('/test/deleted');
  const requests: { url: string; body: Body }[] = [];
  context.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    const body = bodyOf(init); requests.push({ url, body });
    return url.includes('deleted-attempt') ? Response.json({ error: 'Not found' }, { status: 404 }) : responseFor(body);
  });
  queueReviewSession({ attemptId: 'deleted-attempt', sessionId: 'deleted-session', activeMs: 2000, closed: true });
  queueReviewSession({ attemptId: 'valid-attempt', sessionId: 'valid-session', activeMs: 3000, closed: true });
  assert.equal(await flushReviewSessions(), true);
  assert.deepEqual(requests.map(({ body }) => [body.sessionId, body.activeMs]), [['deleted-session', 0], ['valid-session', 0], ['valid-session', 3000]]);
  assert.equal(storage.get('code-swipe-review-writes:/test/deleted'), '[]');
});

test('given saved timing in another data directory, when switching directories, then only the selected directory is flushed', async (context) => {
  storage.set('code-swipe-review-writes:/test/other', JSON.stringify([{ attemptId: 'other-attempt', sessionId: 'other-session', activeMs: 2200, closed: true }]));
  setReviewScope('/test/current');
  const requests: Body[] = [];
  context.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => { const body = bodyOf(init); requests.push(body); return responseFor(body); });
  queueReviewSession({ attemptId: 'current-attempt', sessionId: 'current-session', activeMs: 1100, closed: true });
  assert.equal(await flushReviewSessions(), true);
  assert.deepEqual(requests.map(({ sessionId }) => sessionId), ['current-session', 'current-session']);
  assert.notEqual(storage.get('code-swipe-review-writes:/test/other'), '[]');
  setReviewScope('/test/other');
  assert.equal(await flushReviewSessions(), true);
  assert.deepEqual(requests.slice(2).map(({ activeMs, closed }) => ({ activeMs, closed })), [{ activeMs: 0, closed: false }, { activeMs: 2200, closed: true }]);
});

test('given an in-flight opening in an old directory, when switching directories, then its queued continuation waits for its own scope', async (context) => {
  setReviewScope('/test/switch-old');
  const requests: Body[] = [];
  let release: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  context.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    const body = bodyOf(init); requests.push(body);
    if (body.sessionId === 'old-session' && body.activeMs === 0) await wait;
    return responseFor(body);
  });
  queueReviewSession({ attemptId: 'old-attempt', sessionId: 'old-session', activeMs: 500, closed: true });
  const pending = flushReviewSessions();
  setReviewScope('/test/switch-new');
  queueReviewSession({ attemptId: 'new-attempt', sessionId: 'new-session', activeMs: 800, closed: true });
  assert.equal(await flushReviewSessions(), true);
  release!();
  assert.equal(await pending, true);
  assert.equal(requests.some((body) => body.sessionId === 'old-session' && body.activeMs > 0), false);
  setReviewScope('/test/switch-old');
  assert.equal(await flushReviewSessions(), true);
  assert.equal(requests.at(-1)?.activeMs, 500);
});

test('given an offline opening timestamp, when timing is coalesced and later flushed, then the original viewing time survives', async (context) => {
  setReviewScope('/test/opening-time');
  const openedAt = '2026-01-01T12:00:00.000Z';
  const requests: (Body & { openedAt?: string })[] = [];
  context.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    const body = bodyOf(init); requests.push(body); return responseFor(body);
  });
  queueReviewSession({ attemptId: 'opening-attempt', sessionId: 'opening-session', activeMs: 0, closed: false, openedAt });
  queueReviewSession({ attemptId: 'opening-attempt', sessionId: 'opening-session', activeMs: 2000, closed: true });
  await flushReviewSessions();
  assert.deepEqual(requests.map(item => item.openedAt), [openedAt, openedAt]);
});
