import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocalStore, lessonHash } from '../server/store.ts';
import { TutorService } from '../server/service.ts';
import { createDemoLesson } from '../server/demo.ts';
import { validateLesson } from '../server/validation.ts';
import { activeArc, arcEvidenceHash, learningTaskPrompt, migrateLearning, parseArcReview, parseDirections, parseLearningPlan, sustainedPatterns } from '../server/learning-journey.ts';
import { buildTutorPrompt } from '../server/prompts.ts';
import { CurriculumReady, DirectionChooser, LegacyLearning } from '../src/LearningJourney.tsx';
import type { ArcReview, DirectionProposal, LearningPlan, ProviderStatus, TutorContext } from '../src/types.ts';

const providers: ProviderStatus[] = [{ id: 'codex', available: true, version: 'test', detail: 'Injected tutor.' }];
const directions: DirectionProposal = {
  options: ['hashing', 'networking', 'recursion'].map(id => ({ id, title: id, summary: `Explore ${id}.`, goal: `Understand ${id} in useful applications.`, why: 'A useful new explanatory idea.', novelty: 'Extends beyond repeated scans.', contexts: ['Python'], preview: { description: 'An accessible explanation.', example: 'A small concrete example.', explanation: 'How the example illustrates the idea.', links: [] } })),
  recommendedId: 'hashing', recommendation: 'Build on familiar dictionary use with a new explanation.',
};
const freshDirections: DirectionProposal = {
  options: ['accessibility', 'databases', 'operating-systems'].map(id => ({ id, title: id, summary: `Explore ${id}.`, goal: `Understand ${id} in useful applications.`, why: 'A useful new explanatory idea.', novelty: 'Introduces a different area.', contexts: [id], preview: { description: 'An accessible explanation.', example: 'A small concrete example.', explanation: 'How the example illustrates the idea.', links: [] } })),
  recommendedId: 'accessibility', recommendation: 'Explore an area not offered in the previous set.',
};
const plan: LearningPlan = { title: 'How hash tables work', goal: 'Understand keys and collisions.', outcomes: [{ id: 'collisions', description: 'Distinguish collisions from equal keys.', evidence: 'Judge varied examples independently.' }],
  lessons: [{ id: 'first', title: 'Keys and buckets', objective: 'Introduce buckets and collisions.', ideas: ['Hash buckets'], role: 'introduce', teaching: 'Offer a short guide and a worked example.', successEvidence: 'Apply the distinction to simple cases.' },
    { id: 'second', title: 'Handling collisions', objective: 'Apply collision handling.', ideas: ['Lookup'], role: 'apply', teaching: 'Fade example support.', successEvidence: 'Judge a different application.' }],
  finishWhen: 'Independent varied examples support the central distinction.', laterChecks: ['A delayed lookup example.'],
};
function storeFor(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'code-swipe-learning-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return new LocalStore(directory);
}
async function addLesson(store: LocalStore, answer = true) {
  const context = store.context();
  const lesson = store.commitLesson(await validateLesson(createDemoLesson(context), context), context.settings);
  if (answer) for (const question of lesson.questions) store.answer(question.id, question.verdict, 500);
  return lesson;
}
function reviewFor(context: TutorContext, complete = false): ArcReview {
  return { decision: complete ? 'complete' : 'continue', summary: 'The learner applied the idea in independent examples.', reason: complete ? 'Enough varied application supports moving on.' : 'Build on the first lesson.',
    outcomes: [{ outcomeId: 'collisions', status: complete ? 'demonstrated' : 'emerging', attemptIds: context.history.flatMap(item => item.attempts).filter(item => item.correct).slice(-3).map(item => item.id), explanation: 'Actual answers support this assessment, with remaining uncertainty.' }],
    remainingLessons: complete ? [] : [plan.lessons[1]], investigations: [], retention: 'Check again after a delay in a future curriculum.' };
}

test('given no preferred contexts, when suggesting directions, then a legacy demo language is not presented as a preference', t => {
  const store = storeFor(t);
  store.saveSettings({ ...store.snapshot().settings, language: 'rust', preferredContexts: [] });
  const prompt = learningTaskPrompt({ kind: 'directions' }, store.context(), store.snapshot().learning!).prompt;
  const promptContext = JSON.parse(prompt.split('\nCONTEXT\n').at(-1)!.split('\nOUTPUT_SCHEMA')[0]);
  assert.deepEqual(promptContext.settings.preferredContexts, []);
  assert.equal(Object.hasOwn(promptContext.settings, 'language'), false);
});

test('given archived lessons and an unanswered current lesson, when migrating and restarting, then legacy evidence and sealed bytes survive while the current lesson is cancelled', async t => {
  let store = storeFor(t);
  const earlier = await addLesson(store);
  const current = await addLesson(store, false);
  const original = store.snapshot();
  const bytes = readFileSync(join(store.directory, 'plans', `${earlier.id}.json`));
  const v3 = { ...original, version: 3, learning: undefined };
  writeFileSync(join(store.directory, 'state.json'), JSON.stringify(v3));
  store = new LocalStore(store.directory);
  assert.equal(store.snapshot().version, 4);
  assert.equal(store.snapshot().learning!.arcs[0].status, 'legacy');
  assert.equal(store.activeLesson()?.id, current.id);
  assert.deepEqual(store.snapshot().attempts, original.attempts);
  assert.deepEqual(migrateLearning(store.snapshot()), store.snapshot());
  store.restartAtDirections();
  const after = store.snapshot();
  assert.equal(store.activeLesson(), undefined);
  assert.equal(store.pendingQuestion(), null);
  assert.deepEqual(after.attempts, original.attempts);
  assert.deepEqual(after.lessons, [earlier]);
  assert.deepEqual(readFileSync(join(store.directory, 'plans', `${earlier.id}.json`)), bytes);
  assert.equal(lessonHash(after.lessons[0]), earlier.predictionHash);
  assert.deepEqual(after.learning!.cancelledLessonIds, [current.id]);
  assert.deepEqual(after.learning!.arcs[0].lessons.map(item => item.lessonId), [earlier.id]);
  assert.equal(new LocalStore(store.directory).activeLesson(), undefined);
  assert.ok(readdirSync(join(store.directory, 'backups')).some(name => name.startsWith('curricula-v3-')));
});

test('given a selected direction, when completing successive lessons, then the tutor revises remaining steps and returns to three choices after completion', async t => {
  const store = storeFor(t);
  const lessonContexts: TutorContext[] = [];
  let reviews = 0;
  let directionRequests = 0;
  const service = new TutorService(store, providers, async context => { lessonContexts.push(structuredClone(context)); return createDemoLesson(context); }, undefined, undefined,
    async (task, context, _journey, options) => {
      assert.ok(options.sessionDirectory?.startsWith(store.directory));
      return task.kind === 'directions' ? ++directionRequests === 1 ? directions : freshDirections : task.kind === 'curriculum' ? plan : reviewFor(context, ++reviews === 2);
    });
  service.next(); await service.settled();
  assert.equal(service.state().learning!.directions!.options.length, 3);
  assert.equal(service.state().question, null);
  const choices = store.snapshot().learning!.directions!;
  assert.throws(() => service.chooseDirection('stale', 'hashing'), /current learning directions/);
  service.chooseDirection(choices.id, choices.recommendedId); await service.settled();
  assert.equal(activeArc(store.snapshot().learning)!.plan.title, plan.title);
  assert.equal(store.pendingQuestion(), null);
  service.next(); await service.settled();
  assert.equal(lessonContexts[0].learningPlan?.step.id, 'first');
  const first = store.activeLesson()!;
  for (const question of first.questions) store.answer(question.id, question.verdict, 700);
  service.next(); await service.settled();
  assert.equal(service.job?.status, 'ready');
  assert.equal(lessonContexts[1].learningPlan?.step.id, 'second');
  assert.equal(activeArc(store.snapshot().learning)!.revisions.length, 1);
  assert.deepEqual(store.snapshot().lessons[0], first);
  const second = store.activeLesson()!;
  for (const question of second.questions) store.answer(question.id, question.verdict, 700);
  service.next(); await service.settled();
  assert.equal(service.job?.status, 'ready');
  assert.equal(store.snapshot().learning!.activeArcId, null);
  assert.equal(store.snapshot().learning!.arcs[0].status, 'complete');
  assert.equal(store.snapshot().learning!.arcs[0].revisions.length, 2);
  assert.equal(store.snapshot().learning!.directions!.options.length, 3);
  assert.equal(store.snapshot().learning!.directions!.options[0].title, 'accessibility');
  assert.equal(service.state().currentLesson, null);
  assert.equal(service.state().reviews.length, first.questions.length + second.questions.length);
});

test('given repeated suggestions and a learner request, when regenerating and choosing, then the tutor avoids repeats and carries the request into lessons', async t => {
  const store = storeFor(t);
  const tasks: string[] = [];
  const service = new TutorService(store, providers, undefined, undefined, undefined, async (task, context, journey) => {
    tasks.push(task.kind);
    if (task.kind === 'directions') {
      const prompt = learningTaskPrompt(task, context, journey).prompt;
      assert.match(prompt, /USER_REQUEST/);
      assert.match(prompt, /DNS caching/);
      if (tasks.length > 1) assert.match(prompt, /RECENTLY_SUGGESTED_DIRECTIONS[\s\S]*hashing/);
      return tasks.length === 1 || tasks.length === 2 ? directions : freshDirections;
    }
    assert.equal(task.kind, 'curriculum');
    assert.equal(task.steering, 'Focus on DNS caching and TTLs.');
    return plan;
  });
  service.proposeDirections('DNS caching'); await service.settled();
  assert.equal(store.snapshot().learning!.directions?.steering, 'DNS caching');
  service.proposeDirections('DNS caching'); await service.settled();
  assert.equal(service.job?.status, 'ready');
  assert.deepEqual(tasks, ['directions', 'directions', 'directions']);
  const saved = store.snapshot().learning!;
  assert.equal(saved.seenDirections?.length, 6);
  assert.equal(saved.directions?.options[0].title, 'accessibility');
  assert.equal(new LocalStore(store.directory).snapshot().learning?.seenDirections?.length, 6);
  service.chooseDirection(saved.directions!.id, 'accessibility', 'Focus on DNS caching and TTLs.'); await service.settled();
  assert.equal(activeArc(store.snapshot().learning)?.steering, 'Focus on DNS caching and TTLs.');
  assert.equal(store.context().learningPlan?.steering, 'Focus on DNS caching and TTLs.');
  assert.match(renderToStaticMarkup(createElement(CurriculumReady, { arc: activeArc(store.snapshot().learning)!, pending: false, onStart() {} })), /Your emphasis: Focus on DNS caching and TTLs/);
});

test('given an unfinished curriculum lesson, when taking general practice, then both sets of cards can be resumed independently', async t => {
  const store = storeFor(t);
  store.saveDirections(directions);
  store.beginCurriculum(store.snapshot().learning!.directions!.id, 'hashing', plan);
  const main = await addLesson(store, false);
  for (const question of main.questions.slice(0, 2)) store.answer(question.id, question.verdict, 500);
  const contexts: TutorContext[] = [];
  const service = new TutorService(store, providers, async context => { contexts.push(structuredClone(context)); return createDemoLesson(context); });
  service.startGeneralPractice(); await service.settled();
  assert.equal(service.job?.status, 'ready', service.job?.message);
  const practice = store.activeLesson()!;
  assert.equal(practice.generalPractice, true);
  assert.notEqual(practice.id, main.id);
  assert.equal(store.snapshot().learning?.mainLessonId, main.id);
  assert.equal(store.snapshot().learning?.practiceLessonId, practice.id);
  assert.equal(activeArc(store.snapshot().learning)?.lessons.length, 1);
  assert.equal(contexts[0].learningPlan, undefined);
  assert.equal(contexts[0].generalPractice?.avoidQuestions.length, main.questions.length - 2);
  assert.match(buildTutorPrompt(contexts[0]), /GENERAL PRACTICE/);
  store.answer(practice.questions[0].id, practice.questions[0].verdict, 500);
  service.returnFromGeneralPractice();
  assert.equal(store.activeLesson()?.id, main.id);
  assert.equal(store.pendingQuestion()?.id, main.questions[2].id);
  service.startGeneralPractice();
  assert.equal(store.activeLesson()?.id, practice.id);
  assert.equal(store.pendingQuestion()?.id, practice.questions[1].id);
  assert.equal(contexts.length, 1);
  const reopened = new LocalStore(store.directory);
  assert.equal(reopened.activeLesson()?.id, practice.id);
  assert.equal(reopened.snapshot().learning?.mainLessonId, main.id);
  assert.equal(reopened.snapshot().learning?.practiceLessonId, practice.id);
  service.returnFromGeneralPractice();
  assert.equal(store.context().history.some(item => item.lesson.id === practice.id && item.attempts.length === 1), true);
});

test('given direction choices without a curriculum lesson, when general practice ends, then the choices remain available', async t => {
  const store = storeFor(t);
  store.saveDirections(directions);
  const choiceId = store.snapshot().learning!.directions!.id;
  const service = new TutorService(store, providers, async context => createDemoLesson(context));
  service.startGeneralPractice(); await service.settled();
  assert.equal(service.job?.status, 'ready', service.job?.message);
  const practice = store.activeLesson()!;
  assert.equal(practice.generalPractice, true);
  for (const question of practice.questions) store.answer(question.id, question.verdict, 500);
  service.returnFromGeneralPractice();
  assert.equal(store.activeLesson(), undefined);
  assert.equal(store.snapshot().learning?.directions?.id, choiceId);
  assert.equal(store.snapshot().learning?.practiceLessonId, practice.id);
  assert.equal(store.publicState(providers, null).lessons.find(item => item.id === practice.id)?.generalPractice, true);
});

test('given untouched general practice, when restarting at directions, then its saved pointer is cleared', async t => {
  const store = storeFor(t);
  const service = new TutorService(store, providers, async context => createDemoLesson(context));
  service.startGeneralPractice(); await service.settled();
  const practiceId = store.activeLesson()!.id;
  assert.equal(store.snapshot().learning?.practiceLessonId, practiceId);
  store.restartAtDirections();
  assert.equal(store.snapshot().learning?.practiceLessonId, null);
  assert.equal(store.snapshot().lessons.some(item => item.id === practiceId), false);
  assert.equal(new LocalStore(store.directory).activeLesson(), undefined);
});

test('given a cancelled direction request, when it returns after a replacement, then only the current choices are published', async t => {
  const store = storeFor(t);
  let resolve!: (value: DirectionProposal) => void;
  const old = new Promise<DirectionProposal>(done => { resolve = done; });
  let count = 0;
  const service = new TutorService(store, providers, undefined, undefined, undefined, async () => ++count === 1 ? old : directions);
  service.proposeDirections();
  const oldWork = service.settled();
  service.cancel();
  service.proposeDirections(); await service.settled();
  const saved = store.snapshot().learning!.directions;
  resolve({ ...directions, recommendation: 'STALE RESPONSE' }); await oldWork;
  assert.deepEqual(store.snapshot().learning!.directions, saved);
  assert.equal(service.job?.status, 'ready');
});

test('given isolated or resolved mistakes, when considering investigations, then only sustained recent attributable errors qualify', async t => {
  const store = storeFor(t);
  const context = store.context();
  const evidence = Array.from({ length: 5 }, (_, index) => ({ attemptId: `a${index}`, lessonId: 'l', title: 'Task', answer: 'buggy' as const, correct: index < 2, answeredAt: `2026-10-${20 + index}T00:00:00Z`, role: 'target' as const, support: 'independent' as const, source: 'planned' as const, signal: index < 2 ? 'supports' as const : 'challenges' as const, rationale: 'Actual target evidence.' }));
  context.curriculum = { concepts: [{ id: 'test', contextPractice: { python: { evidence } } }] as unknown as NonNullable<TutorContext['curriculum']>['concepts'], variants: [], legacyLessons: [] };
  assert.equal(sustainedPatterns(context).length, 1);
  context.curriculum.concepts[0].contextPractice!.python.evidence = evidence.slice(0, 4);
  assert.equal(sustainedPatterns(context).length, 0);
  context.curriculum.concepts[0].contextPractice!.python.evidence = evidence.map(item => ({ ...item, signal: 'inconclusive' }));
  assert.equal(sustainedPatterns(context).length, 0);
  context.settings.tutorMode = 'baseline';
  assert.deepEqual(sustainedPatterns(context), []);
});

test('given public curricula and baseline mode, when building prompts, then baseline has no history and planned lessons follow their selected goal', t => {
  const store = storeFor(t);
  store.saveDirections(directions);
  store.beginCurriculum(store.snapshot().learning!.directions!.id, 'hashing', plan);
  const context = store.context();
  const prompt = buildTutorPrompt(context);
  assert.match(prompt, /How hash tables work/);
  assert.match(prompt, /single error is an observation/);
  assert.match(prompt, /remaining/);
  store.saveSettings({ ...store.snapshot().settings, tutorMode: 'baseline' });
  const baseline = store.context();
  assert.equal(baseline.learningPlan, undefined);
  const baselinePrompt = learningTaskPrompt({ kind: 'directions' }, baseline, store.snapshot().learning!).prompt;
  assert.doesNotMatch(baselinePrompt, /How hash tables work/);
  assert.deepEqual(baseline.history, []);
});

test('given malformed plans or unsupported evidence, when validating, then choices, links and outcome claims cannot be fabricated', async t => {
  assert.throws(() => parseDirections(JSON.stringify({ ...directions, recommendedId: 'absent' })), /one of the three/);
  assert.throws(() => parseDirections(JSON.stringify(directions), directions.options), /repeats one recently offered/);
  const bad = structuredClone(directions);
  bad.options[0].preview.links = [{ title: 'Unsafe', url: 'javascript:alert(1)' }];
  assert.throws(() => parseDirections(JSON.stringify(bad)), /documentation catalog/);
  assert.throws(() => parseLearningPlan(JSON.stringify({ ...plan, lessons: [plan.lessons[0], plan.lessons[0]] })), /distinct IDs/);
  const store = storeFor(t);
  store.saveDirections(directions); store.beginCurriculum(store.snapshot().learning!.directions!.id, 'hashing', plan);
  const lesson = await addLesson(store);
  const arc = activeArc(store.snapshot().learning)!;
  const context = store.context();
  const valid = reviewFor(context);
  assert.throws(() => parseArcReview(JSON.stringify({ ...valid, outcomes: [{ ...valid.outcomes[0], attemptIds: ['invented'] }] }), arc, context), /actual eligible/);
  assert.throws(() => parseArcReview(JSON.stringify({ ...valid, investigations: [{ description: 'Investigate one miss.', attemptIds: context.history[0].attempts.slice(0, 3).map(item => item.id), alternativeExplanation: 'An oversight.' }] }), arc, context), /recurring attributable/);
  const before = arcEvidenceHash(store.snapshot(), arc);
  store.flagAttempt(context.history[0].attempts[0].id, true);
  assert.notEqual(arcEvidenceHash(store.snapshot(), arc), before);
  assert.equal(store.snapshot().lessons[0].predictionHash, lesson.predictionHash);
});

test('given direction previews and a curriculum, when rendered, then options, recommendations and legacy navigation are reviewable without quiz answers', t => {
  const store = storeFor(t);
  store.saveDirections(directions); store.beginCurriculum(store.snapshot().learning!.directions!.id, 'hashing', plan);
  const journey = store.snapshot().learning!;
  const chooser = renderToStaticMarkup(createElement(DirectionChooser, { choices: journey.directions, pending: false, onChoose() {}, onPropose() {} }));
  assert.equal((chooser.match(/data-testid="choose-direction"/g) ?? []).length, 3);
  assert.match(chooser, /Choose for me/);
  assert.match(chooser, /data-testid="suggest-different-directions"/);
  assert.doesNotMatch(chooser, /data-testid="direction-steering"/);
  const outline = renderToStaticMarkup(createElement(CurriculumReady, { arc: activeArc(journey)!, pending: false, onStart() {} }));
  assert.match(outline, /Prepare first/);
  assert.match(outline, /When we’ll move on/);
  const legacy = renderToStaticMarkup(createElement(LegacyLearning, { lessons: [], reviews: [], onSelect() {}, onReview() {} }));
  assert.match(legacy, /Legacy learning/);
});


test('given a coherent introductory curriculum step, when all cards teach and practice that idea, then publication does not require an unrelated investigation or transfer', async t => {
  const store = storeFor(t);
  store.saveDirections(directions); store.beginCurriculum(store.snapshot().learning!.directions!.id, 'hashing', plan);
  const context = store.context();
  const proposal = createDemoLesson(context);
  for (const question of proposal.questions) { question.purpose = 'practice'; question.plan!.purposes = ['practice']; }
  await assert.doesNotReject(validateLesson(proposal, context));
  const standalone = { ...context }; delete standalone.learningPlan;
  await assert.rejects(validateLesson(proposal, standalone), /include teaching, investigation/);
});
