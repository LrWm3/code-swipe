import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { FunctionSignature, JsonValue } from '../src/types.ts';
import { validateArguments, validateSignature } from './question-format.ts';

// A digest keeps the runtime reproducible and prevents an implicit network pull.
export const PYTHON_IMAGE = 'python:3.12-slim@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159';
const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 20_000;

export async function pythonAvailability(): Promise<{ available: boolean; detail: string }> {
  try {
    await execFileAsync('docker', ['image', 'inspect', PYTHON_IMAGE, '--format', '{{.Id}}'], { timeout: 5_000, maxBuffer: 4_096 });
    return { available: true, detail: 'Python sandbox image is ready.' };
  } catch {
    return { available: false, detail: `Start Docker and run: docker pull ${PYTHON_IMAGE}` };
  }
}

// This program runs entirely inside a disposable, unprivileged container. The
// only input is source and one fixture's arguments; expected outputs stay in
// the host. AST checks enforce the exercise format, not the security boundary.
const HARNESS = String.raw`
import ast, json, math, sys

def fail(kind, message):
    print(json.dumps({'kind': kind, 'value': None, 'error': str(message)[:240]}, allow_nan=False))

try:
    request = json.loads(sys.stdin.read(25000))
    source, name, parameters, arguments = request['code'], request['name'], request['parameters'], request['arguments']
    tree = ast.parse(source, mode='exec')
    allowed_imports = {'math', 'typing', 'collections', 'itertools', 'functools', 're'}
    definitions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name]
    if len(definitions) != 1 or any(not isinstance(node, (ast.FunctionDef, ast.Import, ast.ImportFrom)) for node in tree.body):
        raise ValueError('Provide named synchronous functions and supported standard-library imports only.')
    for node in ast.walk(tree):
        if isinstance(node, (ast.AsyncFunctionDef, ast.ClassDef, ast.Global, ast.Nonlocal, ast.Yield, ast.YieldFrom)):
            raise ValueError('Use synchronous functions without classes, global declarations, or generators.')
        if isinstance(node, ast.FunctionDef) and (node.decorator_list or node.args.vararg or node.args.kwarg or node.args.kwonlyargs or node.args.defaults or node.args.kw_defaults):
            raise ValueError('Functions cannot use decorators, default arguments, or variadic parameters.')
        if isinstance(node, ast.Import) and any(alias.name not in allowed_imports for alias in node.names):
            raise ValueError('Only math, typing, collections, itertools, functools, and re imports are supported.')
        if isinstance(node, ast.ImportFrom) and (node.level or node.module not in allowed_imports or any(alias.name == '*' for alias in node.names)):
            raise ValueError('Only named supported standard-library imports are allowed.')
        if isinstance(node, ast.Attribute) and (node.attr.startswith('_') or node.attr in ('sys', 'os', 'subprocess', 'builtins')):
            raise ValueError('Private or restricted attribute access is not supported.')
        if isinstance(node, ast.Name) and (node.id.startswith('__') or node.id in {'eval', 'exec', 'compile', 'open', 'globals', 'locals', 'vars', 'getattr', 'setattr', 'delattr', 'input', 'print', 'breakpoint', 'help'}):
            raise ValueError('The exercise must be a pure function without I/O or dynamic execution.')
    function = definitions[0]
    if [arg.arg for arg in function.args.posonlyargs + function.args.args] != parameters:
        raise ValueError('The function parameters do not match the declared signature.')
    if not ast.get_docstring(function):
        raise ValueError('The function needs a docstring describing its contract.')
    namespace = {'__builtins__': __builtins__}
    exec(compile(tree, '<exercise>', 'exec'), namespace)
    callable_function = namespace[name]
except BaseException as error:
    fail('source', error)
    sys.exit(0)

try:
    before = json.dumps(arguments, sort_keys=True, allow_nan=False, separators=(',', ':'))
    try:
        result = callable_function(*arguments)
    except (MemoryError, RecursionError):
        fail('invalid', 'The sandbox resource limit was reached.')
        sys.exit(0)
    except BaseException as error:
        fail('throw', error)
        sys.exit(0)
    after = json.dumps(arguments, sort_keys=True, allow_nan=False, separators=(',', ':'))
    if before != after:
        fail('throw', 'The function modified an input.')
        sys.exit(0)
    def normalize(value, depth=0, seen=None):
        if seen is None: seen = set()
        if depth > 12: raise ValueError('Result exceeds nesting limits.')
        if value is None or type(value) in (bool, str): return value
        if type(value) is int:
            if abs(value) > 9007199254740991: raise ValueError('Result integer exceeds the safe JSON range.')
            return value
        if type(value) is float:
            if not math.isfinite(value): raise ValueError('Result must be finite JSON.')
            return value
        if type(value) not in (list, dict) or id(value) in seen: raise ValueError('Result must use plain JSON lists and objects.')
        seen.add(id(value))
        if len(value) > 2000: raise ValueError('Result contains too many entries.')
        if type(value) is list: out = [normalize(item, depth + 1, seen) for item in value]
        else:
            if any(type(key) is not str for key in value): raise ValueError('Result object keys must be strings.')
            out = {key: normalize(item, depth + 1, seen) for key, item in value.items()}
        seen.remove(id(value))
        return out
    output = json.dumps({'kind': 'value', 'value': normalize(result), 'error': None}, allow_nan=False, separators=(',', ':'))
    if len(output) > 16000: raise ValueError('Result exceeds output limits.')
    print(output)
except SystemExit:
    raise
except (MemoryError, RecursionError) as error:
    fail('invalid', 'The sandbox resource limit was reached.')
except BaseException as error:
    fail('invalid', error)
`;

export interface PythonExecution { actual: JsonValue | null; error: string | null }

export async function executePython(code: string, input: JsonValue, path: string, signal: AbortSignal | undefined, signature: FunctionSignature): Promise<PythonExecution> {
  validateSignature(signature);
  validateArguments(input, signature);
  if (signal?.aborted) throw new Error(`${path}: validation cancelled.`);
  const name = `code-swipe-python-${randomUUID()}`;
  const args = ['run', '--rm', '--pull=never', '--name', name, '--network=none', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges', '--pids-limit=32', '--memory=128m', '--memory-swap=128m', '--cpus=1',
    '--user=65534:65534', '-i', PYTHON_IMAGE, '/usr/bin/timeout', '--signal=KILL', '3s', 'python', '-I', '-S', '-c', HARNESS];
  const payload = JSON.stringify({ code, name: signature.name, parameters: signature.parameters, arguments: input });
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = ''; let stderr = ''; let interrupted = '';
    let finished = false;
    const cleanup = () => { void execFileAsync('docker', ['rm', '-f', name], { timeout: 4_000 }).catch(() => {}); };
    const stop = (reason: string) => { if (!interrupted) { interrupted = reason; child.kill('SIGKILL'); cleanup(); } };
    const abort = () => stop('validation cancelled');
    const timer = setTimeout(() => stop('sandbox timed out'), 15_000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > MAX_OUTPUT) stop('sandbox output exceeded limits'); });
    child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > MAX_OUTPUT) stop('sandbox output exceeded limits'); });
    child.stdin.on('error', () => {});
    child.once('error', () => { if (!finished) { finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error(`${path}: Docker could not start the Python sandbox.`)); } });
    child.once('close', code => {
      if (finished) return;
      finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (interrupted) { reject(new Error(`${path}: ${interrupted}; no verdict was accepted.`)); return; }
      if (code !== 0) { cleanup(); reject(new Error(`${path}: Python sandbox timed out or failed; ensure Docker and the pinned image are available. No verdict was accepted.`)); return; }
      let report: { kind: string; value: JsonValue | null; error: string | null };
      try { report = JSON.parse(stdout); } catch { reject(new Error(`${path}: Python sandbox returned an invalid report.`)); return; }
      if (report.kind === 'source' || report.kind === 'invalid') { reject(new Error(`${path}: ${report.error || 'Invalid Python source or result.'}`)); return; }
      if (report.kind !== 'value' && report.kind !== 'throw') { reject(new Error(`${path}: Python sandbox returned an invalid report.`)); return; }
      resolve({ actual: report.value, error: report.error?.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240) ?? null });
    });
    child.stdin.end(payload);
  });
}
