import { useEffect, useRef } from 'react';
import type { ReviewSession } from './types';

export type ReviewWrite = { attemptId: string; sessionId: string; activeMs: number; closed: boolean; openedAt?: string; created?: boolean };
const STORAGE_KEY = 'code-swipe-review-writes';
type Outbox = { storageKey: string; loaded: boolean; writes: Map<string, ReviewWrite>; known: Set<string>; flushing: Promise<boolean> | null };
const boxes = new Map<string, Outbox>();
const listeners = new Set<(session: ReviewSession) => void>();
const makeBox = (storageKey: string): Outbox => ({ storageKey, loaded: false, writes: new Map(), known: new Set(), flushing: null });
let currentBox = makeBox(STORAGE_KEY);

export function setReviewScope(directory: string) {
  const key = `${STORAGE_KEY}:${directory}`;
  if (!boxes.has(key)) boxes.set(key, makeBox(key));
  currentBox = boxes.get(key)!;
}
function loadWrites(box: Outbox) {
  if (box.loaded) return;
  box.loaded = true;
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(box.storageKey) || '[]');
    if (Array.isArray(saved)) for (const value of saved) {
      if (typeof value?.attemptId === 'string' && typeof value?.sessionId === 'string' && Number.isFinite(value?.activeMs) && typeof value?.closed === 'boolean') box.writes.set(value.sessionId, value);
    }
  } catch { /* Timing still works when browser storage is unavailable. */ }
}
function persistWrites(box: Outbox) {
  try { localStorage.setItem(box.storageKey, JSON.stringify([...box.writes.values()])); } catch { /* Requests still persist timing on the server. */ }
}
export function queueReviewSession(write: ReviewWrite) {
  const box = currentBox;
  loadWrites(box);
  const previous = box.writes.get(write.sessionId);
  box.writes.set(write.sessionId, { ...write, openedAt: previous?.openedAt ?? write.openedAt, activeMs: Math.max(previous?.activeMs || 0, write.activeMs), closed: Boolean(previous?.closed || write.closed), created: Boolean(previous?.created || box.known.has(write.sessionId)) });
  persistWrites(box);
}

/** Cumulative writes can be retried safely after a lost response or page reload. */
export function flushReviewSessions(): Promise<boolean> {
  const box = currentBox;
  loadWrites(box);
  if (box.flushing) return box.flushing;
  box.flushing = (async () => {
    while (box.writes.size) {
      if (box !== currentBox) return true;
      const write = box.writes.values().next().value as ReviewWrite;
      try {
        const response = await fetch(`/api/attempts/${encodeURIComponent(write.attemptId)}/review`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', keepalive: true,
          body: JSON.stringify({ sessionId: write.sessionId, activeMs: write.created ? write.activeMs : 0, closed: write.created ? write.closed : false, openedAt: write.openedAt }),
          signal: AbortSignal.timeout(15_000),
        });
        // A deleted record cannot receive timing. Do not strand later valid writes.
        if (response.status === 404) { box.writes.delete(write.sessionId); persistWrites(box); continue; }
        if (!response.ok) return false;
        const { session } = await response.json() as { session: ReviewSession };
        if (box === currentBox) for (const listener of listeners) listener(session);
        box.known.add(write.sessionId);
        const latest = box.writes.get(write.sessionId);
        if (!write.created && latest && (latest.activeMs > 0 || latest.closed)) box.writes.set(write.sessionId, { ...latest, created: true });
        else if (latest === write) box.writes.delete(write.sessionId);
        else if (latest) box.writes.set(write.sessionId, { ...latest, created: true });
        persistWrites(box);
      } catch { return false; }
    }
    return true;
  })().finally(() => { box.flushing = null; });
  return box.flushing;
}

export function useReviewSync(onSaved: (session: ReviewSession) => void, directory?: string) {
  useEffect(() => {
    if (!directory) return;
    setReviewScope(directory);
    listeners.add(onSaved);
    const flush = () => { void flushReviewSessions(); };
    flush();
    window.addEventListener('online', flush);
    return () => { listeners.delete(onSaved); window.removeEventListener('online', flush); };
  }, [onSaved, directory]);
}

/** Mount only while a review is open; background/blurred windows accrue no time. */
export function useReviewTiming(attemptId: string) {
  useEffect(() => {
    let sessionId = crypto.randomUUID();
    let openedAt = new Date().toISOString();
    let activeMs = 0;
    let since: number | null = null;
    let gone = false;
    let focused = document.hasFocus();
    let started = false;
    let timer = 0;
    const sample = () => {
      const now = performance.now();
      if (since !== null) activeMs += Math.max(0, now - since);
      since = !gone && document.visibilityState === 'visible' && focused ? now : null;
    };
    const save = (closed = false) => {
      sample();
      queueReviewSession({ sessionId, attemptId, activeMs: Math.round(activeMs), closed, openedAt });
      void flushReviewSessions();
    };
    const visibility = () => { sample(); save(); };
    const blur = () => { focused = false; sample(); save(); };
    const focus = () => { focused = true; sample(); };
    const pagehide = () => {
      gone = true;
      sample();
      const body = { sessionId, activeMs: Math.round(activeMs), closed: true, openedAt };
      queueReviewSession({ ...body, attemptId });
      // Beacon survives navigation even when an earlier periodic request is pending.
      const beaconBody = currentBox.known.has(sessionId) ? body : { sessionId, activeMs: 0, closed: false, openedAt };
      navigator.sendBeacon?.(`/api/attempts/${encodeURIComponent(attemptId)}/review`, new Blob([JSON.stringify(beaconBody)], { type: 'application/json' }));
      void flushReviewSessions();
    };
    const pageshow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      sessionId = crypto.randomUUID(); openedAt = new Date().toISOString(); activeMs = 0; gone = false; since = null;
      save();
    };
    // Defer one tick so StrictMode's effect replay does not create phantom openings.
    const opening = window.setTimeout(() => {
      started = true;
      focused = document.hasFocus();
      queueReviewSession({ sessionId, attemptId, activeMs: 0, closed: false, openedAt });
      void flushReviewSessions();
      sample();
      timer = window.setInterval(() => save(), 5000);
      document.addEventListener('visibilitychange', visibility);
      window.addEventListener('blur', blur);
      window.addEventListener('focus', focus);
      window.addEventListener('pagehide', pagehide);
      window.addEventListener('pageshow', pageshow);
    }, 0);
    return () => {
      window.clearTimeout(opening);
      if (!started) return;
      gone = true;
      save(true);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('pageshow', pageshow);
    };
  }, [attemptId]);
}

export function useAnswerClock(questionId: string | undefined, active: boolean) {
  const clock = useRef({ questionId, elapsed: 0, since: null as number | null });
  const read = () => clock.current.elapsed + (clock.current.since === null ? 0 : performance.now() - clock.current.since);
  useEffect(() => {
    if (clock.current.questionId !== questionId) clock.current = { questionId, elapsed: 0, since: null };
    const update = () => {
      clock.current.elapsed = read();
      clock.current.since = active && document.visibilityState === 'visible' && document.hasFocus() ? performance.now() : null;
    };
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('blur', update);
    window.addEventListener('focus', update);
    return () => {
      clock.current.elapsed = read(); clock.current.since = null;
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('blur', update);
      window.removeEventListener('focus', update);
    };
  }, [questionId, active]);
  return read;
}
