import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDemoLesson } from '../server/demo.ts';
import { DEFAULT_SETTINGS } from '../server/store.ts';
import { validateQuestionFormat } from '../server/question-format.ts';
import { execute, validateLesson } from '../server/validation.ts';
import type { TutorContext } from '../src/types.ts';

const context: TutorContext = { settings: DEFAULT_SETTINGS, history: [], hypotheses: [], metrics: { count: 0, brier: null, accuracy: null, calibration: [], byPurpose: [] } };

test('given multiple named parameters, when checking a lesson, then positional calls retain exact counterexamples', async () => {
  const result = await validateLesson(createDemoLesson(context), context);
  const question = result.questions[6];
  assert.deepEqual(question.signature, { name: 'firstMatchingIndex', parameters: ['values', 'target'] });
  assert.deepEqual(result.reports[6].failures, [{ input: [[7, 8], 7], expected: 0, actual: -1, error: null }]);
  assert.deepEqual(result.reports[7].failures, []);
});

test('given malformed names documentation or argument lists, when validating new questions, then generation must repair the contract', async () => {
  for (const mutate of [
    question => { question.signature.name = 'solve'; },
    question => { question.signature.name = 'run);globalThis.changed=true;//'; },
    question => { question.signature.parameters[0] = 'input'; },
    question => { question.signature.parameters.reverse(); },
    question => { question.code = question.code.replace(/\/\*\*[\s\S]*?\*\//, '/** @param {number[]} values @param {number} target @returns {number} */'); },
    question => { question.code = question.code.replace('@param {number} target', '@param {number} missing'); },
    question => { question.referenceCode = question.referenceCode.replace('Integer to find.', 'Different contract.'); },
    question => { question.tests[0].input = [1, 2, 3]; },
  ] as ((question: ReturnType<typeof createDemoLesson>['questions'][number]) => void)[]) {
    const proposal = createDemoLesson(context);
    mutate(proposal.questions[6]);
    await assert.rejects(validateLesson(proposal, context), /signature|JSDoc|document each parameter|identical JSDoc|positional arguments/);
  }
});

test('given object field types, when checking conventional multiline JSDoc, then nested braces remain valid', () => {
  const question = createDemoLesson(context).questions[1];
  assert.match(question.code, /@param \{\{quantity: number\}\[\]\} orders/);
  assert.doesNotThrow(() => validateQuestionFormat({ ...question, signature: question.signature! }));
});

test('given multiple arguments, when candidate code mutates a later nested argument, then the sandbox freezes it too', async () => {
  const result = await execute('function collectValues(values, options) { options.items.push(9); return values; }', [[1], { items: [2] }], 'candidate', undefined, { name: 'collectValues', parameters: ['values', 'options'] });
  assert.ok(result.error);
});

test('given candidate code replacing Reflect.apply and Array iteration, when calling named functions, then captured invocation still uses the original arguments', async () => {
  const result = await execute('Reflect.apply = () => 999; Array.prototype[Symbol.iterator] = function* () { yield 999; }; function addAmounts(first, second) { return first + second; }', [2, 3], 'candidate', undefined, { name: 'addAmounts', parameters: ['first', 'second'] });
  assert.deepEqual(result, { actual: 5, error: null });
});
