export type ProviderId = 'codex' | 'opencode' | 'demo';
export type Language = 'javascript' | 'python';
export type Verdict = 'buggy' | 'correct';
export type Answer = Verdict | 'idk';
export const PURPOSES = ['diagnostic', 'practice', 'transfer', 'retention', 'introduction', 'frontier', 'robustness', 'calibration', 'strategy-evaluation'] as const;
export type Purpose = typeof PURPOSES[number];
export interface SkillUse {
  conceptId: string;
  role: 'target' | 'exercised' | 'incidental';
  support: 'independent' | 'scaffolded';
  ifCorrect: 'supports' | 'inconclusive';
  ifIncorrect: 'challenges' | 'inconclusive';
  rationale: string;
}
export interface SkillRetrofit {
  id: string;
  createdAt: string;
  method: string;
  archiveHash: string;
  concepts: Pick<ConceptUpdate, 'id' | 'name' | 'description' | 'representations' | 'prerequisiteIds'>[];
  questions: { lessonId: string; exerciseId: string; predictionHash: string; uses: SkillUse[]; note: string }[];
}
export interface SkillEvidence {
  role: SkillUse['role'];
  support: SkillUse['support'];
  source: 'planned' | 'retrospective' | 'legacy';
  signal: 'supports' | 'challenges' | 'inconclusive';
  rationale: string;
}
export interface ConceptUpdate {
  id: string;
  name: string;
  description: string;
  representations: string[];
  prerequisiteIds: string[];
  familiarity: 'unknown' | 'introduced' | 'developing' | 'familiar';
  evidenceAttemptIds: string[];
  uncertainty: string;
  nextProbe: string;
}
export interface QuestionPlan {
  purposes: Purpose[];
  educationalObjective: string;
  investigativeObjective: string;
  conceptIds: string[];
  prerequisiteIds: string[];
  stage: 'warmup' | 'build' | 'stretch' | 'consolidate';
  // Absent only in sealed questions from before skill attribution.
  skillUses?: SkillUse[];
  cognitiveDemand: number;
  difficultyRationale: string;
  scaffolding: string;
  ifIdk: string;
  familyId: string;
  counterpart: 'in-lesson' | 'defer' | 'unasked';
  variantReason: string;
}
export interface LearningObservation {
  attemptIds: string[];
  conceptIds: string[];
  observation: string;
  interpretation: string;
  nextAction: string;
}
export interface CurriculumPlan {
  conceptUpdates: ConceptUpdate[];
  observations: LearningObservation[];
  frontier: { conceptId: string; reason: string; decision: 'introduce' | 'defer' | 'explore' }[];
  mixRationale: string;
  sequenceRationale: string;
}
export interface ConceptRecord extends ConceptUpdate {
  exposures: number;
  correctJudgments: number;
  incorrectJudgments: number;
  uncertainJudgments: number;
  lastSeenAt: string | null;
  practice?: {
    targeted: number; exercised: number; incidental: number;
    supporting: number; challenging: number; inconclusive: number;
    lastTargetedAt: string | null; lastExercisedAt: string | null; lastIndependentSuccessAt: string | null;
  };
  languagePractice?: Partial<Record<Language, { exposures: number; supporting: number; challenging: number }>>;
  evidence: ({ attemptId: string; lessonId: string; title: string; answer: Answer; correct: boolean | null; answeredAt: string; language?: Language } & Partial<SkillEvidence>)[];
}
export interface VariantRecord {
  familyId: string;
  conceptIds: string[];
  title: string;
  counterpart: QuestionPlan['counterpart'];
  reason: string;
  askedCount: number;
  lastAskedAt: string | null;
  askedVerdicts?: Verdict[];
  counterpartStatus?: 'deferred' | 'unasked' | 'shown';
}
export interface CurriculumMemory {
  concepts: ConceptRecord[];
  variants: VariantRecord[];
  legacyLessons: { lessonId: string; objective: string; answered: number }[];
}
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface Settings {
  // Missing only in notebooks created before language selection.
  language?: Language;
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
export interface FunctionSignature { name: string; parameters: string[] }
export interface ProposedQuestion {
  // New questions use positional argument tuples in tests[].input.
  // Sealed legacy questions omit this and still call solve(input).
  signature?: FunctionSignature;
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
  // Optional only for reading sealed lessons created before curriculum planning.
  plan?: QuestionPlan;
}
export interface ProposedLesson {
  objective: string;
  rationale: string;
  assumptions: string[];
  reflection: string;
  hypotheses: Hypothesis[];
  questions: ProposedQuestion[];
  curriculum?: CurriculumPlan;
}
export interface ValidationReport {
  checkedAt: string;
  testCount: number;
  passedCount: number;
  failures: { input: JsonValue; expected: JsonValue; actual: JsonValue | null; error: string | null }[];
}
export interface Exercise extends ProposedQuestion { id: string; validation: ValidationReport }
export interface Lesson extends Omit<ProposedLesson, 'questions'> {
  // Missing means JavaScript for sealed lessons created before language selection.
  language?: Language;
  id: string;
  createdAt: string;
  provider: ProviderId;
  model: string;
  tutorMode: Settings['tutorMode'];
  interests: string;
  questions: Exercise[];
  predictionHash: string;
  focus?: { conceptId: string; parentLessonId: string };
}
export interface GuideConcept { id: string; name: string; description: string }
export interface ConceptGuide {
  language?: Language;
  conceptId: string;
  version: string;
  createdAt: string;
  title: string;
  description: string;
  examples: { expression: string; mode?: 'expression' | 'statements'; result: JsonValue; explanation: string }[];
  takeaway: string;
  links: { title: string; url: string }[];
}
export interface GuideEvent {
  language?: Language;
  id: string;
  conceptId: string;
  version: string | null;
  lessonId: string | null;
  at: string;
  action: 'opened' | 'finished' | 'familiar' | 'unclear';
}
export interface Attempt {
  id: string;
  lessonId: string;
  exerciseId: string;
  answer: Answer;
  correct: boolean | null;
  answeredAt: string;
  elapsedMs: number;
  flagged: boolean;
  exclusionReason?: 'accidental-input' | 'flawed-question';
}
export interface ReviewSession {
  id: string;
  attemptId: string;
  openedAt: string;
  updatedAt: string;
  activeMs: number;
  closed: boolean;
}
export interface LessonFeedback {
  lessonId: string;
  text: string;
  accidentalAttemptIds: string[];
  updatedAt: string;
}
export interface ProposedDiscussion {
  reflection: string;
  questions: string[];
}
export interface DiscussionQuestion {
  id: string;
  text: string;
  answer: string | null;
  skipped: boolean;
}
export interface Discussion {
  id: string;
  lessonId: string;
  createdAt: string;
  provider: ProviderId;
  model: string;
  feedbackText: string;
  reflection: string;
  questions: DiscussionQuestion[];
  repliedAt?: string;
}
export interface DiscussionContext {
  tutor: TutorContext;
  lesson: Lesson;
  attempts: Attempt[];
  feedback: LessonFeedback | null;
  discussions: Discussion[];
}
export interface StoreData {
  version: 1;
  settings: Settings;
  lessons: Lesson[];
  attempts: Attempt[];
  reviewSessions?: ReviewSession[];
  feedback?: LessonFeedback[];
  discussions?: Discussion[];
  skillRetrofits?: SkillRetrofit[];
  presentationRevisions?: PresentationRevision[];
  activeLessonId?: string;
  startedLessonIds?: string[];
  endedFocusIds?: string[];
  guides?: ConceptGuide[];
  guideEvents?: GuideEvent[];
}
export interface PresentationRevision {
  id: string;
  createdAt: string;
  archiveHash: string;
  method: string;
  questions: {
    lessonId: string;
    exerciseId: string;
    predictionHash: string;
    signature: FunctionSignature;
    // null passes the entire legacy input; a string selects an object field.
    parameterSources: (string | null)[];
    specification: string;
    code: string;
    referenceCode: string;
    note: string;
  }[];
}
export interface ProviderStatus { id: ProviderId; available: boolean; version: string; detail: string }
export interface TutorContext {
  settings: Settings;
  history: { lesson: Lesson; attempts: Attempt[] }[];
  hypotheses: Hypothesis[];
  metrics: Metrics;
  reviewSessions?: ReviewSession[];
  feedback?: LessonFeedback[];
  discussions?: Discussion[];
  curriculum?: CurriculumMemory;
  skillRetrofits?: SkillRetrofit[];
  repair?: string[];
  draft?: ProposedLesson;
  focus?: { concept: GuideConcept; parentLessonId: string; avoidQuestions?: ProposedQuestion[] };
  guideEvents?: GuideEvent[];
  focusHistory?: { lessonId: string; parentLessonId: string; conceptId: string; language?: Language; answered: number; total: number; endedEarly: boolean }[];
}
export interface Job {
  id: string;
  status: 'running' | 'ready' | 'error' | 'cancelled';
  stage: string;
  startedAt: string;
  message: string;
  kind?: 'lesson' | 'discussion' | 'guide' | 'focus';
  lessonId?: string;
  conceptId?: string;
  language?: Language;
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
  language?: Language;
  id: string;
  title: string;
  specification: string;
  code: string;
  purpose: Purpose;
  testCount: number;
}
export interface Review {
  language?: Language;
  attempt: Attempt;
  question: Exercise;
  lessonObjective: string;
  provider: ProviderId;
  originalPresentation?: Pick<Exercise, 'specification' | 'code' | 'referenceCode'>;
  relatedConcepts?: GuideConcept[];
  teachingBeforeAnswer?: string[];
}
export interface LessonSummary {
  language?: Language;
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
  feedback?: LessonFeedback;
  curriculum?: CurriculumPlan;
  focus?: Lesson['focus'];
  endedEarly?: boolean;
}
export interface AppState {
  languages?: { id: Language; available: boolean; detail: string }[];
  settings: Settings;
  providers: ProviderStatus[];
  job: Job | null;
  currentLesson: LessonSummary | null;
  lessonPreview?: GuideConcept[];
  guides?: ConceptGuide[];
  question: PublicQuestion | null;
  lessons: LessonSummary[];
  reviews: Review[];
  hypotheses: Hypothesis[];
  metrics: Metrics;
  dataDirectory: string;
  reviewSessions: ReviewSession[];
  feedback: LessonFeedback[];
  discussions: Discussion[];
}
