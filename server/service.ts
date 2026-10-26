import { randomUUID } from 'node:crypto';
import type { Job, ProviderStatus } from '../src/types.ts';
import { AppError, LocalStore, parseSettings } from './store.ts';
import { detectProviders, generateLesson, generateDiscussion } from './providers.ts';
import { createDemoLesson } from './demo.ts';
import { validateLesson } from './validation.ts';

export class TutorService {
  job: Job | null = null;
  private controller: AbortController | null = null;
  private work: Promise<void> = Promise.resolve();
  constructor(readonly store: LocalStore, readonly providers: ProviderStatus[], private generate = generateLesson, private discussWithTutor = generateDiscussion) {}

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
    let context = this.store.context();
    if (!this.providers.some(item => item.id === context.settings.provider && item.available)) {
      throw new AppError(`${context.settings.provider} is unavailable. Install its CLI and restart, or choose practice demo.`, 503);
    }
    this.store.skipUnansweredDiscussions();
    context = this.store.context();
    this.controller = new AbortController();
    const controller = this.controller;
    const job: Job = { id: randomUUID(), kind: 'lesson', status: 'running', stage: 'planning', startedAt: new Date().toISOString(), message: 'Preparing the lesson…' };
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
  discuss(lessonId: string) {
    this.requireIdle();
    let context = this.store.discussionContext(lessonId);
    if (!this.providers.some(item => item.id === context.tutor.settings.provider && item.available)) {
      throw new AppError(`${context.tutor.settings.provider} is unavailable. Check Setup, or continue without follow-up questions.`, 503);
    }
    this.store.skipUnansweredDiscussions();
    context = this.store.discussionContext(lessonId);
    const controller = new AbortController();
    this.controller = controller;
    const job: Job = { id: randomUUID(), kind: 'discussion', lessonId, status: 'running', stage: 'reflecting', startedAt: new Date().toISOString(), message: 'Your tutor is considering the lesson and your feedback…' };
    this.job = job;
    this.store.recordJob(job);
    const active = () => !controller.signal.aborted && this.job?.id === job.id && job.status === 'running';
    this.work = (async () => {
      try {
        const proposal = context.tutor.settings.provider === 'demo' ? {
          reflection: 'This demo saves your feedback and optional replies for later. A connected tutor can use them to reconsider its assumptions and adjust the next lesson; the demo does not infer what you understand.',
          questions: context.discussions.length ? [] : ['What would you like to practice or change in the next lesson?'],
        } : await this.discussWithTutor(context, { signal: controller.signal, onProgress: message => {
          if (!active()) return;
          job.message = message;
          this.store.recordJob(job);
        } });
        if (!active()) return;
        this.store.commitDiscussion(lessonId, proposal);
        Object.assign(job, { status: 'ready', stage: 'ready', message: 'Tutor response saved. Follow-up questions are optional.' });
        this.store.recordJob(job);
      } catch (error) {
        if (!active()) return;
        Object.assign(job, { status: 'error', stage: 'error', message: error instanceof Error ? error.message : 'The tutor could not respond. Your feedback is saved; continue or retry.' });
        this.store.recordJob(job);
      }
    })();
  }
  cancel() {
    if (this.job?.status !== 'running') return;
    this.controller?.abort();
    Object.assign(this.job, { status: 'cancelled', stage: 'cancelled', message: 'Tutor run cancelled. Your saved answers and feedback are kept.' });
    this.store.recordJob(this.job);
  }
  async settled() { await this.work; }
  async close() { this.cancel(); await this.settled(); }
}
