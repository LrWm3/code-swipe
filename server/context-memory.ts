import type { ConceptRecord, ContextPractice, CurriculumMemory, SkillEvidence, StoreData } from '../src/types.ts';
import { questionContext, questionLanguage } from '../src/learning-contexts.ts';
import { buildKnowledgeGraph, canonicalId } from './knowledge-graph.ts';
import { familiaritySupport, independentSupport, interpretSkill, questionSkills } from './skill-evidence.ts';
import { componentIds, knowledgeKind } from '../src/knowledge-organization.ts';

const later = (left: string | null, right: string) => left === null || Date.parse(right) > Date.parse(left) ? right : left;
const emptyPractice = () => ({ targeted: 0, exercised: 0, incidental: 0, supporting: 0, challenging: 0, inconclusive: 0, lastTargetedAt: null, lastExercisedAt: null, lastIndependentSuccessAt: null });

export function contextualizeMemory(data: StoreData, legacy: CurriculumMemory): CurriculumMemory {
  const graph = buildKnowledgeGraph(data);
  const resolve = (id: string) => canonicalId(id, graph.aliases);
  const records = new Map<string, ConceptRecord>();
  for (const definition of graph.concepts) {
    const id = resolve(definition.id);
    if (id !== definition.id) continue;
    records.set(id, { ...definition, definition, prerequisiteIds: graph.relationships.filter(edge => edge.active && edge.kind === 'prerequisite' && resolve(edge.toId) === id).map(edge => resolve(edge.fromId)),
      familiarity: 'unknown', uncertainty: 'Understanding has not been established in any context.', nextProbe: 'Choose a focused probe in a relevant context.', evidenceAttemptIds: [],
      exposures: 0, correctJudgments: 0, incorrectJudgments: 0, uncertainJudgments: 0, lastSeenAt: null, practice: emptyPractice(), contextPractice: Object.create(null), evidence: [] });
  }
  const old = new Map(legacy.concepts.map(item => [item.id, item]));
  const assessments = new Map(data.lessons.filter(lesson => lesson.tutorMode !== 'baseline').flatMap(lesson => lesson.curriculum?.knowledge?.assessments ?? [])
    .map(item => [`${resolve(item.conceptId)}\0${item.contextId}`, item]));
  const retrofits = new Map((data.skillRetrofits ?? []).flatMap(review => review.questions.map(item => [item.exerciseId, item] as const)));
  const seen = new Set<string>();
  const allEvidence = new Map<string, ConceptRecord['evidence']>();
  for (const attempt of data.attempts) {
    const lesson = data.lessons.find(item => item.id === attempt.lessonId);
    const question = lesson?.questions.find(item => item.id === attempt.exerciseId);
    if (!lesson || !question || seen.has(question.id) || !attempt.id || !Number.isFinite(Date.parse(attempt.answeredAt)) || !['correct', 'buggy', 'idk'].includes(attempt.answer)
      || attempt.correct !== (attempt.answer === 'idk' ? null : attempt.answer === question.verdict)) continue;
    seen.add(question.id);
    const retrofit = retrofits.get(question.id);
    const uses = questionSkills(question, retrofit?.predictionHash === lesson.predictionHash ? retrofit : undefined);
    // An explicit historical citation preserves a legacy association, not invented competence.
    if (!question.plan) for (const concept of legacy.concepts) {
      if (concept.evidence.some(item => item.attemptId === attempt.id) && !uses.some(item => item.use.conceptId === concept.id)) uses.push({ use: { conceptId: concept.id, role: 'target', support: 'scaffolded', ifCorrect: 'inconclusive', ifIncorrect: 'inconclusive', rationale: 'Legacy retrospective association.' }, source: 'legacy' });
    }
    const interpreted = new Map<string, { id: string; contextId: string; skill: SkillEvidence }>();
    for (const { use, source } of uses) {
      const id = resolve(use.conceptId), contextId = use.contextId ?? questionContext(question, lesson);
      const key = `${id}\0${contextId}`;
      const skill: SkillEvidence = { ...interpretSkill(use, source, attempt), contextId, verification: question.validation.verification?.status ?? 'executed' };
      const previous = interpreted.get(key);
      if (previous) {
        // Two historical aliases are one observation. Conflicting attributions remain inconclusive.
        if (previous.skill.signal !== skill.signal) previous.skill.signal = 'inconclusive';
        if (skill.support === 'scaffolded') previous.skill.support = 'scaffolded';
        if (skill.role === 'target') previous.skill.role = 'target';
      } else interpreted.set(key, { id, contextId, skill });
    }
    const countedConcepts = new Set<string>();
    for (const { id, contextId, skill } of interpreted.values()) {
      const record = records.get(id);
      if (!record) continue;
      const practice: ContextPractice = record.contextPractice![contextId] ??= { conceptId: id, contextId, familiarity: 'unknown', evidenceAttemptIds: [], uncertainty: 'No assessment has been made in this context.', nextProbe: 'Probe this context without assuming transfer.', exposures: 0, ...emptyPractice(), uncertainJudgments: 0, lastSeenAt: null, evidence: [] };
      practice.exposures++; practice.lastSeenAt = later(practice.lastSeenAt, attempt.answeredAt);
      if (!countedConcepts.has(id)) { record.exposures++; record.lastSeenAt = later(record.lastSeenAt, attempt.answeredAt); countedConcepts.add(id); }
      if (attempt.flagged) continue;
      practice[skill.role === 'target' ? 'targeted' : skill.role]++;
      practice[skill.signal === 'supports' ? 'supporting' : skill.signal === 'challenges' ? 'challenging' : 'inconclusive']++;
      if (skill.role === 'target') practice.lastTargetedAt = later(practice.lastTargetedAt, attempt.answeredAt);
      if (skill.role !== 'incidental' && skill.source !== 'legacy') practice.lastExercisedAt = later(practice.lastExercisedAt, attempt.answeredAt);
      if (independentSupport(skill)) practice.lastIndependentSuccessAt = later(practice.lastIndependentSuccessAt, attempt.answeredAt);
      if (attempt.answer === 'idk') practice.uncertainJudgments++;
      const evidence = { attemptId: attempt.id, lessonId: lesson.id, title: question.title, answer: attempt.answer, correct: attempt.correct, answeredAt: attempt.answeredAt, language: questionLanguage(question, lesson), ...skill };
      const list = allEvidence.get(`${id}\0${contextId}`) ?? [];
      list.push(evidence); allEvidence.set(`${id}\0${contextId}`, list);
    }
  }
  for (const record of records.values()) {
    const uniqueEvidence = new Map<string, ConceptRecord['evidence'][number]>();
    for (const [contextId, practice] of Object.entries(record.contextPractice!)) {
      const evidence = (allEvidence.get(`${record.id}\0${contextId}`) ?? []).sort((a, b) => Date.parse(b.answeredAt) - Date.parse(a.answeredAt));
      const assessment = assessments.get(`${record.id}\0${contextId}`);
      const legacyAssessments = [...old.values()].filter(item => resolve(item.id) === record.id);
      const cited = new Set(assessment?.evidenceAttemptIds ?? legacyAssessments.flatMap(item => item.evidenceAttemptIds));
      practice.evidenceAttemptIds = evidence.filter(item => cited.has(item.attemptId)).map(item => item.attemptId);
      const supporting = evidence.filter(item => cited.has(item.attemptId) && familiaritySupport(item));
      const wantsFamiliar = assessment?.familiarity === 'familiar' || (!assessment && legacyAssessments.some(item => item.familiarity === 'familiar'));
      practice.familiarity = wantsFamiliar && supporting.length >= 3 && new Set(supporting.map(item => item.lessonId)).size >= 2 ? 'familiar'
        : practice.supporting ? 'developing' : practice.exposures ? 'introduced' : 'unknown';
      practice.uncertainty = assessment?.uncertainty ?? 'Evidence is specific to this context; transfer to another remains untested.';
      practice.nextProbe = assessment?.nextProbe ?? 'Use a focused or embedded probe where understanding remains uncertain.';
      // Reserve recency and supporting citations so old successes cannot hide new challenges.
      const selected = new Map(evidence.slice(0, 3).map(item => [item.attemptId, item]));
      const candidates = [...new Map([...supporting, ...evidence.filter(familiaritySupport)].map(item => [item.attemptId, item])).values()];
      const selectedSupport = () => [...selected.values()].filter(familiaritySupport);
      if (candidates[0] && selected.size < 6) selected.set(candidates[0].attemptId, candidates[0]);
      const otherLesson = candidates.find(item => !new Set(selectedSupport().map(entry => entry.lessonId)).has(item.lessonId));
      if (otherLesson && selected.size < 6) selected.set(otherLesson.attemptId, otherLesson);
      for (const item of candidates) if (selectedSupport().length < 3 && selected.size < 6) selected.set(item.attemptId, item);
      for (const predicate of [independentSupport, (item: ConceptRecord['evidence'][number]) => item.signal === 'challenges', (item: ConceptRecord['evidence'][number]) => item.role === 'target']) {
        const item = evidence.find(predicate); if (item && selected.size < 6) selected.set(item.attemptId, item);
      }
      for (const item of [...supporting, ...evidence]) if (selected.size < 6) selected.set(item.attemptId, item);
      practice.evidence = [...selected.values()];
      for (const item of evidence) uniqueEvidence.set(item.attemptId, item);
      for (const name of ['targeted', 'exercised', 'incidental', 'supporting', 'challenging', 'inconclusive'] as const) record.practice![name] += practice[name];
      for (const name of ['lastTargetedAt', 'lastExercisedAt', 'lastIndependentSuccessAt'] as const) if (practice[name]) record.practice![name] = later(record.practice![name], practice[name]);
    }
    const evidence = [...uniqueEvidence.values()];
    record.correctJudgments = evidence.filter(item => item.correct === true).length;
    record.incorrectJudgments = evidence.filter(item => item.correct === false).length;
    record.uncertainJudgments = evidence.filter(item => item.correct === null).length;
    record.evidence = Object.values(record.contextPractice!).flatMap(item => item.evidence);
    record.evidenceAttemptIds = [...new Set(Object.values(record.contextPractice!).flatMap(item => item.evidenceAttemptIds))];
    // Legacy field is encounter compatibility only; contextual assessments are authoritative.
    record.familiarity = record.practice!.supporting ? 'developing' : record.exposures ? 'introduced' : 'unknown';
    record.summary = Object.values(record.contextPractice!).map(item => `${graph.contexts.find(context => context.id === item.contextId)?.name ?? item.contextId}: ${item.familiarity}`).join('; ') || 'No answered evidence yet.';
    const members = new Set(componentIds(graph, record.id).filter(id => id !== record.id));
    if (members.size || knowledgeKind(record.definition!) === 'topic') {
      const attempts = new Map<string, ConceptRecord['evidence'][number]>();
      const coveredIds = new Set<string>();
      for (const id of members) for (const [key, values] of allEvidence) if (key.startsWith(`${id}\0`)) for (const item of values) {
        if (item.role === 'incidental' || item.source === 'legacy') continue;
        attempts.set(item.attemptId, item); coveredIds.add(id);
      }
      const evidence = [...attempts.values()];
      record.coverage = { recordIds: [...coveredIds], answered: evidence.length, contextIds: [...new Set(evidence.map(item => item.contextId!))], lastSeenAt: evidence.reduce<string | null>((at, item) => later(at, item.answeredAt), null) };
      if (!record.exposures) record.summary = evidence.length ? `${evidence.length} answered cards across ${coveredIds.size} related records; no direct assessment.` : 'No related practice yet.';
    }
  }
  return { ...legacy, concepts: [...records.values()], variants: legacy.variants.map(item => ({ ...item, conceptIds: [...new Set(item.conceptIds.map(resolve))] })) };
}
