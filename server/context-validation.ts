import type { ConceptUpdate, KnowledgeGraph, ProposedLesson, TutorContext } from '../src/types.ts';
import { canonicalId, canonicalizeProposal, validateKnowledgePlan } from './knowledge-graph.ts';
import { contextualCurriculumSchema, contextualQuestionPlanSchema, validateSchema } from './prompts.ts';
import { executionEnvironments } from './environments.ts';
import { contextIsExcluded, isLanguage, questionContext } from '../src/learning-contexts.ts';
import { familiaritySupport } from './skill-evidence.ts';
import { knowledgeKind } from '../src/knowledge-organization.ts';

export function prepareContextualLesson(lesson: ProposedLesson, context: TutorContext): { lesson: ProposedLesson; graph: KnowledgeGraph } {
  validateSchema(lesson.curriculum, contextualCurriculumSchema, 'curriculum');
  const graph = validateKnowledgePlan(lesson.curriculum!.knowledge!, context);
  return { lesson: canonicalizeProposal(lesson, graph), graph };
}

export function validateContextualQuestions(lesson: ProposedLesson, context: TutorContext, graph: KnowledgeGraph): void {
  const contexts = new Set(graph.contexts.map(item => item.id));
  const definitions = new Set(graph.concepts.map(item => canonicalId(item.id, graph.aliases)));
  const usedContexts = new Set<string>();
  const environments = context.environments ?? executionEnvironments();
  for (const [index, question] of lesson.questions.entries()) {
    const at = `questions[${index}]`;
    if (!question.contextId || !contexts.has(question.contextId)) throw new Error(`${at}.contextId needs an existing context.`);
    if (contextIsExcluded(question.contextId, graph.contexts, context.settings.excludedContexts)) throw new Error(`${at} targets an excluded context or specialization.`);
    if (context.focus?.contextId && question.contextId !== context.focus.contextId) throw new Error(`${at} focused practice must keep its selected context.`);
    usedContexts.add(question.contextId);
    if (!['code-review', 'answer-review'].includes(question.kind)) throw new Error(`${at}.kind needs code-review or answer-review.`);
    validateSchema(question.plan, contextualQuestionPlanSchema, `${at}.plan`);
    for (const use of question.plan!.skillUses!) {
      if (!contexts.has(use.contextId!) || !definitions.has(use.conceptId)) throw new Error(`${at} has an unknown skill context or concept.`);
      // A context on a dependency is not evidence in that context. It must actually be on the card.
      if (use.contextId !== question.contextId) throw new Error(`${at} skill contexts must describe this card's actual primary context; use a separate transfer card for another context.`);
      const definition = graph.concepts.find(item => item.id === use.conceptId)!;
      if (knowledgeKind(definition) === 'topic') throw new Error(`${at} cannot assess a grouping topic; attribute evidence to an actual concept, technique, skill, or representation.`);
      if (definition.scope === 'context-specific' && !definition.contextIds.some(scope => contextIsExcluded(use.contextId!, graph.contexts, [scope]))) throw new Error(`${at} uses a context-specific concept outside its defining context or a specialization.`);
    }
    const verification = question.verification;
    if (!verification || !['execute', 'unverified'].includes(verification.mode) || !verification.reason?.trim()) throw new Error(`${at} needs an explicit verification decision and reason.`);
    if (question.kind === 'answer-review') {
      if (!question.proposedAnswer?.trim() || !question.referenceAnswer?.trim() || question.code !== '' || question.referenceCode !== '' || question.signature || question.language) throw new Error(`${at} answer-review needs proposed/reference answers, empty code, and no function signature or language.`);
      if (verification.mode !== 'unverified') throw new Error(`${at} answer-review content has no executable validator.`);
    } else {
      if (!question.code.trim() || !question.referenceCode.trim() || question.proposedAnswer || question.referenceAnswer) throw new Error(`${at} code-review needs candidate/reference code and empty answer text.`);
    }
    const supported = question.kind === 'code-review' && environments.some(item => item.contextIds.includes(question.contextId!) && item.id === question.language);
    if (verification.mode === 'execute') {
      const environment = environments.find(item => item.id === verification.environmentId);
      if (!environment || !supported || question.language !== environment.id || !environment.contextIds.includes(question.contextId)) throw new Error(`${at} cannot execute in the requested environment; use a context and language that it explicitly supports.`);
      if (!environment.available) throw new Error(`${at} ${environment.detail} Restore this environment; do not relabel the question unverified.`);
    } else {
      if (verification.environmentId !== null || question.tests.length) throw new Error(`${at} unverified content must have no environment or test results.`);
      if (supported) throw new Error(`${at} supported code must use executable verification; a failed run cannot become unverified.`);
      if (context.draft?.questions.some(previous => previous.verification?.mode === 'execute' && previous.plan?.familyId === question.plan!.familyId)) throw new Error(`${at} cannot downgrade a previously executable task to unverified during repair; repair it or replace it with a genuinely different task.`);
    }
    if (question.language !== undefined && !isLanguage(question.language)) throw new Error(`${at} has an unsupported rendering language.`);
    if ((question.language === 'rust' || question.contextId === 'rust') && /(?:does?\s+not|won'?t|will\s+not|fails?\s+to)\s+compile|borrow[- ]checker\s+(?:error|reject)|compilation\s+(?:error|fail)/i.test(`${question.specification} ${question.explanation}`)) throw new Error(`${at} compiler-only Rust questions are not eligible; use observable behavioral differences.`);
  }
  if (usedContexts.size > 2) throw new Error('Use one main context and at most one secondary context per lesson.');
  const assessments = new Set<string>();
  for (const assessment of lesson.curriculum!.knowledge!.assessments) {
    const key = `${assessment.conceptId}\0${assessment.contextId}`;
    if (assessments.has(key) || !definitions.has(assessment.conceptId) || !contexts.has(assessment.contextId)) throw new Error('Assessment needs a unique existing concept/context pair.');
    assessments.add(key);
    if (knowledgeKind(graph.concepts.find(item => item.id === assessment.conceptId)!) === 'topic') throw new Error('Do not assess familiarity for a grouping topic; related practice is coverage only.');
    const concept = context.curriculum?.concepts.find(item => canonicalId(item.id, graph.aliases) === assessment.conceptId);
    const evidence = new Map((context.curriculum?.concepts.filter(item => canonicalId(item.id, graph.aliases) === assessment.conceptId) ?? []).flatMap(item => item.contextPractice?.[assessment.contextId]?.evidence ?? []).map(item => [item.attemptId, item]));
    // Recent raw answers override bounded memory and exclusions.
    for (const { lesson: previous, attempts } of context.history) for (const attempt of attempts) {
      const question = previous.questions.find(item => item.id === attempt.exerciseId);
      if (!question || attempt.flagged) { evidence.delete(attempt.id); continue; }
      const use = question.plan?.skillUses?.find(item => canonicalId(item.conceptId, graph.aliases) === assessment.conceptId && (item.contextId ?? questionContext(question, previous)) === assessment.contextId);
      if (use) evidence.set(attempt.id, { attemptId: attempt.id, lessonId: previous.id, title: question.title, answer: attempt.answer, correct: attempt.correct, answeredAt: attempt.answeredAt, role: use.role, support: use.support, source: 'planned', signal: attempt.correct === null || use.role === 'incidental' ? 'inconclusive' : attempt.correct ? use.ifCorrect : use.ifIncorrect, rationale: use.rationale });
    }
    if (new Set(assessment.evidenceAttemptIds).size !== assessment.evidenceAttemptIds.length || assessment.evidenceAttemptIds.some(id => !evidence.has(id))) throw new Error(`Assessment ${assessment.conceptId}/${assessment.contextId} cites missing, flagged, or cross-context evidence.`);
    if (context.settings.tutorMode === 'baseline' && (assessment.familiarity !== 'unknown' || assessment.evidenceAttemptIds.length)) throw new Error('Baseline assessments must be unknown without personal evidence.');
    if (assessment.familiarity !== 'unknown' && !assessment.evidenceAttemptIds.length) throw new Error('Contextual familiarity needs cited evidence.');
    const supporting = assessment.evidenceAttemptIds.map(id => evidence.get(id)!).filter(familiaritySupport);
    if (assessment.familiarity === 'familiar' && (supporting.length < 3 || new Set(supporting.map(item => item.lessonId)).size < 2)) throw new Error(`Familiar ${assessment.conceptId}/${assessment.contextId} needs three planned supporting answers across two lessons in that context.`);
    if (assessment.familiarity === 'developing' && !assessment.evidenceAttemptIds.some(id => evidence.get(id)?.signal === 'supports')) throw new Error(`Developing ${concept?.name ?? assessment.conceptId} needs supporting evidence.`);
  }
  const frontier = new Set<string>();
  for (const entry of lesson.curriculum!.frontier) {
    const key = `${entry.conceptId}\0${entry.contextId}`;
    if (frontier.has(key) || !contexts.has(entry.contextId!) || !definitions.has(entry.conceptId)) throw new Error('Frontier entries need unique existing concept/context pairs.');
    frontier.add(key);
    const targeted = lesson.questions.some(question => question.contextId === entry.contextId && question.plan?.conceptIds.includes(entry.conceptId));
    if (knowledgeKind(graph.concepts.find(item => item.id === entry.conceptId)!) === 'topic' && entry.decision === 'introduce') throw new Error('An introduced frontier must name a teachable concept or technique, not just a broad topic.');
    if ((entry.decision === 'introduce' && !targeted) || (entry.decision === 'defer' && targeted)) throw new Error('Frontier introduce/defer decisions must match targeted concept/context pairs.');
    const executed = lesson.questions.filter(question => question.contextId === entry.contextId && question.plan?.conceptIds.includes(entry.conceptId));
    if (executed.length && !executed.some(question => (question.verification?.mode === 'execute' ? 'executed' : 'unverified') === entry.verification)) throw new Error('Frontier verification must describe a path used by its targeted cards.');
  }
}

/** Compatibility adapter for structural curriculum rules; never persisted. */
export function curriculumValidationView(lesson: ProposedLesson, graph: KnowledgeGraph): ProposedLesson {
  const definitions = graph.concepts.filter(item => canonicalId(item.id, graph.aliases) === item.id);
  const updates: ConceptUpdate[] = definitions.map(item => ({ ...item,
    prerequisiteIds: graph.relationships.filter(edge => edge.active && edge.kind === 'prerequisite' && canonicalId(edge.toId, graph.aliases) === item.id).map(edge => canonicalId(edge.fromId, graph.aliases)),
    familiarity: 'unknown', evidenceAttemptIds: [], uncertainty: 'Assessments are contextual.', nextProbe: 'See context assessments.',
  }));
  const clone = structuredClone(lesson);
  clone.curriculum!.conceptUpdates = updates;
  return clone;
}
