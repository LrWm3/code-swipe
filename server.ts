import express, { type ErrorRequestHandler } from 'express';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { AppError } from './server/store.ts';
import { TutorService } from './server/service.ts';

dotenv.config({ quiet: true });

export function createApp(service: TutorService) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    // Loopback binding alone does not stop a website from calling a local CLI.
    const allowed = new Set([`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`]);
    const host = req.get('host') ?? '';
    if (!allowed.has(host)) return res.status(403).json({ error: 'Use the local URL printed by Code Swipe.' });
    if (req.get('sec-fetch-site') === 'cross-site' || (req.get('origin') && req.get('origin') !== `http://${host}`)) {
      return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) return res.status(415).json({ error: 'Send JSON for API changes.' });
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.get('/api/state', (_req, res) => res.json(service.state()));
  app.put('/api/settings', (req, res) => { service.saveSettings(req.body); res.json(service.state()); });
  app.post('/api/plan', (_req, res) => { service.plan(); res.status(202).json(service.state()); });
  app.post('/api/concepts/:id/guide', (req, res) => { service.prepareGuide(req.params.id); res.json(service.state()); });
  app.post('/api/concepts/:id/events', (req, res) => { service.store.recordGuideEvent(req.params.id, req.body?.action); res.json(service.state()); });
  app.post('/api/concepts/:id/practice', (req, res) => { service.plan({ conceptId: req.params.id, length: req.body?.length }); res.status(202).json(service.state()); });
  app.post('/api/lessons/:id/start', (req, res) => { service.requireIdle(); service.store.startPreparedLesson(req.params.id); res.json(service.state()); });
  app.post('/api/lessons/resume', (_req, res) => { service.requireIdle(); service.store.resumeParent(); res.json(service.state()); });
  app.post('/api/cancel', (_req, res) => { service.cancel(); res.json(service.state()); });
  app.post('/api/answers', (req, res) => {
    service.requireIdle();
    const review = service.store.answer(req.body?.exerciseId, req.body?.answer, req.body?.elapsedMs);
    res.json({ review, state: service.state() });
  });
  app.post('/api/attempts/:id/flag', (req, res) => {
    service.requireIdle();
    service.store.flagAttempt(req.params.id, req.body?.flagged, req.body?.reason);
    res.json(service.state());
  });
  app.post('/api/attempts/:id/review', (req, res) => {
    res.json({ session: service.store.recordReview(req.params.id, req.body) });
  });
  app.post('/api/lessons/:id/feedback', (req, res) => {
    service.requireIdle();
    service.store.saveFeedback(req.params.id, req.body);
    res.json(service.state());
  });
  app.post('/api/lessons/:id/discuss', (req, res) => {
    service.discuss(req.params.id);
    res.status(202).json(service.state());
  });
  app.post('/api/discussions/:id/replies', (req, res) => {
    service.requireIdle();
    service.store.saveDiscussionReplies(req.params.id, req.body);
    res.json(service.state());
  });
  app.get('/api/export', (_req, res) => {
    res.attachment(`code-swipe-${new Date().toISOString().slice(0, 10)}.json`).json(service.store.snapshot());
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = error instanceof AppError ? error.status : error.status === 413 ? 413 : error instanceof SyntaxError ? 400 : 500;
    if (status === 500) console.error('Local API error:', error.message);
    res.status(status).json({ error: status === 500 ? 'Could not save the change. Check the server terminal and available disk space, then retry.' : status === 413 ? 'Request is too large.' : error.message });
  };
  app.use(errors);
  return app;
}

async function main() {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer between 0 and 65535.');
  const service = await TutorService.create(process.env.CODE_SWIPE_DATA_DIR || resolve('.code-swipe'));
  const app = createApp(service);
  let vite: Awaited<ReturnType<typeof import('vite')['createServer']>> | undefined;
  if (process.env.NODE_ENV === 'production') {
    const client = resolve('dist/client');
    app.use(express.static(client));
    app.get('*', (_req, res) => res.sendFile(join(client, 'index.html')));
  } else {
    const { createServer } = await import('vite');
    vite = await createServer({ server: { middlewareMode: true, fs: { deny: ['.env', '.env.*', '**/.git/**', '**/.code-swipe/**', `${service.store.directory}/**`] } }, appType: 'spa' });
    app.use(vite.middlewares);
  }
  const server = app.listen(port, '127.0.0.1', () => {
    const address = server.address();
    if (address && typeof address !== 'string') console.log(`Code Swipe → http://127.0.0.1:${address.port}\nLocal history → ${service.store.directory}`);
  });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; void vite?.close(); });
  const shutdown = async () => {
    await service.close();
    server.close();
    await vite?.close();
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
