import type { Attempt, ConceptRecord, ConceptUpdate, CurriculumMemory, Exercise, Lesson, StoreData, VariantRecord } from '../src/types.ts';

interface LinkedAttempt {
  attempt: Attempt;
  lesson: Lesson;
  question: Exercise;
  conceptIds: Set<string>;
}

function blankConcept(id: string): ConceptRecord {
  return {
    id, name: id, description: 'This concept appears in an archived exercise plan; no description was recorded.',
    representations: [], prerequisiteIds: [], familiarity: 'unknown', evidenceAttemptIds: [],
    uncertainty: 'No learner familiarity has been established.', nextProbe: '',
    exposures: 0, correctJudgments: 0, incorrectJudgments: 0, uncertainJudgments: 0,
    lastSeenAt: null, evidence: [],
  };
}

function latestTime(previous: string | null, next: string): string {
  return previous === null || Date.parse(next) > Date.parse(previous) ? next : previous;
}

function summarizeEvidence(evidence: LinkedAttempt[], cited: Set<string>, familiar: boolean): ConceptRecord['evidence'] {
  const recent = [...evidence].sort((a, b) => Date.parse(b.attempt.answeredAt) - Date.parse(a.attempt.answeredAt));
  // Recent mistakes and IDK responses must remain visible even when an older
  // assessment cites many successes. Reserve half the summary for recency.
  const selected = new Map(recent.slice(0, 3).map(item => [item.attempt.id, item]));
  const correctCitations = recent.filter(item => cited.has(item.attempt.id) && item.attempt.correct === true);
  if (familiar) {
    const supporting = () => [...selected.values()].filter(item => cited.has(item.attempt.id) && item.attempt.correct === true);
    if (!supporting().length && correctCitations.length) selected.set(correctCitations[0].attempt.id, correctCitations[0]);
    const supportedLessons = new Set(supporting().map(item => item.lesson.id));
    if (supportedLessons.size < 2) {
      const anotherLesson = correctCitations.find(item => !supportedLessons.has(item.lesson.id));
      if (anotherLesson) selected.set(anotherLesson.attempt.id, anotherLesson);
    }
    for (const item of correctCitations) {
      if (supporting().length >= 3) break;
      selected.set(item.attempt.id, item);
    }
  }
  for (const item of [...recent.filter(item => cited.has(item.attempt.id)), ...recent]) {
    if (selected.size >= 6) break;
    selected.set(item.attempt.id, item);
  }
  return [...selected.values()].sort((a, b) => Date.parse(b.attempt.answeredAt) - Date.parse(a.attempt.answeredAt))
    .map(({ attempt, lesson, question }) => ({
      attemptId: attempt.id, lessonId: lesson.id, title: question.title,
      answer: attempt.answer, correct: attempt.correct, answeredAt: attempt.answeredAt,
    }));
}

/** Rebuild learner memory from the sealed archive, independently of prompt-history limits. */
export function buildCurriculumMemory(data: StoreData): CurriculumMemory {
  if (data.settings.tutorMode === 'baseline') return { concepts: [], variants: [], legacyLessons: [] };

  const lessons = new Map(data.lessons.map(lesson => [lesson.id, lesson]));
  const linked = new Map<string, LinkedAttempt>();
  const answeredQuestions = new Set<string>();
  for (const attempt of data.attempts) {
    const lesson = lessons.get(attempt.lessonId);
    const question = lesson?.questions.find(item => item.id === attempt.exerciseId);
    // A dangling or inconsistent answer must never establish competence. Flagged
    // answers remain here solely to preserve the fact that an exercise was seen.
    if (!lesson || !question || !attempt.id || linked.has(attempt.id)
      || !['buggy', 'correct', 'idk'].includes(attempt.answer)
      || attempt.correct !== (attempt.answer === 'idk' ? null : attempt.answer === question.verdict)
      || !Number.isFinite(Date.parse(attempt.answeredAt))) continue;
    const key = JSON.stringify([lesson.id, question.id]);
    if (answeredQuestions.has(key)) continue;
    answeredQuestions.add(key);
    linked.set(attempt.id, { attempt, lesson, question, conceptIds: new Set(question.plan?.conceptIds ?? []) });
  }

  const concepts = new Map<string, ConceptRecord>();
  const variants = new Map<string, VariantRecord>();
  const latestUpdates = new Map<string, ConceptUpdate>();
  const reflectiveConcepts = new Set<string>();
  const ensureConcept = (id: string) => {
    if (!concepts.has(id)) concepts.set(id, blankConcept(id));
    return concepts.get(id)!;
  };

  for (const lesson of data.lessons) {
    for (const update of lesson.curriculum?.conceptUpdates ?? []) {
      const record = ensureConcept(update.id);
      // Baseline plans see an empty learner context. Their fresh priors can
      // define new concepts but cannot erase an existing reflective assessment.
      if (lesson.tutorMode !== 'baseline' || !reflectiveConcepts.has(update.id)) {
        Object.assign(record, structuredClone(update));
        latestUpdates.set(update.id, update);
      }
      if (lesson.tutorMode !== 'baseline') reflectiveConcepts.add(update.id);
      for (const attemptId of update.evidenceAttemptIds) {
        const item = linked.get(attemptId);
        // Legacy plans have no concept IDs. Later, explicit evidence references
        // can associate their real answers without rewriting those sealed plans.
        if (item && !item.question.plan) item.conceptIds.add(update.id);
      }
    }
    for (const question of lesson.questions) {
      const plan = question.plan;
      if (!plan) continue;
      plan.conceptIds.forEach(ensureConcept);
      const previous = variants.get(plan.familyId);
      variants.set(plan.familyId, {
        familyId: plan.familyId,
        conceptIds: [...new Set([...(previous?.conceptIds ?? []), ...plan.conceptIds])],
        title: question.title, counterpart: plan.counterpart, reason: plan.variantReason,
        askedCount: previous?.askedCount ?? 0, lastAskedAt: previous?.lastAskedAt ?? null,
        askedVerdicts: [], counterpartStatus: plan.counterpart === 'defer' ? 'deferred' : 'unasked',
      });
    }
  }

  const evidenceByConcept = new Map<string, LinkedAttempt[]>();
  const answeredByLesson = new Map<string, number>();
  for (const item of linked.values()) {
    const { attempt, question } = item;
    answeredByLesson.set(attempt.lessonId, (answeredByLesson.get(attempt.lessonId) ?? 0) + 1);
    if (question.plan) {
      const variant = variants.get(question.plan.familyId)!;
      variant.askedCount += 1;
      variant.lastAskedAt = latestTime(variant.lastAskedAt, attempt.answeredAt);
      if (!variant.askedVerdicts!.includes(question.verdict)) variant.askedVerdicts!.push(question.verdict);
      if (variant.askedVerdicts!.includes('correct') && variant.askedVerdicts!.includes('buggy')) variant.counterpartStatus = 'shown';
    }
    for (const id of item.conceptIds) {
      const record = ensureConcept(id);
      record.exposures += 1;
      record.lastSeenAt = latestTime(record.lastSeenAt, attempt.answeredAt);
      if (attempt.flagged) continue;
      if (attempt.answer === 'idk') record.uncertainJudgments += 1;
      else if (attempt.correct) record.correctJudgments += 1;
      else record.incorrectJudgments += 1;
      const evidence = evidenceByConcept.get(id) ?? [];
      evidence.push(item);
      evidenceByConcept.set(id, evidence);
    }
  }

  for (const record of concepts.values()) {
    const latest = latestUpdates.get(record.id);
    record.evidenceAttemptIds = [...new Set(latest?.evidenceAttemptIds ?? [])].filter(id => {
      const item = linked.get(id);
      return item && !item.attempt.flagged && item.conceptIds.has(record.id);
    });
    const cited = new Set(record.evidenceAttemptIds);
    const evidence = evidenceByConcept.get(record.id) ?? [];
    const correctCitations = evidence.filter(item => cited.has(item.attempt.id) && item.attempt.correct === true);
    const supportsFamiliarity = correctCitations.length >= 3 && new Set(correctCitations.map(item => item.lesson.id)).size >= 2;

    // Exposure establishes introduction, never competence. In particular, IDK
    // and excluded answers cannot sustain a previous claim of familiarity.
    if (!record.exposures) record.familiarity = 'unknown';
    else if (record.familiarity === 'familiar' && !supportsFamiliarity) record.familiarity = correctCitations.length ? 'developing' : 'introduced';
    else if (record.familiarity === 'developing' && !record.correctJudgments) record.familiarity = 'introduced';

    record.evidence = summarizeEvidence(evidence, cited, record.familiarity === 'familiar');
  }

  return {
    concepts: [...concepts.values()], variants: [...variants.values()],
    legacyLessons: data.lessons.filter(lesson => !lesson.curriculum).map(lesson => ({
      lessonId: lesson.id, objective: lesson.objective, answered: answeredByLesson.get(lesson.id) ?? 0,
    })),
  };
}
