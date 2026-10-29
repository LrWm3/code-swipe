import type { JsonValue, ProposedQuestion } from './types';

function splitTypes(value: string): string[] {
  const parts: string[] = []; let depth = 0; let start = 0;
  for (let i = 0; i < value.length; i++) {
    if ('<(['.includes(value[i])) depth++;
    if ('>)]'.includes(value[i])) depth--;
    if (value[i] === ',' && depth === 0) { parts.push(value.slice(start, i).trim()); start = i + 1; }
  }
  if (value.slice(start).trim()) parts.push(value.slice(start).trim());
  return parts;
}

function quote(value: string): string {
  return '"' + Array.from(value).map(char => char === '"' ? '\\"' : char === '\\' ? '\\\\' : char === '\n' ? '\\n' : char === '\r' ? '\\r' : char === '\t' ? '\\t' : char.codePointAt(0)! < 32 ? `\\u{${char.codePointAt(0)!.toString(16)}}` : char).join('') + '"';
}

function rustValue(value: JsonValue, rawType: string): string | null {
  const type = rawType.replace(/\s+/g, '').replace(/(?:core::option::|core::result::|alloc::vec::|alloc::string::|std::collections::hash::map::|std::collections::)/g, '');
  if (type.startsWith('Option<') && type.endsWith('>')) {
    if (value === null) return 'None';
    const item = rustValue(value, type.slice(7, -1));
    return item === null ? null : `Some(${item})`;
  }
  if (type.startsWith('Result<') && type.endsWith('>') && value && typeof value === 'object' && !Array.isArray(value)) {
    const types = splitTypes(type.slice(7, -1));
    if (types.length !== 2) return null;
    const isOk = Object.hasOwn(value, 'Ok'); const isErr = Object.hasOwn(value, 'Err');
    if (isOk === isErr || Object.keys(value).length !== 1) return null;
    const item = rustValue(isOk ? value.Ok : value.Err, types[isOk ? 0 : 1]);
    return item === null ? null : `${isOk ? 'Ok' : 'Err'}(${item})`;
  }
  if (type.startsWith('HashMap<') && type.endsWith('>') && value && typeof value === 'object' && !Array.isArray(value)) {
    const types = splitTypes(type.slice(8, -1));
    if (types.length !== 2 || types[0] !== 'String') return null;
    const entries = Object.entries(value).map(([key, item]) => {
      const rendered = rustValue(item, types[1]);
      return rendered === null ? null : `(${quote(key)}.to_string(), ${rendered})`;
    });
    return entries.some(entry => entry === null) ? null : `HashMap::from([${entries.join(', ')}])`;
  }
  const vector = type.startsWith('Vec<') && type.endsWith('>') ? type.slice(4, -1) : null;
  const slice = type.startsWith('&[') && type.endsWith(']') ? type.slice(2, -1) : null;
  const element = vector ?? slice;
  if (element !== null && Array.isArray(value)) {
    const items = value.map(item => rustValue(item, element));
    return items.some(item => item === null) ? null : `${slice !== null ? '&[' : 'vec!['}${items.join(', ')}]`;
  }
  if (type.startsWith('&') && type !== '&str') {
    const item = rustValue(value, type.slice(1)); return item === null ? null : `&${item}`;
  }
  if ((type === '&str' || type === 'String') && typeof value === 'string') return quote(value) + (type === 'String' ? '.to_string()' : '');
  if (type === 'char' && typeof value === 'string' && Array.from(value).length === 1) {
    const escaped = value === "'" ? "\\'" : value === '\\' ? '\\\\' : value === '\n' ? '\\n' : value === '\r' ? '\\r' : value === '\t' ? '\\t' : value.codePointAt(0)! < 32 ? `\\u{${value.codePointAt(0)!.toString(16)}}` : value;
    return `'${escaped}'`;
  }
  if (type === 'bool' && typeof value === 'boolean') return String(value);
  if (/^(?:i8|i16|i32|i64|isize|u8|u16|u32|u64|usize|f32|f64)$/.test(type) && typeof value === 'number') return (type === 'f32' || type === 'f64') && Number.isInteger(value) ? `${value}.0` : String(value);
  return null;
}

export function rustSignature(question: Pick<ProposedQuestion, 'code' | 'signature'>): { types: string[]; returns: string } | null {
  if (!question.signature) return null;
  const pattern = new RegExp(`\\bfn\\s+${question.signature.name}\\s*\\(([^)]*)\\)\\s*->\\s*([^\\n{]+)\\s*\\{`);
  const match = pattern.exec(question.code);
  if (!match) return null;
  const types = splitTypes(match[1]).map(parameter => parameter.slice(parameter.indexOf(':') + 1).trim());
  return types.length === question.signature.parameters.length ? { types, returns: match[2].trim() } : null;
}

export function rustCall(question: Pick<ProposedQuestion, 'code' | 'signature'>, input: JsonValue): string | null {
  const signature = rustSignature(question);
  if (!signature || !question.signature || !Array.isArray(input) || input.length !== signature.types.length) return null;
  const args = input.map((value, index) => rustValue(value, signature.types[index]));
  return args.some(value => value === null) ? null : `${question.signature.name}(${args.join(', ')})`;
}

export function rustResult(question: Pick<ProposedQuestion, 'code' | 'signature'>, value: JsonValue): string {
  const type = rustSignature(question)?.returns;
  return rustDisplay(value, type);
}

export function rustDisplay(value: JsonValue, type?: string): string {
  return (type ? rustValue(value, type) : null) ?? JSON.stringify(value, null, 2);
}
