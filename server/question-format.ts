import type { FunctionSignature, JsonValue } from '../src/types.ts';

const identifier = /^[A-Za-z][A-Za-z0-9_]*$/;
const genericFunctions = new Set(['solve', 'solution', 'main', 'fn', 'func', 'handler']);
const genericParameters = new Set(['input', 'data', 'arg', 'args']);

export function validateSignature(value: unknown): asserts value is FunctionSignature {
  const signature = value as FunctionSignature;
  if (!signature || typeof signature !== 'object' || Array.isArray(signature)
    || Object.keys(signature).sort().join(',') !== 'name,parameters'
    || typeof signature.name !== 'string' || !identifier.test(signature.name)
    || signature.name.length < 3 || signature.name.length > 80 || genericFunctions.has(signature.name.toLowerCase())
    || !Array.isArray(signature.parameters) || signature.parameters.length < 1 || signature.parameters.length > 6
    || new Set(signature.parameters).size !== signature.parameters.length
    || signature.parameters.some(name => typeof name !== 'string' || !identifier.test(name) || name.length > 80 || genericParameters.has(name.toLowerCase()))) {
    throw new Error('signature must name a descriptive function and 1–6 distinct meaningful parameters; avoid solve/input/data/args.');
  }
}

export function validateQuestionFormat(question: { signature: FunctionSignature; code: string; referenceCode: string }): void {
  validateSignature(question.signature);
  let candidateDoc = '';
  for (const field of ['code', 'referenceCode'] as const) {
    const source = question[field];
    const match = /^\s*(\/\*\*\r?\n[\s\S]*?\r?\n\s*\*\/)\s*function\s+([A-Za-z][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*\{/.exec(source);
    if (!match || match[2] !== question.signature.name
      || JSON.stringify(match[3].split(',').map(name => name.trim())) !== JSON.stringify(question.signature.parameters)) {
      throw new Error(`${field} must begin with multiline JSDoc followed by function ${question.signature.name}(${question.signature.parameters.join(', ')}).`);
    }
    const lines = match[1].split(/\r?\n/).slice(1, -1);
    if (lines.some(line => !/^\s*\*(?:\s|$)/.test(line) || (line.match(/@(param|returns?)\b/g)?.length ?? 0) > 1)) {
      throw new Error(`${field}: put each JSDoc tag on its own " * " line.`);
    }
    const parameters = lines.filter(line => /@param\b/.test(line));
    const names = parameters.map(line => /^\s*\*\s+@param\s+\{.+\}\s+([A-Za-z][A-Za-z0-9_]*)\s+-\s+\S.*$/.exec(line)?.[1]);
    if (JSON.stringify(names) !== JSON.stringify(question.signature.parameters)) {
      throw new Error(`${field}: document each parameter in order as @param {type} name - Description and constraints.`);
    }
    const returns = lines.filter(line => /@returns?\b/.test(line));
    if (returns.length !== 1 || !/^\s*\*\s+@returns\s+\{.+\}\s+(?:-\s+)?\S.*$/.test(returns[0])) {
      throw new Error(`${field}: include one @returns {type} Description line.`);
    }
    if (field === 'code') candidateDoc = match[1];
    else if (match[1] !== candidateDoc) throw new Error('Candidate and reference must have identical JSDoc contracts.');
  }
}

export function validateArguments(input: JsonValue, signature: FunctionSignature): void {
  if (!Array.isArray(input) || input.length !== signature.parameters.length) {
    throw new Error(`inputJson must encode an array of ${signature.parameters.length} positional arguments, matching signature.parameters.`);
  }
}
