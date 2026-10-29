import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { parseGuide } from '../server/concept-guides.ts';
import { createRustDemoLesson } from '../server/rust-demo.ts';
import { executeRustBatch, rustAvailability, validateRustQuestionFormat } from '../server/rust-runtime.ts';
import { TutorService } from '../server/service.ts';
import { LocalStore } from '../server/store.ts';
import { validateLesson } from '../server/validation.ts';
import { rustCall, rustDisplay, rustResult } from '../src/rust-display.ts';
import type { FunctionSignature } from '../src/types.ts';

const status = await rustAvailability();
const sandbox = { skip: status.available ? false : status.detail };

test('given Rust implementations, when checking their signatures, then documentation names and types must agree', () => {
  const signature = { name: 'sum_values', parameters: ['values'] };
  const source = '/// Sum the values.\nfn sum_values(values: &[i64]) -> i64 { values.iter().sum() }';
  assert.doesNotThrow(() => validateRustQuestionFormat({ signature, code: source, referenceCode: source }));
  assert.throws(() => validateRustQuestionFormat({ signature, code: source, referenceCode: source.replace('&[i64]', 'Vec<i64>') }), /identical Rust parameter/);
  assert.throws(() => validateRustQuestionFormat({ signature, code: source, referenceCode: source.replace('Sum the values.', 'Different contract.') }), /identical Rust.*documentation/);
  assert.throws(() => validateRustQuestionFormat({ signature, code: source.replace('values:', 'items:'), referenceCode: source }), /parameter names/);
  assert.throws(() => validateRustQuestionFormat({ signature, code: source.replace('values.iter().sum()', 'std::fs::read_to_string("/etc/passwd").unwrap().len() as i64'), referenceCode: source }), /without.*I\/O/);
});

test('given Rust code with borrowed arguments and optional results, when checking fixtures, then values panics and types are reported accurately', sandbox, async () => {
  const signature: FunctionSignature = { name: 'first_letter', parameters: ['text'] };
  const source = '/// Return the first character.\nfn first_letter(text: &str) -> Option<char> { text.chars().next() }';
  const results = await executeRustBatch(source, [['Hello'], [''], ['é']], 'example', undefined, signature);
  assert.deepEqual(results.map(item => item.actual), ['H', null, 'é']);
  assert.ok(results.every(item => item.error === null && item.rustType?.includes('Option')));
  await assert.rejects(executeRustBatch(source, [['\ud800']], 'example', undefined, signature), /valid Unicode/);
  const panic = await executeRustBatch('/// Return a value.\nfn first_value(values: &[i64]) -> i64 { values[0] }', [[[1]], [[]]], 'example', undefined, { name: 'first_value', parameters: ['values'] });
  assert.equal(panic[0].actual, 1);
  assert.match(panic[1].error!, /panicked/);
});

test('given Result values and Rust example guides, when checking and displaying them, then Ok Err Some and None remain recognizable', sandbox, async () => {
  const signature = { name: 'parse_number', parameters: ['text'] };
  const code = '/// Parse a number.\nfn parse_number(text: &str) -> Result<i64, String> { text.parse::<i64>().map_err(|_| String::from("invalid")) }';
  const results = await executeRustBatch(code, [['42'], ['x']], 'example', undefined, signature);
  assert.deepEqual(results.map(item => item.actual), [{ Ok: 42 }, { Err: 'invalid' }]);
  assert.equal(rustCall({ code, signature }, ['x']), 'parse_number("x")');
  assert.equal(rustResult({ code, signature }, { Err: 'invalid' }), 'Err("invalid".to_string())');
  const map = { code: 'fn total_orders(orders: &[HashMap<String, i64>]) -> i64 { 0 }', signature: { name: 'total_orders', parameters: ['orders'] } };
  assert.equal(rustCall(map, [[{ quantity: 2 }]]), 'total_orders(&[HashMap::from([("quantity".to_string(), 2)])])');
  const guide = { title: 'Options', description: 'An option may contain a value.', takeaway: 'None means no value.', examples: [
    { mode: 'expression', expression: 'Some(5_i32)', expectedJson: '5', explanation: 'The option contains five.' },
    { mode: 'expression', expression: 'None::<i32>', expectedJson: 'null', explanation: 'The option contains no value.' },
  ] };
  const checked = await parseGuide(JSON.stringify(guide), { id: 'rust-option', name: 'Options', description: 'Optional values.' }, undefined, 'rust');
  assert.deepEqual(checked.examples.map(example => rustDisplay(example.result, example.rustType)), ['Some(5)', 'None']);
  assert.match(checked.links[0].url, /^https:\/\/doc\.rust-lang\.org\//);
  guide.examples[0].expectedJson = '6';
  await assert.rejects(parseGuide(JSON.stringify(guide), { id: 'rust-option', name: 'Options', description: 'Optional values.' }, undefined, 'rust'), /did not produce/);
});

test('given a real Rust compiler error, when it is an ownership bug, then the diagnostic is usable but unsupported code and timeouts are rejected', sandbox, async () => {
  const signature = { name: 'count_values', parameters: ['values'] };
  const moved = '/// Count values.\nfn count_values(values: Vec<i64>) -> usize { let moved = values; values.len() + moved.len() }';
  const result = await executeRustBatch(moved, [[[1]], [[]]], 'example', undefined, signature, true);
  assert.match(result[0].compilationError!, /E0382.*moved/);
  await assert.rejects(executeRustBatch(moved, [[[1]]], 'example', undefined, signature), /did not compile/);
  await assert.rejects(executeRustBatch('/// Count values.\nfn count_values(values: Vec<i64>) -> usize { nonexistent::value() }', [[[1]]], 'example', undefined, signature, true), /unsupported diagnostic/);
  await assert.rejects(executeRustBatch('/// Count values.\nfn count_values(values: Vec<i64>) -> usize { loop {} }', [[[1]]], 'example', undefined, signature), /timed out or failed/);
  await assert.rejects(executeRustBatch('/// Count values.\nfn count_values(values: Vec<i64>) -> Option<Option<i64>> { Some(None) }', [[[1]]], 'example', undefined, signature), /Nested Option/);
});

test('given a running Rust validation, when cancelled, then the isolated execution cannot publish a verdict', sandbox, async () => {
  const signature = { name: 'count_values', parameters: ['values'] };
  const controller = new AbortController();
  const pending = executeRustBatch('/// Count values.\nfn count_values(values: Vec<i64>) -> usize { loop {} }', [[[1]]], 'example', controller.signal, signature);
  setTimeout(() => controller.abort(), 400);
  await assert.rejects(pending, /cancelled/);
});

test('given a Rust lesson with an ownership bug, when validating and answering, then the review preserves the compiler diagnostic', { ...sandbox, timeout: 90_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'swipe-rust-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  store.saveSettings({ ...store.snapshot().settings, provider: 'demo', language: 'rust', batchSize: 6 });
  const context = store.context(); const proposal = createRustDemoLesson(context); const question = proposal.questions[0];
  const doc = question.code.slice(0, question.code.indexOf('fn '));
  question.code = `${doc}fn keep_nonnegative_readings(readings: Vec<i64>) -> Vec<i64> {\n    let moved = readings;\n    if readings.is_empty() { return Vec::new(); }\n    moved.into_iter().filter(|value| *value >= 0).collect()\n}`;
  question.referenceCode = `${doc}fn keep_nonnegative_readings(readings: Vec<i64>) -> Vec<i64> { readings.into_iter().filter(|value| *value >= 0).collect() }`;
  question.explanation = 'The first assignment moves readings, so the later use does not compile.';
  const checked = await validateLesson(proposal, context);
  assert.match(checked.reports[0].compilationError!, /E0382/);
  assert.equal(checked.reports[0].passedCount, 0);
  store.commitLesson(checked, context.settings);
  const lesson = store.activeLesson()!; const artifact = readFileSync(join(directory, 'plans', `${lesson.id}.json`), 'utf8');
  const review = store.answer(lesson.questions[0].id, 'buggy', 1000);
  assert.equal(review.attempt.correct, true);
  assert.match(review.question.validation.compilationError!, /E0382/);
  assert.equal(readFileSync(join(directory, 'plans', `${lesson.id}.json`), 'utf8'), artifact);
  assert.equal(new LocalStore(directory).activeLesson()?.language, 'rust');
});

test('given an unavailable Rust sandbox, when starting a lesson, then setup guidance appears and no lesson is published', t => {
  const directory = mkdtempSync(join(tmpdir(), 'swipe-rust-missing-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  store.saveSettings({ ...store.snapshot().settings, provider: 'demo', language: 'rust' });
  const service = new TutorService(store, [{ id: 'demo', available: true, version: '1', detail: 'Demo' }], undefined, undefined,
    [{ id: 'rust', available: false, detail: 'Start Docker and install the Rust sandbox image.' }]);
  assert.throws(() => service.plan(), /Start Docker/);
  assert.equal(store.snapshot().lessons.length, 0);
});
