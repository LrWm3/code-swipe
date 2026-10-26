import type { JsonValue, ProposedLesson, ProposedQuestion, TutorContext, Verdict } from '../src/types.ts';

interface Example {
  title: string;
  specification: string;
  code: string;
  referenceCode: string;
  verdict: Verdict;
  explanation: string;
  fixtures: [JsonValue, JsonValue, string][];
}

const EXAMPLES: Example[] = [
  {
    title: 'Keep every nonnegative reading',
    specification: 'Given an array of finite numbers, return a new array containing every number greater than or equal to zero, preserving input order. Zero must be retained. Do not modify the input.',
    code: 'function solve(input) {\n  return input.filter(value => value > 0);\n}',
    referenceCode: 'function solve(input) { return input.filter(value => value >= 0); }',
    verdict: 'buggy',
    explanation: 'The strict comparison drops zero. The specification includes zero, so [-1, 0, 2] should produce [0, 2], while this implementation produces [2].',
    fixtures: [[[], [], 'Empty input'], [[-1, 0, 2], [0, 2], 'Zero boundary'], [[-5, -2], [], 'All negative'], [[3, 0, 3], [3, 0, 3], 'Duplicates and zero']],
  },
  {
    title: 'Total order quantities',
    specification: 'Given an array of records with a finite numeric quantity field, return the sum of all quantities. The empty array totals zero. Do not modify the input.',
    code: 'function solve(input) {\n  return input.reduce((total, order) => total + order.quantity, 0);\n}',
    referenceCode: 'function solve(input) { let total = 0; for (const order of input) total += order.quantity; return total; }',
    verdict: 'correct',
    explanation: 'The explicit initial value handles the empty array and each record contributes its quantity exactly once. Zero and negative quantities are preserved in the arithmetic.',
    fixtures: [[[], 0, 'Empty input'], [[{ quantity: 3 }], 3, 'Single record'], [[{ quantity: 2 }, { quantity: 4 }], 6, 'Two records'], [[{ quantity: -3 }, { quantity: 0 }, { quantity: 5 }], 2, 'Negative and zero quantities']],
  },
  {
    title: 'Find the largest signed value',
    specification: 'Given a nonempty array of finite numbers, return its largest value. Negative-only arrays are valid. Do not modify the input.',
    code: 'function solve(input) {\n  let largest = 0;\n  for (const value of input) largest = Math.max(largest, value);\n  return largest;\n}',
    referenceCode: 'function solve(input) { return input.reduce((largest, value) => Math.max(largest, value), input[0]); }',
    verdict: 'buggy',
    explanation: 'Starting at zero introduces a value that may not occur in the input. For [-8, -3, -5], this returns 0; the correct largest value is -3.',
    fixtures: [[[1, 4, 2], 4, 'Positive values'], [[-8, -3, -5], -3, 'All negative'], [[-2], -2, 'Single negative'], [[-1, 0, -4], 0, 'Zero present']],
  },
  {
    title: 'Keep first appearances',
    specification: 'Given an array of strings, return a new array with duplicate strings removed. Preserve the order of first appearance. Comparison is case sensitive. Do not modify the input.',
    code: 'function solve(input) {\n  return [...new Set(input)];\n}',
    referenceCode: 'function solve(input) { const result = []; for (const value of input) if (!result.includes(value)) result.push(value); return result; }',
    verdict: 'correct',
    explanation: 'A Set keeps insertion order and stores each distinct string once. Spreading it creates the requested new array without changing the original.',
    fixtures: [[[], [], 'Empty input'], [['cod', 'salmon', 'cod'], ['cod', 'salmon'], 'Repeated value'], [['A', 'a', 'A'], ['A', 'a'], 'Case sensitivity'], [['', '', 'x'], ['', 'x'], 'Empty strings']],
  },
  {
    title: 'Sort temperatures numerically',
    specification: 'Given an array of finite numbers, return a new array sorted from smallest to largest numerically. Preserve duplicates and do not modify the input.',
    code: 'function solve(input) {\n  return [...input].sort();\n}',
    referenceCode: 'function solve(input) { return [...input].sort((a, b) => a - b); }',
    verdict: 'buggy',
    explanation: 'Without a comparator, sort compares string representations. Thus [2, 10, 1] becomes [1, 10, 2] rather than the numeric order [1, 2, 10].',
    fixtures: [[[], [], 'Empty input'], [[2, 10, 1], [1, 2, 10], 'Different digit lengths'], [[-2, -10, 0], [-10, -2, 0], 'Negative values'], [[3, 3, 1], [1, 3, 3], 'Duplicates']],
  },
  {
    title: 'Detect an even reading',
    specification: 'Given an array of integers, return true if at least one integer is even; otherwise return false. Zero and negative even integers count as even. Do not modify the input.',
    code: 'function solve(input) {\n  return input.some(value => value % 2 === 0);\n}',
    referenceCode: 'function solve(input) { for (const value of input) if (value % 2 === 0) return true; return false; }',
    verdict: 'correct',
    explanation: 'some returns true as soon as an even value is found and false for an empty array. The remainder comparison also handles zero and negative even integers.',
    fixtures: [[[], false, 'Empty input'], [[1, 3, 5], false, 'All odd'], [[1, 0, 3], true, 'Zero is even'], [[-3, -4, 7], true, 'Negative even value']],
  },
  {
    title: 'Return the first matching position',
    specification: 'Given an object with a values array of integers and an integer target, return the zero-based index of the first target occurrence. Return -1 if absent. Do not modify the input.',
    code: 'function solve(input) {\n  return input.values.indexOf(input.target) || -1;\n}',
    referenceCode: 'function solve(input) { return input.values.indexOf(input.target); }',
    verdict: 'buggy',
    explanation: 'A match at index zero is falsy, so the fallback incorrectly replaces it with -1. For {values:[7,8], target:7}, the correct result is 0.',
    fixtures: [[{ values: [], target: 1 }, -1, 'Empty values'], [{ values: [7, 8], target: 7 }, 0, 'First position'], [{ values: [2, 7, 7], target: 7 }, 1, 'First of multiple matches'], [{ values: [2, 3], target: 7 }, -1, 'Missing target']],
  },
  {
    title: 'Clamp a reading to its range',
    specification: 'Given an object with finite numeric value, min, and max fields where min <= max, return value constrained to the inclusive interval [min, max]. Values inside the interval remain unchanged. Do not modify the input.',
    code: 'function solve(input) {\n  return Math.min(input.max, Math.max(input.min, input.value));\n}',
    referenceCode: 'function solve(input) { if (input.value < input.min) return input.min; if (input.value > input.max) return input.max; return input.value; }',
    verdict: 'correct',
    explanation: 'The inner maximum enforces the lower bound, then the outer minimum enforces the upper bound. Values already in range pass through, including both boundaries.',
    fixtures: [[{ value: 5, min: 0, max: 10 }, 5, 'Inside range'], [{ value: -3, min: 0, max: 10 }, 0, 'Below minimum'], [{ value: 12, min: 0, max: 10 }, 10, 'Above maximum'], [{ value: -2, min: -2, max: -2 }, -2, 'Equal bounds and negative value']],
  },
];

export function createDemoLesson(context: TutorContext): ProposedLesson {
  const count = [4, 6, 8].includes(context.settings.batchSize) ? context.settings.batchSize : 4;
  const questions: ProposedQuestion[] = EXAMPLES.slice(0, count).map(example => ({
    title: example.title,
    specification: example.specification,
    code: example.code,
    referenceCode: example.referenceCode,
    verdict: example.verdict,
    explanation: example.explanation,
    tests: example.fixtures.map(([input, expected, note]) => ({ input: structuredClone(input), expected: structuredClone(expected), note })),
    purpose: 'diagnostic',
    hypothesisId: context.settings.tutorMode === 'baseline' ? null : 'demo-boundaries',
    ifCorrect: 'A correct judgment provides one observation; another independently designed question would be needed to assess this skill.',
    ifIncorrect: 'An incorrect judgment could reflect a boundary misconception, a reading slip, or a guess; one response cannot distinguish these explanations.',
    prediction: { pCorrect: 0.5, rationale: 'Neutral sample prediction. This deterministic demo does not estimate your skill or adapt from your history.' },
  }));
  return {
    objective: 'Sample local practice: judge small JavaScript functions against explicit specifications.',
    rationale: 'These curated examples demonstrate the local practice and validation workflow. They are deterministic sample questions, not an LLM-generated adaptive lesson.',
    assumptions: ['You can read basic JavaScript functions and array operations.', 'Your proficiency and preferred difficulty are unknown; no skill claim is inferred from demo answers.'],
    reflection: 'Demo mode does not reflect on prior answers or adapt its question selection. Repeated demo sessions use the same curated examples.',
    hypotheses: context.settings.tutorMode === 'baseline' ? [] : [{
      id: 'demo-boundaries',
      claim: 'Boundary cases may be a useful starting point for practice; current evidence does not establish a misconception.',
      status: 'tentative',
      supportingAttemptIds: [],
      counterevidenceAttemptIds: [],
      alternatives: ['The learner may already understand these cases.', 'An incorrect answer may result from a reading slip rather than a skill gap.'],
      nextProbe: 'Use an independently generated question before drawing conclusions about boundary reasoning.',
    }],
    questions,
  };
}
