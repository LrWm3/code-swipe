import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { AppState, Attempt, Lesson, LessonSummary, Metrics, ProposedLesson, ProviderStatus, Review, Settings, StoreData, TutorContext, ValidationReport, Verdict, Job } from '../src/types.ts';

export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const DEFAULT_SETTINGS: Settings = { provider: 'codex', model: '', interests: '', batchSize: 4, tutorMode: 'reflective' };

export function parseSettings(input: unknown): Settings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('Choose valid tutor settings.');
  const data = input as Settings;
  if (!['codex', 'opencode', 'demo'].includes(data.provider)) throw new AppError('Choose Codex, OpenCode, or practice demo.');
  if (typeof data.model !== 'string' || data.model.length > 160 || !/^[\w./:-]*$/.test(data.model) || data.model.startsWith('-')) throw new AppError('Enter a model name, or leave it blank for the CLI default.');
  if (typeof data.interests !== 'string' || data.interests.length > 2000) throw new AppError('Keep interests under 2,000 characters.');
  if (![4, 6, 8].includes(data.batchSize)) throw new AppError('Choose 4, 6, or 8 exercises per lesson.');
  if (!['reflective', 'baseline'].includes(data.tutorMode)) throw new AppError('Choose reflective or baseline tutor mode.');
  return { provider: data.provider, model: data.model, interests: data.interests.trim(), batchSize: data.batchSize, tutorMode: data.tutorMode };
}

export function lessonHash(lesson: Lesson): string {
  const { predictionHash: _hash, ...sealed } = lesson;
  return createHash('sha256').update(JSON.stringify(sealed)).digest('hex');
}

export function calculateMetrics(data: StoreData, filter?: Pick<Settings, 'provider' | 'tutorMode'>): Metrics {
  const observations = data.attempts.filter(attempt => !attempt.flagged).flatMap(attempt => {
    const lesson = data.lessons.find(item => item.id === attempt.lessonId);
    if (!lesson || (filter && (lesson.provider !== filter.provider || lesson.tutorMode !== filter.tutorMode))) return [];
    const question = lesson.questions.find(item => item.id === attempt.exerciseId);
    return question ? [{ p: question.prediction.pCorrect, y: Number(attempt.correct), purpose: question.purpose }] : [];
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
    byPurpose: (['diagnostic', 'practice', 'transfer', 'retention'] as const).map(purpose => {
      const items = observations.filter(item => item.purpose === purpose);
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
        if (this.data.version !== 1 || !Array.isArray(this.data.lessons) || !Array.isArray(this.data.attempts)) throw new Error('Unsupported data format.');
        this.data.settings = parseSettings(this.data.settings);
        for (const lesson of this.data.lessons) {
          if (lesson.predictionHash !== lessonHash(lesson)) throw new Error('A committed lesson has changed.');
          const artifact = JSON.parse(readFileSync(join(this.directory, 'plans', `${lesson.id}.json`), 'utf8')) as Lesson;
          if (artifact.predictionHash !== lesson.predictionHash || lessonHash(artifact) !== lesson.predictionHash) throw new Error('A plan artifact has changed.');
        }
      } catch (error) {
        throw new Error(`Could not read local history at ${this.file}. Nothing was reset. Check state.backup.json and restore a matching set of plan files. ${error instanceof Error ? error.message : ''}`);
      }
    } else {
      this.data = { version: 1, settings: { ...DEFAULT_SETTINGS }, lessons: [], attempts: [] };
      this.persist();
    }
  }

  snapshot(): StoreData { return structuredClone(this.data); }

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

  saveSettings(settings: Settings) { this.update({ ...this.data, settings: parseSettings(settings) }); }

  pendingQuestion() {
    const lesson = this.data.lessons.at(-1);
    if (!lesson) return null;
    const answered = new Set(this.data.attempts.filter(item => item.lessonId === lesson.id).map(item => item.exerciseId));
    return structuredClone(lesson.questions.find(item => !answered.has(item.id)) ?? null);
  }

  commitLesson(proposal: ProposedLesson & { reports: ValidationReport[] }, settings: Settings): Lesson {
    if (this.pendingQuestion()) throw new AppError('Finish the current lesson before starting another.', 409);
    if (proposal.questions.length !== proposal.reports.length) throw new Error('Missing exercise validation reports.');
    proposal = structuredClone(proposal);
    const lesson: Lesson = {
      id: randomUUID(), createdAt: new Date().toISOString(), provider: settings.provider, model: settings.model,
      tutorMode: settings.tutorMode, interests: settings.interests,
      objective: proposal.objective, rationale: proposal.rationale, assumptions: proposal.assumptions,
      reflection: proposal.reflection, hypotheses: proposal.hypotheses,
      questions: proposal.questions.map((question, index) => ({ ...question, id: randomUUID(), validation: proposal.reports[index] })),
      predictionHash: '',
    };
    lesson.predictionHash = lessonHash(lesson);
    const path = join(this.directory, 'plans', `${lesson.id}.json`);
    // Write the whole sealed plan before any question can be returned to a client.
    writeFileSync(path, JSON.stringify(lesson, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    chmodSync(path, 0o400);
    this.update({ ...this.data, lessons: [...this.data.lessons, lesson] });
    return structuredClone(lesson);
  }

  answer(exerciseId: string, answer: Verdict, elapsedMs: number): Review {
    if (!['buggy', 'correct'].includes(answer)) throw new AppError('Choose buggy or correct.');
    if (typeof exerciseId !== 'string' || !Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 86_400_000) throw new AppError('Invalid exercise response.');
    const existing = this.data.attempts.find(item => item.exerciseId === exerciseId);
    if (existing) {
      if (existing.answer !== answer) throw new AppError('This answer has already been recorded.', 409);
      return this.review(existing);
    }
    const current = this.pendingQuestion();
    if (!current || current.id !== exerciseId) throw new AppError('This exercise is no longer current. Refresh to continue.', 409);
    const lesson = this.data.lessons.at(-1)!;
    const attempt: Attempt = { id: randomUUID(), lessonId: lesson.id, exerciseId, answer,
      correct: answer === current.verdict, answeredAt: new Date().toISOString(), elapsedMs: Math.round(elapsedMs), flagged: false };
    this.update({ ...this.data, attempts: [...this.data.attempts, attempt] });
    return this.review(attempt);
  }

  flagAttempt(id: string, flagged: boolean) {
    if (typeof flagged !== 'boolean') throw new AppError('Choose whether this exercise should be excluded.');
    if (!this.data.attempts.some(item => item.id === id)) throw new AppError('Answer not found.', 404);
    this.update({ ...this.data, attempts: this.data.attempts.map(item => item.id === id ? { ...item, flagged } : item) });
  }

  private review(attempt: Attempt): Review {
    const lesson = this.data.lessons.find(item => item.id === attempt.lessonId)!;
    const question = lesson.questions.find(item => item.id === attempt.exerciseId)!;
    return structuredClone({ attempt, question, lessonObjective: lesson.objective, provider: lesson.provider });
  }

  context(): TutorContext {
    const history = this.data.lessons.map(lesson => ({ lesson, attempts: this.data.attempts.filter(item => item.lessonId === lesson.id && !item.flagged) }));
    if (this.data.settings.tutorMode === 'baseline') {
      return { settings: { ...this.data.settings }, history: [], hypotheses: [], metrics: calculateMetrics({ ...this.data, lessons: [], attempts: [] }) };
    }
    const hypotheses = this.data.lessons.at(-1)?.hypotheses ?? [];
    const evidence = new Set(hypotheses.flatMap(item => [...item.supportingAttemptIds, ...item.counterevidenceAttemptIds]));
    const selected = history.filter((item, index) => index >= history.length - 12 || item.attempts.some(attempt => evidence.has(attempt.id)));
    // Keep the archive intact while reserving room for instructions and repair.
    // Evidence dropped from the context is also removed from current hypotheses.
    while (selected.length > 1 && Buffer.byteLength(JSON.stringify(selected)) > 280_000) selected.shift();
    const knownIds = new Set(selected.flatMap(item => item.attempts.map(attempt => attempt.id)));
    return { settings: { ...this.data.settings }, history: structuredClone(selected),
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

  publicState(providers: ProviderStatus[], job: Job | null): AppState {
    const summaries: LessonSummary[] = this.data.lessons.map(lesson => {
      const answered = this.data.attempts.filter(item => item.lessonId === lesson.id).length;
      const complete = answered === lesson.questions.length;
      return { id: lesson.id, objective: lesson.objective, rationale: complete ? lesson.rationale : 'The tutor’s rationale is sealed until this lesson is complete, so it cannot give away the answers.', createdAt: lesson.createdAt,
        provider: lesson.provider, tutorMode: lesson.tutorMode, answered, total: lesson.questions.length, complete,
        reflection: complete ? lesson.reflection : null, assumptions: complete ? lesson.assumptions : [],
        hypotheses: complete ? lesson.hypotheses : [], predictionHash: lesson.predictionHash };
    });
    const current = this.pendingQuestion();
    return structuredClone({ settings: this.data.settings, providers, job,
      currentLesson: summaries.at(-1) ?? null,
      question: current ? { id: current.id, title: current.title, specification: current.specification, code: current.code,
        purpose: current.purpose, testCount: current.validation.testCount } : null,
      lessons: [...summaries].reverse(), reviews: [...this.data.attempts].reverse().map(item => this.review(item)),
      hypotheses: summaries.filter(item => item.complete).at(-1)?.hypotheses ?? [],
      metrics: calculateMetrics(this.data, this.data.settings), dataDirectory: this.directory });
  }
}
