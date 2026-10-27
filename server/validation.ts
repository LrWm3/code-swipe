import { getQuickJS } from 'quickjs-emscripten';
import type { FunctionSignature, JsonValue, ProposedLesson, TutorContext, ValidationReport } from '../src/types.ts';
import { LESSON_SIZES } from '../src/lesson-sizes.ts';
import { PURPOSES } from '../src/types.ts';
import { curriculumSchema, questionPlanSchema, validateSchema } from './prompts.ts';
import { mirrors, validateCurriculum } from './curriculum-validation.ts';
import { questionSkills } from './skill-evidence.ts';
import { validateArguments, validateQuestionFormat, validateSignature } from './question-format.ts';

const MAX_PAYLOAD = 180_000;
const MAX_VALUE = 16_000;
const EXECUTION_MS = 100;
const MEMORY_BYTES = 16 * 1024 * 1024;

export class LessonValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LessonValidationError';
  }
}

function reject(path: string, detail: string): never {
  throw new LessonValidationError(`${path}: ${detail}`);
}

function checkJSON(value: unknown, path = 'lesson', maxChars = MAX_PAYLOAD): asserts value is JsonValue {
  let nodes = 0;
  let chars = 0;
  const seen = new Set<object>();
  function visit(item: unknown, at: string, depth: number): void {
    if (++nodes > 20_000 || depth > 16) reject(at, 'JSON exceeds size or nesting limits.');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) reject(at, 'must contain only finite JSON numbers.');
      return;
    }
    if (typeof item === 'string') {
      chars += item.length;
      if (item.length > 20_000 || chars > maxChars) reject(at, 'JSON exceeds text size limits.');
      return;
    }
    if (typeof item !== 'object') reject(at, 'must contain JSON values only; no undefined, functions, or symbols.');
    if (seen.has(item)) reject(at, 'must not contain circular or shared object references.');
    seen.add(item);
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null && !(array && prototype === Array.prototype)) {
      reject(at, 'must contain plain JSON objects and arrays.');
    }
    const keys = Reflect.ownKeys(item);
    if (keys.length > 2_001) reject(at, 'contains too many entries.');
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') reject(at, 'symbol keys are not JSON.');
      if (array && !/^(0|[1-9]\d*)$/.test(key)) reject(at, 'arrays cannot have named properties.');
      chars += key.length;
      if (chars > maxChars) reject(at, 'JSON exceeds text size limits.');
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (!('value' in descriptor) || !descriptor.enumerable) reject(at, 'accessors and hidden properties are not JSON.');
      visit(descriptor.value, `${at}.${key}`, depth + 1);
    }
    if (array && (item.length > 2_000 || keys.length !== item.length + 1)) reject(at, 'must be a dense array of at most 2000 entries.');
    seen.delete(item);
  }
  visit(value, path, 0);
  if (JSON.stringify(value).length > maxChars) reject(path, `serialized JSON must be at most ${maxChars} characters.`);
}

function object(value: unknown, path: string, keys: string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) reject(path, 'must be an object.');
  const found = Object.keys(value);
  for (const key of keys) if (!Object.hasOwn(value, key)) reject(`${path}.${key}`, 'is required.');
  for (const key of found) if (!keys.includes(key)) reject(`${path}.${key}`, 'is not an allowed field.');
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string, max = 1_000): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) reject(path, `must be a nonempty string of at most ${max} characters.`);
}

function list(value: unknown, path: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) reject(path, `must be an array with ${min}–${max} entries.`);
  return value;
}

function strings(value: unknown, path: string, min: number, max: number, length = 1_000): string[] {
  const values = list(value, path, min, max);
  values.forEach((entry, i) => string(entry, `${path}[${i}]`, length));
  if (new Set(values).size !== values.length) reject(path, 'must not repeat entries.');
  return values as string[];
}

function oneOf(value: unknown, path: string, choices: string[]): void {
  if (typeof value !== 'string' || !choices.includes(value)) reject(path, `must be one of: ${choices.join(', ')}.`);
}

function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function structure(proposal: unknown, context: TutorContext): ProposedLesson {
  checkJSON(proposal);
  const lesson = object(proposal, 'lesson', ['objective', 'rationale', 'assumptions', 'reflection', 'hypotheses', 'questions', 'curriculum']);
  string(lesson.objective, 'objective', 600);
  string(lesson.rationale, 'rationale', 2_000);
  string(lesson.reflection, 'reflection', 2_000);
  strings(lesson.assumptions, 'assumptions', 1, 8, 700);
  const hypotheses = list(lesson.hypotheses, 'hypotheses', 0, 8);
  if (context.settings.tutorMode === 'baseline' && hypotheses.length) reject('hypotheses', 'baseline lessons cannot contain persistent learner hypotheses.');
  const attemptIds = new Set(context.history.flatMap(({ lesson: previous, attempts }) => attempts
    .filter(attempt => !attempt.flagged && attempt.lessonId === previous.id && previous.questions.some(question => question.id === attempt.exerciseId))
    .map(attempt => attempt.id)));
  const hypothesisIds = new Set<string>();
  for (let i = 0; i < hypotheses.length; i++) {
    const path = `hypotheses[${i}]`;
    const hypothesis = object(hypotheses[i], path, ['id', 'claim', 'status', 'supportingAttemptIds', 'counterevidenceAttemptIds', 'alternatives', 'nextProbe']);
    string(hypothesis.id, `${path}.id`, 80);
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(hypothesis.id)) reject(`${path}.id`, 'use letters, numbers, underscores, and hyphens; start with a letter.');
    if (hypothesisIds.has(hypothesis.id)) reject(`${path}.id`, 'must be unique in this lesson.');
    hypothesisIds.add(hypothesis.id);
    string(hypothesis.claim, `${path}.claim`, 1_000);
    oneOf(hypothesis.status, `${path}.status`, ['tentative', 'supported', 'contradicted']);
    const supporting = strings(hypothesis.supportingAttemptIds, `${path}.supportingAttemptIds`, 0, 30, 120);
    const counter = strings(hypothesis.counterevidenceAttemptIds, `${path}.counterevidenceAttemptIds`, 0, 30, 120);
    for (const id of [...supporting, ...counter]) {
      if (!attemptIds.has(id)) reject(path, `evidence attempt "${id}" does not exist in the supplied historical attempts.`);
    }
    if (supporting.some(id => counter.includes(id))) reject(path, 'an attempt cannot be both support and counterevidence for the same claim.');
    if (hypothesis.status === 'supported' && !supporting.length) reject(`${path}.status`, 'supported requires at least one real supportingAttemptId; otherwise use tentative.');
    if (hypothesis.status === 'contradicted' && !counter.length) reject(`${path}.status`, 'contradicted requires at least one real counterevidenceAttemptId; otherwise use tentative.');
    strings(hypothesis.alternatives, `${path}.alternatives`, 1, 5, 700);
    string(hypothesis.nextProbe, `${path}.nextProbe`, 1_000);
  }
  const batchSize = context.settings.batchSize;
  if (!LESSON_SIZES.some(size => size === batchSize) && !(context.focus && batchSize === 4)) reject('settings.batchSize', 'must be 6, 8, or 12 (or 4 for focused practice).');
  const questions = list(lesson.questions, 'questions', batchSize, batchSize);
  const unique = { title: new Set<string>(), code: new Set<string>() };
  for (let i = 0; i < questions.length; i++) {
    const path = `questions[${i}]`;
    const question = object(questions[i], path, ['title', 'specification', 'code', 'referenceCode', 'verdict', 'explanation', 'tests', 'purpose', 'hypothesisId', 'ifCorrect', 'ifIncorrect', 'prediction', 'plan', ...((questions[i] as Record<string, unknown>)?.signature !== undefined ? ['signature'] : [])]);
    string(question.title, `${path}.title`, 140);
    string(question.specification, `${path}.specification`, 2_000);
    string(question.code, `${path}.code`, 6_000);
    string(question.referenceCode, `${path}.referenceCode`, 6_000);
    if (question.signature !== undefined) {
      try { validateQuestionFormat(question as unknown as { signature: FunctionSignature; code: string; referenceCode: string }); }
      catch (error) { reject(path, (error as Error).message); }
    }
    string(question.explanation, `${path}.explanation`, 2_000);
    string(question.ifCorrect, `${path}.ifCorrect`, 1_000);
    string(question.ifIncorrect, `${path}.ifIncorrect`, 1_000);
    // Paired probes may share a specification while changing representation.
    for (const key of ['title', 'code'] as const) {
      const normalized = (question[key] as string).trim().replace(/\s+/g, ' ');
      if (unique[key].has(normalized)) reject(`${path}.${key}`, `duplicates another question's ${key}; provide a distinct exercise.`);
      unique[key].add(normalized);
    }
    oneOf(question.verdict, `${path}.verdict`, ['correct', 'buggy']);
    oneOf(question.purpose, `${path}.purpose`, [...PURPOSES]);
    try { validateSchema(question.plan, questionPlanSchema, `${path}.plan`); }
    catch (error) { reject(path, (error as Error).message); }
    if (context.focus && !(question.plan as NonNullable<ProposedLesson['questions'][number]['plan']>).conceptIds.includes(context.focus.concept.id)) reject(`${path}.plan.conceptIds`, 'focused practice must target the selected concept.');
    if ((question.plan as ProposedLesson['questions'][number]['plan'])!.purposes.includes('retention')) {
      const targetConcepts = (question.plan as NonNullable<ProposedLesson['questions'][number]['plan']>).skillUses!
        .filter(use => use.role !== 'incidental').map(use => use.conceptId);
      const candidates = new Map<string, string>();
      for (const concept of context.curriculum?.concepts ?? []) {
        if (targetConcepts.includes(concept.id)) for (const evidence of concept.evidence) {
          if (evidence.role && evidence.role !== 'incidental' && evidence.source !== 'legacy') candidates.set(evidence.attemptId, evidence.answeredAt);
        }
      }
      for (const { lesson: previous, attempts } of context.history) for (const attempt of attempts) {
        candidates.delete(attempt.id); // Raw evidence overrides summaries, including exclusions.
        const previousQuestion = previous.questions.find(item => item.id === attempt.exerciseId);
        if (!attemptIds.has(attempt.id) || !previousQuestion) continue;
        const retrofit = context.skillRetrofits?.flatMap(item => item.questions).find(item => item.exerciseId === previousQuestion.id);
        const linked = questionSkills(previousQuestion, retrofit).some(({ use, source }) => source !== 'legacy' && use.role !== 'incidental' && targetConcepts.includes(use.conceptId));
        if (linked) candidates.set(attempt.id, attempt.answeredAt);
      }
      if (context.settings.tutorMode === 'baseline' || ![...candidates].some(([id, at]) => Date.now() - Date.parse(at) >= 86_400_000 && (lesson.rationale as string).includes(id))) {
        reject(`${path}.purpose`, 'retention requires a related unflagged attempt at least 24 hours old cited in the lesson rationale.');
      }
    }
    if (question.hypothesisId !== null && (typeof question.hypothesisId !== 'string' || !hypothesisIds.has(question.hypothesisId))) {
      reject(`${path}.hypothesisId`, 'must be null or reference a hypothesis in this lesson.');
    }
    const prediction = object(question.prediction, `${path}.prediction`, ['pCorrect', 'rationale']);
    if (typeof prediction.pCorrect !== 'number' || !Number.isFinite(prediction.pCorrect) || prediction.pCorrect < 0 || prediction.pCorrect > 1) reject(`${path}.prediction.pCorrect`, 'must be a finite number between 0 and 1, not a string.');
    string(prediction.rationale, `${path}.prediction.rationale`, 1_000);
    const tests = list(question.tests, `${path}.tests`, 4, 12);
    const inputs = new Set<string>();
    for (let j = 0; j < tests.length; j++) {
      const testPath = `${path}.tests[${j}]`;
      const test = object(tests[j], testPath, ['input', 'expected', 'note']);
      string(test.note, `${testPath}.note`, 500);
      checkJSON(test.input, `${testPath}.input`, MAX_VALUE);
      if (question.signature) {
        try { validateArguments(test.input as JsonValue, question.signature as FunctionSignature); }
        catch (error) { reject(testPath, (error as Error).message); }
      }
      checkJSON(test.expected, `${testPath}.expected`, MAX_VALUE);
      const signature = canonical(test.input);
      if (inputs.has(signature)) reject(`${testPath}.input`, 'duplicates an existing fixture; provide at least four distinct inputs.');
      inputs.add(signature);
    }
  }
  try {
    validateSchema(lesson.curriculum, curriculumSchema, 'curriculum');
    validateCurriculum(proposal as unknown as ProposedLesson, context);
  } catch (error) { reject('curriculum', (error as Error).message); }
  // The checks above validate every field without coercing the provider response.
  return proposal as unknown as ProposedLesson;
}

// This harness executes only inside QuickJS WASM. It captures intrinsics before
// untrusted source runs, and receives the compiled function through a VM handle.
// The function cannot read harness locals or the expected fixture output.
const HARNESS = `(() => {
  'use strict';
  const apply = Reflect.apply;
  const arrayIsArray = Array.isArray;
  const objectKeys = Object.keys;
  const ownKeys = Reflect.ownKeys;
  const descriptor = Object.getOwnPropertyDescriptor;
  const getPrototype = Object.getPrototypeOf;
  const objectPrototype = Object.prototype;
  const arrayPrototype = Array.prototype;
  const create = Object.create;
  const setPrototype = Object.setPrototypeOf;
  const freeze = Object.freeze;
  const isFiniteNumber = Number.isFinite;
  const stringify = JSON.stringify;
  const parse = JSON.parse;
  let nonPureAccess = false;
  const denied = new Error('Date and randomness are unavailable to pure exercises.');
  function denyNondeterminism() { nonPureAccess = true; throw denied; }
  Object.defineProperty(globalThis, 'Date', { get: denyNondeterminism, configurable: false });
  Object.defineProperty(Math, 'random', { get: denyNondeterminism, configurable: false });
  const finiteError = new Error('Returned value must be finite JSON.');
  const sizeError = new Error('Returned JSON exceeds output limits.');
  const plainError = new Error('Returned value must contain plain JSON without getters or custom prototypes.');
  const seen = new Set();
  const setHas = Function.prototype.call.bind(Set.prototype.has);
  const setAdd = Function.prototype.call.bind(Set.prototype.add);
  const setDelete = Function.prototype.call.bind(Set.prototype.delete);
  let count;
  function normalize(value, depth) {
    if (++count > 2000 || depth > 12) throw sizeError;
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') { if (!isFiniteNumber(value)) throw finiteError; return value; }
    if (typeof value === 'string') { if (value.length > 8000) throw sizeError; return value; }
    if (typeof value !== 'object' || setHas(seen, value)) throw finiteError;
    const array = arrayIsArray(value);
    const prototype = getPrototype(value);
    if (prototype !== null && prototype !== objectPrototype && !(array && prototype === arrayPrototype)) throw plainError;
    setAdd(seen, value);
    const keys = ownKeys(value);
    if (keys.length > 2001 || (array && keys.length !== value.length + 1)) throw plainError;
    const copy = array ? setPrototype([], null) : create(null);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (array && key === 'length') continue;
      const property = descriptor(value, key);
      if (typeof key !== 'string' || !property || !('value' in property) || !property.enumerable) throw plainError;
      if (array && (key === '' || +key < 0 || +key >= value.length || '' + (+key) !== key)) throw plainError;
      copy[key] = normalize(property.value, depth + 1);
    }
    setDelete(seen, value);
    return copy;
  }
  function freezeInput(value) {
    if (value !== null && typeof value === 'object') {
      const keys = objectKeys(value);
      for (let i = 0; i < keys.length; i++) freezeInput(value[keys[i]]);
      freeze(value);
    }
    return value;
  }
  function pack(kind, value, error) {
    const envelope = create(null);
    envelope.kind = kind;
    envelope.value = value;
    envelope.error = error;
    return stringify(envelope);
  }
  return function(callable, serializedInput) {
    const input = parse(serializedInput);
    freezeInput(input);
    let result;
    try { result = apply(callable, undefined, input); }
    catch (error) {
      if (nonPureAccess) return pack('invalid', null, 'The function must be deterministic; Date and randomness are unavailable.');
      let message = 'Exercise threw an error.';
      if (typeof error === 'string') message = error;
      else if (error !== null && typeof error === 'object') {
        const property = descriptor(error, 'message');
        if (property && typeof property.value === 'string') message = property.value;
      }
      if (message.length > 1000) message = 'Exercise threw an error (message too long).';
      return pack('throw', null, message);
    }
    if (nonPureAccess) return pack('invalid', null, 'The function must be deterministic; Date and randomness are unavailable.');
    try {
      count = 0;
      const normalized = normalize(result, 0);
      const output = pack('value', normalized, null);
      if (output.length > ${MAX_VALUE}) return pack('invalid', null, 'Returned JSON exceeds output limits.');
      return output;
    } catch (_) {
      return pack('invalid', null, 'Returned value must be bounded finite JSON; no promises, getters, cycles, or custom prototypes.');
    }
  };
})()`;

interface Execution { actual: JsonValue | null; error: string | null }

export async function execute(code: string, input: JsonValue, path: string, signal?: AbortSignal, signature?: FunctionSignature): Promise<Execution> {
  if (signature) { validateSignature(signature); validateArguments(input, signature); }
  const functionName = signature?.name ?? 'solve';
  if (signal?.aborted) reject(path, 'validation cancelled.');
  // Yield between fixture runs so cancellation and other local requests progress.
  await new Promise<void>(resolve => setImmediate(resolve));
  if (signal?.aborted) reject(path, 'validation cancelled.');
  const engine = await getQuickJS();
  if (signal?.aborted) reject(path, 'validation cancelled.');
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(MEMORY_BYTES);
  runtime.setMaxStackSize(256 * 1024);
  let interrupted = false;
  const deadline = performance.now() + EXECUTION_MS;
  runtime.setInterruptHandler(() => {
    interrupted = Boolean(signal?.aborted) || performance.now() > deadline;
    return interrupted;
  });
  const vm = runtime.newContext();
  try {
    // No host functions, module loaders, filesystem, network, or process objects
    // are ever installed in this isolated JavaScript realm.
    const harnessResult = vm.evalCode(HARNESS, 'trusted-harness.js', { type: 'global' });
    if (!('value' in harnessResult)) {
      harnessResult.error.dispose();
      reject(path, 'sandbox harness initialization failed; no verdict was accepted.');
    }
    const harness = harnessResult.value;
    try {
      const source = vm.evalCode(`(function () { "use strict";\n${code}\n; return typeof ${functionName} === "function" ? ${functionName} : null; })()`, 'exercise.js', { type: 'global' });
      if (!('value' in source)) {
        source.error.dispose();
        reject(path, interrupted ? 'sandbox execution timed out or was cancelled; provide a terminating pure function.' : 'source did not compile or initialize; define the declared synchronous pure function within sandbox limits.');
      }
      const solve = source.value;
      try {
        if (vm.typeof(solve) !== 'function') reject(path, `must define a synchronous function named ${functionName}.`);
        const argument = vm.newString(JSON.stringify(signature ? input : [input]));
        try {
          const result = vm.callFunction(harness, vm.undefined, solve, argument);
          if (!('value' in result)) {
            result.error.dispose();
            reject(path, interrupted ? 'sandbox execution timed out or was cancelled; a timeout does not prove a buggy verdict.' : 'sandbox execution or resource limit failed; no verdict was accepted.');
          }
          try {
            if (interrupted || signal?.aborted || performance.now() > deadline) reject(path, 'sandbox execution timed out or was cancelled; a timeout does not prove a buggy verdict.');
            if (vm.typeof(result.value) !== 'string') reject(path, 'sandbox returned an invalid report.');
            const serialized = vm.getString(result.value);
            if (serialized.length > MAX_VALUE) reject(path, 'sandbox output exceeded its limit.');
            const output = JSON.parse(serialized) as { kind: string; value: JsonValue | null; error: string | null };
            if (output.kind === 'invalid') reject(path, output.error ?? 'sandbox returned invalid JSON.');
            if (output.kind !== 'value' && output.kind !== 'throw') reject(path, 'sandbox returned an invalid report.');
            if (output.error && /out of memory|stack overflow|interrupted/i.test(output.error)) reject(path, 'sandbox resource limit failed; no verdict was accepted.');
            return { actual: output.value, error: output.error?.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240) ?? null };
          } finally { result.value.dispose(); }
        } finally { argument.dispose(); }
      } finally { solve.dispose(); }
    } finally { harness.dispose(); }
  } catch (error) {
    if (error instanceof LessonValidationError) throw error;
    reject(path, 'sandbox failed safely; no verdict was accepted.');
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}

export async function validateLesson(proposal: unknown, context: TutorContext, signal?: AbortSignal): Promise<ProposedLesson & { reports: ValidationReport[] }> {
  const lesson = structure(proposal, context);
  if (context.focus?.avoidQuestions?.length) {
    for (let index = 0; index < lesson.questions.length; index++) {
      if (context.focus.avoidQuestions.some(parent => mirrors(lesson.questions[index], parent))) {
        reject(`questions[${index}]`, 'duplicates an unanswered question in the paused lesson; use a different task and reference implementation.');
      }
    }
  }
  const reports: ValidationReport[] = [];
  for (let i = 0; i < lesson.questions.length; i++) {
    const question = lesson.questions[i];
    const report: ValidationReport = { checkedAt: new Date().toISOString(), testCount: question.tests.length, passedCount: 0, failures: [] };
    for (let j = 0; j < question.tests.length; j++) {
      const fixture = question.tests[j];
      const reference = await execute(question.referenceCode, fixture.input, `questions[${i}].referenceCode (fixture ${j + 1})`, signal, question.signature);
      if (reference.error !== null || canonical(reference.actual) !== canonical(fixture.expected)) reject(`questions[${i}].tests[${j}]`, 'referenceCode does not produce the expected output; repair the reference or fixture before labelling the candidate.');
      const observed = await execute(question.code, fixture.input, `questions[${i}].code (fixture ${j + 1})`, signal, question.signature);
      if (observed.error === null && canonical(observed.actual) === canonical(fixture.expected)) report.passedCount++;
      else report.failures.push({ input: fixture.input, expected: fixture.expected, actual: observed.actual, error: observed.error });
    }
    if (question.verdict === 'correct' && report.failures.length) reject(`questions[${i}].verdict`, `labelled correct but failed ${report.failures.length}/${report.testCount} fixtures; repair code or label.`);
    if (question.verdict === 'buggy' && !report.failures.length) reject(`questions[${i}].verdict`, 'labelled buggy but passed every fixture; provide a concrete counterexample or label correct.');
    reports.push(report);
  }
  return { ...lesson, reports };
}
