import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConceptGuide, GuideConcept, DiscussionContext, ProposedDiscussion, ProposedLesson, ProviderId, ProviderStatus, TutorContext, LearningContext } from '../src/types.ts';
import { guidePrompt, guideSchema, parseGuide, contextGuidePrompt, contextGuideSchema, parseContextGuide, guideIsExecutable } from './concept-guides.ts';
import { buildDiscussionPrompt, discussionOutputSchema, parseDiscussionOutput } from './discussion.ts';
import { buildTutorPrompt, lessonSchemaForBatch, parseLessonOutput } from './prompts.ts';
import { learningTaskPrompt, parseDirections, parseLearningPlan, parseArcReview, type LearningTask } from './learning-journey.ts';
import type { LearningJourney, DirectionProposal, LearningPlan, ArcReview } from '../src/types.ts';

type CliProvider = Exclude<ProviderId, 'demo'>;
export type GenerationOptions = { signal: AbortSignal; onProgress: (message: string) => void; sessionDirectory?: string };
type RunOptions = { cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal; input?: string; timeout: number; maxBytes?: number };
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MIN_CODEX_VERSION = [0, 153, 4] as const;

function binary(provider: CliProvider): string {
  return process.env[provider === 'codex' ? 'CODE_SWIPE_CODEX_BIN' : 'CODE_SWIPE_OPENCODE_BIN'] || provider;
}

function abortError(): Error {
  const error = new Error('Lesson generation cancelled.');
  error.name = 'AbortError';
  return error;
}

function isolatedEnvironment(directory: string): NodeJS.ProcessEnv {
  const env = { ...process.env, PWD: directory, NO_COLOR: '1' };
  for (const key of Object.keys(env)) {
    if ((key.startsWith('CODEX_') && key !== 'CODEX_HOME') || key.startsWith('OPENCODE_') || ['NODE_OPTIONS', 'NODE_PATH', 'BUN_OPTIONS', 'BASH_ENV', 'ENV'].includes(key)) delete env[key];
  }
  return env;
}

function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch { /* Process may already have exited. */ }
}

async function runCli(provider: CliProvider, args: string[], options: RunOptions): Promise<{ stdout: string; stderr: string }> {
  if (options.signal?.aborted) throw abortError();
  return new Promise((resolve, reject) => {
    const child = spawn(binary(provider), args, {
      cwd: options.cwd, env: options.env, shell: false,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let failure: Error | undefined;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      clearTimeout(settleTimer);
      options.signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve({ stdout, stderr });
    };
    const stop = (error: Error) => {
      if (failure || settled) return;
      failure = error;
      signalProcessGroup(child, 'SIGTERM');
      killTimer = setTimeout(() => signalProcessGroup(child, 'SIGKILL'), 350);
      // A descendant can keep pipes open after the CLI exits. Never wait forever.
      settleTimer = setTimeout(() => {
        signalProcessGroup(child, 'SIGKILL');
        child.stdout.destroy();
        child.stderr.destroy();
        child.stdin.destroy();
        finish(error);
      }, 1_000);
    };
    const onAbort = () => stop(abortError());
    const timeout = setTimeout(() => stop(new Error(`${provider} took too long. Retry with a smaller batch or faster model; CODE_SWIPE_TUTOR_TIMEOUT_MS controls the time limit.`)), options.timeout);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    // Covers cancellation between the initial check and listener registration.
    if (options.signal?.aborted) onAbort();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const receive = (target: 'stdout' | 'stderr', chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > (options.maxBytes ?? MAX_OUTPUT_BYTES)) {
        stop(new Error(`${provider} produced too much output. Retry with a smaller batch.`));
        return;
      }
      if (target === 'stdout') stdout += chunk;
      else stderr += chunk;
    };
    child.stdout.on('data', chunk => receive('stdout', chunk));
    child.stderr.on('data', chunk => receive('stderr', chunk));
    child.stdin.on('error', () => { /* EPIPE is reported through process exit. */ });
    child.once('error', error => {
      const code = (error as NodeJS.ErrnoException).code;
      finish(new Error(code === 'ENOENT'
        ? `${provider} CLI was not found. Install it, add it to PATH, or set CODE_SWIPE_${provider.toUpperCase()}_BIN.`
        : `${provider} could not start. Check its executable path and permissions.`));
    });
    child.once('close', (code, signal) => {
      // Stop descendants too; temporary files and processes belong to this run.
      signalProcessGroup(child, 'SIGKILL');
      const events = cliEventFailures(stdout);
      finish(failure ?? (code === 0 && !events.failed ? undefined : cliFailure(provider, `${stderr}\n${events.diagnostics}`, { code, signal })));
    });
    child.stdin.end(options.input ?? '');
  });
}

function cliEventFailures(stdout: string): { diagnostics: string; failed: boolean } {
  const diagnostics: string[] = [];
  let failed = false;
  for (const line of stdout.split('\n')) {
    let event: Record<string, unknown>;
    try { event = JSON.parse(line); } catch { continue; }
    if (!event || typeof event !== 'object') continue;
    if (event.type === 'turn.completed') {
      // A successful retry supersedes an earlier stream error.
      diagnostics.length = 0;
      failed = false;
    } else if (event.type === 'error' || event.type === 'turn.failed') {
      diagnostics.push(JSON.stringify(event.error ?? event.message ?? ''));
      failed = true;
    }
    // item.completed/type:error can be a nonfatal CLI configuration warning.
    // Never classify agent_message text, which may echo untrusted lesson data.
  }
  return { diagnostics: diagnostics.join('\n'), failed };
}

function cliFailure(provider: CliProvider, diagnostics: string, exit?: { code: number | null; signal: NodeJS.Signals | null }): Error {
  // Emit only fixed diagnostic vocabulary and process status. Even redacted
  // log excerpts can expose prompt/history text or unfamiliar credential forms.
  const status = !exit || exit.code === 0 ? '' : exit.signal ? ` (${exit.signal})` : ` (exit ${exit.code ?? 'unknown'})`;
  const failure = (message: string) => new Error(`${provider}${status} ${message}`);
  if (/(?:session|thread|rollout).{0,80}(?:not found|does not exist|no longer exists)|(?:no|missing).{0,20}(?:session|thread|rollout).{0,30}(?:found|id|file)/i.test(diagnostics)) return new SessionMissingError('The saved tutor conversation is unavailable.');
  if (/invalid_json_schema|invalid schema|schema.{0,80}(?:not supported|unsupported|invalid)|(?:not supported|unsupported).{0,80}schema/i.test(diagnostics)) {
    const bound = diagnostics.match(/\b(?:minItems|maxItems|minLength|maxLength|additionalProperties|required|pattern)\b/)?.[0];
    return failure(`rejected the lesson output schema${bound ? ` (${bound})` : ''}. This is a structured-output compatibility error; update the app or choose another provider/model.`);
  }
  if (/unknown (?:argument|option)|unexpected argument|unrecognized option|unknown feature|unrecognized feature/i.test(diagnostics)) return failure('does not support a required CLI option or feature. Update the CLI and retry.');
  if (/error (?:loading|parsing) config|failed to (?:load|parse) config|invalid (?:configuration|config)|configuration error|TOML parse error/i.test(diagnostics)) return failure('could not load its CLI configuration. Check the CLI installation and configuration syntax.');
  if (/unauthori[sz]ed|unauthenticated|not logged in|authentication|auth(?:entication)?[_ -]?(?:error|required)|invalid.{0,15}(?:api.?key|token)|401|login required|sign.?in/i.test(diagnostics)) {
    return failure(`needs authentication. Run "${provider === 'codex' ? 'codex login' : 'opencode auth login'}" in your terminal, then retry.`);
  }
  if (/429|rate.?limit|quota|usage.?limit|insufficient.?credit|billing/i.test(diagnostics)) return failure('reached a usage or rate limit. Wait, check your account, or choose another provider/model.');
  if (/model.{0,50}(?:not found|not supported|does not exist|unavailable)|(?:unknown|invalid|unsupported).{0,20}model|ModelNotFound/i.test(diagnostics)) return failure('could not use that model. Check the model name or clear it to use the CLI default.');
  if (/403|forbidden|access.?denied|permission.?denied/i.test(diagnostics)) return failure('reported an access or permission denial. Check account access and local CLI permissions.');
  if (/ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|connection (?:refused|reset|closed)|network (?:error|unreachable)|error sending request|stream (?:disconnected|closed)|TLS|certificate/i.test(diagnostics)) return failure('lost its network connection to the model service. Check connectivity and retry.');
  if (/\b50[0234]\b|service unavailable|server error|overloaded/i.test(diagnostics)) return failure('reported a model service error. Retry after a short wait.');
  return failure('stopped without a recognized failure reason. Retry generation; if it repeats, check the CLI installation. No raw CLI logs are exposed.');
}

async function cliVersion(provider: CliProvider, directory: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<string> {
  const output = await runCli(provider, ['--version'], { cwd: directory, env, signal, timeout: 5_000, maxBytes: 16_384 });
  const version = `${output.stdout}\n${output.stderr}`.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/)?.[0];
  if (!version) throw new Error(`${provider} did not report a version. Check its installation.`);
  return version;
}

function requireSupportedCodex(version: string): void {
  const parts = version.split(/[.+-]/).slice(0, 3).map(Number);
  const comparison = parts.map((part, index) => part - MIN_CODEX_VERSION[index]).find(value => value !== 0) ?? 0;
  if (comparison < 0) {
    throw new Error(`Codex CLI ${version} is too old for isolated lesson generation. Version ${MIN_CODEX_VERSION.join('.')} or newer is required. Update Codex or set CODE_SWIPE_CODEX_BIN to a supported installation; its path may differ from your terminal's CLI.`);
  }
}

export async function detectProviders(): Promise<ProviderStatus[]> {
  const statuses = await Promise.all((['codex', 'opencode'] as const).map(async id => {
    let version = '';
    try {
      version = await cliVersion(id, tmpdir(), isolatedEnvironment(tmpdir()));
      if (id === 'codex') requireSupportedCodex(version);
      return { id, available: true, version, detail: 'Installed. Authentication and model access are checked during generation.' };
    } catch (error) {
      return { id, available: false, version, detail: (error as Error).message };
    }
  }));
  return [...statuses, { id: 'demo', available: true, version: '1', detail: 'Local examples. No CLI, account, or model request required.' }];
}

class SessionMissingError extends Error {}

function codexArguments(directory: string, schemaPath: string, outputPath: string, model: string, persistent = false, sessionId?: string): string[] {
  const disabled = ['apps', 'plugins', 'remote_plugin', 'hooks', 'shell_tool', 'unified_exec', 'multi_agent', 'multi_agent_v2', 'memories', 'external_agent_memory_import', 'skill_search', 'skill_mcp_dependency_install', 'tool_suggest', 'browser_use', 'computer_use', 'image_generation', 'view_image', 'shell_snapshot', 'workspace_dependencies'];
  return [
    'exec', ...(sessionId ? ['resume'] : []), ...(!persistent ? ['--ephemeral'] : []), '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check',
    ...(!sessionId ? ['--sandbox', 'read-only', '--cd', directory, '--color', 'never'] : []), '--json', '--output-schema', schemaPath, '-o', outputPath,
    '-c', 'sandbox_mode="read-only"',
    '-c', 'approval_policy="never"', '-c', 'web_search="disabled"', '-c', 'mcp_servers={}',
    '-c', 'plugins._default.enabled=false', '-c', 'project_doc_max_bytes=0', '-c', 'allow_login_shell=false',
    '--enable', 'skip_host_skill_discovery', ...disabled.flatMap(feature => ['--disable', feature]),
    ...(model ? ['--model', model] : []), ...(sessionId ? [sessionId] : []), '-',
  ];
}

export function parseOpenCodeOutput(stdout: string): string {
  const textParts: string[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    let event: { type?: string; part?: { text?: string }; error?: unknown };
    try { event = JSON.parse(line); }
    catch { throw new Error('OpenCode returned malformed event JSON. Update the CLI or retry generation.'); }
    if (!event || typeof event !== 'object') throw new Error('OpenCode returned an invalid event. Retry generation.');
    if (event.type === 'error' || event.error) throw cliFailure('opencode', JSON.stringify(event));
    if (event.type === 'text' && typeof event.part?.text === 'string') textParts.push(event.part.text);
  }
  if (!textParts.length) throw new Error('OpenCode returned no lesson text. Check the selected model and retry.');
  return textParts.join('\n');
}

type TutorRequest = { prompt: string; schema: unknown; subject: 'lesson' | 'discussion' | 'guide' | 'directions' | 'curriculum' | 'progress' };
const sessionQueues = new Map<string, Promise<unknown>>();
function sessionIdFromEvents(stdout: string, provider: CliProvider): string | undefined {
  for (const line of stdout.split('\n')) {
    try {
      const event = JSON.parse(line);
      const id = provider === 'codex' ? event.type === 'thread.started' ? event.thread_id : undefined : event.sessionID ?? event.part?.sessionID;
      if (typeof id === 'string' && (provider === 'codex' ? /^[0-9a-f-]{36}$/i : /^ses_[a-zA-Z0-9_-]{5,100}$/).test(id)) return id;
    } catch { /* Other output is handled by the provider parser. */ }
  }
}

async function runStructuredTutor(settings: TutorContext['settings'], request: TutorRequest, options: GenerationOptions): Promise<string> {
  // Baseline must never inherit a reflective conversation, even if a caller supplies its directory.
  const key = options.sessionDirectory && settings.tutorMode === 'reflective'
    ? join(options.sessionDirectory, createHash('sha256').update(`${settings.provider}\0${settings.model}\0tutor-session-v1`).digest('hex').slice(0, 24)) : undefined;
  if (!key) return runTutorTurn(settings, request, options);
  const previous = sessionQueues.get(key) ?? Promise.resolve();
  const work = previous.catch(() => {}).then(async () => {
    if (options.signal.aborted) throw abortError();
    try { return await runTutorTurn(settings, request, options, key); }
    catch (error) {
      if (!(error instanceof SessionMissingError) || options.signal.aborted) throw error;
      await rm(join(key, 'conversation.json'), { force: true });
      options.onProgress('The previous conversation is unavailable. Continuing in a new session with your saved learning record…');
      return runTutorTurn(settings, request, options, key);
    }
  });
  sessionQueues.set(key, work);
  try { return await work; } finally { if (sessionQueues.get(key) === work) sessionQueues.delete(key); }
}

async function runTutorTurn(
  settings: TutorContext['settings'],
  request: TutorRequest,
  options: GenerationOptions,
  sessionDirectory?: string,
): Promise<string> {
  const provider = settings.provider;
  if (provider !== 'codex' && provider !== 'opencode') throw new Error('Choose Codex or OpenCode for CLI generation.');
  if (options.signal.aborted) throw abortError();
  const configuredTimeout = Number(process.env.CODE_SWIPE_TUTOR_TIMEOUT_MS);
  const timeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? Math.min(configuredTimeout, 600_000) : request.subject === 'lesson' ? 360_000 : 180_000;
  const temporary = await mkdtemp(join(tmpdir(), 'code-swipe-tutor-'));
  const directory = sessionDirectory ?? temporary;
  let session: { id: string; turns: number } | undefined;
  try {
    if (sessionDirectory) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      try {
        session = JSON.parse(await readFile(join(directory, 'conversation.json'), 'utf8'));
        if (!session || !/^[a-zA-Z0-9_-]{8,120}$/.test(session.id) || !Number.isInteger(session.turns)) throw new Error('Invalid session record.');
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const env = isolatedEnvironment(directory);
    // Older CLIs reject isolation features before making a request. Never
    // silently drop those protections just to make generation start.
    if (provider === 'codex') requireSupportedCodex(await cliVersion(provider, directory, env, options.signal));
    const { schema, subject } = request;
    const prompt = `${sessionDirectory ? 'This is a continuing tutor conversation. Current task, schema, and supplied saved records supersede prior turns. Earlier generated drafts, cancelled lessons, and superseded plans are not evidence of learning. Never assume a generated question was answered. Return only the current task schema.\n' : ''}${request.prompt}`;
    if (Buffer.byteLength(prompt) > 512 * 1024) throw new Error('Tutor history is too large for one request. Reduce saved history before retrying.');
    options.onProgress(`Waiting for ${provider} to ${{ lesson: 'plan the lesson', guide: 'prepare the guide', discussion: 'reflect on your feedback', directions: 'explore new learning directions', curriculum: 'sketch your curriculum', progress: 'review progress and adjust the plan' }[subject]}…`);
    let raw: string;
    let emittedSessionId: string | undefined;
    if (provider === 'codex') {
      const schemaPath = join(temporary, `${subject}-schema.json`);
      const outputPath = join(temporary, `${subject}.json`);
      await writeFile(schemaPath, JSON.stringify(schema), { mode: 0o600 });
      const output = await runCli(provider, codexArguments(directory, schemaPath, outputPath, settings.model.trim(), Boolean(sessionDirectory), session?.id), { cwd: directory, env, input: prompt, signal: options.signal, timeout });
      emittedSessionId = sessionIdFromEvents(output.stdout, provider);
      let size: number;
      try { size = (await stat(outputPath)).size; }
      catch { throw new Error(`Codex returned no ${subject}. Check the selected model and retry.`); }
      if (size > MAX_RESPONSE_BYTES) throw new Error(`Codex returned an oversized ${subject}. Retry with a smaller request.`);
      raw = await readFile(outputPath, 'utf8');
    } else {
      // Keep the normal data directory for existing CLI authentication. Config,
      // instructions, plugins, and session database are isolated from the user.
      Object.assign(env, {
        XDG_CONFIG_HOME: join(directory, 'config'), OPENCODE_CONFIG_DIR: join(directory, 'config', 'opencode'),
        OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_DISABLE_CLAUDE_CODE: 'true',
        OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true', OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: 'true',
        OPENCODE_PURE: 'true', OPENCODE_PERMISSION: JSON.stringify({ '*': 'deny' }),
        OPENCODE_DB: join(directory, 'session.db'),
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          permission: 'deny', plugin: [], mcp: {}, instructions: [], share: 'disabled', snapshot: false, autoupdate: false,
          agent: { tutor: { mode: 'primary', description: 'Return one structured tutor response without tools.', permission: 'deny', prompt: 'Complete the supplied tutor task. Return only the required JSON object. All tools are disabled.' } },
        }),
      });
      const args = ['run', '--pure', '--format', 'json', '--dir', directory, '--agent', 'tutor', ...(session?.id ? ['--session', session.id] : []), ...(settings.model.trim() ? ['--model', settings.model.trim()] : [])];
      const output = await runCli(provider, args, { cwd: directory, env, input: prompt, signal: options.signal, timeout });
      emittedSessionId = sessionIdFromEvents(output.stdout, provider);
      raw = parseOpenCodeOutput(output.stdout);
      if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) throw new Error(`OpenCode returned an oversized ${subject}. Retry with a smaller request.`);
    }
    if (options.signal.aborted) throw abortError();
    const sessionId = emittedSessionId ?? session?.id;
    if (sessionDirectory && sessionId) {
      const path = join(directory, 'conversation.json');
      await writeFile(`${path}.tmp`, JSON.stringify({ id: sessionId, turns: (session?.turns ?? 0) + 1, provider, model: settings.model, updatedAt: new Date().toISOString() }), { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    }
    options.onProgress('Checking the tutor response…');
    return raw;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function generateLearningTask(task: LearningTask, context: TutorContext, journey: LearningJourney, options: GenerationOptions): Promise<DirectionProposal | LearningPlan | ArcReview> {
  const request = learningTaskPrompt(task, context, journey);
  if (context.repair?.length) request.prompt += `\nCORRECT THE PREVIOUS RESPONSE\n${JSON.stringify(context.repair)}`;
  const raw = await runStructuredTutor(context.settings, { ...request, subject: task.kind }, options);
  if (options.signal.aborted) throw abortError();
  try { return task.kind === 'directions' ? parseDirections(raw) : task.kind === 'curriculum' ? parseLearningPlan(raw) : parseArcReview(raw, task.arc, context); }
  catch (error) { throw new Error(`Invalid curriculum response: ${(error as Error).message}`); }
}

export async function generateLesson(context: TutorContext, options: GenerationOptions): Promise<ProposedLesson> {
  const raw = await runStructuredTutor(context.settings, {
    prompt: buildTutorPrompt(context), schema: lessonSchemaForBatch(context.settings.batchSize, Boolean(context.knowledge)), subject: 'lesson',
  }, options);
  if (options.signal.aborted) throw abortError();
  const lesson = parseLessonOutput(raw, Boolean(context.knowledge));
  if (lesson.questions.length !== context.settings.batchSize) throw new Error('Tutor returned the wrong batch size. Retry generation.');
  if (context.settings.tutorMode === 'baseline' && (lesson.hypotheses.length || lesson.questions.some(question => question.hypothesisId !== null))) throw new Error('Baseline tutor returned a persistent learner hypothesis. Retry generation.');
  return lesson;
}

export async function generateDiscussion(context: DiscussionContext, options: GenerationOptions): Promise<ProposedDiscussion> {
  const raw = await runStructuredTutor(context.tutor.settings, {
    prompt: buildDiscussionPrompt(context), schema: discussionOutputSchema, subject: 'discussion',
  }, options);
  if (options.signal.aborted) throw abortError();
  return parseDiscussionOutput(raw);
}

export async function generateGuide(settings: TutorContext['settings'], concept: GuideConcept, options: GenerationOptions, context?: LearningContext): Promise<ConceptGuide> {
  if (context && !guideIsExecutable(context)) {
    const raw = await runStructuredTutor(settings, { prompt: contextGuidePrompt(concept, context), schema: contextGuideSchema, subject: 'guide' }, options);
    if (options.signal.aborted) throw abortError();
    return parseContextGuide(raw, concept, context);
  }
  const language = settings.language ?? 'javascript';
  const raw = await runStructuredTutor(settings, { prompt: guidePrompt(concept, language), schema: guideSchema, subject: 'guide' }, options);
  return parseGuide(raw, concept, options.signal, language);
}
