import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStore } from '../server/store.ts';
import { TutorService } from '../server/service.ts';
import { parseGuide, reviewedGuide } from '../server/concept-guides.ts';
import { buildTutorPrompt } from '../server/prompts.ts';
import { createDemoLesson } from '../server/demo.ts';
import { validateLesson } from '../server/validation.ts';
import type { GuideConcept } from '../src/types.ts';

const available = [{ id: 'demo' as const, available: true, version: '1', detail: 'Offline demo' }];
function temporaryTutor(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'swipe-concept-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  store.saveSettings({ ...store.snapshot().settings, provider: 'demo' });
  return { store, tutor: new TutorService(store, available) };
}

test('given an optional guide and focused practice, when returning to the main lesson, then its questions and precommitted predictions are preserved', async t => {
  const { store, tutor } = temporaryTutor(t);
  t.after(() => tutor.close());
  tutor.plan(); await tutor.settled();
  assert.equal(tutor.job?.status, 'ready');
  const parent = store.activeLesson()!;
  const artifact = readFileSync(join(store.directory, 'plans', `${parent.id}.json`), 'utf8');
  assert.deepEqual(store.previewConcepts().map(item => item.id), ['demo-code-review']);
  tutor.prepareGuide('demo-code-review');
  assert.equal(store.snapshot().guides?.[0].examples.length, 2);
  store.recordGuideEvent('demo-code-review', 'opened');
  store.recordGuideEvent('demo-code-review', 'unclear');
  tutor.plan({ conceptId: 'demo-code-review', length: 4 }); await tutor.settled();
  assert.equal(tutor.job?.status, 'ready', tutor.job?.message);
  const focused = store.activeLesson()!;
  assert.equal(focused.focus?.parentLessonId, parent.id);
  assert.equal(focused.questions.length, 4);
  assert.equal(store.snapshot().settings.batchSize, 8);
  assert.throws(() => tutor.plan({ conceptId: 'demo-code-review', length: 4 }), /main lesson/);
  store.answer(focused.questions[0].id, focused.questions[0].verdict, 1000);
  let reopened = new LocalStore(store.directory);
  assert.equal(reopened.activeLesson()?.id, focused.id);
  assert.equal(reopened.pendingQuestion()?.id, focused.questions[1].id);
  for (const question of focused.questions.slice(1)) store.answer(question.id, question.verdict, 1000);
  assert.equal(store.publicState(available, tutor.job).currentLesson?.complete, true);
  store.resumeParent();
  reopened = new LocalStore(store.directory);
  assert.equal(reopened.activeLesson()?.id, parent.id);
  assert.equal(reopened.pendingQuestion()?.id, parent.questions[0].id);
  assert.deepEqual(reopened.previewConcepts().map(item => item.id), ['demo-code-review']);
  assert.equal(readFileSync(join(store.directory, 'plans', `${parent.id}.json`), 'utf8'), artifact);
  assert.deepEqual(reopened.snapshot().lessons.find(item => item.id === parent.id), parent);
  reopened.startPreparedLesson(parent.id);
  assert.deepEqual(reopened.previewConcepts(), []);
  const review = reopened.answer(parent.questions[0].id, parent.questions[0].verdict, 1000);
  assert.deepEqual(review.teachingBeforeAnswer, ['Opened guide: JavaScript function review', 'Focused practice: JavaScript function review']);
  assert.equal(review.question.prediction.pCorrect, parent.questions[0].prediction.pCorrect);
  const prompt = buildTutorPrompt(reopened.context());
  assert.match(prompt, /guideEvents/);
  assert.match(prompt, /self-report, never evidence of competence/);
});

test('given focused demo practice, when choosing six cards, then every card is validated and targets the selected concept', async t => {
  const { store, tutor } = temporaryTutor(t);
  t.after(() => tutor.close());
  tutor.plan(); await tutor.settled();
  tutor.plan({ conceptId: 'demo-code-review', length: 6 }); await tutor.settled();
  assert.equal(tutor.job?.status, 'ready', tutor.job?.message);
  assert.equal(store.activeLesson()?.questions.length, 6);
  assert.ok(store.activeLesson()?.questions.every(question => question.plan?.conceptIds.includes('demo-code-review')));
});

test('given a question introducing a new concept outside the frontier list, when the lesson is prepared, then the preview still offers that concept', async t => {
  const { store, tutor } = temporaryTutor(t);
  t.after(() => tutor.close());
  const context = store.context();
  const proposal = createDemoLesson(context);
  proposal.questions[0].plan!.purposes.push('introduction');
  proposal.curriculum!.conceptUpdates.push({ ...proposal.curriculum!.conceptUpdates[0], id: 'later-concept', name: 'A later concept' });
  proposal.curriculum!.frontier = [{ conceptId: 'later-concept', decision: 'defer', reason: 'Save this concept for later.' }];
  store.commitLesson(await validateLesson(proposal, context), context.settings);
  assert.deepEqual(store.previewConcepts().map(item => item.id), ['demo-code-review']);
});

test('given an unfinished focused lesson, when leaving practice, then completed answers remain and the main lesson resumes', async t => {
  const { store, tutor } = temporaryTutor(t);
  t.after(() => tutor.close());
  tutor.plan(); await tutor.settled();
  const parent = store.activeLesson()!;
  tutor.plan({ conceptId: 'demo-code-review', length: 4 }); await tutor.settled();
  const focus = store.activeLesson()!;
  store.answer(focus.questions[0].id, 'idk', 1234);
  store.resumeParent();
  const reopened = new LocalStore(store.directory);
  assert.equal(reopened.activeLesson()?.id, parent.id);
  assert.equal(reopened.snapshot().attempts.length, 1);
  assert.deepEqual(reopened.snapshot().endedFocusIds, [focus.id]);
  assert.equal(reopened.publicState(available, null).lessons.find(item => item.id === focus.id)?.endedEarly, true);
  assert.deepEqual(reopened.context().focusHistory?.at(-1), { lessonId: focus.id, parentLessonId: parent.id, conceptId: 'demo-code-review', answered: 1, total: 4, endedEarly: true });
});

test('given an unanswered parent question, when a focused practice question duplicates it, then the mini-lesson is rejected', async t => {
  const { store, tutor } = temporaryTutor(t);
  t.after(() => tutor.close());
  tutor.plan(); await tutor.settled();
  const parent = store.activeLesson()!;
  const concept = store.concept('demo-code-review')!;
  const context = store.context();
  context.settings.batchSize = 4;
  context.focus = { concept, parentLessonId: parent.id, avoidQuestions: parent.questions };
  const proposal = createDemoLesson(context);
  proposal.questions[0] = { ...structuredClone(parent.questions[0]), plan: { ...structuredClone(parent.questions[0].plan!), familyId: 'different-family' } };
  delete (proposal.questions[0] as { id?: string }).id;
  delete (proposal.questions[0] as { validation?: unknown }).validation;
  await assert.rejects(validateLesson(proposal, context), /duplicates an unanswered question/);
});

test('given a generated guide, when examples are checked in the sandbox, then incorrect outputs and unverified links are rejected', async () => {
  const concept: GuideConcept = { id: 'distance', name: 'Distance', description: 'Distance between two numbers.' };
  const input = { title: 'Distance', description: 'Absolute difference removes direction.', takeaway: 'Distance is nonnegative.',
    examples: [{ expression: 'Math.abs(4 - 9)', expectedJson: '5', explanation: 'The distance is five.' }] };
  const guide = await parseGuide(JSON.stringify(input), concept);
  assert.deepEqual(guide.examples[0].result, 5);
  assert.ok(guide.links.every(link => new URL(link.url).hostname === 'developer.mozilla.org'));
  await assert.rejects(parseGuide(JSON.stringify({ ...input, examples: [{ ...input.examples[0], expectedJson: '4' }] }), concept), /did not produce/);
  await assert.rejects(parseGuide(JSON.stringify({ ...input, links: ['https://example.com'] }), concept), /invalid|unknown|extra|not allowed/i);
  await assert.rejects(parseGuide(JSON.stringify({ ...input, examples: [{ ...input.examples[0], expression: 'process.exit()' }] }), concept), /did not produce/);
});

test('given reviewed guides, when running their examples, then each stated result agrees with JavaScript', async () => {
  for (const id of ['absolute_difference', 'compound_conditions', 'demo-code-review']) {
    const concept: GuideConcept = { id, name: id, description: 'Example concept.' };
    const guide = reviewedGuide(concept)!;
    const wire = { title: guide.title, description: guide.description, takeaway: guide.takeaway,
      examples: guide.examples.map(example => ({ expression: example.expression, expectedJson: JSON.stringify(example.result), explanation: example.explanation })) };
    const checked = await parseGuide(JSON.stringify(wire), concept);
    assert.deepEqual(checked.examples.map(item => item.result), guide.examples.map(item => item.result));
  }
});
