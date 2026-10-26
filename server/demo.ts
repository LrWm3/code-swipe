import type { JsonValue, ProposedLesson, ProposedQuestion, TutorContext, Verdict } from '../src/types.ts';
import { DEFAULT_LESSON_SIZE, LESSON_SIZES } from '../src/lesson-sizes.ts';

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
  {
    title: 'Count every odd integer',
    specification: 'Given an array of integers, return how many are odd. Negative odd integers count too. The empty array has zero odd integers. Do not modify the input.',
    code: '/** @param {number[]} input @returns {number} */\nfunction solve(input) {\n  return input.filter(value => value % 2 === 1).length;\n}',
    referenceCode: '/** @param {number[]} input @returns {number} */\nfunction solve(input) { return input.filter(value => value % 2 !== 0).length; }',
    verdict: 'buggy',
    explanation: 'JavaScript remainders keep the sign of the dividend. A negative odd integer has remainder -1, so comparing only with 1 misses it. For [-3, -2, -1], the answer should be 2, but this returns 0.',
    fixtures: [[[], 0, 'Empty input'], [[1, 2, 3], 2, 'Positive odd integers'], [[-3, -2, -1], 2, 'Negative odd integers'], [[-5, 0, 4, 7], 2, 'Mixed signs and zero']],
  },
  {
    title: 'Measure successive changes',
    specification: 'Given an array of integers between -1000 and 1000 inclusive, return a new array of differences between successive readings: each reading minus the one immediately before it. Empty and single-reading arrays return an empty array. Do not modify the input.',
    code: '/** @param {number[]} input @returns {number[]} */\nfunction solve(input) {\n  return input.slice(1).map((value, index) => value - input[index]);\n}',
    referenceCode: '/** @param {number[]} input @returns {number[]} */\nfunction solve(input) { const changes = []; for (let i = 1; i < input.length; i++) changes.push(input[i] - input[i - 1]); return changes; }',
    verdict: 'correct',
    explanation: 'Slicing starts at the second reading. Its mapped index still points to the preceding reading in the original array, so every subtraction uses the intended pair. Inputs with fewer than two readings produce no differences.',
    fixtures: [[[], [], 'Empty input'], [[4], [], 'Single reading'], [[2, 5, 1], [3, -4], 'Increase then decrease'], [[-2, -2, 0, -3], [0, 2, -3], 'Repeated readings and mixed signs']],
  },
  {
    title: 'Allocate groups of three',
    specification: 'Given a nonnegative integer item count, return the minimum number of groups needed when each group holds at most three items. Any remaining items require another group. Zero items need zero groups.',
    code: '/** @param {number} input @returns {number} */\nfunction solve(input) {\n  return Math.round(input / 3);\n}',
    referenceCode: '/** @param {number} input @returns {number} */\nfunction solve(input) { return Math.ceil(input / 3); }',
    verdict: 'buggy',
    explanation: 'Rounding to the nearest integer can discard a partially filled group. Four items need two groups, but Math.round(4 / 3) returns 1. The quotient must always round upward.',
    fixtures: [[0, 0, 'No items'], [1, 1, 'One item still needs a group'], [3, 1, 'Exactly one full group'], [4, 2, 'One remaining item'], [8, 3, 'Two remaining items']],
  },
  {
    title: 'Normalize label spacing',
    specification: 'Given a string, remove leading and trailing whitespace, then replace every remaining run of whitespace with one ordinary space. Whitespace includes spaces, tabs, and line breaks. Preserve all non-whitespace characters and their case. An empty or whitespace-only string returns an empty string.',
    code: '/** @param {string} input @returns {string} */\nfunction solve(input) {\n  return input.trim().replace(/\\s+/g, " ");\n}',
    referenceCode: '/** @param {string} input @returns {string} */\nfunction solve(input) { return input.trim().split(/\\s+/).join(" "); }',
    verdict: 'correct',
    explanation: 'trim removes whitespace at both ends, and the global replacement collapses every internal whitespace run to one space. Non-whitespace characters stay unchanged, while empty and whitespace-only inputs produce an empty string.',
    fixtures: [['', '', 'Empty input'], ['  Reel  Data  ', 'Reel Data', 'Outer and repeated inner spaces'], ['\tCod\nsalmon\r\n', 'Cod salmon', 'Tabs and line breaks'], ['A-B', 'A-B', 'Already normalized'], [' \t\n ', '', 'Whitespace only']],
  },
];

export function createDemoLesson(context: TutorContext): ProposedLesson {
  const count = LESSON_SIZES.some(size => size === context.settings.batchSize) ? context.settings.batchSize : DEFAULT_LESSON_SIZE;
  const questions: ProposedQuestion[] = EXAMPLES.slice(0, count).map((example, index) => ({
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
    plan: {
      purposes: [count - 1 === index ? 'transfer' : index === 1 ? 'practice' : 'diagnostic'],
      educationalObjective: 'Practice checking a small function against its contract and boundary cases.',
      investigativeObjective: 'Observe this judgment without claiming a particular reasoning strategy or capability.',
      conceptIds: ['demo-code-review'], prerequisiteIds: [],
      stage: index === 0 ? 'warmup' : index === count - 1 ? 'consolidate' : index >= Math.ceil(count / 2) ? 'stretch' : 'build',
      cognitiveDemand: index === 0 ? 1 : index === count - 1 ? 2 : index >= Math.ceil(count / 2) ? 3 : 2,
      difficultyRationale: 'A sample sequence moves from one comparison to combining operations, then finishes with a compact independent task. These are illustrative demands, not personalized estimates.',
      scaffolding: 'The specification supplies the required behavior and boundary rules; no earlier explanation is required.',
      ifIdk: 'Record uncertainty without inferring an incorrect rule or lack of ability.',
      familyId: `demo-task-${index + 1}`, counterpart: 'unasked',
      variantReason: 'Leave the opposite implementation unasked; use the reference for optional review rather than another copy of this task.',
    },
  }));
  for (const question of questions) question.purpose = question.plan!.purposes[0];
  const prior = context.history.flatMap(entry => entry.attempts.filter(attempt => !attempt.flagged).map(attempt => ({
    attempt, question: entry.lesson.questions.find(question => question.id === attempt.exerciseId),
  }))).filter(item => item.question).at(-1);
  const priorMemory = context.curriculum?.concepts.flatMap(concept => concept.evidence.map(evidence => ({ concept, evidence }))).at(-1);
  return {
    objective: 'Sample local practice: judge small JavaScript functions against explicit specifications.',
    rationale: 'These curated examples demonstrate the local practice and validation workflow. They are deterministic sample questions, not an LLM-generated adaptive lesson.',
    assumptions: ['You can read basic JavaScript functions and array operations.', 'Your proficiency and preferred difficulty are unknown; no skill claim is inferred from demo answers.'],
    reflection: 'Demo mode does not reflect on prior answers or adapt its question selection. Repeated demo sessions use the same curated examples.',
    curriculum: {
      conceptUpdates: [{
        id: 'demo-code-review', name: 'JavaScript function review', description: 'Compare small pure functions with their stated contracts.',
        representations: ['JavaScript functions'], prerequisiteIds: [], familiarity: 'unknown', evidenceAttemptIds: [],
        uncertainty: 'The fixed demo does not infer familiarity from answers.', nextProbe: 'Use a connected tutor for an independently chosen next exercise.',
      }],
      observations: context.settings.tutorMode === 'baseline' ? [] : prior ? [{
        attemptIds: [prior.attempt.id], conceptIds: prior.question?.plan?.conceptIds ?? ['demo-code-review'],
        observation: `A previous response was recorded as ${prior.attempt.answer}.`,
        interpretation: 'The scripted demo does not infer understanding or teaching effectiveness from this response.',
        nextAction: 'Continue the fixed demo; use a connected tutor to adapt from evidence.',
      }] : priorMemory ? [{
        attemptIds: [priorMemory.evidence.attemptId], conceptIds: [priorMemory.concept.id],
        observation: `An archived response was recorded as ${priorMemory.evidence.answer}.`,
        interpretation: 'The scripted demo does not assess competence.', nextAction: 'Use a connected tutor for personalized planning.',
      }] : [],
      frontier: [{ conceptId: 'demo-code-review', decision: 'explore', reason: 'A fixed sample of small functions introduces the workflow without claiming a personalized frontier.' }],
      mixRationale: 'Independent sample tasks combine diagnostic judgments, practice, and a final different-context transfer opportunity; no mirror pairs.',
      sequenceRationale: 'Start with a single comparison, build toward multi-operation judgments, then consolidate with an independent task. This curated demo is not an adaptive curriculum.',
    },
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
