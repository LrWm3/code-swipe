import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { FunctionSignature, JsonValue } from '../src/types.ts';
import { validateArguments, validateSignature } from './question-format.ts';

export const RUST_IMAGE = 'rust:1.89-slim-bookworm@sha256:d7fc7de78bb8c1469933aeecbf801314d30d7d6e9f0578bba4cfa285bfa37fe6';
const execFileAsync = promisify(execFile);

export async function rustAvailability(): Promise<{ available: boolean; detail: string }> {
  try {
    await execFileAsync('docker', ['image', 'inspect', RUST_IMAGE, '--format', '{{.Id}}'], { timeout: 5_000, maxBuffer: 4_096 });
    return { available: true, detail: 'Rust sandbox image is ready.' };
  } catch {
    return { available: false, detail: `Start Docker and run: docker pull ${RUST_IMAGE}` };
  }
}

interface RustDeclaration { doc: string; parameters: { name: string; type: string }[]; returnType: string }

function splitTypes(value: string): string[] {
  const parts: string[] = []; let depth = 0; let start = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if ('<(['.includes(char)) depth++;
    if ('>)]'.includes(char)) depth--;
    if (depth < 0) throw new Error('Unbalanced Rust type.');
    if (char === ',' && depth === 0) { parts.push(value.slice(start, i).trim()); start = i + 1; }
  }
  if (depth !== 0) throw new Error('Unbalanced Rust type.');
  if (value.slice(start).trim()) parts.push(value.slice(start).trim());
  return parts;
}

export function rustDeclaration(code: string, signature: FunctionSignature): RustDeclaration {
  validateSignature(signature);
  const pattern = new RegExp(`((?:^[ \\t]*///[^\\n]*\\n)+)[ \\t]*(?:pub\\s+)?fn\\s+${signature.name}\\s*\\(([^)]*)\\)\\s*->\\s*([^\\n{]+)\\s*\\{`, 'm');
  const match = pattern.exec(code);
  if (!match) throw new Error(`Define ${signature.name} with Rust /// documentation, typed parameters, and an explicit return type.`);
  const parameters = splitTypes(match[2]).map(item => {
    const parameter = /^(?:mut\s+)?([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.+)$/.exec(item);
    if (!parameter) throw new Error('Use simple named, typed Rust parameters.');
    return { name: parameter[1], type: parameter[2].replace(/\s+/g, '') };
  });
  if ([...parameters.map(parameter => parameter.type), match[3].replace(/\s+/g, '')].some(type => /Option<Option</.test(type.replace(/core::option::/g, '')))) throw new Error('Nested Option values cannot be represented unambiguously by the fixture format.');
  if (JSON.stringify(parameters.map(item => item.name)) !== JSON.stringify(signature.parameters)) throw new Error('Rust parameter names must match the declared signature.');
  const source = code.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"/g, '');
  if (/\b(?:unsafe|extern|mod|macro_rules)\b|#\s*\[|\b(?:include|include_str|include_bytes|env|option_env|print|println|eprint|eprintln)!\s*\(|\b(?:std|core|alloc)\s*::\s*(?:fs|io|env|process|thread|net|os|time|ffi|sync|alloc|arch)\b|\buse\s+(?:std|core|alloc)\s*::\s*\{/.test(source)) {
    throw new Error('Use pure Rust functions without unsafe code, I/O, environment access, processes, threads, or attributes.');
  }
  return { doc: match[1].trim(), parameters, returnType: match[3].replace(/\s+/g, '') };
}

export function validateRustQuestionFormat(question: { signature: FunctionSignature; code: string; referenceCode: string }): void {
  const candidate = rustDeclaration(question.code, question.signature);
  const reference = rustDeclaration(question.referenceCode, question.signature);
  if (candidate.doc !== reference.doc) throw new Error('Candidate and reference must have identical Rust /// documentation.');
  if (JSON.stringify(candidate.parameters) !== JSON.stringify(reference.parameters) || candidate.returnType !== reference.returnType) throw new Error('Candidate and reference must have identical Rust parameter and return types.');
}

function rustString(value: string): string {
  if (Array.from(value).some(char => char.length === 1 && char.charCodeAt(0) >= 0xd800 && char.charCodeAt(0) <= 0xdfff)) throw new Error('Rust string fixtures must contain valid Unicode.');
  return `String::from_utf8(vec![${Array.from(Buffer.from(value, 'utf8')).map(byte => `${byte}u8`).join(',')}]).unwrap()`;
}

function inner(type: string, name: string): string | null {
  return type.startsWith(`${name}<`) && type.endsWith('>') ? type.slice(name.length + 1, -1) : null;
}

function literal(value: JsonValue, type: string): string {
  const vector = inner(type, 'Vec');
  const optional = inner(type, 'Option');
  const result = inner(type, 'Result');
  if (vector !== null) {
    if (!Array.isArray(value)) throw new Error(`Expected a JSON array for ${type}.`);
    return `vec![${value.map(item => literal(item, vector)).join(',')}]`;
  }
  if (optional !== null) return value === null ? `None::<${optional}>` : `Some(${literal(value, optional)})`;
  if (result !== null) {
    const types = splitTypes(result);
    if (types.length !== 2 || !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1) throw new Error(`Expected an object with one Ok or Err value for ${type}.`);
    if ('Ok' in value) return `Ok::<${types[0]},${types[1]}>(${literal(value.Ok, types[0])})`;
    if ('Err' in value) return `Err::<${types[0]},${types[1]}>(${literal(value.Err, types[1])})`;
    throw new Error(`Expected an object with one Ok or Err value for ${type}.`);
  }
  if (type === 'String' && typeof value === 'string') return rustString(value);
  if (type === 'char' && typeof value === 'string' && Array.from(value).length === 1) return `${rustString(value)}.chars().next().unwrap()`;
  if (type === 'bool' && typeof value === 'boolean') return String(value);
  if (/^(?:i8|i16|i32|i64|isize|u8|u16|u32|u64|usize)$/.test(type) && typeof value === 'number' && Number.isSafeInteger(value)) {
    const bounds: Record<string, [number, number]> = { i8: [-128, 127], i16: [-32768, 32767], i32: [-2147483648, 2147483647], u8: [0, 255], u16: [0, 65535], u32: [0, 4294967295], u64: [0, Number.MAX_SAFE_INTEGER], usize: [0, Number.MAX_SAFE_INTEGER] };
    const [min, max] = bounds[type] ?? [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
    if (value < min || value > max) throw new Error(`Fixture value is outside ${type} range.`);
    return `(${value}${type})`;
  }
  if ((type === 'f32' || type === 'f64') && typeof value === 'number' && Number.isFinite(value)) return `(${String(value)}${type})`;
  const map = inner(type, 'HashMap') ?? inner(type, 'std::collections::HashMap');
  if (map !== null) {
    const types = splitTypes(map);
    if (types.length !== 2 || types[0] !== 'String' || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected an object with String keys for ${type}.`);
    return `vec![${Object.entries(value).map(([key, item]) => `(${rustString(key)},${literal(item, types[1])})`).join(',')}].into_iter().collect::<std::collections::HashMap<String,${types[1]}>>()`;
  }
  throw new Error(`Unsupported Rust fixture type ${type}; use supported primitives, String, Vec, Option, slices, or HashMap<String, T>.`);
}

function argumentsFor(input: JsonValue, declaration: RustDeclaration, signature: FunctionSignature): { definitions: string; call: string } {
  validateArguments(input, signature);
  const definitions: string[] = []; const call: string[] = [];
  for (let i = 0; i < declaration.parameters.length; i++) {
    let type = declaration.parameters[i].type; const arg = (input as JsonValue[])[i];
    let reference = '';
    if (type === '&str') { type = 'String'; reference = '.as_str()'; }
    else if (type.startsWith('&[') && type.endsWith(']')) { type = `Vec<${type.slice(2, -1)}>`; reference = '.as_slice()'; }
    else if (type.startsWith('&') && !type.startsWith('&mut')) { type = type.slice(1); reference = '&'; }
    const value = literal(arg, type);
    definitions.push(`let arg${i}: ${type} = ${value};`);
    call.push(reference === '&' ? `&arg${i}` : `arg${i}${reference}`);
  }
  return { definitions: definitions.join('\n'), call: call.join(', ') };
}

// The generated function is compiled and executed only inside the container.
// Each fixture runs in a fresh process; expected answers never enter it.
const SUPPORT = String.raw`
trait JsonOutput { fn json(&self) -> Option<String>; }
fn quoted(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() { match c {
        '"' => out.push_str("\\\""), '\\' => out.push_str("\\\\"),
        '\n' => out.push_str("\\n"), '\r' => out.push_str("\\r"), '\t' => out.push_str("\\t"),
        c if c < ' ' => out.push_str(&format!("\\u{:04x}", c as u32)),
        c => out.push(c),
    }}
    out.push('"'); out
}
impl JsonOutput for str { fn json(&self) -> Option<String> { Some(quoted(self)) } }
impl JsonOutput for String { fn json(&self) -> Option<String> { Some(quoted(self)) } }
impl JsonOutput for char { fn json(&self) -> Option<String> { Some(quoted(&self.to_string())) } }
impl JsonOutput for bool { fn json(&self) -> Option<String> { Some(self.to_string()) } }
macro_rules! ints { ($($t:ty),*) => { $(impl JsonOutput for $t { fn json(&self) -> Option<String> { if (*self as i128).abs() > 9007199254740991 { None } else { Some(self.to_string()) } } })* }; }
ints!(i8,i16,i32,i64,isize,u8,u16,u32,u64,usize);
impl JsonOutput for f32 { fn json(&self) -> Option<String> { if self.is_finite() { Some(self.to_string()) } else { None } } }
impl JsonOutput for f64 { fn json(&self) -> Option<String> { if self.is_finite() { Some(self.to_string()) } else { None } } }
impl<T: JsonOutput + ?Sized> JsonOutput for &T { fn json(&self) -> Option<String> { (*self).json() } }
impl<T: JsonOutput> JsonOutput for Vec<T> { fn json(&self) -> Option<String> { let mut out=Vec::new(); for x in self { out.push(x.json()?); } Some(format!("[{}]",out.join(","))) } }
impl<T: JsonOutput> JsonOutput for [T] { fn json(&self) -> Option<String> { let mut out=Vec::new(); for x in self { out.push(x.json()?); } Some(format!("[{}]",out.join(","))) } }
impl<T: JsonOutput> JsonOutput for Option<T> { fn json(&self) -> Option<String> { match self { Some(x) => x.json(), None => Some(String::from("null")) } } }
impl<T: JsonOutput, E: JsonOutput> JsonOutput for Result<T,E> { fn json(&self) -> Option<String> { match self { Ok(x) => Some(format!("{{\"Ok\":{}}}",x.json()?)), Err(e) => Some(format!("{{\"Err\":{}}}",e.json()?)) } } }
impl<T: JsonOutput> JsonOutput for std::collections::HashMap<String,T> { fn json(&self) -> Option<String> { let mut out=Vec::new(); for (k,v) in self { out.push(format!("{}:{}",quoted(k),v.json()?)); } Some(format!("{{{}}}",out.join(","))) } }
fn encode<T: JsonOutput + ?Sized>(v: &T) -> Option<String> { v.json() }
`;

const SCRIPT = String.raw`set -u
IFS= read -r combined
printf '%s' "$combined" | base64 -d > /tmp/exercise.rs
/usr/bin/timeout 30s rustc --edition=2021 -Awarnings /tmp/exercise.rs -o /tmp/exercise 2>/tmp/compile.err
status=$?
if [ "$status" -ne 0 ]; then
  if [ "$status" -eq 124 ] || [ "$status" -eq 137 ]; then exit 12; fi
  printf 'COMPILE_ERROR:'; head -c 1500 /tmp/compile.err; exit 10
fi
i=0
while [ "$i" -lt "$1" ]; do
  /usr/bin/timeout --signal=KILL 3s /tmp/exercise "$i" || exit 11
  i=$((i+1))
done`;

export interface RustExecution { actual: JsonValue | null; error: string | null; rustType?: string; compilationError?: string }
export async function executeRustBatch(code: string, inputs: JsonValue[], path: string, signal: AbortSignal | undefined, signature: FunctionSignature): Promise<RustExecution[]> {
  const declaration = rustDeclaration(code, signature);
  const cases = inputs.map((input, index) => {
    const args = argumentsFor(input, declaration, signature);
    return `${index} => { ${args.definitions}\n let result = ${signature.name}(${args.call}); super::encode(&result).map(|json| (json, std::any::type_name_of_val(&result))) },`;
  }).join('\n');
  const source = `${SUPPORT}\n#[allow(dead_code,unused_imports,unused_variables)] mod exercise {\n${code}\npub fn case(index: usize) -> Option<(String, &'static str)> { match index {\n${cases}\n_ => None } }\n}\nfn main() { let index: usize = std::env::args().nth(1).unwrap().parse().unwrap(); match std::panic::catch_unwind(|| exercise::case(index)) { Ok(Some((json, type_name))) => println!("{{\\\"kind\\\":\\\"value\\\",\\\"value\\\":{},\\\"error\\\":null,\\\"rustType\\\":{}}}", json, quoted(type_name)), Ok(None) => println!("{{\\\"kind\\\":\\\"invalid\\\",\\\"value\\\":null,\\\"error\\\":\\\"Output is not supported JSON\\\"}}"), Err(_) => println!("{{\\\"kind\\\":\\\"throw\\\",\\\"value\\\":null,\\\"error\\\":\\\"Rust function panicked\\\"}}") } }`;
  if (signal?.aborted) throw new Error(`${path}: validation cancelled.`);
  const name = `code-swipe-rust-${randomUUID()}`;
  const args = ['run', '--rm', '--pull=never', '--name', name, '--network=none', '--read-only', '--tmpfs', '/tmp:rw,exec,nosuid,nodev,size=96m', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=64', '--memory=768m', '--memory-swap=768m', '--cpus=1', '--user=65534:65534', '-i', '--entrypoint=/bin/sh', RUST_IMAGE, '-c', SCRIPT, 'rust-validation', String(inputs.length)];
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = ''; let stderr = ''; let interrupted = ''; let finished = false;
    const cleanup = () => { void execFileAsync('docker', ['rm', '-f', name], { timeout: 4_000 }).catch(() => {}); };
    const stop = (reason: string) => { if (!interrupted) { interrupted = reason; child.kill('SIGKILL'); cleanup(); } };
    const abort = () => stop('validation cancelled');
    const timer = setTimeout(() => stop('sandbox timed out'), 60_000);
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 200_000) stop('sandbox output exceeded limits'); });
    child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 20_000) stop('sandbox output exceeded limits'); });
    child.stdin.on('error', () => {});
    child.once('error', () => { if (!finished) { finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error(`${path}: Docker could not start the Rust sandbox.`)); } });
    child.once('close', code => {
      if (finished) return; finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (interrupted) { reject(new Error(`${path}: ${interrupted}; no verdict was accepted.`)); return; }
      if (code !== 0) {
        cleanup();
        const compiler = stdout.startsWith('COMPILE_ERROR:') ? stdout.slice('COMPILE_ERROR:'.length).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 600) : '';
        reject(new Error(`${path}: ${compiler ? `Rust compilation failed: ${compiler}` : 'Rust sandbox timed out or failed'}; no verdict was accepted.`)); return;
      }
      try {
        const lines = stdout.trim().split('\n');
        if (lines.length !== inputs.length) throw new Error('Unexpected output.');
        const reports = lines.map(line => JSON.parse(line) as { kind: string; value: JsonValue | null; error: string | null; rustType?: string });
        if (reports.some(report => report.kind !== 'value' && report.kind !== 'throw')) throw new Error('Invalid result.');
        for (const report of reports) {
          if (report.rustType && /Option<Option</.test(report.rustType.replace(/core::option::/g, '').replace(/\s+/g, ''))) throw new Error('Ambiguous nested Option.');
          if (JSON.stringify(report.value).length > 16_000) throw new Error('Result too large.');
          const pending: { value: JsonValue; depth: number }[] = [{ value: report.value, depth: 0 }]; let count = 0;
          while (pending.length) {
            const { value, depth } = pending.pop()!;
            if (++count > 2000 || depth > 12 || (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error('Result outside fixture limits.');
            if (value && typeof value === 'object') for (const item of Object.values(value)) pending.push({ value: item, depth: depth + 1 });
          }
        }
        resolve(reports.map(report => ({ actual: report.value, error: report.error?.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240) ?? null, ...(typeof report.rustType === 'string' ? { rustType: report.rustType.slice(0, 400) } : {}) })));
      } catch { reject(new Error(`${path}: Rust sandbox returned invalid or unsupported output; no verdict was accepted.`)); }
    });
    child.stdin.end(`${Buffer.from(source).toString('base64')}\n`);
  });
}
