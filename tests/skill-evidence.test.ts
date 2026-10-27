import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveHash, validateSkillUses, validateRetrofit } from '../server/skill-evidence.ts';
import { buildCurriculumMemory } from '../server/curriculum-memory.ts';
import { createDemoLesson } from '../server/demo.ts';
import { LocalStore, DEFAULT_SETTINGS, lessonHash } from '../server/store.ts';
import { validateCurriculum } from '../server/curriculum-validation.ts';
import { validateLesson } from '../server/validation.ts';
import { buildTutorPrompt } from '../server/prompts.ts';
import type { ConceptUpdate, Lesson, SkillUse, SkillRetrofit, StoreData, TutorContext } from '../src/types.ts';

const context = (): TutorContext => ({ settings: { ...DEFAULT_SETTINGS, provider: 'demo' }, history: [], hypotheses: [], metrics: { count: 0, accuracy: null, brier: null, calibration: [], byPurpose: [] } });
const use = (conceptId: string, role: SkillUse['role'] = 'target', extra: Partial<SkillUse> = {}): SkillUse => ({ conceptId, role, support: 'independent', ifCorrect: role === 'incidental' ? 'inconclusive' : 'supports', ifIncorrect: 'inconclusive', rationale: `The card ${role === 'incidental' ? 'contains' : 'requires'} ${conceptId}; one judgment leaves other reasoning uncertain.`, ...extra });
const definition = (id: string): ConceptUpdate => ({ id, name: id, description: `${id} skill`, representations: ['JavaScript'], prerequisiteIds: [], familiarity: 'unknown', evidenceAttemptIds: [], uncertainty: 'Tentative evidence only.', nextProbe: 'Probe when uncertainty warrants it.' });

function archive(uses: SkillUse[][], answers: ('correct' | 'buggy' | 'idk')[] = []): StoreData {
  const data: StoreData = { version: 1, settings: context().settings, lessons: [], attempts: [] };
  uses.forEach((skills, i) => {
    const proposal = createDemoLesson(context());
    const question = { ...proposal.questions[1], id: `q${i}`, verdict: 'correct' as const, plan: { ...proposal.questions[1].plan!, familyId: `archive-task-${i}`, conceptIds: skills.filter(item => item.role === 'target').map(item => item.conceptId), skillUses: skills }, validation: { checkedAt: '', testCount: 4, passedCount: 4, failures: [] } };
    const lesson: Lesson = { ...proposal, id: `l${i}`, provider: 'demo', tutorMode: 'reflective', model: '', interests: '', createdAt: `2026-10-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`, predictionHash: '', questions: [question], curriculum: { ...proposal.curriculum!, conceptUpdates: skills.map(item => definition(item.conceptId)) } };
    lesson.predictionHash = lessonHash(lesson);
    data.lessons.push(lesson);
    const answer = answers[i] ?? 'correct';
    data.attempts.push({ id: `a${i}`, lessonId: lesson.id, exerciseId: question.id, answer, correct: answer === 'idk' ? null : answer === 'correct', answeredAt: lesson.createdAt, elapsedMs: 5000, flagged: false });
  });
  return data;
}

test('given an old skill reused in a harder task, when judging it correctly, then embedded practice refreshes use without inventing another direct test', () => {
  const data = archive([[use('summing')], [use('grouping'), use('summing', 'exercised'), use('syntax', 'incidental')]]);
  data.lessons[1].curriculum!.conceptUpdates.find(item => item.id === 'grouping')!.prerequisiteIds = ['unexercised-ancestor'];
  data.lessons[1].curriculum!.conceptUpdates.push(definition('unexercised-ancestor'));
  const memory = buildCurriculumMemory(data);
  const sum = memory.concepts.find(item => item.id === 'summing')!;
  assert.equal(sum.practice!.lastTargetedAt, data.attempts[0].answeredAt);
  assert.equal(sum.practice!.lastExercisedAt, data.attempts[1].answeredAt);
  assert.equal(sum.practice!.lastIndependentSuccessAt, data.attempts[1].answeredAt);
  assert.equal(sum.practice!.exercised, 1);
  assert.equal(sum.practice!.supporting, 2);
  const incidental = memory.concepts.find(item => item.id === 'syntax')!;
  assert.equal(incidental.lastSeenAt, data.attempts[1].answeredAt);
  assert.equal(incidental.practice!.lastExercisedAt, null);
  assert.equal(incidental.practice!.supporting, 0);
  assert.equal(memory.concepts.find(item => item.id === 'unexercised-ancestor')!.exposures, 0);
});

test('given ambiguous failure IDK scaffolding or exclusion, when interpreting compound answers, then component competence is not inferred from card accuracy', () => {
  const data = archive(Array.from({ length: 4 }, () => [use('target'), use('old', 'exercised')]), ['buggy', 'idk', 'correct', 'correct']);
  data.lessons[2].questions[0].plan!.skillUses!.forEach(item => { item.support = 'scaffolded'; });
  data.attempts[3].flagged = true;
  const old = buildCurriculumMemory(data).concepts.find(item => item.id === 'old')!;
  assert.equal(old.incorrectJudgments, 1); // Raw card result remains available.
  assert.equal(old.practice!.challenging, 0);
  assert.equal(old.practice!.supporting, 1);
  assert.equal(old.practice!.inconclusive, 2);
  assert.equal(old.practice!.lastIndependentSuccessAt, null);
  assert.equal(old.practice!.lastExercisedAt, data.attempts[2].answeredAt);
  assert.equal(old.evidence.length, 3);
});

test('given recent incidental appearances, when summarizing a long history, then the last meaningful supporting observation remains retrievable', () => {
  const data = archive([[use('old')], ...Array.from({ length: 9 }, () => [use('new'), use('old', 'incidental')])]);
  const old = buildCurriculumMemory(data).concepts.find(item => item.id === 'old')!;
  assert.equal(old.practice!.lastExercisedAt, data.attempts[0].answeredAt);
  assert.ok(old.evidence.some(item => item.attemptId === 'a0' && item.signal === 'supports'));
  assert.ok(old.evidence.length <= 6);
});

test('given a legacy target tag without reviewed attribution, when rebuilding, then a correct card cannot establish independent skill competence', () => {
  const data = archive([[use('old')]]);
  delete data.lessons[0].questions[0].plan!.skillUses;
  const old = buildCurriculumMemory(data).concepts.find(item => item.id === 'old')!;
  assert.equal(old.correctJudgments, 1);
  assert.equal(old.practice!.supporting, 0);
  assert.equal(old.practice!.lastExercisedAt, null);
  assert.equal(old.evidence[0].source, 'legacy');
});

test('given misleading skill mappings, when validating new plans, then missing roles incidental credit and blanket blame are rejected', () => {
  assert.throws(() => validateSkillUses(undefined, ['target']), /requires/);
  assert.throws(() => validateSkillUses([use('target')], ['target'], ['old']), /cover/);
  assert.throws(() => validateSkillUses([use('other')], ['target']), /match/);
  assert.throws(() => validateSkillUses([use('old', 'incidental', { ifCorrect: 'supports' })]), /Incidental/);
  assert.throws(() => validateSkillUses([use('old', 'exercised', { ifIncorrect: 'challenges' })]), /composite failure/);
  assert.throws(() => validateSkillUses([use('a', 'target', { ifIncorrect: 'challenges' }), use('b', 'target', { ifIncorrect: 'challenges' })]), /multiple skills/);
});

test('given correct but inconclusive or scaffolded history, when claiming familiarity, then raw successes cannot satisfy evidence requirements', () => {
  for (const kind of ['independent', 'scaffolded', 'inconclusive'] as const) {
    const data = archive(Array.from({ length: 3 }, () => [use('old', 'target', kind === 'inconclusive' ? { ifCorrect: 'inconclusive' } : { support: kind })]));
    const tutor = context();
    tutor.curriculum = buildCurriculumMemory(data);
    const proposal = createDemoLesson(tutor);
    proposal.curriculum!.conceptUpdates.push({ ...definition('old'), familiarity: 'familiar', evidenceAttemptIds: ['a0', 'a1', 'a2'] });
    if (kind === 'independent') assert.doesNotThrow(() => validateCurriculum(proposal, tutor));
    else assert.throws(() => validateCurriculum(proposal, tutor), /planned independent supporting/);
  }
});

test('given retrospective success across several lessons, when assessing familiarity from recent history or compact memory, then post-hoc attribution cannot become planned evidence', () => {
  const data = archive(Array.from({ length: 3 }, () => [use('old')]));
  data.lessons.forEach(lesson => { delete lesson.questions[0].plan!.skillUses; });
  data.skillRetrofits = [{ id: 'prior-review', createdAt: '2026-10-10T00:00:00.000Z', archiveHash: archiveHash(data), method: 'Reviewed archive', concepts: [],
    questions: data.lessons.map(lesson => ({ lessonId: lesson.id, exerciseId: lesson.questions[0].id, predictionHash: lesson.predictionHash, uses: [use('old')], note: 'Retrospective interpretation only.' })) }];
  for (const includeHistory of [false, true]) {
    const tutor = context();
    tutor.curriculum = buildCurriculumMemory(data);
    tutor.skillRetrofits = data.skillRetrofits;
    if (includeHistory) tutor.history = data.lessons.map(lesson => ({ lesson, attempts: data.attempts.filter(attempt => attempt.lessonId === lesson.id) }));
    const proposal = createDemoLesson(tutor);
    proposal.curriculum!.conceptUpdates.push({ ...definition('old'), familiarity: 'familiar', evidenceAttemptIds: ['a0', 'a1', 'a2'] });
    assert.throws(() => validateCurriculum(proposal, tutor), /planned independent supporting/);
  }
});

test('given a reviewed new concept and later definition refinement, when reopening the archive, then the retrofit remains valid and does not erase later interpretation', () => {
  const data = archive([[use('old')]]);
  delete data.lessons[0].questions[0].plan!.skillUses;
  const retrofit: SkillRetrofit = { id: 'review', createdAt: '2026-10-02T00:00:00.000Z', archiveHash: archiveHash(data), method: 'Reviewed archive', concepts: [definition('embedded')], questions: [{ lessonId: 'l0', exerciseId: 'q0', predictionHash: data.lessons[0].predictionHash, uses: [use('old'), use('embedded', 'exercised')], note: 'The accumulator is genuinely needed to evaluate this old question.' }] };
  assert.doesNotThrow(() => validateRetrofit(retrofit, data));
  const later = archive([[use('embedded')]]).lessons[0];
  later.id = 'later'; later.createdAt = '2026-10-03T00:00:00.000Z'; later.questions[0].id = 'later-question';
  later.curriculum!.conceptUpdates[0].description = 'Refined after the review.';
  data.lessons.push(later);
  assert.doesNotThrow(() => validateRetrofit(retrofit, data, false));
  data.skillRetrofits = [retrofit];
  assert.equal(buildCurriculumMemory(data).concepts.find(concept => concept.id === 'embedded')!.description, 'Refined after the review.');
});

test('given delayed embedded practice, when planning retention, then an actively exercised old skill qualifies but an incidental appearance does not', async () => {
  const data = archive([[use('new'), use('old', 'exercised')]]);
  const tutor = context(); tutor.curriculum = buildCurriculumMemory(data);
  const proposal = createDemoLesson(tutor);
  proposal.questions[0].plan!.skillUses!.push(use('old', 'exercised'));
  proposal.questions[0].plan!.purposes.push('retention');
  proposal.rationale = 'Revisit embedded accumulation from a0 after more than a day.';
  await validateLesson(proposal, tutor);
  data.lessons[0].questions[0].plan!.skillUses![1] = use('old', 'incidental');
  tutor.curriculum = buildCurriculumMemory(data);
  await assert.rejects(validateLesson(proposal, tutor), /retention requires/);
});

test('given reviewed archived answers, when importing twice and restarting, then retrofit evidence persists while sealed history stays unchanged', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'code-swipe-retrofit-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  store.saveSettings(context().settings);
  const proposal = await validateLesson(createDemoLesson(store.context()), store.context());
  proposal.questions.forEach(question => { delete question.plan!.skillUses; });
  const lesson = store.commitLesson(proposal, context().settings);
  const answer = store.answer(lesson.questions[0].id, lesson.questions[0].verdict, 1000);
  const original = store.snapshot();
  const artifact = readFileSync(join(directory, 'plans', `${lesson.id}.json`), 'utf8');
  const retrofit: SkillRetrofit = { id: 'review-1', createdAt: new Date().toISOString(), method: 'Manual review of code and feedback', archiveHash: archiveHash(original), concepts: [], questions: [{ lessonId: lesson.id, exerciseId: answer.question.id, predictionHash: lesson.predictionHash, uses: [use('demo-code-review')], note: 'Historical judgment supports this broad skill tentatively; reasoning was not observed.' }] };
  assert.throws(() => store.importSkillRetrofit({ ...retrofit, archiveHash: '0'.repeat(64) }), /archive changed/);
  assert.throws(() => store.importSkillRetrofit({ ...retrofit, questions: [{ ...retrofit.questions[0], exerciseId: lesson.questions[1].id }] }), /answered legacy/);
  assert.equal(store.importSkillRetrofit(retrofit), true);
  assert.equal(store.importSkillRetrofit(retrofit), false);
  assert.throws(() => store.importSkillRetrofit({ ...retrofit, method: 'Changed interpretation' }), /overwritten/);
  const reopened = new LocalStore(directory);
  assert.deepEqual(reopened.snapshot().lessons, original.lessons);
  assert.deepEqual(reopened.snapshot().attempts, original.attempts);
  assert.equal(readFileSync(join(directory, 'plans', `${lesson.id}.json`), 'utf8'), artifact);
  const evidence = reopened.context().curriculum!.concepts[0].evidence[0];
  assert.equal(evidence.source, 'retrospective');
  assert.equal(evidence.signal, 'supports');
  reopened.flagAttempt(answer.attempt.id, true, 'accidental-input');
  assert.deepEqual(reopened.context().curriculum!.concepts[0].evidence, []);
  assert.equal(reopened.context().curriculum!.concepts[0].practice!.lastIndependentSuccessAt, null);
  reopened.saveSettings({ ...context().settings, tutorMode: 'baseline' });
  assert.deepEqual(reopened.context().curriculum!.concepts, []);
  assert.equal(reopened.context().skillRetrofits, undefined);
  assert.ok(!buildTutorPrompt({ ...reopened.context(), skillRetrofits: [retrofit] }).includes('Historical judgment supports'));
});
