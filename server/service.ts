import { randomUUID } from 'node:crypto';
import type { Job, ProviderStatus } from '../src/types.ts';
import { AppError, LocalStore, parseSettings } from './store.ts';
import { detectProviders, generateLesson } from './providers.ts';
import { createDemoLesson } from './demo.ts';
import { validateLesson } from './validation.ts';

export class TutorService {
  job: Job | null = null;
  private controller: AbortController | null = null;
  private work: Promise<void> = Promise.resolve();
  constructor(readonly store: LocalStore, readonly providers: ProviderStatus[], private generate = generateLesson) {}

  static async create(directory: string) {
    return new TutorService(new LocalStore(directory), await detectProviders());
  }
  state() { return this.store.publicState(this.providers, this.job); }
  saveSettings(value: unknown) {
    this.requireIdle();
    this.store.saveSettings(parseSettings(value));
  }
  requireIdle() {
    if (this.job?.status === 'running') throw new AppError('Cancel the current tutor run before changing settings or evidence.', 409);
  }
  plan() {
    this.requireIdle();
    if (this.store.pendingQuestion()) throw new AppError('Finish the current lesson before planning another.', 409);
    const context = this.store.context();
    if (!this.providers.some(item => item.id === context.settings.provider && item.available)) {
      throw new AppError(`${context.settings.provider} is unavailable. Install its CLI and restart, or choose practice demo.`, 503);
    }
    this.controller = new AbortController();
    const controller = this.controller;
    const job: Job = { id: randomUUID(), status: 'running', stage: 'planning', startedAt: new Date().toISOString(), message: 'Preparing the lesson…' };
    this.job = job;
    this.store.recordJob(job);
    const active = () => !controller.signal.aborted && this.job?.id === job.id && job.status === 'running';
    const progress = (message: string, stage = 'planning') => {
      if (!active()) return;
      Object.assign(job, { message, stage });
      this.store.recordJob(job);
    };
    this.work = (async () => {
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const proposal = context.settings.provider === 'demo' ? createDemoLesson(context) : await this.generate(context, { signal: controller.signal, onProgress: progress });
          if (!active()) return;
          progress('Running every fixture in an isolated JavaScript engine…', 'validating');
          let validated: Awaited<ReturnType<typeof validateLesson>>;
          try { validated = await validateLesson(proposal, context, controller.signal); }
          catch (error) {
            if (!active()) return;
            if (attempt || context.settings.provider === 'demo') throw new Error(`The lesson failed validation. No exercises were published. ${error instanceof Error ? error.message : 'Try again.'}`);
            context.repair = [error instanceof Error ? error.message : 'Invalid lesson.'];
            context.draft = proposal;
            progress('A check failed. Asking the tutor to repair this lesson…', 'repairing');
            continue;
          }
          if (!active()) return;
          this.store.commitLesson(validated, context.settings);
          Object.assign(job, { status: 'ready', stage: 'ready', message: 'Lesson checked. Predictions committed. Ready to play.' });
          this.store.recordJob(job);
          return;
        }
      } catch (error) {
        if (!active()) return;
        Object.assign(job, { status: 'error', stage: 'error', message: error instanceof Error ? error.message : 'Lesson generation failed. Retry to continue.' });
        this.store.recordJob(job);
      }
    })();
  }
  cancel() {
    if (this.job?.status !== 'running') return;
    this.controller?.abort();
    Object.assign(this.job, { status: 'cancelled', stage: 'cancelled', message: 'Tutor run cancelled. Your history is unchanged.' });
    this.store.recordJob(this.job);
  }
  async settled() { await this.work; }
  async close() { this.cancel(); await this.settled(); }
}
