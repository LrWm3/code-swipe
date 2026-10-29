import { randomUUID } from 'node:crypto';
import type { AppState, Job, Language, ProviderStatus } from '../src/types.ts';
import { AppError, LocalStore, parseSettings } from './store.ts';
import { detectProviders, generateLesson, generateDiscussion, generateGuide } from './providers.ts';
import { createDemoLesson } from './demo.ts';
import { createPythonDemoLesson } from './python-demo.ts';
import { validateLesson } from './validation.ts';
import { reviewedGuide } from './concept-guides.ts';
import { pythonAvailability } from './python-runtime.ts';

export class TutorService {
  job: Job | null = null;
  private controller: AbortController | null = null;
  private work: Promise<void> = Promise.resolve();
  constructor(readonly store: LocalStore, readonly providers: ProviderStatus[], private generate = generateLesson, private discussWithTutor = generateDiscussion,
    readonly languages: NonNullable<AppState['languages']> = [{ id: 'javascript', available: true, detail: 'JavaScript sandbox ready.' }, { id: 'python', available: true, detail: 'Python sandbox availability has not been checked.' }]) {}

  static async create(directory: string) {
    const [providers, python] = await Promise.all([detectProviders(), pythonAvailability()]);
    return new TutorService(new LocalStore(directory), providers, undefined, undefined,
      [{ id: 'javascript', available: true, detail: 'JavaScript sandbox ready.' }, { id: 'python', ...python }]);
  }
  state() { return this.store.publicState(this.providers, this.job, this.languages); }
  saveSettings(value: unknown) {
    this.requireIdle();
    this.store.saveSettings(parseSettings(value));
  }
  requireIdle() {
    if (this.job?.status === 'running') throw new AppError('Cancel the current tutor run before changing settings or evidence.', 409);
  }
  plan(focusRequest?: { conceptId: string; length: number; language?: Language }) {
    this.requireIdle();
    const parent = this.store.activeLesson();
    const concept = focusRequest ? this.store.concept(focusRequest.conceptId) : null;
    if (focusRequest && (!concept || !parent || parent.focus || ![4, 6].includes(focusRequest.length) || (focusRequest.language !== undefined && !['javascript', 'python'].includes(focusRequest.language)))) throw new AppError('Choose a concept and 4 or 6 cards while a main lesson is open.', 400);
    if (focusRequest && this.store.snapshot().settings.provider === 'demo' && !['demo-code-review', 'python-demo-code-review'].includes(concept?.id ?? '')) throw new AppError('Choose Codex or OpenCode in Setup to generate focused practice for this concept.');
    if (!focusRequest && this.store.pendingQuestion()) throw new AppError('Finish the current lesson before planning another.', 409);
    let context = this.store.context();
    if (!this.providers.some(item => item.id === context.settings.provider && item.available)) {
      throw new AppError(`${context.settings.provider} is unavailable. Install its CLI and restart, or choose practice demo.`, 503);
    }
    if (!focusRequest) this.store.skipUnansweredDiscussions();
    context = this.store.context();
    if (focusRequest && concept && parent) {
      context.settings = { ...context.settings, batchSize: focusRequest.length, language: focusRequest.language ?? parent.language ?? 'javascript' };
      const answered = new Set(this.store.snapshot().attempts.filter(item => item.lessonId === parent.id).map(item => item.exerciseId));
      context.focus = { concept, parentLessonId: parent.id, avoidQuestions: parent.questions.filter(item => !answered.has(item.id)) };
    }
    const language = context.settings.language ?? 'javascript';
    const runtime = this.languages.find(item => item.id === language);
    if (!runtime?.available) throw new AppError(runtime?.detail ?? `The ${language} sandbox is unavailable.`, 503);
    this.controller = new AbortController();
    const controller = this.controller;
    const job: Job = { id: randomUUID(), kind: focusRequest ? 'focus' : 'lesson', ...(concept ? { conceptId: concept.id, language } : {}), status: 'running', stage: 'planning', startedAt: new Date().toISOString(), message: 'Preparing the lesson…' };
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
          const proposal = context.settings.provider === 'demo' ? (context.settings.language === 'python' ? createPythonDemoLesson(context) : createDemoLesson(context)) : await this.generate(context, { signal: controller.signal, onProgress: progress });
          if (!active()) return;
          progress(`Running every fixture in the isolated ${language === 'python' ? 'Python' : 'JavaScript'} sandbox…`, 'validating');
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
          this.store.commitLesson(validated, context.settings, context.focus ? { conceptId: context.focus.concept.id, parentLessonId: context.focus.parentLessonId } : undefined);
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
  prepareGuide(conceptId: string, language: Language = 'javascript') {
    this.requireIdle();
    if (!['javascript', 'python'].includes(language)) throw new AppError('Choose a supported guide language.');
    const concept = this.store.concept(conceptId);
    if (!concept) throw new AppError('Concept not found.', 404);
    if (this.store.snapshot().guides?.some(item => item.conceptId === conceptId && (item.language ?? 'javascript') === language)) return;
    const curated = reviewedGuide(concept, language);
    if (curated) { this.store.saveGuide(curated); return; }
    const settings = { ...this.store.snapshot().settings, language };
    const runtime = this.languages.find(item => item.id === language);
    if (!runtime?.available) throw new AppError(runtime?.detail ?? 'This language sandbox is unavailable.', 503);
    if (!this.providers.some(item => item.id === settings.provider && item.available) || settings.provider === 'demo') {
      throw new AppError('Choose an available Codex or OpenCode tutor in Setup to prepare this guide.', 503);
    }
    this.controller = new AbortController();
    const controller = this.controller;
    const job: Job = { id: randomUUID(), kind: 'guide', conceptId, language, status: 'running', stage: 'preparing', startedAt: new Date().toISOString(), message: 'Preparing your concept guide…' };
    this.job = job;
    this.store.recordJob(job);
    const active = () => !controller.signal.aborted && this.job?.id === job.id && job.status === 'running';
    this.work = (async () => {
      try {
        const guide = await generateGuide(settings, concept, { signal: controller.signal, onProgress: message => {
          if (active()) { job.message = message; this.store.recordJob(job); }
        } });
        if (!active()) return;
        this.store.saveGuide(guide);
        Object.assign(job, { status: 'ready', stage: 'ready', message: 'Concept guide ready.' });
        this.store.recordJob(job);
      } catch (error) {
        if (!active()) return;
        Object.assign(job, { status: 'error', stage: 'error', message: error instanceof Error ? error.message : 'Guide preparation failed. Retry.' });
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
