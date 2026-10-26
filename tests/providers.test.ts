import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import type { TutorContext } from '../src/types.ts';
import { detectProviders, generateLesson, parseOpenCodeOutput } from '../server/providers.ts';
import { buildTutorPrompt, lessonOutputSchema, parseLessonOutput } from '../server/prompts.ts';

function wireLesson() {
  return {
    objective: 'Judge boundary handling', rationale: 'Compare empty and nonempty inputs.', assumptions: ['No prior evidence'], reflection: 'Cold start.', hypotheses: [],
    questions: [{
      title: 'Sum the measurements', specification: 'Return the sum of an array of finite integers.',
      code: 'function solve(input) { return input.reduce((a,b) => a+b, 0); }',
      referenceCode: 'function solve(input) { return input.reduce((a,b) => a+b, 0); }',
      verdict: 'correct', explanation: 'Initial zero handles an empty array.',
      tests: [[], [0], [1, 2], [-3, 2]].map(input => ({ inputJson: JSON.stringify(input), expectedJson: JSON.stringify(input.reduce((a, b) => a + b, 0)), note: 'Distinct boundary fixture.' })),
      purpose: 'practice', hypothesisId: null, ifCorrect: 'Tentative evidence only.', ifIncorrect: 'Compare empty inputs.', prediction: { pCorrect: 0.6, rationale: 'Uncertain prior.' },
    }],
  };
}

function context(provider: 'codex' | 'opencode' = 'codex'): TutorContext {
  return {
    settings: { provider, model: '', interests: 'Fishing', batchSize: 1, tutorMode: 'reflective' },
    history: [], hypotheses: [], metrics: { count: 0, brier: null, accuracy: null, calibration: [], byPurpose: [] },
  };
}

async function fakeCli(t: TestContext, mode = 'valid') {
  const directory = await mkdtemp(join(tmpdir(), 'code-swipe-provider-test-'));
  const executable = join(directory, 'fake-cli');
  const record = join(directory, 'record.json');
  const fixture = join(directory, 'fixture.json');
  await writeFile(fixture, JSON.stringify(wireLesson()));
  await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('fake-cli 1.2.3'); process.exit(0); }
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const mode = process.env.CODE_SWIPE_FAKE_MODE;
  const config = process.env.OPENCODE_CONFIG_CONTENT;
  fs.writeFileSync(process.env.CODE_SWIPE_FAKE_RECORD, JSON.stringify({
    args, cwd: process.cwd(), input, config: config ? JSON.parse(config) : null,
    permission: process.env.OPENCODE_PERMISSION, configHome: process.env.XDG_CONFIG_HOME,
    db: process.env.OPENCODE_DB, codexThread: process.env.CODEX_THREAD_ID,
    opencodeConfig: process.env.OPENCODE_CONFIG,
  }));
  if (mode === 'auth') { console.error('401 authentication error: SECRET-NEVER-DISPLAY'); process.exit(1); }
  if (mode === 'flood') { process.stdout.write('x'.repeat(3 * 1024 * 1024)); setInterval(() => {}, 1000); return; }
  if (mode === 'slow' || mode === 'descendant') {
    process.on('SIGTERM', () => {});
    if (mode === 'descendant') {
      const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      fs.writeFileSync(process.env.CODE_SWIPE_FAKE_PID, String(child.pid));
    }
    setInterval(() => {}, 1000); return;
  }
  const content = mode === 'malformed' ? '{bad JSON' : fs.readFileSync(process.env.CODE_SWIPE_FAKE_FIXTURE, 'utf8');
  const out = args.indexOf('-o');
  if (out >= 0) fs.writeFileSync(args[out + 1], content);
  else {
    console.log(JSON.stringify({ type: 'step_start', part: {} }));
    console.log(JSON.stringify({ type: 'text', part: { text: content } }));
    console.log(JSON.stringify({ type: 'step_finish', part: {} }));
  }
});
`, { mode: 0o700 });
  const changes = {
    CODE_SWIPE_CODEX_BIN: executable, CODE_SWIPE_OPENCODE_BIN: executable,
    CODE_SWIPE_FAKE_MODE: mode, CODE_SWIPE_FAKE_RECORD: record, CODE_SWIPE_FAKE_FIXTURE: fixture,
    CODE_SWIPE_FAKE_PID: join(directory, 'descendant.pid'), CODE_SWIPE_TUTOR_TIMEOUT_MS: '5000',
  };
  const previous = Object.fromEntries(Object.keys(changes).map(key => [key, process.env[key]]));
  Object.assign(process.env, changes);
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, fixture, record, pidFile: changes.CODE_SWIPE_FAKE_PID };
}

test('given installed and missing CLIs, when detecting providers, then reports availability without model requests', async t => {
  const fake = await fakeCli(t);
  const statuses = await detectProviders();
  assert.deepEqual(statuses.map(status => [status.id, status.available, status.version]), [['codex', true, '1.2.3'], ['opencode', true, '1.2.3'], ['demo', true, '1']]);
  process.env.CODE_SWIPE_CODEX_BIN = join(fake.directory, 'missing');
  const missing = (await detectProviders())[0];
  assert.equal(missing.available, false);
  assert.match(missing.detail, /CLI was not found/);
});

test('given a valid Codex response, when generating, then sends stdin and validates isolated structured output', async t => {
  const fake = await fakeCli(t);
  const input = context();
  input.settings.model = 'model-name;not-a-shell-command';
  const stages: string[] = [];
  const result = await generateLesson(input, { signal: new AbortController().signal, onProgress: stage => stages.push(stage) });
  assert.deepEqual(result.questions[0].tests[2].input, [1, 2]);
  assert.equal(result.questions[0].tests[2].expected, 3);
  assert.equal(result.questions[0].hypothesisId, null);
  const invocation = JSON.parse(await readFile(fake.record, 'utf8'));
  assert.equal(invocation.args.at(-1), '-');
  assert.ok(invocation.args.includes('--ignore-user-config'));
  assert.ok(invocation.args.includes('--ignore-rules'));
  assert.ok(invocation.args.includes('--ephemeral'));
  assert.equal(invocation.args[invocation.args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(invocation.args[invocation.args.indexOf('--model') + 1], input.settings.model);
  assert.match(invocation.input, /Falsifiable|falsifiable/);
  assert.equal(stages.length, 2);
  await assert.rejects(readFile(join(invocation.cwd, 'lesson-schema.json')), { code: 'ENOENT' });
});

test('given OpenCode, when generating, then denies all tools and isolates config while decoding JSON events', async t => {
  const fake = await fakeCli(t);
  const result = await generateLesson(context('opencode'), { signal: new AbortController().signal, onProgress() {} });
  assert.equal(result.questions[0].tests.length, 4);
  const invocation = JSON.parse(await readFile(fake.record, 'utf8'));
  assert.ok(invocation.args.includes('--pure'));
  assert.equal(invocation.args[invocation.args.indexOf('--format') + 1], 'json');
  assert.equal(invocation.args[invocation.args.indexOf('--dir') + 1], invocation.cwd);
  assert.equal(invocation.config.permission, 'deny');
  assert.equal(invocation.config.agent.tutor.permission, 'deny');
  assert.deepEqual(JSON.parse(invocation.permission), { '*': 'deny' });
  assert.ok(invocation.configHome.startsWith(invocation.cwd));
  assert.ok(invocation.db.startsWith(invocation.cwd));
  assert.equal(invocation.opencodeConfig, undefined);
  assert.equal(invocation.codexThread, undefined);
});

test('given authentication failure, when generating, then gives sign-in guidance without exposing CLI logs', async t => {
  await fakeCli(t, 'auth');
  await assert.rejects(generateLesson(context(), { signal: new AbortController().signal, onProgress() {} }), error => {
    assert.match((error as Error).message, /codex login/);
    assert.doesNotMatch((error as Error).message, /SECRET/);
    return true;
  });
});

test('given malformed model output, when generating, then rejects instead of accepting an unchecked lesson', async t => {
  await fakeCli(t, 'malformed');
  await assert.rejects(generateLesson(context(), { signal: new AbortController().signal, onProgress() {} }), /malformed JSON/);
});

test('given an output flood, when generating, then bounds capture and terminates the CLI', async t => {
  await fakeCli(t, 'flood');
  await assert.rejects(generateLesson(context(), { signal: new AbortController().signal, onProgress() {} }), /too much output/);
});

test('given a stalled CLI, when its timeout expires, then terminates and returns actionable guidance', async t => {
  await fakeCli(t, 'slow');
  process.env.CODE_SWIPE_TUTOR_TIMEOUT_MS = '100';
  const started = Date.now();
  await assert.rejects(generateLesson(context(), { signal: new AbortController().signal, onProgress() {} }), /took too long/);
  assert.ok(Date.now() - started < 3000);
});

test('given cancellation and a resistant descendant, when aborting, then kills the whole CLI process group', { skip: process.platform === 'win32' }, async t => {
  const fake = await fakeCli(t, 'descendant');
  const controller = new AbortController();
  const pending = generateLesson(context(), { signal: controller.signal, onProgress() {} });
  let pid = 0;
  for (let i = 0; i < 100; i++) {
    try { pid = Number(await readFile(fake.pidFile, 'utf8')); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  assert.ok(pid > 0);
  const rejection = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();
  await rejection;
  // Linux may retain a killed, orphaned process as a zombie until init reaps it.
  let alive = false;
  try {
    process.kill(pid, 0);
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    alive = !/^\d+ \(.+\) Z /.test(stat);
  } catch { /* Gone. */ }
  assert.equal(alive, false);
});

test('given an already cancelled job, when generating, then starts no CLI', async t => {
  const fake = await fakeCli(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(generateLesson(context(), { signal: controller.signal, onProgress() {} }), { name: 'AbortError' });
  await assert.rejects(readFile(fake.record), { code: 'ENOENT' });
});

test('given baseline mode and persistent history, when building the prompt, then excludes history hypotheses and metrics', () => {
  const input = context();
  input.settings.tutorMode = 'baseline';
  input.hypotheses = [{ id: 'PRIVATE-HYPOTHESIS', claim: 'secret-history', status: 'tentative', supportingAttemptIds: [], counterevidenceAttemptIds: [], alternatives: ['other'], nextProbe: 'secret-probe' }];
  input.history = [{ lesson: { objective: 'PRIVATE-LESSON' }, attempts: [{ id: 'PRIVATE-ATTEMPT' }] }] as unknown as TutorContext['history'];
  input.metrics.count = 987654321;
  const prompt = buildTutorPrompt(input);
  assert.doesNotMatch(prompt, /PRIVATE-|secret-history|secret-probe|987654321/);
  assert.match(prompt, /BASELINE/);
  assert.match(prompt, /"history":\[\],"hypotheses":\[\]/);
});

test('given schema violations or bad fixtures, when parsing tutor output, then rejects invalid contracts', () => {
  const missingNullable = wireLesson();
  delete (missingNullable.questions[0] as Partial<typeof missingNullable.questions[0]>).hypothesisId;
  assert.throws(() => parseLessonOutput(JSON.stringify(missingNullable)), /hypothesisId is required/);
  const badFixture = wireLesson();
  badFixture.questions[0].tests[0].inputJson = 'undefined';
  assert.throws(() => parseLessonOutput(JSON.stringify(badFixture)), /malformed JSON in a test fixture/);
  badFixture.questions[0].tests[0].inputJson = '[1e999]';
  assert.throws(() => parseLessonOutput(JSON.stringify(badFixture)), /malformed JSON in a test fixture/);
  const badProbability = wireLesson();
  badProbability.questions[0].prediction.pCorrect = 2;
  assert.throws(() => parseLessonOutput(JSON.stringify(badProbability)), /outside its allowed range/);
  const threeFixtures = wireLesson();
  threeFixtures.questions[0].tests.pop();
  assert.throws(() => parseLessonOutput(JSON.stringify(threeFixtures)), /invalid item count/);
  assert.equal(parseLessonOutput('```json\n' + JSON.stringify(wireLesson()) + '\n```').questions.length, 1);
});

test('given a failed draft, when building repair instructions, then includes the whole draft and validation feedback', () => {
  const input = context();
  input.draft = parseLessonOutput(JSON.stringify(wireLesson()));
  input.repair = ['Reference fixture did not match.'];
  const prompt = buildTutorPrompt(input);
  assert.match(prompt, /Fix the ENTIRE batch/);
  assert.match(prompt, /Reference fixture did not match/);
  assert.match(prompt, /Sum the measurements/);
  assert.match(prompt, /"referenceCode"/);
});

test('given structured output schema, when inspecting nested objects, then all fields are required and closed', () => {
  function inspect(schema: typeof lessonOutputSchema) {
    if (schema.properties) {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(schema.required, Object.keys(schema.properties));
      Object.values(schema.properties).forEach(inspect);
    }
    if (schema.items) inspect(schema.items);
  }
  inspect(lessonOutputSchema);
});

test('given OpenCode error events or missing text, when parsing, then rejects failures even after exit zero', () => {
  assert.throws(() => parseOpenCodeOutput(JSON.stringify({ type: 'error', error: { message: '401 SECRET' } })), /opencode auth login/);
  assert.throws(() => parseOpenCodeOutput(JSON.stringify({ type: 'step_finish' })), /no lesson text/);
  assert.throws(() => parseOpenCodeOutput('not json'), /malformed event JSON/);
});
