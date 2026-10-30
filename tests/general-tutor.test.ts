import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createDemoLesson } from '../server/demo.ts';
import { DEFAULT_SETTINGS, LocalStore, lessonHash, calculateMetrics } from '../server/store.ts';
import { buildCurriculumMemory } from '../server/curriculum-memory.ts';
import { buildKnowledgeGraph, legacyDefinition, validateKnowledgePlan, canonicalId } from '../server/knowledge-graph.ts';
import { executionEnvironments } from '../server/environments.ts';
import { validateLesson } from '../server/validation.ts';
import { migrateKnowledge } from '../server/knowledge-migration.ts';
import { buildTutorPrompt, parseLessonOutput } from '../server/prompts.ts';
import { parseContextGuide } from '../server/concept-guides.ts';
import { BASE_CONTEXTS } from '../src/learning-contexts.ts';
import type { KnowledgePlan, Lesson, ProposedLesson, StoreData, TutorContext } from '../src/types.ts';

export function tutorContext(): TutorContext {
  return { settings: { ...DEFAULT_SETTINGS, provider: 'demo', batchSize: 6, preferredContexts: ['javascript'] }, history: [], hypotheses: [], metrics: calculateMetrics({ version: 2, settings: DEFAULT_SETTINGS, lessons: [], attempts: [] }),
    curriculum: { concepts: [], variants: [], legacyLessons: [] }, knowledge: { concepts: [], contexts: BASE_CONTEXTS, relationships: [], aliases: {}, history: [] }, environments: executionEnvironments([{ id: 'javascript', available: true, detail: 'Ready' }, { id: 'python', available: true, detail: 'Ready' }, { id: 'rust', available: true, detail: 'Ready' }]) };
}

export function generalLesson(context = tutorContext(), mixed = true): ProposedLesson {
  const lesson = createDemoLesson(context);
  const updates = lesson.curriculum!.conceptUpdates;
  lesson.curriculum!.knowledge = { concepts: updates.map(legacyDefinition), contexts: [], relationships: [], assessments: [], merges: [] };
  lesson.curriculum!.conceptUpdates = [];
  lesson.questions.forEach((question, index) => {
    const answer = mixed && index >= 3;
    Object.assign(question, { kind: answer ? 'answer-review' : 'code-review', contextId: answer ? 'numpy' : 'javascript', proposedAnswer: '', referenceAnswer: '', verification: { mode: answer ? 'unverified' : 'execute', environmentId: answer ? null : 'javascript', reason: answer ? 'NumPy has no execution environment.' : 'Pure JavaScript functions fit this environment.' } });
    if (answer) {
      const examples = [
        ['Broadcast compatible shapes', 'An array has shape (3, 1), and another has shape (1, 4). Can their elementwise sum have shape (3, 4)?', 'Yes. Each length-one dimension can expand to match the other array.', true],
        ['Align dimensions', 'Does broadcasting align dimensions from the left?', 'Yes, the first dimensions must be compared first.', false],
        ['Recognize a scalar', 'Can a scalar be added elementwise to a NumPy array?', 'Yes. The scalar contributes to each element without requiring an explicit repeated array.', true],
      ];
      const [title, specification, proposed, correct] = examples[index - 3];
      question.title = title as string; question.specification = specification as string;
      question.proposedAnswer = proposed as string; question.referenceAnswer = correct ? proposed as string : 'No. Broadcasting compares dimensions from the trailing (rightmost) end.';
      question.explanation = question.referenceAnswer;
      question.verdict = correct ? 'correct' : 'buggy';
      question.code = ''; question.referenceCode = ''; question.tests = []; delete question.signature;
      question.plan!.familyId = `numpy-example-${index}`;
    } else question.language = 'javascript';
    question.plan!.skillUses!.forEach(use => use.contextId = question.contextId);
    question.plan!.scaffolding = 'A short concrete task makes exploration reasonable without assuming prerequisites.';
    question.plan!.difficultyRationale = 'One small judgment in this representation keeps the transition manageable.';
  });
  lesson.curriculum!.frontier = [{ conceptId: updates[0].id, contextId: 'javascript', purpose: 'practice', readiness: 'Start with a small review task.', verification: 'executed', decision: 'explore', reason: 'Check familiar code, then probe another context.' }];
  return lesson;
}

test('given a mixed-context lesson, when validating and answering, then execution and unverified cards share grading with accurate verification reports', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'code-swipe-general-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  const context = { ...store.context(), environments: tutorContext().environments, settings: { ...store.context().settings, batchSize: 6 } };
  const checked = await validateLesson(generalLesson(context), context);
  assert.equal(checked.reports[0].verification!.status, 'executed');
  assert.equal(checked.reports[3].verification!.status, 'unverified');
  assert.equal(checked.reports[3].testCount, 0);
  const lesson = store.commitLesson(checked, context.settings);
  const planBytes = readFileSync(join(directory, 'plans', `${lesson.id}.json`), 'utf8');
  for (const question of lesson.questions) {
    const state = store.publicState([], null);
    assert.equal(state.question?.contextId, question.contextId);
    assert.equal('referenceAnswer' in state.question!, false);
    assert.equal('verification' in state.question!, false);
    assert.equal(store.answer(question.id, question.verdict, 2000).attempt.correct, true);
    if (question.id === lesson.questions[3].id) assert.equal(store.publicState([], null).conceptMemory?.find(item => item.id === lesson.questions[0].plan!.conceptIds[0])?.contextPractice?.numpy.exposures, 1, 'Answered evidence is visible before the lesson completes.');
  }
  const memory = buildCurriculumMemory(store.snapshot()).concepts.find(item => item.id === lesson.questions[0].plan!.conceptIds[0])!;
  assert.equal(memory.contextPractice!.javascript.supporting, 3);
  assert.equal(memory.contextPractice!.numpy.supporting, 3);
  assert.equal(store.publicState([], null).metrics.count, 6);
  const unverified = store.snapshot().attempts[3];
  store.flagAttempt(unverified.id, true);
  assert.equal(buildCurriculumMemory(store.snapshot()).concepts[0].contextPractice!.numpy.supporting, 2);
  assert.equal(store.publicState([], null).metrics.count, 5);
  assert.equal(readFileSync(join(directory, 'plans', `${lesson.id}.json`), 'utf8'), planBytes);
});

test('given supported code, when it fails verification or is relabeled unverified, then it cannot bypass execution checks', async () => {
  const context = tutorContext();
  const proposal = generalLesson(context);
  proposal.questions[0].verification = { mode: 'unverified', environmentId: null, reason: 'Skip running this code.' };
  proposal.questions[0].tests = [];
  await assert.rejects(validateLesson(proposal, context), /supported code must use executable verification/);
  const wrong = generalLesson(context);
  wrong.questions[0].verdict = wrong.questions[0].verdict === 'correct' ? 'buggy' : 'correct';
  await assert.rejects(validateLesson(wrong, context), /labelled/);
  const unavailable = tutorContext(); unavailable.environments![0].available = false;
  await assert.rejects(validateLesson(generalLesson(unavailable), unavailable), /Restore this environment/);
});

test('given a stretch prerequisite without prior success, when preparation explains exploration, then advisory dependencies do not block the lesson', async () => {
  const context = tutorContext(); const proposal = generalLesson(context, false);
  const prerequisite = { ...proposal.curriculum!.knowledge!.concepts[0], id: 'new_supporting_skill', name: 'A new supporting skill' };
  proposal.curriculum!.knowledge!.concepts.push(prerequisite);
  const question = proposal.questions[4];
  question.plan!.prerequisiteIds.push(prerequisite.id);
  question.plan!.skillUses!.push({ conceptId: prerequisite.id, contextId: 'javascript', role: 'exercised', support: 'scaffolded', ifCorrect: 'supports', ifIncorrect: 'inconclusive', rationale: 'The task provides enough support to try this relationship.' });
  assert.ok((await validateLesson(proposal, context)).questions.length);
});

test('given Python-only evidence, when claiming familiarity in NumPy, then contextual citations cannot transfer automatically', async () => {
  const context = tutorContext(); const proposal = generalLesson(context);
  const id = proposal.curriculum!.knowledge!.concepts[0].id;
  context.curriculum!.concepts = [{ ...proposal.curriculum!.knowledge!.concepts[0], prerequisiteIds: [], familiarity: 'developing', evidenceAttemptIds: [], uncertainty: 'Transfer unknown.', nextProbe: 'Probe NumPy.', exposures: 3, correctJudgments: 3, incorrectJudgments: 0, uncertainJudgments: 0, lastSeenAt: null, evidence: [], contextPractice: { python: { conceptId: id, contextId: 'python', familiarity: 'developing', evidenceAttemptIds: ['py-1'], uncertainty: 'Transfer unknown.', nextProbe: 'Probe NumPy.', exposures: 1, supporting: 1, challenging: 0, inconclusive: 0, targeted: 1, exercised: 0, incidental: 0, uncertainJudgments: 0, lastSeenAt: null, lastTargetedAt: null, lastExercisedAt: null, lastIndependentSuccessAt: null, evidence: [{ attemptId: 'py-1', lessonId: 'old', title: 'Python aggregation', answer: 'correct', correct: true, answeredAt: new Date().toISOString(), role: 'target', source: 'planned', support: 'independent', signal: 'supports' }] } } }];
  proposal.curriculum!.knowledge!.assessments = [{ conceptId: id, contextId: 'numpy', familiarity: 'familiar', evidenceAttemptIds: ['py-1'], uncertainty: 'Assumed transfer.', nextProbe: 'More arrays.' }];
  await assert.rejects(validateLesson(proposal, context), /cross-context evidence/);
});

test('given equivalent identities, when merging and undoing, then evidence is rebuilt without editing sealed lessons or double-counting attempts', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'code-swipe-merge-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory); const context = tutorContext();
  const first = generalLesson(context, false);
  const originalId = first.curriculum!.knowledge!.concepts[0].id;
  const alias = { ...first.curriculum!.knowledge!.concepts[0], id: 'equivalent_review', name: 'Equivalent review skill' };
  first.curriculum!.knowledge!.concepts.push(alias);
  first.questions[0].plan!.conceptIds.push(alias.id);
  first.questions[0].plan!.skillUses!.push({ ...first.questions[0].plan!.skillUses![0], conceptId: alias.id });
  const lesson = store.commitLesson(await validateLesson(first, context), context.settings);
  lesson.questions.forEach(question => store.answer(question.id, question.verdict, 1000));
  const originalBytes = readFileSync(join(directory, 'plans', `${lesson.id}.json`), 'utf8');
  const nextContext = { ...store.context(), environments: context.environments };
  const merge = generalLesson(nextContext, false);
  merge.curriculum!.knowledge!.concepts = [];
  merge.curriculum!.knowledge!.merges = [{ fromId: alias.id, toId: originalId, reason: 'These definitions describe the same broad code-review capability.' }];
  const attempt = store.snapshot().attempts[0];
  merge.curriculum!.observations = [{ attemptIds: [attempt.id], conceptIds: [originalId], observation: 'The learner judged the first implementation correctly.', interpretation: 'This supports a tentative review capability in JavaScript.', nextAction: 'Use a different representation next time.' }];
  // New task families avoid deliberately reusing a previous introductory family.
  merge.questions.forEach((question, index) => question.plan!.familyId = `second-review-${index}`);
  store.commitLesson(await validateLesson(merge, nextContext), nextContext.settings);
  let memory = buildCurriculumMemory(store.snapshot());
  assert.equal(memory.concepts.find(item => item.id === originalId)!.exposures, 6);
  assert.equal(memory.concepts.some(item => item.id === alias.id), false);
  const event = store.snapshot().graphRevisions!.find(item => item.change.type === 'merge')!;
  store.undoConceptMerge(event.id);
  memory = buildCurriculumMemory(store.snapshot());
  assert.equal(memory.concepts.find(item => item.id === alias.id)!.exposures, 1);
  assert.equal(memory.concepts.find(item => item.id === originalId)!.exposures, 6);
  assert.equal(readFileSync(join(directory, 'plans', `${lesson.id}.json`), 'utf8'), originalBytes);
  assert.equal(canonicalId(alias.id, buildKnowledgeGraph(store.snapshot()).aliases), alias.id);
});

test('given a specialization, when attempting to merge it into a general concept, then identity checks preserve the distinction', () => {
  const context = tutorContext();
  const general = { id: 'aggregation', name: 'Grouped aggregation', description: 'Combine values for each key.', aliases: [], representations: ['sums'], domainTags: ['data'], scope: 'general' as const, contextIds: [] };
  const specific = { ...general, id: 'pandas_groupby', name: 'pandas groupby behavior', scope: 'context-specific' as const, contextIds: ['pandas'] };
  const plan: KnowledgePlan = { concepts: [general, specific], contexts: [], relationships: [], assessments: [], merges: [{ fromId: specific.id, toId: general.id, reason: 'Both involve grouping.' }] };
  assert.throws(() => validateKnowledgePlan(plan, context), /identical scope/);
});

test('given a version-one notebook, when migrating and reopening, then hashes plan bytes and progress remain intact and the migration is repeatable', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'code-swipe-migrate-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const context = tutorContext(); const checked = await validateLesson(createDemoLesson(context), context);
  const lesson: Lesson = { ...checked, questions: checked.questions.map((question, index) => ({ ...question, id: `old-${index}`, validation: checked.reports[index] })), id: 'old-lesson', createdAt: new Date().toISOString(), provider: 'demo', model: '', tutorMode: 'reflective', interests: '', predictionHash: '' };
  delete (lesson as unknown as { reports?: unknown }).reports;
  lesson.predictionHash = lessonHash(lesson);
  const data: StoreData = { version: 1, settings: DEFAULT_SETTINGS, lessons: [lesson], attempts: [], activeLessonId: lesson.id };
  const dryRun = migrateKnowledge(data, '/backup');
  assert.equal(data.version, 1); assert.equal(dryRun.report.needed, true);
  assert.deepEqual(dryRun.data.lessons, data.lessons);
  assert.equal(migrateKnowledge(dryRun.data, '/another').report.needed, false);
  mkdirSync(join(directory, 'plans'));
  const bytes = JSON.stringify(lesson);
  writeFileSync(join(directory, 'state.json'), JSON.stringify(data)); writeFileSync(join(directory, 'plans', `${lesson.id}.json`), bytes);
  const store = new LocalStore(directory);
  assert.equal(store.snapshot().version, 4); assert.equal(store.pendingQuestion()?.id, 'old-0');
  assert.equal(readFileSync(join(directory, 'plans', `${lesson.id}.json`), 'utf8'), bytes);
  assert.equal(readFileSync(join(store.snapshot().migration!.backupDirectory, 'plans', `${lesson.id}.json`), 'utf8'), bytes);
  assert.equal(new LocalStore(directory).snapshot().migration!.backupDirectory, store.snapshot().migration!.backupDirectory);
});

test('given an unsupported context and baseline mode, when preparing guides and prompts, then examples remain unverified and personal history stays absent', () => {
  const guide = parseContextGuide(JSON.stringify({ title: 'Grouping rows', description: 'Group rows by a key before aggregating.', takeaway: 'The grouping key determines which rows contribute.', examples: [{ mode: 'illustration', expression: 'Two sales rows share category books.', expectedJson: '"Their values contribute to the same group."', explanation: 'Both rows have the same key.' }] }), { id: 'groups', name: 'Grouping', description: 'Grouping rows.' }, BASE_CONTEXTS.find(item => item.id === 'pandas')!);
  assert.equal(guide.contextId, 'pandas'); assert.equal(guide.verification!.status, 'unverified');
  const notation = parseContextGuide(JSON.stringify({ title: 'A vector shape', description: 'A one-dimensional array has one dimension.', takeaway: 'A trailing comma distinguishes a one-item tuple.', examples: [{ mode: 'illustration', expression: 'np.array([2, 4, 6]).shape', expectedJson: '(3,) — one dimension of length three', explanation: 'There are three elements along one dimension.' }] }), { id: 'shape', name: 'Shapes', description: 'Array shapes.' }, BASE_CONTEXTS.find(item => item.id === 'numpy')!);
  assert.equal(notation.examples[0].result, '(3,) — one dimension of length three');
  const context = tutorContext(); context.settings.tutorMode = 'baseline'; context.feedback = [{ lessonId: 'private', text: 'private learner history', accidentalAttemptIds: [], updatedAt: '' }];
  const prompt = buildTutorPrompt(context);
  assert.equal(prompt.includes('private learner history'), false);
  const wire = generalLesson();
  const serialized = { ...wire, questions: wire.questions.map(question => ({ ...question, language: question.language ?? null, signature: question.signature ?? null, tests: question.tests.map(test => ({ inputJson: JSON.stringify(test.input), expectedJson: JSON.stringify(test.expected), note: test.note })) })) };
  const parsed = parseLessonOutput(JSON.stringify(serialized));
  assert.equal(parsed.questions[3].signature, undefined);
  assert.equal(Object.hasOwn(parsed.questions[3], 'signature'), false);
  const legacy = createDemoLesson(tutorContext());
  assert.throws(() => parseLessonOutput(JSON.stringify({ ...legacy, questions: legacy.questions.map(question => ({ ...question, tests: question.tests.map(test => ({ inputJson: JSON.stringify(test.input), expectedJson: JSON.stringify(test.expected), note: test.note })) })) }), true), /invalid lesson/);
});

test('given unverified answers across lessons, when assessing familiarity then flagging a supporting answer, then the same evidence thresholds and retractions apply', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'code-swipe-unverified-evidence-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  const settings = tutorContext().settings;
  const run = async () => {
    const context = { ...store.context(), settings, environments: tutorContext().environments };
    const proposal = generalLesson(context);
    if (context.history.length) {
      proposal.curriculum!.knowledge!.concepts = [];
      const attempt = context.history[0].attempts[0];
      proposal.curriculum!.observations = [{ conceptIds: [proposal.questions[0].plan!.conceptIds[0]], attemptIds: [attempt.id], observation: 'The learner answered a code review correctly.', interpretation: 'This is some evidence in its recorded context.', nextAction: 'Compare with another representation.' }];
    }
    const lesson = store.commitLesson(await validateLesson(proposal, context), settings);
    lesson.questions.forEach(question => store.answer(question.id, question.verdict, 1000));
    return lesson;
  };
  const first = await run(); const second = await run();
  const attempts = store.snapshot().attempts;
  const ids = attempts.filter(item => item.lessonId === first.id && first.questions.slice(3).some(q => q.id === item.exerciseId)).map(item => item.id);
  const secondId = attempts.find(item => item.exerciseId === second.questions[3].id)!.id;
  const context = { ...store.context(), settings, environments: tutorContext().environments };
  const next = generalLesson(context);
  next.curriculum!.knowledge!.concepts = [];
  const conceptId = first.questions[0].plan!.conceptIds[0];
  next.curriculum!.knowledge!.assessments = [{ conceptId, contextId: 'numpy', familiarity: 'familiar', evidenceAttemptIds: [...ids, secondId], uncertainty: 'Responses agree across two lessons.', nextProbe: 'Vary array rank.' }];
  next.curriculum!.observations = [{ conceptIds: [conceptId], attemptIds: [secondId], observation: 'The learner judged the NumPy answer correctly.', interpretation: 'This supports a tentative array capability in this context.', nextAction: 'Vary array rank.' }];
  store.commitLesson(await validateLesson(next, context), settings);
  assert.equal(buildCurriculumMemory(store.snapshot()).concepts[0].contextPractice!.numpy.familiarity, 'familiar');
  assert.equal(store.publicState([], null).conceptMemory?.[0].contextPractice!.numpy.familiarity, 'developing', 'An unfinished lesson must not reveal its new assessment.');
  store.flagAttempt(secondId, true);
  assert.equal(buildCurriculumMemory(store.snapshot()).concepts[0].contextPractice!.numpy.familiarity, 'developing');
});

test('given a new context, when using a simpler bridge card, then demand may decrease only at the context switch', async () => {
  const context = tutorContext(); const proposal = generalLesson(context);
  proposal.questions[3].plan!.stage = 'build';
  proposal.questions[3].plan!.cognitiveDemand = 1;
  proposal.questions[4].plan!.stage = 'build'; proposal.questions[4].plan!.cognitiveDemand = 2;
  proposal.questions[5].plan!.cognitiveDemand = 2;
  await validateLesson(proposal, context);
  proposal.questions[3].contextId = 'javascript';
  proposal.questions[3].plan!.skillUses!.forEach(use => use.contextId = 'javascript');
  await assert.rejects(validateLesson(proposal, context), /cannot decrease within one context/);
});

test('given an excluded parent context or a failed executable task, when introducing a specialization or downgrading verification, then neither bypass is accepted', async () => {
  const context = tutorContext(); context.settings.excludedContexts = ['python'];
  await assert.rejects(validateLesson(generalLesson(context), context), /excluded context or specialization/);
  const repairing = tutorContext(); repairing.draft = generalLesson(repairing);
  const proposal = generalLesson(repairing);
  proposal.questions[0].contextId = 'numpy'; proposal.questions[0].plan!.skillUses!.forEach(use => use.contextId = 'numpy');
  proposal.questions[0].verification = { mode: 'unverified', environmentId: null, reason: 'Changed the context after a failed run.' }; proposal.questions[0].tests = [];
  await assert.rejects(validateLesson(proposal, repairing), /cannot downgrade a previously executable task/);
});
