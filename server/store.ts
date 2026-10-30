import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync, chmodSync, cpSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { AppState, Attempt, Lesson, LessonSummary, Metrics, ProposedLesson, ProviderStatus, Review, ReviewSession, LessonFeedback, Settings, StoreData, TutorContext, ValidationReport, Answer, Job, Discussion, DiscussionContext, ProposedDiscussion } from '../src/types.ts';
import { parseDiscussionOutput } from './discussion.ts';
import { DEFAULT_LESSON_SIZE, LESSON_SIZES } from '../src/lesson-sizes.ts';
import { PURPOSES } from '../src/types.ts';
import { buildCurriculumMemory } from './curriculum-memory.ts';
import { validateRetrofit } from './skill-evidence.ts';
import { presentationArchiveHash, revisedQuestion, validatePresentationRevision, verifyPresentationBehavior } from './presentation-revisions.ts';
import type { ConceptGuide, GuideConcept, GuideEvent, Language, PresentationRevision, SkillRetrofit } from '../src/types.ts';
import { BASE_CONTEXTS, guideContext, questionContext, questionLanguage } from '../src/learning-contexts.ts';
import { buildKnowledgeGraph, canonicalId, validId } from './knowledge-graph.ts';
import { migrateKnowledge } from './knowledge-migration.ts';
import { executionEnvironments } from './environments.ts';

export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const DEFAULT_SETTINGS: Settings = { provider: 'codex', language: 'javascript', model: '', interests: '', batchSize: DEFAULT_LESSON_SIZE, tutorMode: 'reflective' };

export function parseSettings(input: unknown): Settings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('Choose valid tutor settings.');
  const data = input as Settings;
  if (data.language !== undefined && !['javascript', 'python', 'rust'].includes(data.language)) throw new AppError('Choose JavaScript, Python, or Rust.');
  if (!['codex', 'opencode', 'demo'].includes(data.provider)) throw new AppError('Choose Codex, OpenCode, or practice demo.');
  if (typeof data.model !== 'string' || data.model.length > 160 || !/^[\w./:-]*$/.test(data.model) || data.model.startsWith('-')) throw new AppError('Enter a model name, or leave it blank for the CLI default.');
  if (typeof data.interests !== 'string' || data.interests.length > 2000) throw new AppError('Keep interests under 2,000 characters.');
  if (!LESSON_SIZES.some(size => size === data.batchSize)) throw new AppError('Choose 6, 8, or 12 exercises per lesson.');
  if (!['reflective', 'baseline'].includes(data.tutorMode)) throw new AppError('Choose reflective or baseline tutor mode.');
  const preferences = (values: unknown, fallback: string[]) => {
    if (values === undefined) return fallback;
    if (!Array.isArray(values) || values.length > 16 || values.some(value => typeof value !== 'string' || !validId(value)) || new Set(values).size !== values.length) throw new AppError('Choose up to 16 distinct learning context IDs.');
    return [...values] as string[];
  };
  const preferredContexts = preferences(data.preferredContexts, [data.language ?? 'javascript']);
  const excludedContexts = preferences(data.excludedContexts, []);
  if (preferredContexts.some(id => excludedContexts.includes(id))) throw new AppError('A context cannot be both preferred and excluded.');
  return { provider: data.provider, language: data.language ?? 'javascript', preferredContexts, excludedContexts, model: data.model, interests: data.interests.trim(), batchSize: data.batchSize, tutorMode: data.tutorMode };
}

export function lessonHash(lesson: Lesson): string {
  const { predictionHash: _hash, ...sealed } = lesson;
  return createHash('sha256').update(JSON.stringify(sealed)).digest('hex');
}

export function calculateMetrics(data: StoreData, filter?: Pick<Settings, 'provider' | 'tutorMode' | 'language'>): Metrics {
  const observations = data.attempts.filter(attempt => !attempt.flagged && attempt.answer !== 'idk' && typeof attempt.correct === 'boolean').flatMap(attempt => {
    const lesson = data.lessons.find(item => item.id === attempt.lessonId);
    if (!lesson || (filter && (lesson.provider !== filter.provider || lesson.tutorMode !== filter.tutorMode || (data.version === 1 && (lesson.language ?? 'javascript') !== (filter.language ?? 'javascript'))))) return [];
    const question = lesson.questions.find(item => item.id === attempt.exerciseId);
    return question ? [{ p: question.prediction.pCorrect, y: Number(attempt.correct), purposes: question.plan?.purposes ?? [question.purpose] }] : [];
  });
  return {
    count: observations.length,
    brier: observations.length ? observations.reduce((sum, item) => sum + (item.p - item.y) ** 2, 0) / observations.length : null,
    accuracy: observations.length ? observations.reduce((sum, item) => sum + item.y, 0) / observations.length : null,
    calibration: Array.from({ length: 5 }, (_, index) => {
      const items = observations.filter(item => Math.min(4, Math.floor(item.p * 5)) === index);
      return { label: `${index * 20}–${(index + 1) * 20}%`, count: items.length,
        predicted: items.length ? items.reduce((sum, item) => sum + item.p, 0) / items.length : null,
        actual: items.length ? items.reduce((sum, item) => sum + item.y, 0) / items.length : null };
    }),
    byPurpose: PURPOSES.map(purpose => {
      const items = observations.filter(item => item.purposes.includes(purpose));
      return { purpose, count: items.length, accuracy: items.length ? items.reduce((sum, item) => sum + item.y, 0) / items.length : null };
    }),
  };
}

export class LocalStore {
  readonly directory: string;
  private file: string;
  private data: StoreData;

  constructor(directory: string) {
    this.directory = resolve(directory);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    mkdirSync(join(this.directory, 'plans'), { recursive: true, mode: 0o700 });
    mkdirSync(join(this.directory, 'runs'), { recursive: true, mode: 0o700 });
    this.file = join(this.directory, 'state.json');
    if (existsSync(this.file)) {
      try {
        this.data = JSON.parse(readFileSync(this.file, 'utf8'));
        if (![1, 2].includes(this.data.version) || !Array.isArray(this.data.lessons) || !Array.isArray(this.data.attempts)) throw new Error('Unsupported data format.');
        // Retire the old four-card setting without changing any sealed lesson.
        if (this.data.settings?.batchSize === 4) this.data.settings = { ...this.data.settings, batchSize: DEFAULT_LESSON_SIZE };
        this.data.settings = parseSettings(this.data.settings);
        this.data.feedback ??= [];
        this.data.reviewSessions ??= [];
        this.data.discussions ??= [];
        const retrofits = this.data.skillRetrofits ?? [];
        if (!Array.isArray(retrofits)) throw new Error('Invalid skill retrofit history.');
        const prior: SkillRetrofit[] = [];
        for (const retrofit of retrofits) {
          if (prior.some(item => item.id === retrofit.id)) throw new Error('Duplicate skill retrofit.');
          validateRetrofit(retrofit, { ...this.data, skillRetrofits: prior }, false);
          prior.push(retrofit);
        }
        const revisions = this.data.presentationRevisions ?? [];
        if (!Array.isArray(revisions)) throw new Error('Invalid presentation revisions.');
        const priorRevisions: PresentationRevision[] = [];
        for (const revision of revisions) {
          if (priorRevisions.some(item => item.id === revision.id)) throw new Error('Duplicate presentation revision.');
          validatePresentationRevision(revision, { ...this.data, presentationRevisions: priorRevisions }, false);
          priorRevisions.push(revision);
        }
        if (!Array.isArray(this.data.feedback) || !Array.isArray(this.data.reviewSessions) || !Array.isArray(this.data.discussions)) throw new Error('Invalid feedback history.');
        if (this.data.activeLessonId && !this.data.lessons.some(lesson => lesson.id === this.data.activeLessonId)) throw new Error('Active lesson is missing.');
        for (const lesson of this.data.lessons) {
          if (lesson.focus && !this.data.lessons.some(parent => parent.id === lesson.focus!.parentLessonId && parent.id !== lesson.id && !parent.focus)) throw new Error('A focused lesson has no valid parent.');
          if (lesson.predictionHash !== lessonHash(lesson)) throw new Error('A committed lesson has changed.');
          const artifact = JSON.parse(readFileSync(join(this.directory, 'plans', `${lesson.id}.json`), 'utf8')) as Lesson;
          if (artifact.predictionHash !== lesson.predictionHash || lessonHash(artifact) !== lesson.predictionHash) throw new Error('A plan artifact has changed.');
        }
        if (this.data.version === 1) {
          const backupDirectory = join(this.directory, 'backups', `knowledge-v1-${new Date().toISOString().replace(/[:.]/g, '-')}`);
          mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
          copyFileSync(this.file, join(backupDirectory, 'state.json'));
          cpSync(join(this.directory, 'plans'), join(backupDirectory, 'plans'), { recursive: true });
          this.data = migrateKnowledge(this.data, backupDirectory).data;
          this.persist();
        }
        buildKnowledgeGraph(this.data);
      } catch (error) {
        throw new Error(`Could not read local history at ${this.file}. Nothing was reset. Check state.backup.json and restore a matching set of plan files. ${error instanceof Error ? error.message : ''}`);
      }
    } else {
      this.data = { version: 2, settings: parseSettings(DEFAULT_SETTINGS), lessons: [], attempts: [], feedback: [], reviewSessions: [], discussions: [], graphRevisions: [] };
      this.persist();
    }
  }

  snapshot(): StoreData { return structuredClone(this.data); }

  importSkillRetrofit(retrofit: SkillRetrofit): boolean {
    const existing = this.data.skillRetrofits?.find(item => item.id === retrofit.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(retrofit)) throw new AppError('A saved retrofit cannot be overwritten.');
      return false;
    }
    validateRetrofit(retrofit, this.data);
    this.update({ ...this.data, skillRetrofits: [...this.data.skillRetrofits ?? [], structuredClone(retrofit)] });
    return true;
  }

  async importPresentationRevision(revision: PresentationRevision): Promise<{ imported: boolean; fixtures: number }> {
    const existing = this.data.presentationRevisions?.find(item => item.id === revision.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(revision)) throw new AppError('A saved presentation revision cannot be overwritten.');
      return { imported: false, fixtures: 0 };
    }
    const before = this.snapshot();
    const fixtures = await verifyPresentationBehavior(revision, before);
    if (presentationArchiveHash(this.data) !== presentationArchiveHash(before)) throw new AppError('Archive changed during verification; retry against the latest data.');
    this.update({ ...this.data, presentationRevisions: [...this.data.presentationRevisions ?? [], structuredClone(revision)] });
    return { imported: true, fixtures };
  }

  concept(id: string): GuideConcept | null {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(id)) return null;
    const graph = buildKnowledgeGraph(this.data);
    id = canonicalId(id, graph.aliases);
    const definition = graph.concepts.find(item => item.id === id);
    return definition ? { id, name: definition.name, description: definition.description } : null;
  }

  undoConceptMerge(id: string): void {
    const history = this.data.graphRevisions ?? [];
    const merge = history.find(item => item.id === id && item.change.type === 'merge');
    if (!merge || history.some(item => item.change.type === 'undo-merge' && item.change.mergeId === id)) throw new AppError('This merge is missing or already undone.', 409);
    this.update({ ...this.data, graphRevisions: [...history, { id: randomUUID(), createdAt: new Date().toISOString(), source: 'user', change: { type: 'undo-merge', mergeId: id, reason: 'Learner reversed this concept equivalence.' } }] });
  }

  previewConcepts(): GuideConcept[] {
    const lesson = this.activeLesson();
    if (!lesson || lesson.focus || this.data.startedLessonIds?.includes(lesson.id)
      || this.data.attempts.some(item => item.lessonId === lesson.id)) return [];
    const frontier = lesson.curriculum?.frontier ?? [];
    const updates = lesson.curriculum?.conceptUpdates ?? [];
    const memory = buildCurriculumMemory({ ...this.data, settings: { ...this.data.settings, tutorMode: 'reflective' } });
    const unfamiliar = (id: string, contextId: string) => !memory.concepts.find(item => item.id === id)?.contextPractice?.[contextId]?.exposures;
    const directions = frontier.filter(item => item.decision === 'introduce' || (item.decision === 'explore' && (lesson.curriculum?.knowledge ? unfamiliar(item.conceptId, item.contextId!) : updates.some(c => c.id === item.conceptId && c.familiarity === 'unknown'))))
      .map(item => ({ id: item.conceptId, contextId: item.contextId ?? lesson.language ?? 'javascript' }));
    for (const question of lesson.questions) if (question.plan?.purposes.includes('introduction')) {
      for (const id of question.plan.conceptIds) if (lesson.curriculum?.knowledge ? unfamiliar(id, question.contextId!) : updates.some(concept => concept.id === id && concept.familiarity === 'unknown')) directions.push({ id, contextId: questionContext(question, lesson) });
    }
    const concepts: GuideConcept[] = [];
    const seen = new Set<string>();
    for (const { id, contextId } of directions) {
      const concept = this.concept(id);
      if (!concept) continue;
      const key = `${concept.id}\0${contextId}`;
      if (!seen.has(key)) { concepts.push({ ...concept, contextId }); seen.add(key); }
    }
    return concepts;
  }

  startPreparedLesson(id: string): void {
    if (this.activeLesson()?.id !== id || !this.pendingQuestion()) throw new AppError('This lesson is no longer current.', 409);
    if (!(this.data.startedLessonIds ?? []).includes(id)) this.update({ ...this.data, startedLessonIds: [...this.data.startedLessonIds ?? [], id] });
  }

  resumeParent(): void {
    const lesson = this.activeLesson();
    if (!lesson?.focus) throw new AppError('No focused practice is active.', 409);
    if (!this.data.lessons.some(item => item.id === lesson.focus!.parentLessonId)) throw new AppError('The original lesson was not found.', 409);
    const endedFocusIds = this.pendingQuestion() ? [...new Set([...(this.data.endedFocusIds ?? []), lesson.id])] : this.data.endedFocusIds;
    this.update({ ...this.data, activeLessonId: lesson.focus.parentLessonId, ...(endedFocusIds ? { endedFocusIds } : {}) });
  }

  saveGuide(guide: ConceptGuide): void {
    if (!this.concept(guide.conceptId)) throw new AppError('Concept not found.', 404);
    this.update({ ...this.data, guides: [...(this.data.guides ?? []).filter(item => item.conceptId !== guide.conceptId || guideContext(item) !== guideContext(guide)), structuredClone(guide)] });
  }

  recordGuideEvent(conceptId: string, action: GuideEvent['action'], language: Language = 'javascript', contextId?: string): void {
    const selectedContext = contextId ?? language;
    if (!buildKnowledgeGraph(this.data).contexts.some(item => item.id === selectedContext)) throw new AppError('Choose a known learning context.');
    const graph = buildKnowledgeGraph(this.data);
    conceptId = canonicalId(conceptId, graph.aliases);
    const guide = this.data.guides?.find(item => canonicalId(item.conceptId, graph.aliases) === conceptId && guideContext(item) === selectedContext);
    if (!guide || !['opened', 'finished', 'familiar', 'unclear'].includes(action)) throw new AppError('Open a prepared guide before recording an action.');
    const event: GuideEvent = { id: randomUUID(), conceptId, language: guide.language, contextId: selectedContext, version: guide.version, lessonId: this.activeLesson()?.id ?? null, at: new Date().toISOString(), action };
    this.update({ ...this.data, guideEvents: [...this.data.guideEvents ?? [], event] });
  }

  private persist() {
    const temp = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data, null, 2) + '\n', { mode: 0o600 });
    if (existsSync(this.file)) copyFileSync(this.file, join(this.directory, 'state.backup.json'));
    renameSync(temp, this.file);
  }

  private update(next: StoreData) {
    const previous = this.data;
    this.data = next;
    try { this.persist(); } catch (error) { this.data = previous; throw error; }
  }

  saveSettings(settings: Settings) {
    const parsed = parseSettings(settings);
    // Older clients still send a single language selection.
    if (settings.language && settings.language !== this.data.settings.language && JSON.stringify(settings.preferredContexts) === JSON.stringify(this.data.settings.preferredContexts)) parsed.preferredContexts = [settings.language];
    this.update({ ...this.data, settings: parsed });
  }

  activeLesson(): Lesson | undefined {
    return this.data.activeLessonId ? this.data.lessons.find(lesson => lesson.id === this.data.activeLessonId) : this.data.lessons.at(-1);
  }

  pendingQuestion() {
    const lesson = this.activeLesson();
    if (!lesson) return null;
    const answered = new Set(this.data.attempts.filter(item => item.lessonId === lesson.id).map(item => item.exerciseId));
    return structuredClone(lesson.questions.find(item => !answered.has(item.id)) ?? null);
  }

  commitLesson(proposal: ProposedLesson & { reports: ValidationReport[] }, settings: Settings, focus?: Lesson['focus']): Lesson {
    if (focus && (this.activeLesson()?.id !== focus.parentLessonId || this.activeLesson()?.focus)) throw new AppError('The main lesson changed; reopen the guide and try again.', 409);
    if (!focus && this.pendingQuestion()) throw new AppError('Finish the current lesson before starting another.', 409);
    if (proposal.questions.length !== proposal.reports.length) throw new Error('Missing exercise validation reports.');
    proposal = structuredClone(proposal);
    const lesson: Lesson = {
      id: randomUUID(), createdAt: new Date().toISOString(), provider: settings.provider, model: settings.model,
      tutorMode: settings.tutorMode, interests: settings.interests, language: proposal.questions.find(question => question.language)?.language ?? settings.language ?? 'javascript',
      ...(proposal.curriculum?.knowledge ? { contextIds: [...new Set(proposal.questions.map(question => question.contextId!))] } : {}),
      ...(focus ? { focus } : {}),
      objective: proposal.objective, rationale: proposal.rationale, assumptions: proposal.assumptions,
      reflection: proposal.reflection, hypotheses: proposal.hypotheses,
      ...(proposal.curriculum ? { curriculum: proposal.curriculum } : {}),
      questions: proposal.questions.map((question, index) => ({ ...question, id: randomUUID(), validation: proposal.reports[index] })),
      predictionHash: '',
    };
    lesson.predictionHash = lessonHash(lesson);
    const path = join(this.directory, 'plans', `${lesson.id}.json`);
    // Write the whole sealed plan before any question can be returned to a client.
    writeFileSync(path, JSON.stringify(lesson, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    chmodSync(path, 0o400);
    const revisions = [...this.data.graphRevisions ?? []];
    for (const relationship of proposal.curriculum?.knowledge?.relationships ?? []) revisions.push({ id: randomUUID(), createdAt: lesson.createdAt, source: 'lesson', lessonId: lesson.id, change: { type: 'relationship', relationship } });
    for (const merge of proposal.curriculum?.knowledge?.merges ?? []) revisions.push({ id: randomUUID(), createdAt: lesson.createdAt, source: 'lesson', lessonId: lesson.id, change: { type: 'merge', ...merge } });
    this.update({ ...this.data, lessons: [...this.data.lessons, lesson], graphRevisions: revisions, activeLessonId: lesson.id });
    return structuredClone(lesson);
  }

  answer(exerciseId: string, answer: Answer, elapsedMs: number): Review {
    if (!['buggy', 'correct', 'idk'].includes(answer)) throw new AppError('Choose buggy, correct, or IDK.');
    if (typeof exerciseId !== 'string' || !Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 86_400_000) throw new AppError('Invalid exercise response.');
    const existing = this.data.attempts.find(item => item.exerciseId === exerciseId);
    if (existing) {
      if (existing.answer !== answer) throw new AppError('This answer has already been recorded.', 409);
      return this.review(existing);
    }
    const current = this.pendingQuestion();
    if (!current || current.id !== exerciseId) throw new AppError('This exercise is no longer current. Refresh to continue.', 409);
    const lesson = this.activeLesson()!;
    const attempt: Attempt = { id: randomUUID(), lessonId: lesson.id, exerciseId, answer,
      correct: answer === 'idk' ? null : answer === current.verdict, answeredAt: new Date().toISOString(), elapsedMs: Math.round(elapsedMs), flagged: false };
    this.update({ ...this.data, attempts: [...this.data.attempts, attempt] });
    return this.review(attempt);
  }

  flagAttempt(id: string, flagged: boolean, reason: Attempt['exclusionReason'] = 'flawed-question') {
    if (typeof flagged !== 'boolean') throw new AppError('Choose whether this exercise should be excluded.');
    if (!['flawed-question', 'accidental-input'].includes(reason)) throw new AppError('Choose a valid reason for excluding this answer.');
    if (!this.data.attempts.some(item => item.id === id)) throw new AppError('Answer not found.', 404);
    this.update({ ...this.data,
      attempts: this.data.attempts.map(item => item.id === id ? { ...item, flagged,
        exclusionReason: !flagged ? undefined : reason === 'accidental-input' && item.flagged && item.exclusionReason !== 'accidental-input' ? 'flawed-question' : reason } : item),
      feedback: (this.data.feedback ?? []).map(item => {
        const belongs = this.data.attempts.some(attempt => attempt.id === id && attempt.lessonId === item.lessonId);
        return { ...item, accidentalAttemptIds: flagged && reason === 'accidental-input' && belongs
          ? [...new Set([...item.accidentalAttemptIds, id])] : item.accidentalAttemptIds.filter(attemptId => attemptId !== id) };
      }),
    });
  }

  recordReview(attemptId: string, input: unknown): ReviewSession {
    if (!this.data.attempts.some(item => item.id === attemptId)) throw new AppError('Answer not found.', 404);
    if (!input || typeof input !== 'object') throw new AppError('Send a valid review session.');
    const { sessionId, activeMs, closed, openedAt } = input as { sessionId: string; activeMs: number; closed: boolean; openedAt?: string };
    if (typeof sessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) throw new AppError('Use a valid review session ID.');
    if (typeof activeMs !== 'number' || !Number.isFinite(activeMs) || activeMs < 0 || activeMs > 86_400_000 || typeof closed !== 'boolean') throw new AppError('Review duration must be between zero and 24 hours.');
    if (openedAt !== undefined && (typeof openedAt !== 'string' || !Number.isFinite(Date.parse(openedAt)))) throw new AppError('Use a valid review opening timestamp.');
    const sessions = this.data.reviewSessions ?? [];
    const previous = sessions.find(item => item.id === sessionId);
    if (previous && previous.attemptId !== attemptId) throw new AppError('This review session belongs to another answer.', 409);
    if (!previous && activeMs !== 0) throw new AppError('Open a review session before recording its duration.', 409);
    if (previous && activeMs <= previous.activeMs && (!closed || previous.closed)) return structuredClone(previous);
    const now = new Date().toISOString();
    const session: ReviewSession = { id: sessionId, attemptId, openedAt: previous?.openedAt ?? (openedAt ? new Date(openedAt).toISOString() : now),
      updatedAt: now, activeMs: Math.max(previous?.activeMs ?? 0, Math.round(activeMs)), closed: closed || previous?.closed || false };
    this.update({ ...this.data, reviewSessions: previous ? sessions.map(item => item.id === sessionId ? session : item) : [...sessions, session] });
    return structuredClone(session);
  }

  saveFeedback(lessonId: string, input: unknown) {
    const lesson = this.data.lessons.find(item => item.id === lessonId);
    if (!lesson) throw new AppError('Lesson not found.', 404);
    const attempts = this.data.attempts.filter(item => item.lessonId === lessonId);
    if (attempts.length !== lesson.questions.length) throw new AppError('Finish this lesson before leaving feedback.', 409);
    if (!input || typeof input !== 'object') throw new AppError('Send valid lesson feedback.');
    const { text, accidentalAttemptIds } = input as { text: string; accidentalAttemptIds: string[] };
    if (typeof text !== 'string' || text.length > 4_000) throw new AppError('Keep feedback under 4,000 characters.');
    if (!Array.isArray(accidentalAttemptIds) || accidentalAttemptIds.length > lesson.questions.length || accidentalAttemptIds.some(id => typeof id !== 'string' || !attempts.some(item => item.id === id))) throw new AppError('Accidental answers must belong to this lesson.');
    const excluded = new Set(accidentalAttemptIds);
    const feedback: LessonFeedback = { lessonId, text: text.trim(), accidentalAttemptIds: [...excluded], updatedAt: new Date().toISOString() };
    this.update({ ...this.data,
      feedback: [...(this.data.feedback ?? []).filter(item => item.lessonId !== lessonId), feedback],
      attempts: this.data.attempts.map(item => {
        if (item.lessonId !== lessonId) return item;
        // Accident notes must not erase an independently flagged bad exercise.
        if (excluded.has(item.id)) return item.flagged && item.exclusionReason !== 'accidental-input' ? item : { ...item, flagged: true, exclusionReason: 'accidental-input' };
        if (item.exclusionReason === 'accidental-input') return { ...item, flagged: false, exclusionReason: undefined };
        return item;
      }),
    });
  }

  discussionContext(lessonId: string): DiscussionContext {
    const lesson = this.data.lessons.find(item => item.id === lessonId);
    if (!lesson) throw new AppError('Lesson not found.', 404);
    if (lesson.id !== this.activeLesson()?.id || this.pendingQuestion()) throw new AppError('Finish the current lesson before talking with your tutor.', 409);
    if (this.data.settings.tutorMode !== 'reflective') throw new AppError('Choose reflective tutor mode to discuss your learning. Baseline mode keeps no learner history.', 409);
    const tutor = this.context();
    return structuredClone({ tutor, lesson,
      attempts: this.data.attempts.filter(item => item.lessonId === lessonId),
      feedback: this.data.feedback?.find(item => item.lessonId === lessonId) ?? null,
      discussions: (tutor.discussions ?? []).filter(item => item.lessonId === lessonId),
    });
  }

  commitDiscussion(lessonId: string, proposal: ProposedDiscussion): Discussion {
    const context = this.discussionContext(lessonId);
    const checked = parseDiscussionOutput(JSON.stringify(proposal));
    const discussion: Discussion = { id: randomUUID(), lessonId, createdAt: new Date().toISOString(),
      provider: context.tutor.settings.provider, model: context.tutor.settings.model,
      feedbackText: context.feedback?.text ?? '', reflection: checked.reflection,
      questions: checked.questions.map(text => ({ id: randomUUID(), text, answer: null, skipped: false })),
    };
    this.update({ ...this.data, discussions: [...(this.data.discussions ?? []), discussion] });
    return structuredClone(discussion);
  }

  saveDiscussionReplies(id: string, input: unknown) {
    const discussion = this.data.discussions?.find(item => item.id === id);
    if (!discussion) throw new AppError('Tutor conversation not found.', 404);
    const replies = (input as { replies?: { questionId: string; answer: string }[] } | null)?.replies;
    if (!Array.isArray(replies) || replies.length !== discussion.questions.length || new Set(replies.map(item => item?.questionId)).size !== replies.length
      || replies.some(item => !item || !discussion.questions.some(question => question.id === item.questionId) || typeof item.answer !== 'string' || item.answer.length > 4000)) {
      throw new AppError('Send one reply per follow-up question, up to 4,000 characters each. Leave a reply blank to skip it.');
    }
    this.update({ ...this.data, discussions: this.data.discussions!.map(item => item.id === id ? {
      ...item, repliedAt: new Date().toISOString(), questions: item.questions.map(question => {
        const answer = replies.find(reply => reply.questionId === question.id)!.answer.trim();
        return { ...question, answer: answer || null, skipped: !answer };
      }),
    } : item) });
  }

  skipUnansweredDiscussions() {
    const lessonId = this.activeLesson()?.id;
    const discussions = this.data.discussions ?? [];
    if (!discussions.some(item => item.lessonId === lessonId && item.questions.some(question => question.answer === null && !question.skipped))) return;
    this.update({ ...this.data, discussions: discussions.map(item => item.lessonId === lessonId ? {
      ...item, questions: item.questions.map(question => question.answer === null ? { ...question, skipped: true } : question),
    } : item) });
  }

  private review(attempt: Attempt): Review {
    const lesson = this.data.lessons.find(item => item.id === attempt.lessonId)!;
    const question = lesson.questions.find(item => item.id === attempt.exerciseId)!;
    const complete = this.data.attempts.filter(item => item.lessonId === lesson.id).length === lesson.questions.length;
    // Planning metadata may identify a future mirror and reveal its verdict.
    const retro = this.data.skillRetrofits?.flatMap(item => item.questions).find(item => item.exerciseId === question.id && item.lessonId === lesson.id);
    const ids = question.plan?.skillUses?.filter(use => use.role !== 'incidental').map(use => use.conceptId) ?? retro?.uses.filter(use => use.role !== 'incidental').map(use => use.conceptId) ?? question.plan?.conceptIds ?? [];
    const relatedConcepts = [...new Set(ids)].map(id => this.concept(id)).filter((item): item is GuideConcept => Boolean(item)).slice(0, 4).map(concept => ({ ...concept, contextId: questionContext(question, lesson) }));
    const afterPlan = (at: string) => Date.parse(at) >= Date.parse(lesson.createdAt) && Date.parse(at) <= Date.parse(attempt.answeredAt);
    const opened = (this.data.guideEvents ?? []).filter(event => event.action === 'opened' && event.lessonId === lesson.id && afterPlan(event.at));
    const practiced = this.data.lessons.filter(item => item.focus?.parentLessonId === lesson.id && this.data.attempts.some(answer => answer.lessonId === item.id && afterPlan(answer.answeredAt)));
    const teachingBeforeAnswer = [...new Set([
      ...opened.map(event => `Opened guide: ${this.concept(event.conceptId)?.name ?? event.conceptId}`),
      ...practiced.map(item => `Focused practice: ${this.concept(item.focus!.conceptId)?.name ?? item.focus!.conceptId}`),
    ])];
    const revision = this.data.presentationRevisions?.flatMap(item => item.questions).find(item => item.exerciseId === question.id);
    const displayed = revision ? revisedQuestion(question, revision) : question;
    const { plan: _plan, ...answeredQuestion } = displayed;
    return structuredClone({ attempt, question: complete ? displayed : answeredQuestion, lessonObjective: lesson.objective, provider: lesson.provider, language: questionLanguage(question, lesson), contextId: questionContext(question, lesson), contextName: buildKnowledgeGraph(this.data).contexts.find(item => item.id === questionContext(question, lesson))?.name,
      relatedConcepts, teachingBeforeAnswer,
      ...(revision ? { originalPresentation: { specification: question.specification, code: question.code, referenceCode: question.referenceCode } } : {}),
    });
  }

  context(): TutorContext {
    const history = this.data.lessons.map(lesson => ({ lesson, attempts: this.data.attempts.filter(item => item.lessonId === lesson.id && !item.flagged) }));
    if (this.data.settings.tutorMode === 'baseline') {
      return { settings: { ...this.data.settings }, knowledge: { concepts: [], contexts: structuredClone(BASE_CONTEXTS), relationships: [], aliases: {}, history: [] }, history: [], hypotheses: [], reviewSessions: [], feedback: [], discussions: [], curriculum: { concepts: [], variants: [], legacyLessons: [] }, metrics: calculateMetrics({ ...this.data, lessons: [], attempts: [] }) };
    }
    const hypotheses = this.data.lessons.at(-1)?.hypotheses ?? [];
    const evidence = new Set(hypotheses.flatMap(item => [...item.supportingAttemptIds, ...item.counterevidenceAttemptIds]));
    const selected = history.filter((item, index) => index >= history.length - 12 || item.attempts.some(attempt => evidence.has(attempt.id)));
    // Keep the archive intact while reserving room for instructions and repair.
    // Evidence dropped from the context is also removed from current hypotheses.
    while (selected.length > 1 && Buffer.byteLength(JSON.stringify(selected)) > 280_000) selected.shift();
    const knownIds = new Set(selected.flatMap(item => item.attempts.map(attempt => attempt.id)));
    const knownLessons = new Set(selected.map(item => item.lesson.id));
    const discussions = (this.data.discussions ?? []).filter(item => knownLessons.has(item.lessonId)).slice(-12);
    while (discussions.length > 1 && Buffer.byteLength(JSON.stringify(discussions)) > 48_000) discussions.shift();
    return { settings: { ...this.data.settings }, knowledge: buildKnowledgeGraph(this.data), history: structuredClone(selected),
      curriculum: buildCurriculumMemory(this.data),
      // Older review details remain in durable concept evidence, just as old plans do.
      skillRetrofits: structuredClone((this.data.skillRetrofits ?? []).map(review => ({ ...review,
        questions: review.questions.filter(question => knownLessons.has(question.lessonId)),
      })).filter(review => review.questions.length)),
      guideEvents: structuredClone((this.data.guideEvents ?? []).slice(-120).map(event => ({ ...event, language: event.language ?? 'javascript' }))),
      focusHistory: this.data.lessons.filter(item => item.focus).slice(-12).map(item => ({ lessonId: item.id, parentLessonId: item.focus!.parentLessonId,
        conceptId: item.focus!.conceptId, language: item.language ?? 'javascript', answered: this.data.attempts.filter(attempt => attempt.lessonId === item.id).length,
        total: item.questions.length, endedEarly: (this.data.endedFocusIds ?? []).includes(item.id) })),
      discussions: structuredClone(discussions),
      feedback: structuredClone((this.data.feedback ?? []).filter(item => knownLessons.has(item.lessonId))),
      reviewSessions: structuredClone((this.data.reviewSessions ?? []).filter(item => knownIds.has(item.attemptId))),
      hypotheses: hypotheses.map(item => {
        const supportingAttemptIds = item.supportingAttemptIds.filter(id => knownIds.has(id));
        const counterevidenceAttemptIds = item.counterevidenceAttemptIds.filter(id => knownIds.has(id));
        return { ...structuredClone(item), supportingAttemptIds, counterevidenceAttemptIds,
          status: item.status === 'supported' && !supportingAttemptIds.length || item.status === 'contradicted' && !counterevidenceAttemptIds.length ? 'tentative' : item.status };
      }),
      metrics: calculateMetrics(this.data, this.data.settings) };
  }

  recordJob(job: Job) {
    writeFileSync(join(this.directory, 'runs', `${job.id}.json`), JSON.stringify(job, null, 2) + '\n', { mode: 0o600 });
  }

  publicState(providers: ProviderStatus[], job: Job | null, languages?: AppState['languages']): AppState {
    const summaries: LessonSummary[] = this.data.lessons.map(lesson => {
      const answered = this.data.attempts.filter(item => item.lessonId === lesson.id).length;
      const complete = answered === lesson.questions.length;
      return { id: lesson.id, objective: lesson.objective, rationale: complete ? lesson.rationale : 'The tutor’s rationale is sealed until this lesson is complete, so it cannot give away the answers.', createdAt: lesson.createdAt,
        provider: lesson.provider, tutorMode: lesson.tutorMode, language: lesson.language ?? 'javascript', contextIds: lesson.contextIds ?? [lesson.language ?? 'javascript'], answered, total: lesson.questions.length, complete,
        reflection: complete ? lesson.reflection : null, assumptions: complete ? lesson.assumptions : [],
        hypotheses: complete ? lesson.hypotheses : [], predictionHash: lesson.predictionHash,
        ...(complete && lesson.curriculum ? { curriculum: lesson.curriculum } : {}),
        feedback: this.data.feedback?.find(item => item.lessonId === lesson.id), ...(lesson.focus ? { focus: lesson.focus } : {}),
        ...((this.data.endedFocusIds ?? []).includes(lesson.id) ? { endedEarly: true } : {}) };
    });
    const current = this.pendingQuestion();
    const graph = buildKnowledgeGraph(this.data);
    const completedIds = new Set(summaries.filter(item => item.complete).map(item => item.id));
    const publicData = { ...this.data, settings: { ...this.data.settings, tutorMode: 'reflective' as const }, lessons: this.data.lessons.map(lesson => {
      if (completedIds.has(lesson.id)) return lesson;
      const questions = lesson.questions.filter(question => this.data.attempts.some(attempt => attempt.lessonId === lesson.id && attempt.exerciseId === question.id));
      const visibleIds = new Set(questions.flatMap(question => question.plan?.skillUses?.map(use => use.conceptId) ?? question.plan?.conceptIds ?? []));
      return { ...lesson, questions, ...(lesson.curriculum ? { curriculum: { ...lesson.curriculum,
        conceptUpdates: lesson.curriculum.conceptUpdates.filter(item => visibleIds.has(item.id)).map(item => ({ ...item, prerequisiteIds: [], familiarity: 'unknown' as const, evidenceAttemptIds: [], uncertainty: 'The current assessment remains sealed.', nextProbe: 'The next probe remains sealed.' })),
        ...(lesson.curriculum.knowledge ? { knowledge: { ...lesson.curriculum.knowledge, concepts: lesson.curriculum.knowledge.concepts.filter(item => visibleIds.has(item.id)), relationships: [], assessments: [], merges: [] } } : {}),
        observations: [], frontier: [], mixRationale: '', sequenceRationale: '',
      } } : {}) };
    }), graphRevisions: this.data.graphRevisions?.filter(item => item.change.type !== 'relationship' || !item.lessonId || completedIds.has(item.lessonId)) };
    return structuredClone({ settings: this.data.settings, providers, job, ...(languages ? { languages } : {}),
      contexts: graph.contexts, environments: executionEnvironments(languages), knowledge: buildKnowledgeGraph(publicData), conceptMemory: buildCurriculumMemory(publicData).concepts,
      currentLesson: summaries.find(item => item.id === this.activeLesson()?.id) ?? null,
      lessonPreview: this.previewConcepts(), guides: (this.data.guides ?? []).map(item => ({ ...item, conceptId: canonicalId(item.conceptId, graph.aliases) })),
      question: current ? { id: current.id, title: current.title, specification: current.specification, code: current.code, language: questionLanguage(current, this.activeLesson()), ...(current.contextId ? { kind: current.kind, contextId: current.contextId, contextName: graph.contexts.find(item => item.id === current.contextId)?.name, ...(current.kind === 'answer-review' ? { proposedAnswer: current.proposedAnswer } : {}) } : {}),
        purpose: current.purpose, testCount: current.validation.testCount } : null,
      lessons: [...summaries].reverse(), reviews: [...this.data.attempts].reverse().map(item => this.review(item)),
      hypotheses: summaries.filter(item => item.complete).at(-1)?.hypotheses ?? [],
      metrics: calculateMetrics(this.data, this.data.settings), dataDirectory: this.directory,
      reviewSessions: this.data.reviewSessions ?? [], feedback: this.data.feedback ?? [], discussions: this.data.discussions ?? [] });
  }
}
