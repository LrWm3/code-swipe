import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { LocalStore } from '../server/store.ts';
import { TutorService } from '../server/service.ts';
import { executePython, pythonAvailability } from '../server/python-runtime.ts';
import { validatePythonQuestionFormat } from '../server/question-format.ts';
import { parseGuide, reviewedGuide } from '../server/concept-guides.ts';
import { buildTutorPrompt } from '../server/prompts.ts';
import type { FunctionSignature, GuideConcept, JsonValue } from '../src/types.ts';

const status = await pythonAvailability();
const sandbox = { skip: status.available ? false : status.detail };
const signature: FunctionSignature = { name: 'count_above', parameters: ['values', 'limit'] };
const doc = '    """Count matching values.\n\n    Args:\n        values: Integer values; not modified.\n        limit: Integer threshold.\n\n    Returns:\n        Number above the limit.\n    """\n';
const source = (body: string) => `def count_above(values, limit):\n${doc}    ${body}\n`;

test('given named Python functions, when reviewing their docstrings, then parameter contracts match on both implementations', () => {
  const question = { signature, code: source('return sum(1 for value in values if value > limit)'), referenceCode: source('return len([value for value in values if value > limit])') };
  assert.doesNotThrow(() => validatePythonQuestionFormat(question));
  assert.throws(() => validatePythonQuestionFormat({ ...question, code: question.code.replace('values: Integer values', 'items: Integer values') }), /document parameter values/);
  assert.throws(() => validatePythonQuestionFormat({ ...question, referenceCode: question.referenceCode.replace('Integer threshold.', 'Different threshold.') }), /identical docstring/);
});

test('given Python code, when running separate fixtures, then outputs exceptions and mutations are recorded accurately', sandbox, async () => {
  const run = (code: string, input: JsonValue) => executePython(code, input, 'candidate', undefined, signature);
  assert.deepEqual(await run(source('return sum(1 for value in values if value > limit)'), [[0, 2, 4], 1]), { actual: 2, error: null });
  const thrown = await run(source('return 1 // 0'), [[], 1]);
  assert.match(thrown.error!, /division.*zero/);
  const mutated = await run(source('values.append(limit)\n    return 0'), [[1], 2]);
  assert.match(mutated.error!, /modified an input/);
});

test('given unsupported imports invalid JSON or nonterminating code, when validating Python, then failures cannot establish a verdict', sandbox, async () => {
  const run = (code: string) => executePython(code, [[], 1], 'candidate', undefined, signature);
  await assert.rejects(run(`import os\n${source('return 0')}`), /Only .* imports are supported/);
  await assert.rejects(run(source('return open("/etc/passwd").read()')), /pure function/);
  await assert.rejects(run(`import typing\n${source('return typing.sys.version')}`), /restricted attribute/);
  await assert.rejects(run(source('return float("nan")')), /finite JSON/);
  await assert.rejects(run(source('while True:\n        pass')), /timed out or failed/);
});

test('given a running Python fixture, when validation is cancelled, then the sandbox stops without a verdict', sandbox, async () => {
  const controller = new AbortController();
  const pending = executePython(source('while True:\n        pass'), [[], 1], 'candidate', controller.signal, signature);
  setTimeout(() => controller.abort(), 500);
  await assert.rejects(pending, /cancelled/i);
});

test('given a Python demo and an existing JavaScript notebook, when practicing a concept, then both languages retain their own sealed plans', { ...sandbox, timeout: 180_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'swipe-python-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  store.saveSettings({ ...store.snapshot().settings, provider: 'demo', language: 'javascript', batchSize: 6 });
  const service = new TutorService(store, [{ id: 'demo', available: true, version: '1', detail: 'Demo' }]);
  t.after(() => service.close());
  service.plan(); await service.settled();
  const earlier = store.activeLesson()!;
  const artifact = readFileSync(join(directory, 'plans', `${earlier.id}.json`), 'utf8');
  for (const question of earlier.questions) store.answer(question.id, question.verdict, 1000);
  store.saveSettings({ ...store.snapshot().settings, language: 'python' });
  service.plan(); await service.settled();
  assert.equal(service.job?.status, 'ready', service.job?.message);
  const lesson = store.activeLesson()!;
  assert.equal(lesson.language, 'python');
  assert.equal(lesson.questions.length, 6);
  assert.ok(lesson.questions.every(question => question.signature?.name.includes('_')));
  assert.ok(lesson.questions.every(question => question.code.includes('    """')));
  assert.equal(store.publicState([], null).question?.language, 'python');
  assert.equal(store.publicState([], null).metrics.count, 0, 'JavaScript judgments are not counted as Python predictions.');
  service.prepareGuide('python-demo-code-review', 'python');
  store.recordGuideEvent('python-demo-code-review', 'opened', 'python');
  service.plan({ conceptId: 'python-demo-code-review', length: 4, language: 'python' }); await service.settled();
  assert.equal(service.job?.status, 'ready', service.job?.message);
  const focus = store.activeLesson()!;
  assert.equal(focus.language, 'python');
  assert.equal(focus.focus?.parentLessonId, lesson.id);
  assert.equal(focus.questions.length, 4);
  store.answer(focus.questions[0].id, focus.questions[0].verdict, 1000);
  store.resumeParent();
  assert.equal(store.activeLesson()?.id, lesson.id);
  assert.equal(store.publicState([], null).metrics.count, 1);
  assert.equal(readFileSync(join(directory, 'plans', `${earlier.id}.json`), 'utf8'), artifact);
  const original = store.snapshot();
  assert.deepEqual(new LocalStore(directory).snapshot(), original);
  assert.match(buildTutorPrompt(store.context()), /Python questions/);
  assert.doesNotMatch(buildTutorPrompt(store.context()), /multiline JSDoc/);
});

test('given a missing Python sandbox, when starting a Python lesson, then the app reports setup guidance without publishing a plan', t => {
  const directory = mkdtempSync(join(tmpdir(), 'swipe-python-missing-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  store.saveSettings({ ...store.snapshot().settings, provider: 'demo', language: 'python' });
  const service = new TutorService(store, [{ id: 'demo', available: true, version: '1', detail: 'Demo' }], undefined, undefined,
    [{ id: 'javascript', available: true, detail: 'Ready' }, { id: 'python', available: false, detail: 'Start Docker and install the Python sandbox image.' }]);
  assert.throws(() => service.plan(), /Start Docker/);
  assert.equal(service.job, null);
  assert.equal(store.snapshot().lessons.length, 0);
});

test('given JavaScript and Python guides for one concept, when saving or recording each, then they remain separate', sandbox, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'swipe-guide-lang-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  store.saveSettings({ ...store.snapshot().settings, provider: 'demo' });
  const service = new TutorService(store, [{ id: 'demo', available: true, version: '1', detail: 'Demo' }]);
  t.after(() => service.close());
  service.plan(); await service.settled();
  const concept: GuideConcept = store.concept('demo-code-review')!;
  const javascript = reviewedGuide(concept, 'javascript')!;
  const python = reviewedGuide(concept, 'python')!;
  store.saveGuide(javascript); store.saveGuide(python);
  store.recordGuideEvent(concept.id, 'opened', 'python');
  assert.deepEqual(store.snapshot().guides?.map(item => item.language), ['javascript', 'python']);
  assert.equal(store.snapshot().guideEvents?.at(-1)?.version, python.version);
  assert.equal(store.snapshot().guideEvents?.at(-1)?.language, 'python');
  const wire = { title: 'Absolute distance', description: 'Distance ignores direction.', takeaway: 'Distance is nonnegative.', examples: [{ expression: 'abs(4 - 9)', expectedJson: '5', explanation: 'The distance is five.' }] };
  const result = await parseGuide(JSON.stringify(wire), { id: 'absolute_difference', name: 'Distance', description: 'Distance between numbers.' }, undefined, 'python');
  assert.equal(result.language, 'python');
  assert.equal(result.examples[0].result, 5);
  assert.match(result.links[0].url, /^https:\/\/docs\.python\.org\//);
});
