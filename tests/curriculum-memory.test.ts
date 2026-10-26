import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildCurriculumMemory } from '../server/curriculum-memory.ts';
import { DEFAULT_SETTINGS, lessonHash, LocalStore } from '../server/store.ts';
import type { Answer, Attempt, ConceptUpdate, Exercise, Lesson, QuestionPlan, StoreData } from '../src/types.ts';

const timestamp = (index: number) => new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();

function update(overrides: Partial<ConceptUpdate> = {}): ConceptUpdate {
  return {
    id: 'bounds', name: 'Loop boundaries', description: 'Half-open intervals and off-by-one errors.',
    representations: ['loops'], prerequisiteIds: [], familiarity: 'unknown', evidenceAttemptIds: [],
    uncertainty: 'No competence established.', nextProbe: 'Compare inclusive and exclusive bounds.', ...overrides,
  };
}

function question(id: string, plan: Partial<QuestionPlan> = {}): Exercise {
  return {
    id, title: `Exercise ${id}`, specification: 'Return the input.', code: 'function solve(x) { return x; }',
    referenceCode: 'function solve(x) { return x; }', verdict: 'correct', explanation: 'The input is returned unchanged.',
    tests: [{ input: 1, expected: 1, note: 'Positive input.' }], purpose: 'practice', hypothesisId: null,
    ifCorrect: 'Probe transfer.', ifIncorrect: 'Offer a worked example.', prediction: { pCorrect: 0.5, rationale: 'Uncertain prior.' },
    validation: { checkedAt: timestamp(0), testCount: 1, passedCount: 1, failures: [] },
    plan: {
      purposes: ['practice'], educationalObjective: 'Recognize bounds.', investigativeObjective: 'Check boundary understanding.',
      conceptIds: ['bounds'], prerequisiteIds: [], stage: 'build', cognitiveDemand: 2,
      difficultyRationale: 'One boundary to track.', scaffolding: 'Use a short trace.', ifIdk: 'Trace one iteration.',
      familyId: 'boundary-family', counterpart: 'defer', variantReason: 'Vary the boundary in a later lesson.', ...plan,
    },
  };
}

function lesson(index: number, questions = [question(`q${index}`)], updates = [update()]): Lesson {
  const result: Lesson = {
    id: `lesson${index}`, createdAt: timestamp(index * 10), provider: 'demo', model: '', tutorMode: 'reflective', interests: '',
    objective: `Objective ${index}`, rationale: 'Build transferable understanding.', assumptions: [], reflection: 'Evidence remains tentative.',
    hypotheses: [], questions, predictionHash: '',
    curriculum: { conceptUpdates: updates, observations: [], frontier: [], mixRationale: 'Practice with transfer.', sequenceRationale: 'Increase demand gradually.' },
  };
  result.predictionHash = lessonHash(result);
  return result;
}

function answer(item: Lesson, index = 0, response: Answer = 'correct'): Attempt {
  return {
    id: `attempt-${item.questions[index].id}`, lessonId: item.id, exerciseId: item.questions[index].id,
    answer: response, correct: response === 'idk' ? null : response === item.questions[index].verdict,
    answeredAt: new Date(Date.parse(item.createdAt) + (index + 1) * 1000).toISOString(), elapsedMs: 1000, flagged: false,
  };
}

function archive(lessons: Lesson[], attempts = lessons.flatMap(item => item.questions.map((_, index) => answer(item, index)))): StoreData {
  return { version: 1, settings: { ...DEFAULT_SETTINGS, provider: 'demo' }, lessons, attempts };
}

test('given more than twelve archived lessons, when rebuilding after restart, then early concepts counts citations and variant families survive recent-history truncation', t => {
  const lessons = Array.from({ length: 18 }, (_, index) => lesson(index));
  lessons[0].questions[0].plan!.conceptIds.push('early-only');
  lessons[0].curriculum!.conceptUpdates.push(update({ id: 'early-only', name: 'Early concept' }));
  const cited = ['attempt-q0', 'attempt-q1', 'attempt-q2'];
  lessons[17].curriculum!.conceptUpdates = [update({
    name: 'Latest boundary name', description: 'Latest description.', uncertainty: 'Transfer still needs testing.',
    familiarity: 'familiar', evidenceAttemptIds: cited,
  })];
  for (const item of lessons) item.predictionHash = lessonHash(item);
  const data = archive(lessons);
  const expected = buildCurriculumMemory(data);
  const bounds = expected.concepts.find(item => item.id === 'bounds')!;
  assert.equal(bounds.exposures, 18);
  assert.equal(bounds.correctJudgments, 18);
  assert.equal(bounds.familiarity, 'familiar');
  assert.equal(bounds.description, 'Latest description.');
  assert.equal(bounds.uncertainty, 'Transfer still needs testing.');
  assert.equal(bounds.evidence.length, 6);
  assert.ok(cited.every(id => bounds.evidence.some(item => item.attemptId === id)));
  assert.equal(expected.concepts.find(item => item.id === 'early-only')?.exposures, 1);
  assert.equal(expected.variants.length, 1);
  assert.equal(expected.variants[0].askedCount, 18);
  assert.equal(expected.variants[0].lastAskedAt, data.attempts.at(-1)!.answeredAt);
  assert.deepEqual(expected.variants[0].conceptIds, ['bounds', 'early-only']);

  const directory = mkdtempSync(join(tmpdir(), 'code-swipe-curriculum-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'plans'));
  writeFileSync(join(directory, 'state.json'), JSON.stringify(data));
  for (const item of lessons) writeFileSync(join(directory, 'plans', `${item.id}.json`), JSON.stringify(item));
  const restarted = new LocalStore(directory);
  assert.equal(restarted.context().history.length, 12);
  assert.ok(restarted.context().history.every(item => item.lesson.id !== lessons[0].id));
  assert.deepEqual(buildCurriculumMemory(restarted.snapshot()), expected);
  assert.equal(restarted.snapshot().lessons[0].predictionHash, lessonHash(lessons[0]));
});

test('given a familiar concept supported across lessons, when evidence is flagged and restored, then competence retracts without losing exposure or editing sealed plans', () => {
  const first = lesson(0, [question('first'), question('second')]);
  const second = lesson(1, [question('third')]);
  const refs = ['attempt-first', 'attempt-second', 'attempt-third'];
  const pending = lesson(2, [question('pending')], [update({ familiarity: 'familiar', evidenceAttemptIds: refs })]);
  const data = archive([first, second, pending], [answer(first), answer(first, 1), answer(second)]);
  const originalPlans = JSON.stringify(data.lessons);
  assert.equal(buildCurriculumMemory(data).concepts[0].familiarity, 'familiar');

  data.attempts[0].flagged = true;
  let concept = buildCurriculumMemory(data).concepts[0];
  assert.equal(concept.exposures, 3);
  assert.equal(concept.correctJudgments, 2);
  assert.equal(concept.familiarity, 'developing');
  assert.deepEqual(concept.evidenceAttemptIds, refs.slice(1));
  assert.ok(concept.evidence.every(item => item.attemptId !== refs[0]));

  data.attempts.forEach(item => { item.flagged = true; });
  concept = buildCurriculumMemory(data).concepts[0];
  assert.equal(concept.exposures, 3);
  assert.equal(concept.correctJudgments, 0);
  assert.equal(concept.familiarity, 'introduced');
  assert.deepEqual(concept.evidence, []);
  assert.deepEqual(concept.evidenceAttemptIds, []);
  data.attempts.forEach(item => { item.flagged = false; });
  assert.equal(buildCurriculumMemory(data).concepts[0].familiarity, 'familiar');
  assert.equal(JSON.stringify(data.lessons), originalPlans);
});

test('given IDK and incorrect answers, when rebuilding memory, then uncertainty and errors stay distinct from competence', () => {
  const first = lesson(0, [question('unsure'), question('wrong')], [update({ familiarity: 'developing' })]);
  const data = archive([first], [answer(first, 0, 'idk'), answer(first, 1, 'buggy')]);
  const concept = buildCurriculumMemory(data).concepts[0];
  assert.equal(concept.exposures, 2);
  assert.equal(concept.correctJudgments, 0);
  assert.equal(concept.incorrectJudgments, 1);
  assert.equal(concept.uncertainJudgments, 1);
  assert.equal(concept.familiarity, 'introduced');
  assert.equal(concept.evidence.find(item => item.answer === 'idk')?.correct, null);
  data.attempts[0].flagged = true;
  assert.equal(buildCurriculumMemory(data).concepts[0].uncertainJudgments, 0);
  assert.equal(buildCurriculumMemory(data).concepts[0].exposures, 2);
});

test('given generated but unanswered exercises, when rebuilding memory, then pending families persist without inventing exposure or familiarity', () => {
  const first = lesson(0, [question('asked'), question('deferred', { familyId: 'deferred-family' }), question('unasked', {
    familyId: 'unasked-family', counterpart: 'unasked', variantReason: 'Keep one matched variant unused.', conceptIds: ['new-concept'],
  })], [update({ familiarity: 'introduced' }), update({ id: 'new-concept', familiarity: 'familiar' })]);
  const memory = buildCurriculumMemory(archive([first], [answer(first)]));
  assert.equal(memory.concepts.find(item => item.id === 'bounds')?.exposures, 1);
  const fresh = memory.concepts.find(item => item.id === 'new-concept')!;
  assert.equal(fresh.exposures, 0);
  assert.equal(fresh.lastSeenAt, null);
  assert.equal(fresh.familiarity, 'unknown');
  assert.deepEqual(fresh.evidence, []);
  assert.equal(memory.variants.find(item => item.familyId === 'boundary-family')?.askedCount, 1);
  for (const familyId of ['deferred-family', 'unasked-family']) {
    assert.equal(memory.variants.find(item => item.familyId === familyId)?.askedCount, 0);
    assert.equal(memory.variants.find(item => item.familyId === familyId)?.lastAskedAt, null);
    assert.deepEqual(memory.variants.find(item => item.familyId === familyId)?.askedVerdicts, []);
  }
  assert.equal(memory.variants.find(item => item.familyId === 'deferred-family')?.counterpart, 'defer');
  assert.equal(memory.variants.find(item => item.familyId === 'deferred-family')?.counterpartStatus, 'deferred');
  assert.equal(memory.variants.find(item => item.familyId === 'unasked-family')?.counterpartStatus, 'unasked');
  assert.equal(memory.variants.find(item => item.familyId === 'unasked-family')?.reason, 'Keep one matched variant unused.');
});

test('given legacy answers and later concept citations, when rebuilding memory, then historical exposure is mapped without rewriting legacy plans', () => {
  const old = lesson(0, [question('old-correct'), question('old-flagged')]);
  delete old.curriculum;
  old.questions.forEach(item => { delete item.plan; });
  const current = lesson(1, [question('current')], [update({
    familiarity: 'developing', evidenceAttemptIds: ['attempt-old-correct', 'attempt-old-flagged'],
  })]);
  const first = answer(old);
  const flagged = { ...answer(old, 1), flagged: true };
  const data = archive([old, current], [first, flagged]);
  const original = JSON.stringify(old);
  const memory = buildCurriculumMemory(data);
  assert.deepEqual(memory.legacyLessons, [{ lessonId: old.id, objective: old.objective, answered: 2 }]);
  assert.equal(memory.concepts[0].exposures, 2);
  assert.equal(memory.concepts[0].correctJudgments, 1);
  assert.deepEqual(memory.concepts[0].evidenceAttemptIds, [first.id]);
  assert.equal(memory.variants[0].askedCount, 0);
  assert.equal(JSON.stringify(old), original);
});

test('given orphan mismatched and unrelated evidence references, when rebuilding memory, then only actual linked concept answers are retained', () => {
  const first = lesson(0, [question('valid'), question('inconsistent'), question('flagged')]);
  const unrelated = lesson(1, [question('other', { conceptIds: ['other'] })], [update({ id: 'other' })]);
  const current = lesson(2, [question('pending')], [update({ familiarity: 'familiar', evidenceAttemptIds: [
    'attempt-valid', 'attempt-valid', 'attempt-inconsistent', 'attempt-flagged', 'attempt-other', 'wrong-lesson', 'missing-question', 'missing-lesson', 'nonexistent',
  ] })]);
  const valid = answer(first, 0, 'idk');
  const data = archive([first, unrelated, current], [valid,
    { ...answer(first, 1, 'buggy'), correct: true },
    { ...answer(first, 2), flagged: true }, answer(unrelated),
    { ...valid, id: 'wrong-lesson', lessonId: unrelated.id },
    { ...valid, id: 'missing-question', exerciseId: 'missing' },
    { ...valid, id: 'missing-lesson', lessonId: 'missing' },
  ]);
  const concept = buildCurriculumMemory(data).concepts.find(item => item.id === 'bounds')!;
  assert.deepEqual(concept.evidenceAttemptIds, ['attempt-valid']);
  assert.equal(concept.exposures, 2);
  assert.equal(concept.uncertainJudgments, 1);
  assert.equal(concept.correctJudgments, 0);
  assert.equal(concept.familiarity, 'introduced');
  assert.deepEqual(concept.evidence.map(item => item.attemptId), ['attempt-valid']);
});

test('given three correct answers within one lesson, when a plan claims familiarity, then the claim remains developing', () => {
  const first = lesson(0, [question('one'), question('two'), question('three')]);
  const current = lesson(1, [question('pending')], [update({ familiarity: 'familiar', evidenceAttemptIds: [
    'attempt-one', 'attempt-two', 'attempt-three',
  ] })]);
  const memory = buildCurriculumMemory(archive([first, current], first.questions.map((_, index) => answer(first, index))));
  assert.equal(memory.concepts[0].correctJudgments, 3);
  assert.equal(memory.concepts[0].familiarity, 'developing');
});

test('given archived learner history, when baseline mode is selected, then no concepts variants or legacy lesson summaries are exposed', () => {
  const old = lesson(0);
  delete old.curriculum;
  const data = archive([old, lesson(1)]);
  data.settings.tutorMode = 'baseline';
  assert.deepEqual(buildCurriculumMemory(data), { concepts: [], variants: [], legacyLessons: [] });
});

test('given an established reflective assessment, when returning from baseline lessons, then its assessment persists while baseline answers and new definitions remain available', () => {
  const first = lesson(0, [question('first')]);
  const second = lesson(1, [question('second'), question('third')]);
  const citations = ['attempt-first', 'attempt-second', 'attempt-third'];
  const assessment = lesson(2, [question('review')], [update({
    familiarity: 'familiar', evidenceAttemptIds: citations, description: 'Reflective description.',
    uncertainty: 'Check transfer to recursion.', nextProbe: 'Compare recursive base cases.',
  })]);
  const baseline = lesson(3, [question('baseline-known'), question('baseline-new', { conceptIds: ['new-concept'] })], [
    update({ description: 'Fresh baseline definition.', uncertainty: 'No history available.' }),
    update({ id: 'new-concept', name: 'New baseline concept', description: 'First recorded definition.' }),
  ]);
  baseline.tutorMode = 'baseline';
  const data = archive([first, second, assessment, baseline]);
  data.attempts.find(item => item.exerciseId === 'baseline-known')!.answer = 'buggy';
  data.attempts.find(item => item.exerciseId === 'baseline-known')!.correct = false;
  const memory = buildCurriculumMemory(data);
  const known = memory.concepts.find(item => item.id === 'bounds')!;
  assert.equal(known.familiarity, 'familiar');
  assert.equal(known.description, 'Reflective description.');
  assert.equal(known.uncertainty, 'Check transfer to recursion.');
  assert.equal(known.nextProbe, 'Compare recursive base cases.');
  assert.deepEqual(known.evidenceAttemptIds, citations);
  assert.equal(known.exposures, 5);
  assert.equal(known.correctJudgments, 4);
  assert.equal(known.incorrectJudgments, 1);
  const added = memory.concepts.find(item => item.id === 'new-concept')!;
  assert.equal(added.name, 'New baseline concept');
  assert.equal(added.description, 'First recorded definition.');
  assert.equal(added.exposures, 1);
  assert.equal(added.correctJudgments, 1);
  assert.equal(added.familiarity, 'unknown');

  data.lessons.push(lesson(4, [question('resumed')], [update({ familiarity: 'developing', uncertainty: 'Revise after baseline error.' })]));
  assert.equal(buildCurriculumMemory(data).concepts[0].uncertainty, 'Revise after baseline error.');
  assert.equal(buildCurriculumMemory(data).concepts[0].familiarity, 'developing');
});

test('given many old success citations and recent counterexamples, when summarizing evidence, then recent responses and diverse familiarity support fit within six entries', () => {
  const first = lesson(0, [question('early-success')]);
  const repeated = lesson(1, Array.from({ length: 6 }, (_, index) => question(`same-lesson-${index}`)));
  const citations = [...first.questions, ...repeated.questions].map(item => `attempt-${item.id}`);
  const latest = lesson(2, [question('recent-wrong'), question('recent-idk'), question('newest-wrong')], [update({
    familiarity: 'familiar', evidenceAttemptIds: citations,
  })]);
  const data = archive([first, repeated, latest], [answer(first), ...repeated.questions.map((_, index) => answer(repeated, index)),
    answer(latest, 0, 'buggy'), answer(latest, 1, 'idk'), answer(latest, 2, 'buggy'),
  ]);
  const concept = buildCurriculumMemory(data).concepts[0];
  assert.equal(concept.familiarity, 'familiar');
  assert.equal(concept.evidence.length, 6);
  for (const question of latest.questions) assert.ok(concept.evidence.some(item => item.attemptId === `attempt-${question.id}`));
  const supporting = concept.evidence.filter(item => citations.includes(item.attemptId) && item.correct === true);
  assert.equal(supporting.length, 3);
  assert.equal(new Set(supporting.map(item => item.lessonId)).size, 2);
  assert.equal(concept.correctJudgments, 7);
  assert.equal(concept.incorrectJudgments, 2);
  assert.equal(concept.uncertainJudgments, 1);
});

test('given a deferred variant family, when repeated implementations and its later counterpart are answered, then only seeing both implementation verdicts closes the counterpart', () => {
  const first = lesson(0, [question('first-correct')]);
  const repeated = lesson(1, [question('repeated-correct')]);
  const counterpart = lesson(2, [question('later-buggy')]);
  counterpart.questions[0].verdict = 'buggy';
  const data = archive([first], [answer(first, 0, 'buggy')]);
  let family = buildCurriculumMemory(data).variants[0];
  assert.equal(family.counterpartStatus, 'deferred');
  assert.deepEqual(family.askedVerdicts, ['correct']);

  data.lessons.push(repeated, counterpart);
  data.attempts.push(answer(repeated, 0, 'idk'));
  family = buildCurriculumMemory(data).variants[0];
  assert.equal(family.askedCount, 2);
  assert.deepEqual(family.askedVerdicts, ['correct']);
  assert.equal(family.counterpartStatus, 'deferred');

  data.attempts.push({ ...answer(counterpart, 0, 'correct'), flagged: true });
  family = buildCurriculumMemory(data).variants[0];
  assert.equal(family.askedCount, 3);
  assert.deepEqual(family.askedVerdicts, ['correct', 'buggy']);
  assert.equal(family.counterpartStatus, 'shown');
  assert.equal(family.counterpart, 'defer');
  assert.equal(family.lastAskedAt, data.attempts.at(-1)!.answeredAt);
});

test('given an in-lesson counterpart plan, when only one implementation is answered, then the counterpart remains unasked until its answer is recorded', () => {
  const pair = lesson(0, [question('correct-half', { counterpart: 'in-lesson' }), question('buggy-half', { counterpart: 'in-lesson' })]);
  pair.questions[1].verdict = 'buggy';
  const data = archive([pair], [answer(pair)]);
  assert.equal(buildCurriculumMemory(data).variants[0].counterpartStatus, 'unasked');
  assert.deepEqual(buildCurriculumMemory(data).variants[0].askedVerdicts, ['correct']);
  data.attempts.push(answer(pair, 1, 'idk'));
  assert.equal(buildCurriculumMemory(data).variants[0].counterpartStatus, 'shown');
  assert.equal(buildCurriculumMemory(data).variants[0].counterpart, 'in-lesson');
});
