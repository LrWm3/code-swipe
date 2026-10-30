import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildKnowledgeGraph, legacyDefinition, validateKnowledgePlan } from '../server/knowledge-graph.ts';
import { migrateOrganization } from '../server/organization-migration.ts';
import { buildCurriculumMemory } from '../server/curriculum-memory.ts';
import { DEFAULT_SETTINGS, calculateMetrics, lessonHash, LocalStore } from '../server/store.ts';
import { createDemoLesson } from '../server/demo.ts';
import { buildTutorPrompt } from '../server/prompts.ts';
import { validateContextualQuestions } from '../server/context-validation.ts';
import { KnowledgePanel } from '../src/KnowledgePanel.tsx';
import { componentIds, teachingAnchor, topicIds } from '../src/knowledge-organization.ts';
import { BASE_CONTEXTS } from '../src/learning-contexts.ts';
import type { ConceptUpdate, KnowledgePlan, Lesson, StoreData, TutorContext } from '../src/types.ts';

function archive(): StoreData {
  const settings = { ...DEFAULT_SETTINGS, provider: 'demo' as const, batchSize: 6 };
  const context: TutorContext = { settings, history: [], hypotheses: [], metrics: calculateMetrics({ version: 2, settings, lessons: [], attempts: [] }) };
  const proposal = createDemoLesson(context);
  const definitions: ConceptUpdate[] = [
    ['running_total', 'Maintaining a running total'], ['frequency_counting', 'Counting frequencies with a dictionary'],
    ['grouped_accumulation', 'Accumulating totals by key'], ['output_uniqueness', 'Controlling output multiplicity'],
    ['python_scan_representation', 'Reading Python scans'], ['rust_scan_representation', 'Reading Rust scans'],
  ].map(([id, name]) => ({ id, name, description: name, representations: ['small functions'], prerequisiteIds: [], familiarity: 'unknown', evidenceAttemptIds: [], uncertainty: 'No capability inferred from classification.', nextProbe: 'A focused task.' }));
  proposal.curriculum!.conceptUpdates = definitions;
  proposal.curriculum!.frontier = [];
  proposal.questions.forEach((question, index) => {
    question.plan!.conceptIds = [index === 0 ? 'running_total' : 'grouped_accumulation'];
    question.plan!.skillUses = [{ conceptId: question.plan!.conceptIds[0], role: 'target', support: 'independent', ifCorrect: 'supports', ifIncorrect: 'challenges', rationale: 'A recorded judgment supplies tentative evidence.' }];
    if (index === 0) question.plan!.skillUses.push({ conceptId: 'frequency_counting', role: 'exercised', support: 'scaffolded', ifCorrect: 'supports', ifIncorrect: 'inconclusive', rationale: 'The supporting skill was meaningfully exercised.' });
  });
  const lesson: Lesson = { ...proposal, id: 'archived', createdAt: '2026-10-01T00:00:00.000Z', provider: 'demo', model: '', tutorMode: 'reflective', interests: '', predictionHash: '', questions: proposal.questions.map((question, index) => ({ ...question, id: `question-${index}`, validation: { checkedAt: '2026-10-01T00:00:00.000Z', testCount: question.tests.length, passedCount: question.verdict === 'correct' ? question.tests.length : 0, failures: [] } })) };
  lesson.predictionHash = lessonHash(lesson);
  return { version: 2, settings, lessons: [lesson], activeLessonId: lesson.id, attempts: lesson.questions.slice(0, 2).map((question, index) => ({ id: `answer-${index}`, lessonId: lesson.id, exerciseId: question.id, answer: question.verdict, correct: true, answeredAt: `2026-10-01T00:00:0${index + 1}.000Z`, elapsedMs: 1000, flagged: false })), guides: [], guideEvents: [], feedback: [], discussions: [] };
}

function contextFor(data: StoreData): TutorContext {
  return { settings: data.settings, history: data.lessons.map(lesson => ({ lesson, attempts: data.attempts.filter(attempt => attempt.lessonId === lesson.id) })), hypotheses: [], metrics: calculateMetrics(data), knowledge: buildKnowledgeGraph(data), curriculum: buildCurriculumMemory(data) };
}

const emptyPlan = (): KnowledgePlan => ({ concepts: [], contexts: [], relationships: [], assessments: [], merges: [] });

test('given existing evidence records, when organizing the archive, then identities grades predictions and contextual evidence stay intact', () => {
  const original = archive(); const bytes = JSON.stringify(original); const before = buildCurriculumMemory(original);
  const result = migrateOrganization(original, '/backup', '2026-10-30T00:00:00.000Z');
  assert.equal(JSON.stringify(original), bytes);
  assert.equal(result.data.version, 3); assert.equal(result.report.classified, 6); assert.equal(result.report.added, 14);
  assert.deepEqual(result.data.lessons, original.lessons); assert.deepEqual(result.data.attempts, original.attempts); assert.deepEqual(result.data.guides, original.guides);
  const graph = buildKnowledgeGraph(result.data);
  assert.equal(graph.concepts.find(item => item.id === 'running_total')!.kind, 'technique');
  assert.equal(graph.concepts.find(item => item.id === 'output_uniqueness')!.kind, 'skill');
  assert.equal(graph.concepts.find(item => item.id === 'rust_scan_representation')!.kind, 'representation');
  const after = buildCurriculumMemory(result.data);
  for (const record of before.concepts) assert.deepEqual(after.concepts.find(item => item.id === record.id)!.contextPractice, record.contextPractice);
  assert.equal(migrateOrganization(result.data, '/other').report.needed, false);
  assert.deepEqual(calculateMetrics(result.data), calculateMetrics(original));
});

test('given several component skills on the same card, when calculating topic coverage, then answers are deduplicated and parent familiarity is not inferred', () => {
  const data = migrateOrganization(archive(), '/backup').data;
  let memory = buildCurriculumMemory(data);
  let topic = memory.concepts.find(item => item.id === 'topic_accumulation_reduction')!;
  assert.equal(topic.coverage!.answered, 2);
  assert.equal(topic.exposures, 0); assert.equal(topic.familiarity, 'unknown'); assert.deepEqual(topic.contextPractice, Object.create(null));
  const parent = memory.concepts.find(item => item.id === 'accumulation')!;
  assert.equal(parent.coverage!.answered, 2); assert.equal(parent.correctJudgments, 0); assert.equal(parent.evidence.length, 0);
  data.attempts[1].flagged = true;
  memory = buildCurriculumMemory(data); topic = memory.concepts.find(item => item.id === 'topic_accumulation_reduction')!;
  assert.equal(topic.coverage!.answered, 1);
  assert.equal(memory.concepts.find(item => item.id === 'grouped_accumulation')!.contextPractice!.javascript.supporting, 0);
  assert.ok(componentIds(buildKnowledgeGraph(data), 'accumulation').includes('frequency_counting'));
});

test('given a narrow skill and a composition technique, when choosing teaching guides, then skills use a conceptual anchor while techniques retain their identity', () => {
  const graph = buildKnowledgeGraph(migrateOrganization(archive(), '/backup').data);
  assert.equal(teachingAnchor(graph, 'output_uniqueness')?.id, 'set_membership');
  assert.equal(teachingAnchor(graph, 'grouped_accumulation')?.id, 'grouped_accumulation');
  assert.equal(teachingAnchor(graph, 'topic_dictionaries_sets'), undefined);
  assert.ok(topicIds(graph, 'grouped_accumulation').includes('topic_dictionaries_sets'));
  assert.ok(topicIds(graph, 'grouped_accumulation').includes('topic_accumulation_reduction'));
});

test('given grouping and composition links, when validating the knowledge graph, then grouping cannot masquerade as a prerequisite or assessment', () => {
  const data = migrateOrganization(archive(), '/backup').data; const context = contextFor(data);
  validateKnowledgePlan(emptyPlan(), context);
  const malformed = emptyPlan(); malformed.relationships.push({ id: 'bad_parent', kind: 'part-of', fromId: 'running_total', toId: 'accumulation', contextIds: [], active: true, rationale: 'Wrong target kind.' });
  assert.throws(() => validateKnowledgePlan(malformed, context), /grouping topic/);
  malformed.relationships[0] = { ...malformed.relationships[0], kind: 'prerequisite', fromId: 'topic_dictionaries_sets', toId: 'grouped_accumulation' };
  assert.throws(() => validateKnowledgePlan(malformed, context), /not a learner prerequisite/);
  malformed.relationships[0] = { ...malformed.relationships[0], kind: 'uses', fromId: 'key_value_mappings', toId: 'grouped_accumulation' };
  assert.throws(() => validateKnowledgePlan(malformed, context), /Knowledge composition cycle/);
  const proposal = createDemoLesson(context);
  proposal.curriculum!.knowledge = emptyPlan();
  proposal.questions.forEach(question => Object.assign(question, { kind: 'answer-review', contextId: 'javascript', proposedAnswer: 'An example technical answer.', referenceAnswer: 'The reference answer.', code: '', referenceCode: '', tests: [], verification: { mode: 'unverified', environmentId: null, reason: 'A technical explanation has no executor.' } }));
  const question = proposal.questions[0]; delete question.signature;
  question.plan!.conceptIds = ['topic_dictionaries_sets']; question.plan!.skillUses = [{ conceptId: 'topic_dictionaries_sets', contextId: 'javascript', role: 'target', support: 'independent', ifCorrect: 'supports', ifIncorrect: 'challenges', rationale: 'An invalid broad attribution.' }];
  assert.throws(() => validateContextualQuestions(proposal, context, context.knowledge!), /cannot assess a grouping topic/);
});

test('given a version-two notebook, when reopening and rendering its organization, then backup bytes and active progress survive and classified records appear under topics', t => {
  const directory = mkdtempSync(join(tmpdir(), 'swipe-organization-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const data = archive(); const plan = JSON.stringify(data.lessons[0]);
  mkdirSync(join(directory, 'plans')); writeFileSync(join(directory, 'state.json'), JSON.stringify(data)); writeFileSync(join(directory, 'plans', 'archived.json'), plan);
  const store = new LocalStore(directory); const snapshot = store.snapshot();
  assert.equal(snapshot.version, 3); assert.equal(store.pendingQuestion()!.id, 'question-2');
  assert.equal(readFileSync(join(directory, 'plans', 'archived.json'), 'utf8'), plan);
  assert.equal(readFileSync(join(snapshot.organizationMigration!.backupDirectory, 'plans', 'archived.json'), 'utf8'), plan);
  assert.equal(new LocalStore(directory).snapshot().organizationMigration!.backupDirectory, snapshot.organizationMigration!.backupDirectory);
  const markup = renderToStaticMarkup(createElement(KnowledgePanel, { state: store.publicState([], null), pending: false, onGuide() {}, onUndo() {} }));
  assert.match(markup, /6 topics/); assert.match(markup, /Dictionaries and sets/); assert.match(markup, /Technique/); assert.match(markup, /Specific skill/); assert.match(markup, /Representation/); assert.match(markup, /Related practice/);
});

test('given a classified graph and related coverage, when planning, then the prompt distinguishes organization from new learning and permits organically added topics', () => {
  const data = migrateOrganization(archive(), '/backup').data; const context = contextFor(data);
  const prompt = buildTutorPrompt(context);
  assert.match(prompt, /part-of runs child record/); assert.match(prompt, /does not mean its subject is new to the learner/); assert.match(prompt, /misconceptions and suspected weaknesses belong in falsifiable hypotheses/); assert.match(prompt, /"coverage":/);
  const plan = emptyPlan();
  plan.concepts.push({ ...legacyDefinition({ id: 'topic_new_domain', name: 'A new domain', description: 'A topic outside the migrated catalog.', representations: ['conceptual'] }), kind: 'topic' });
  assert.doesNotThrow(() => validateKnowledgePlan(plan, context));
  plan.concepts.push({ ...plan.concepts[0], id: 'new_domain_principle', kind: 'concept' });
  assert.doesNotThrow(() => validateKnowledgePlan(plan, context), 'A topic and a concept can share a label while retaining distinct identities.');
  assert.deepEqual(buildKnowledgeGraph({ version: 3, settings: DEFAULT_SETTINGS, lessons: [], attempts: [] }).contexts, BASE_CONTEXTS);
});
