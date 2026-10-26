import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProposedLesson, ProviderId, ProviderStatus, TutorContext } from '../src/types.ts';
import { buildTutorPrompt, lessonSchemaForBatch, parseLessonOutput } from './prompts.ts';

type CliProvider = Exclude<ProviderId, 'demo'>;
type RunOptions = { cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal; input?: string; timeout: number; maxBytes?: number };
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_LESSON_BYTES = 512 * 1024;

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
    child.once('close', code => {
      // Stop descendants too; temporary files and processes belong to this run.
      signalProcessGroup(child, 'SIGKILL');
      finish(failure ?? (code === 0 ? undefined : cliFailure(provider, `${stderr}\n${stdout}`)));
    });
    child.stdin.end(options.input ?? '');
  });
}

function cliFailure(provider: CliProvider, diagnostics: string): Error {
  // Never put CLI logs in an API error: they may contain prompts or credentials.
  if (/unauthori[sz]ed|unauthenticated|not logged in|authentication|auth(?:entication)?[_ -]?(?:error|required)|invalid.{0,15}(?:api.?key|token)|401|login required|sign.?in/i.test(diagnostics)) {
    return new Error(`${provider} needs authentication. Run "${provider === 'codex' ? 'codex login' : 'opencode auth login'}" in your terminal, then retry.`);
  }
  if (/429|rate.?limit|quota|usage.?limit|insufficient.?credit|billing/i.test(diagnostics)) return new Error(`${provider} reached a usage or rate limit. Wait, check your account, or choose another provider/model.`);
  if (/model.{0,50}(?:not found|not supported|does not exist|unavailable)|(?:unknown|invalid|unsupported).{0,20}model|ModelNotFound/i.test(diagnostics)) return new Error(`${provider} could not use that model. Check the model name or clear it to use the CLI default.`);
  if (/unknown (?:argument|option)|unexpected argument|unrecognized option/i.test(diagnostics)) return new Error(`${provider} does not support the required CLI options. Update the CLI and retry.`);
  return new Error(`${provider} could not complete the lesson. Check CLI sign-in, network access, and model availability, then retry.`);
}

export async function detectProviders(): Promise<ProviderStatus[]> {
  const statuses = await Promise.all((['codex', 'opencode'] as const).map(async id => {
    try {
      const output = await runCli(id, ['--version'], { cwd: tmpdir(), env: isolatedEnvironment(tmpdir()), timeout: 5_000, maxBytes: 16_384 });
      const version = `${output.stdout}\n${output.stderr}`.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/)?.[0];
      if (!version) throw new Error(`${id} did not report a version. Check its installation.`);
      return { id, available: true, version, detail: 'Installed. Authentication and model access are checked during generation.' };
    } catch (error) {
      return { id, available: false, version: '', detail: (error as Error).message };
    }
  }));
  return [...statuses, { id: 'demo', available: true, version: '1', detail: 'Local examples. No CLI, account, or model request required.' }];
}

function codexArguments(directory: string, schemaPath: string, outputPath: string, model: string): string[] {
  const disabled = ['apps', 'plugins', 'remote_plugin', 'hooks', 'shell_tool', 'unified_exec', 'multi_agent', 'multi_agent_v2', 'memories', 'external_agent_memory_import', 'skill_search', 'skill_mcp_dependency_install', 'tool_suggest', 'browser_use', 'computer_use', 'image_generation', 'view_image', 'shell_snapshot', 'workspace_dependencies'];
  return [
    'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only', '--skip-git-repo-check',
    '--cd', directory, '--color', 'never', '--json', '--output-schema', schemaPath, '-o', outputPath,
    '-c', 'approval_policy="never"', '-c', 'web_search="disabled"', '-c', 'mcp_servers={}',
    '-c', 'plugins._default.enabled=false', '-c', 'project_doc_max_bytes=0', '-c', 'allow_login_shell=false',
    '--enable', 'skip_host_skill_discovery', ...disabled.flatMap(feature => ['--disable', feature]),
    ...(model ? ['--model', model] : []), '-',
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

export async function generateLesson(context: TutorContext, options: { signal: AbortSignal; onProgress: (message: string) => void }): Promise<ProposedLesson> {
  const provider = context.settings.provider;
  if (provider !== 'codex' && provider !== 'opencode') throw new Error('Choose Codex or OpenCode for CLI generation.');
  if (options.signal.aborted) throw abortError();
  const configuredTimeout = Number(process.env.CODE_SWIPE_TUTOR_TIMEOUT_MS);
  const timeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? Math.min(configuredTimeout, 600_000) : 180_000;
  const directory = await mkdtemp(join(tmpdir(), 'code-swipe-tutor-'));
  try {
    const env = isolatedEnvironment(directory);
    const prompt = buildTutorPrompt(context);
    if (Buffer.byteLength(prompt) > 512 * 1024) throw new Error('Tutor history is too large for one request. Reduce saved history before retrying.');
    options.onProgress(`Waiting for ${provider} to plan and check the lesson…`);
    let raw: string;
    if (provider === 'codex') {
      const schemaPath = join(directory, 'lesson-schema.json');
      const outputPath = join(directory, 'lesson.json');
      await writeFile(schemaPath, JSON.stringify(lessonSchemaForBatch(context.settings.batchSize)), { mode: 0o600 });
      await runCli(provider, codexArguments(directory, schemaPath, outputPath, context.settings.model.trim()), { cwd: directory, env, input: prompt, signal: options.signal, timeout });
      let size: number;
      try { size = (await stat(outputPath)).size; }
      catch { throw new Error('Codex returned no lesson. Check the selected model and retry.'); }
      if (size > MAX_LESSON_BYTES) throw new Error('Codex returned an oversized lesson. Retry with a smaller batch.');
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
          agent: { tutor: { mode: 'primary', description: 'Return one structured lesson without tools.', permission: 'deny', prompt: 'Plan the supplied lesson. Return only the required JSON object. All tools are disabled.' } },
        }),
      });
      const args = ['run', '--pure', '--format', 'json', '--dir', directory, '--agent', 'tutor', ...(context.settings.model.trim() ? ['--model', context.settings.model.trim()] : [])];
      const output = await runCli(provider, args, { cwd: directory, env, input: prompt, signal: options.signal, timeout });
      raw = parseOpenCodeOutput(output.stdout);
      if (Buffer.byteLength(raw) > MAX_LESSON_BYTES) throw new Error('OpenCode returned an oversized lesson. Retry with a smaller batch.');
    }
    if (options.signal.aborted) throw abortError();
    options.onProgress('Checking the tutor response…');
    const lesson = parseLessonOutput(raw);
    if (lesson.questions.length !== context.settings.batchSize) throw new Error('Tutor returned the wrong batch size. Retry generation.');
    if (context.settings.tutorMode === 'baseline' && (lesson.hypotheses.length || lesson.questions.some(question => question.hypothesisId !== null))) throw new Error('Baseline tutor returned a persistent learner hypothesis. Retry generation.');
    return lesson;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
