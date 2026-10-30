import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AppState, Job, Language, ProviderStatus, DirectionProposal, LearningPlan, ArcReview, TutorContext } from '../src/types.ts';
import { AppError, LocalStore, parseSettings } from './store.ts';
import { detectProviders, generateLesson, generateDiscussion, generateGuide, generateLearningTask } from './providers.ts';
import { activeArc, arcEvidenceHash, type LearningTask } from './learning-journey.ts';
import { createDemoLesson } from './demo.ts';
import { createPythonDemoLesson } from './python-demo.ts';
import { createRustDemoLesson } from './rust-demo.ts';
import { validateLesson } from './validation.ts';
import { parseGuide, reviewedGuide } from './concept-guides.ts';
import { pythonAvailability } from './python-runtime.ts';
import { rustAvailability } from './rust-runtime.ts';
import { buildKnowledgeGraph } from './knowledge-graph.ts';
import { executionEnvironments } from './environments.ts';
import { BASE_CONTEXTS, guideContext, isLanguage } from '../src/learning-contexts.ts';

export class TutorService {
  job: Job | null = null;
  private controller: AbortController | null = null;
  private work: Promise<void> = Promise.resolve();
  constructor(readonly store: LocalStore, readonly providers: ProviderStatus[], private generate = generateLesson, private discussWithTutor = generateDiscussion,
    readonly languages: NonNullable<AppState['languages']> = [{ id: 'javascript', available: true, detail: 'JavaScript sandbox ready.' }, { id: 'python', available: true, detail: 'Python sandbox availability has not been checked.' }, { id: 'rust', available: true, detail: 'Rust sandbox availability has not been checked.' }],
    private planLearning = generateLearningTask) {}

  static async create(directory: string) {
    const [providers, python, rust] = await Promise.all([detectProviders(), pythonAvailability(), rustAvailability()]);
    return new TutorService(new LocalStore(directory), providers, undefined, undefined,
      [{ id: 'javascript', available: true, detail: 'JavaScript sandbox ready.' }, { id: 'python', ...python }, { id: 'rust', ...rust }]);
  }
  state() { return this.store.publicState(this.providers, this.job, this.languages); }
  saveSettings(value: unknown) {
    this.requireIdle();
    this.store.saveSettings(parseSettings(value));
  }
  requireIdle() {
    if (this.job?.status === 'running') throw new AppError('Cancel the current tutor run before changing settings or evidence.', 409);
  }
  private sessionDirectory() { return join(this.store.directory, 'agent-sessions'); }

  private learningContext(): TutorContext {
    const context = this.store.context();
    context.environments = executionEnvironments(this.languages);
    return context;
  }

  private runLearning(kind: 'directions' | 'curriculum' | 'progress', work: (signal: AbortSignal, active: () => boolean, progress: (message: string) => void) => Promise<void>) {
    this.requireIdle();
    const settings = this.store.snapshot().settings;
    if (settings.tutorMode !== 'reflective' || settings.provider === 'demo') throw new AppError('Choose a reflective Codex or OpenCode tutor to plan a curriculum.');
    if (!this.providers.some(item => item.id === settings.provider && item.available)) throw new AppError(`${settings.provider} is unavailable. Check Setup.`, 503);
    if (this.store.pendingQuestion()) throw new AppError('Finish the current lesson before planning the next direction.', 409);
    const controller = new AbortController();
    this.controller = controller;
    const job: Job = { id: randomUUID(), kind, status: 'running', stage: kind, startedAt: new Date().toISOString(), message: kind === 'directions' ? 'Finding three new learning directions…' : kind === 'curriculum' ? 'Sketching your curriculum…' : 'Reviewing progress and adjusting the remaining lessons…' };
    this.job = job;
    this.store.recordJob(job);
    const active = () => !controller.signal.aborted && this.job?.id === job.id && job.status === 'running';
    const progress = (message: string) => { if (active()) { job.message = message; this.store.recordJob(job); } };
    this.work = (async () => {
      try {
        await work(controller.signal, active, progress);
        if (!active()) return;
        Object.assign(job, { status: 'ready', stage: 'ready', message: 'Your learning plan is ready.' });
        this.store.recordJob(job);
      } catch (error) {
        if (!active()) return;
        Object.assign(job, { status: 'error', stage: 'error', message: error instanceof Error ? error.message : 'Planning stopped. Your learning record is saved.' });
        this.store.recordJob(job);
      }
    })();
  }

  private async learningRequest(task: LearningTask, signal: AbortSignal, onProgress: (message: string) => void) {
    const context = this.learningContext();
    for (let attempt = 0; ; attempt++) {
      try { return await this.planLearning(task, context, this.store.snapshot().learning!, { signal, onProgress, sessionDirectory: this.sessionDirectory() }); }
      catch (error) {
        if (signal.aborted || attempt >= 2 || !(error instanceof Error) || !error.message.startsWith('Invalid curriculum response:')) throw error;
        context.repair = [error.message];
        onProgress('Correcting the curriculum response before saving it…');
      }
    }
  }

  proposeDirections() {
    if (activeArc(this.store.snapshot().learning)) throw new AppError('Finish the current curriculum before choosing another direction.', 409);
    this.runLearning('directions', async (signal, active, progress) => {
      const proposal = await this.learningRequest({ kind: 'directions' }, signal, progress) as DirectionProposal;
      if (active()) this.store.saveDirections(proposal);
    });
  }

  chooseDirection(setId: string, directionId: string) {
    const learning = this.store.snapshot().learning!;
    const choices = learning.directions;
    const direction = choices?.options.find(item => item.id === directionId);
    if (!choices || choices.id !== setId || !direction || activeArc(learning)) throw new AppError('Choose one of the current learning directions.', 409);
    this.runLearning('curriculum', async (signal, active, progress) => {
      const plan = await this.learningRequest({ kind: 'curriculum', direction }, signal, progress) as LearningPlan;
      if (active()) this.store.beginCurriculum(setId, directionId, plan);
    });
  }

  next() {
    this.requireIdle();
    if (this.store.activeLesson()?.focus) throw new AppError('Return from focused practice to your main lesson first.', 409);
    const data = this.store.snapshot();
    if (data.settings.provider === 'demo' || data.settings.tutorMode === 'baseline') return this.plan();
    if (this.store.pendingQuestion()) throw new AppError('Finish the current lesson first.', 409);
    const arc = activeArc(data.learning);
    if (!arc) return this.proposeDirections();
    const previous = arc.lessons.at(-1);
    const lastReview = arc.revisions.at(-1);
    if (!previous || lastReview?.afterLessonId === previous.lessonId && lastReview.evidenceHash === arcEvidenceHash(data, arc)) return this.plan();
    this.store.skipUnansweredDiscussions();
    this.runLearning('progress', async (signal, active, progress) => {
      const review = await this.learningRequest({ kind: 'progress', arc }, signal, progress) as ArcReview;
      if (!active()) return;
      this.store.reviewCurriculum(arc.id, review);
      if (review.decision === 'complete') {
        progress('Curriculum complete. Finding three directions for what comes next…');
        const choices = await this.learningRequest({ kind: 'directions' }, signal, progress) as DirectionProposal;
        if (active()) this.store.saveDirections(choices);
      } else {
        Object.assign(this.job!, { status: 'ready', stage: 'ready', message: 'Curriculum reviewed. Preparing the next lesson.' });
        this.store.recordJob(this.job!);
        this.plan();
        await this.settled();
      }
    });
  }
  plan(focusRequest?: { conceptId: string; length: number; language?: Language; contextId?: string }) {
    this.requireIdle();
    const parent = this.store.activeLesson();
    const concept = focusRequest ? this.store.concept(focusRequest.conceptId) : null;
    if (focusRequest && (!concept || concept.kind === 'topic' || !parent || parent.focus || ![4, 6].includes(focusRequest.length) || (focusRequest.language !== undefined && !['javascript', 'python', 'rust'].includes(focusRequest.language)))) throw new AppError('Choose a teachable concept, technique, skill, or representation and 4 or 6 cards while a main lesson is open.', 400);
    if (focusRequest && this.store.snapshot().settings.provider === 'demo' && !['demo-code-review', 'python-demo-code-review', 'rust-demo-code-review'].includes(concept?.id ?? '')) throw new AppError('Choose Codex or OpenCode in Setup to generate focused practice for this concept.');
    if (!focusRequest && this.store.pendingQuestion()) throw new AppError('Finish the current lesson before planning another.', 409);
    let context = this.store.context();
    if (!this.providers.some(item => item.id === context.settings.provider && item.available)) {
      throw new AppError(`${context.settings.provider} is unavailable. Install its CLI and restart, or choose practice demo.`, 503);
    }
    if (!focusRequest) this.store.skipUnansweredDiscussions();
    context = this.store.context();
    context.environments = executionEnvironments(this.languages);
    if (focusRequest && concept && parent) {
      delete context.learningPlan;
      const contextId = focusRequest.contextId ?? focusRequest.language ?? parent.contextIds?.[0] ?? parent.language ?? 'javascript';
      const definition = buildKnowledgeGraph(this.store.snapshot()).contexts.find(item => item.id === contextId);
      if (!definition) throw new AppError('Choose a known learning context.');
      context.settings = { ...context.settings, batchSize: focusRequest.length, language: definition.language ?? focusRequest.language ?? parent.language ?? 'javascript', preferredContexts: [contextId] };
      const answered = new Set(this.store.snapshot().attempts.filter(item => item.lessonId === parent.id).map(item => item.exerciseId));
      context.focus = { concept: { ...concept, contextId }, contextId, parentLessonId: parent.id, avoidQuestions: parent.questions.filter(item => !answered.has(item.id)) };
    }
    const language = context.settings.language ?? 'javascript';
    const runtime = this.languages.find(item => item.id === language);
    if (context.settings.provider === 'demo' && !runtime?.available) throw new AppError(runtime?.detail ?? `The ${language} sandbox is unavailable.`, 503);
    this.controller = new AbortController();
    const controller = this.controller;
    const job: Job = { id: randomUUID(), kind: focusRequest ? 'focus' : 'lesson', ...(concept ? { conceptId: concept.id, language, contextId: context.focus?.contextId ?? language } : {}), status: 'running', stage: 'planning', startedAt: new Date().toISOString(), message: 'Preparing the lesson…' };
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
        const maxRepairs = context.settings.provider === 'demo' ? 0 : 3;
        const earlierFailures: string[] = [];
        for (let attempt = 0; attempt <= maxRepairs; attempt++) {
          const repairMessage = `A check failed. Asking the tutor to repair the lesson (${attempt} of ${maxRepairs})…`;
          const proposal = context.settings.provider === 'demo' ? (context.settings.language === 'rust' ? createRustDemoLesson(context) : context.settings.language === 'python' ? createPythonDemoLesson(context) : createDemoLesson(context)) : await this.generate(context, { signal: controller.signal, sessionDirectory: this.sessionDirectory(), onProgress: message => progress(attempt ? repairMessage : message, attempt ? 'repairing' : 'planning') });
          if (!active()) return;
          progress('Checking the lesson and running supported exercises in their isolated environments…', 'validating');
          let validated: Awaited<ReturnType<typeof validateLesson>>;
          try { validated = await validateLesson(proposal, context, controller.signal); }
          catch (error) {
            if (!active()) return;
            const failure = error instanceof Error ? error.message : 'Invalid lesson.';
            if (attempt >= maxRepairs) throw new Error(`The lesson failed validation after ${maxRepairs} repair attempts. No exercises were published. Last check: ${failure}`);
            context.repair = [failure, ...earlierFailures.map(item => `Earlier check (may already be fixed): ${item}`)];
            earlierFailures.push(failure);
            context.draft = proposal;
            progress(`A check failed. Asking the tutor to repair the lesson (${attempt + 1} of ${maxRepairs})…`, 'repairing');
            continue;
          }
          if (!active()) return;
          this.store.commitLesson(validated, context.settings, context.focus ? { conceptId: context.focus.concept.id, contextId: context.focus.contextId, parentLessonId: context.focus.parentLessonId } : undefined);
          Object.assign(job, { status: 'ready', stage: 'ready', message: 'Lesson prepared. Predictions committed. Ready to play.' });
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
  prepareGuide(conceptId: string, language: Language = 'javascript', contextId?: string) {
    this.requireIdle();
    const selectedContext = contextId ?? language;
    const definition = buildKnowledgeGraph(this.store.snapshot()).contexts.find(item => item.id === selectedContext);
    if (!definition) throw new AppError('Choose a known learning context.');
    language = definition.language ?? (isLanguage(selectedContext) ? selectedContext : 'javascript');
    const concept = this.store.concept(conceptId);
    if (!concept) throw new AppError('Concept not found.', 404);
    if (concept.kind === 'topic') throw new AppError('Choose a concept or technique within this topic for a guide.');
    conceptId = concept.id;
    if (this.state().guides?.some(item => item.conceptId === conceptId && guideContext(item) === selectedContext)) return;
    const curated = BASE_CONTEXTS.slice(0, 3).some(item => item.id === selectedContext) ? reviewedGuide(concept, language) : null;
    const settings = { ...this.store.snapshot().settings, language };
    const runtime = this.languages.find(item => item.id === language);
    if (isLanguage(selectedContext) && !runtime?.available) throw new AppError(runtime?.detail ?? 'This language sandbox is unavailable.', 503);
    if (!curated && (!this.providers.some(item => item.id === settings.provider && item.available) || settings.provider === 'demo')) {
      throw new AppError('Choose an available Codex or OpenCode tutor in Setup to prepare this guide.', 503);
    }
    this.controller = new AbortController();
    const controller = this.controller;
    const job: Job = { id: randomUUID(), kind: 'guide', conceptId, language, contextId: selectedContext, status: 'running', stage: 'preparing', startedAt: new Date().toISOString(), message: 'Preparing your concept guide…' };
    this.job = job;
    this.store.recordJob(job);
    const active = () => !controller.signal.aborted && this.job?.id === job.id && job.status === 'running';
    this.work = (async () => {
      try {
        const guide = curated ? { ...await parseGuide(JSON.stringify({ title: curated.title, description: curated.description, takeaway: curated.takeaway,
          examples: curated.examples.map(example => ({ mode: example.mode ?? 'expression', expression: example.expression, expectedJson: JSON.stringify(example.result), explanation: example.explanation })) }), concept, controller.signal, language), contextId: selectedContext, version: curated.version } : await generateGuide(settings, concept, { signal: controller.signal, onProgress: message => {
          if (active()) { job.message = message; this.store.recordJob(job); }
        }, sessionDirectory: this.sessionDirectory() }, definition);
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
        }, sessionDirectory: this.sessionDirectory() });
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
