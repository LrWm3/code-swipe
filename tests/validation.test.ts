import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDemoLesson } from '../server/demo.ts';
import { validateLesson } from '../server/validation.ts';
import type { Lesson, ProposedLesson, TutorContext } from '../src/types.ts';

function context(batchSize = 4): TutorContext {
  return {
    settings: { provider: 'demo', model: '', interests: '', batchSize, tutorMode: 'reflective' },
    history: [],
    hypotheses: [],
    metrics: { count: 0, brier: null, accuracy: null, calibration: [], byPurpose: [] },
  };
}

function lesson(): ProposedLesson { return createDemoLesson(context()); }

test('given curated sample lessons, when validating every batch size, then correct code passes and buggy code has exact counterexamples', async () => {
  for (const count of [4, 6, 8]) {
    const tutor = context(count);
    const proposal = createDemoLesson(tutor);
    const validated = await validateLesson(proposal, tutor);
    assert.equal(validated.questions.length, count);
    assert.equal(validated.reports.length, count);
    assert.deepEqual(validated.reports[0].failures, [
      { input: [-1, 0, 2], expected: [0, 2], actual: [2], error: null },
      { input: [3, 0, 3], expected: [3, 0, 3], actual: [3, 3], error: null },
    ]);
    assert.equal(validated.reports[0].testCount, 4);
    assert.equal(validated.reports[0].passedCount, 2);
    assert.deepEqual(validated.reports[2].failures, [
      { input: [-8, -3, -5], expected: -3, actual: 0, error: null },
      { input: [-2], expected: -2, actual: 0, error: null },
    ]);
    for (let i = 0; i < count; i++) {
      const report = validated.reports[i];
      assert.equal(report.passedCount + report.failures.length, report.testCount);
      if (validated.questions[i].verdict === 'correct') assert.equal(report.passedCount, report.testCount);
      else assert.ok(report.failures.length > 0);
      assert.equal(validated.questions[i].prediction.pCorrect, 0.5);
    }
    assert.match(validated.objective, /sample local practice/i);
    assert.match(validated.rationale, /not an LLM-generated adaptive lesson/);
    assert.equal(validated.hypotheses[0].status, 'tentative');
  }
});

test('given a false correct label, when a fixture exposes the defect, then validation rejects the lesson', async () => {
  const proposal = lesson();
  proposal.questions[0].verdict = 'correct';
  await assert.rejects(validateLesson(proposal, context()), /labelled correct but failed 2\/4/);
});

test('given a false buggy label, when every fixture passes, then validation requires a counterexample', async () => {
  const proposal = lesson();
  proposal.questions[1].verdict = 'buggy';
  await assert.rejects(validateLesson(proposal, context()), /labelled buggy but passed every fixture/);
});

test('given an incorrect reference implementation, when validating expected outputs, then no candidate verdict is accepted', async () => {
  const proposal = lesson();
  proposal.questions[0].referenceCode = 'function solve(input) { return 123; }';
  await assert.rejects(validateLesson(proposal, context()), /referenceCode does not produce the expected output/);
});

test('given a thrown candidate error, when reference fixtures pass, then the observed error is retained as a counterexample', async () => {
  const proposal = lesson();
  proposal.questions[0].code = 'function solve(input) { if (input.length === 0) throw new Error("Empty readings\\nare unsupported"); return input.filter(value => value >= 0); }';
  const validated = await validateLesson(proposal, context());
  assert.equal(validated.reports[0].passedCount, 3);
  assert.deepEqual(validated.reports[0].failures, [{ input: [], expected: [], actual: null, error: 'Empty readings are unsupported' }]);
});

test('given infinite candidate or reference code, when the execution budget expires, then timeout cannot establish a buggy verdict', async () => {
  for (const field of ['code', 'referenceCode'] as const) {
    const proposal = lesson();
    proposal.questions[0][field] = 'function solve(input) { while (true) {} }';
    const started = performance.now();
    await assert.rejects(validateLesson(proposal, context()), /timed out/);
    assert.ok(performance.now() - started < 2_000, 'An infinite loop must be interrupted promptly.');
  }
});

test('given excessive allocation, when the sandbox memory limit is reached, then the failure cannot establish a buggy verdict', async () => {
  const proposal = lesson();
  proposal.questions[0].code = 'function solve(input) { return new Array(10000000).fill(1); }';
  await assert.rejects(validateLesson(proposal, context()), /resource limit|timed out/);
  const healthy = await validateLesson(lesson(), context());
  assert.equal(healthy.reports.length, 4, 'A rejected allocation must not corrupt later sandbox runs.');
});

test('given code that inspects host capabilities, when evaluated inside WASM, then filesystem process and network APIs are absent', async () => {
  const proposal = lesson();
  const code = 'function solve(input) { return [typeof process, typeof require, typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof Deno, typeof Bun, typeof setTimeout, input.constructor.constructor("return typeof process")()]; }';
  proposal.questions[0].code = code;
  proposal.questions[0].referenceCode = code;
  proposal.questions[0].verdict = 'correct';
  for (const fixture of proposal.questions[0].tests) fixture.expected = Array(9).fill('undefined');
  const validated = await validateLesson(proposal, context());
  assert.equal(validated.reports[0].passedCount, 4);
});

test('given a candidate that tampers with JSON serialization, when evaluating its output, then the independent harness still records the real mismatch', async () => {
  const proposal = lesson();
  proposal.questions[0].code = 'function solve(input) { JSON.stringify = () => "forged"; Object.prototype.toJSON = () => "forged"; Array.prototype.toJSON = () => "forged"; return input.filter(value => value > 0); }';
  const validated = await validateLesson(proposal, context());
  assert.deepEqual(validated.reports[0].failures[0], { input: [-1, 0, 2], expected: [0, 2], actual: [2], error: null });
});

test('given a candidate returning invalid JSON, when observing its result, then a harness failure cannot be counted as a bug', async () => {
  for (const result of ['undefined', 'NaN', 'Infinity', 'Promise.resolve(1)', '({ get result() { throw new Error("getter"); } })', '"x".repeat(20000)']) {
    const proposal = lesson();
    proposal.questions[0].code = `function solve(input) { return ${result}; }`;
    await assert.rejects(validateLesson(proposal, context()), /bounded finite JSON|output limits/);
  }
});

test('given access to clock or randomness, when a purported pure function runs, then nondeterministic exercises are rejected', async () => {
  for (const code of ['function solve(input) { return Math.random(); }', 'function solve(input) { return Date.now(); }']) {
    const proposal = lesson();
    proposal.questions[0].code = code;
    await assert.rejects(validateLesson(proposal, context()), /deterministic/);
  }
});

test('given an own __proto__ JSON key, when sending a fixture to the sandbox, then the key remains data rather than changing the prototype', async () => {
  const proposal = lesson();
  const code = 'function solve(input) { return Object.hasOwn(input, "__proto__") ? input["__proto__"] : null; }';
  proposal.questions[0].code = code;
  proposal.questions[0].referenceCode = code;
  proposal.questions[0].verdict = 'correct';
  proposal.questions[0].tests = [1, 2, 3, 4].map(number => ({ input: JSON.parse(`{"__proto__":${number}}`), expected: number, note: 'Own prototype-like key stays JSON data.' }));
  const validated = await validateLesson(proposal, context());
  assert.equal(validated.reports[0].passedCount, 4);
});

test('given incomplete or coercible schema values, when validating structure, then each invalid field is rejected before execution', async () => {
  const invalid: { edit: (proposal: any) => void; expected: RegExp }[] = [
    { edit: p => { p.questions[0].prediction.pCorrect = '0.5'; }, expected: /finite number/ },
    { edit: p => { p.questions[0].prediction.pCorrect = -0.01; }, expected: /between 0 and 1/ },
    { edit: p => { p.questions[0].prediction.pCorrect = 1.01; }, expected: /between 0 and 1/ },
    { edit: p => { p.questions[0].tests[0].expected = NaN; }, expected: /finite JSON numbers/ },
    { edit: p => { delete p.questions[0].referenceCode; }, expected: /referenceCode: is required/ },
    { edit: p => { p.questions[0].verdict = 'probably'; }, expected: /must be one of/ },
    { edit: p => { p.questions[0].tests.pop(); }, expected: /4–12 entries/ },
    { edit: p => { p.questions.pop(); }, expected: /4–4 entries/ },
    { edit: p => { p.extra = true; }, expected: /not an allowed field/ },
    { edit: p => { p.questions[0].hypothesisId = 'missing'; }, expected: /reference a hypothesis/ },
    { edit: p => { p.questions[0].tests[1].input = []; }, expected: /duplicates an existing fixture/ },
  ];
  for (const { edit, expected } of invalid) {
    const proposal = lesson();
    edit(proposal);
    await assert.rejects(validateLesson(proposal, context()), expected);
  }
});

test('given duplicate exercise fields, when creating a batch, then repeated code or titles are rejected', async () => {
  for (const key of ['title', 'code'] as const) {
    const proposal = lesson();
    proposal.questions[1][key] = ` ${proposal.questions[0][key]} `;
    await assert.rejects(validateLesson(proposal, context()), /duplicates another question/);
  }
});

test('given unsupported hypotheses or fabricated evidence, when validating a reflection, then only tentative claims without evidence are accepted', async () => {
  const proposal = lesson();
  proposal.hypotheses[0].status = 'supported';
  await assert.rejects(validateLesson(proposal, context()), /supported requires at least one real/);
  proposal.hypotheses[0].supportingAttemptIds = ['invented-attempt'];
  await assert.rejects(validateLesson(proposal, context()), /does not exist in the supplied historical attempts/);
  proposal.hypotheses[0].status = 'contradicted';
  proposal.hypotheses[0].supportingAttemptIds = [];
  await assert.rejects(validateLesson(proposal, context()), /contradicted requires at least one real/);
});

test('given a real historical attempt, when citing it consistently, then evidence is accepted and contradictory or orphan references are rejected', async () => {
  const tutor = context();
  const previous: Lesson = {
    ...lesson(),
    id: 'lesson-before', createdAt: new Date().toISOString(), provider: 'demo', model: '', tutorMode: 'reflective', interests: '', predictionHash: 'test',
    questions: lesson().questions.map((question, index) => ({ ...question, id: `question-${index}`, validation: { checkedAt: '', testCount: 4, passedCount: 4, failures: [] } })),
  };
  tutor.history = [{ lesson: previous, attempts: [{ id: 'actual-attempt', lessonId: previous.id, exerciseId: 'question-0', answer: 'buggy', correct: true, answeredAt: new Date().toISOString(), elapsedMs: 2000, flagged: false }] }];
  const proposal = lesson();
  proposal.hypotheses[0].status = 'supported';
  proposal.hypotheses[0].supportingAttemptIds = ['actual-attempt'];
  assert.equal((await validateLesson(proposal, tutor)).hypotheses[0].status, 'supported');
  proposal.hypotheses[0].counterevidenceAttemptIds = ['actual-attempt'];
  await assert.rejects(validateLesson(proposal, tutor), /cannot be both support and counterevidence/);
  proposal.hypotheses[0].counterevidenceAttemptIds = [];
  tutor.history[0].attempts[0].exerciseId = 'question-that-does-not-exist';
  await assert.rejects(validateLesson(proposal, tutor), /does not exist in the supplied historical attempts/);
});

test('given excessive payloads or non-JSON structures, when validating before sandbox execution, then bounded structural checks reject them', async () => {
  const hugeCode = lesson();
  hugeCode.questions[0].code = 'x'.repeat(6_001);
  await assert.rejects(validateLesson(hugeCode, context()), /at most 6000 characters/);
  const hugeText = lesson();
  hugeText.reflection = 'x'.repeat(200_000);
  await assert.rejects(validateLesson(hugeText, context()), /text size limits/);
  const circular = lesson();
  const input: Record<string, unknown> = {};
  input.self = input;
  circular.questions[0].tests[0].input = input as never;
  await assert.rejects(validateLesson(circular, context()), /circular/);
  const accessor = lesson();
  Object.defineProperty(accessor, 'objective', { get() { throw new Error('Getter must never run.'); }, enumerable: true });
  await assert.rejects(validateLesson(accessor, context()), /accessors and hidden properties/);
});

test('given a cancellation signal, when validation starts or yields between fixtures, then the lesson cannot publish', async () => {
  const before = new AbortController();
  before.abort();
  await assert.rejects(validateLesson(lesson(), context(), before.signal), /cancelled/);
  const during = new AbortController();
  const pending = validateLesson(lesson(), context(), during.signal);
  setImmediate(() => during.abort());
  await assert.rejects(pending, /cancelled/);
});
