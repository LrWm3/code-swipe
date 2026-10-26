export type ProviderId = 'codex' | 'opencode' | 'demo';
export type Verdict = 'buggy' | 'correct';
export type Purpose = 'diagnostic' | 'practice' | 'transfer' | 'retention';
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface Settings {
  provider: ProviderId;
  model: string;
  interests: string;
  batchSize: number;
  tutorMode: 'reflective' | 'baseline';
}
export interface Hypothesis {
  id: string;
  claim: string;
  status: 'tentative' | 'supported' | 'contradicted';
  supportingAttemptIds: string[];
  counterevidenceAttemptIds: string[];
  alternatives: string[];
  nextProbe: string;
}
export interface TestCase { input: JsonValue; expected: JsonValue; note: string }
export interface ProposedQuestion {
  title: string;
  specification: string;
  code: string;
  referenceCode: string;
  verdict: Verdict;
  explanation: string;
  tests: TestCase[];
  purpose: Purpose;
  hypothesisId: string | null;
  ifCorrect: string;
  ifIncorrect: string;
  prediction: { pCorrect: number; rationale: string };
}
export interface ProposedLesson {
  objective: string;
  rationale: string;
  assumptions: string[];
  reflection: string;
  hypotheses: Hypothesis[];
  questions: ProposedQuestion[];
}
export interface ValidationReport {
  checkedAt: string;
  testCount: number;
  passedCount: number;
  failures: { input: JsonValue; expected: JsonValue; actual: JsonValue | null; error: string | null }[];
}
export interface Exercise extends ProposedQuestion { id: string; validation: ValidationReport }
export interface Lesson extends Omit<ProposedLesson, 'questions'> {
  id: string;
  createdAt: string;
  provider: ProviderId;
  model: string;
  tutorMode: Settings['tutorMode'];
  interests: string;
  questions: Exercise[];
  predictionHash: string;
}
export interface Attempt {
  id: string;
  lessonId: string;
  exerciseId: string;
  answer: Verdict;
  correct: boolean;
  answeredAt: string;
  elapsedMs: number;
  flagged: boolean;
}
export interface StoreData {
  version: 1;
  settings: Settings;
  lessons: Lesson[];
  attempts: Attempt[];
}
export interface ProviderStatus { id: ProviderId; available: boolean; version: string; detail: string }
export interface TutorContext {
  settings: Settings;
  history: { lesson: Lesson; attempts: Attempt[] }[];
  hypotheses: Hypothesis[];
  metrics: Metrics;
  repair?: string[];
  draft?: ProposedLesson;
}
export interface Job {
  id: string;
  status: 'running' | 'ready' | 'error' | 'cancelled';
  stage: string;
  startedAt: string;
  message: string;
}
export interface CalibrationBin { label: string; count: number; predicted: number | null; actual: number | null }
export interface Metrics {
  count: number;
  brier: number | null;
  accuracy: number | null;
  calibration: CalibrationBin[];
  byPurpose: { purpose: Purpose; count: number; accuracy: number | null }[];
}
export interface PublicQuestion {
  id: string;
  title: string;
  specification: string;
  code: string;
  purpose: Purpose;
  testCount: number;
}
export interface Review {
  attempt: Attempt;
  question: Exercise;
  lessonObjective: string;
  provider: ProviderId;
}
export interface LessonSummary {
  id: string;
  objective: string;
  rationale: string;
  createdAt: string;
  provider: ProviderId;
  tutorMode: Settings['tutorMode'];
  answered: number;
  total: number;
  complete: boolean;
  // Assumptions, hypotheses and predictions only become visible after the lesson.
  reflection: string | null;
  assumptions: string[];
  hypotheses: Hypothesis[];
  predictionHash: string;
}
export interface AppState {
  settings: Settings;
  providers: ProviderStatus[];
  job: Job | null;
  currentLesson: LessonSummary | null;
  question: PublicQuestion | null;
  lessons: LessonSummary[];
  reviews: Review[];
  hypotheses: Hypothesis[];
  metrics: Metrics;
  dataDirectory: string;
}
