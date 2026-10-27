import type { JsonValue, ProposedLesson, ProposedQuestion, TutorContext, Verdict } from '../src/types.ts';
import { DEFAULT_LESSON_SIZE, LESSON_SIZES } from '../src/lesson-sizes.ts';

interface Example {
  signature: NonNullable<ProposedQuestion['signature']>;
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
    signature: { name: 'keepNonnegativeReadings', parameters: ['readings'] },
    title: 'Keep every nonnegative reading',
    specification: 'Return a new array containing every nonnegative reading, preserving order and duplicates.',
    code: '/**\n * @param {number[]} readings - Finite readings. Do not modify this array.\n * @returns {number[]} Nonnegative readings in their original order.\n */\nfunction keepNonnegativeReadings(readings) {\n  return readings.filter(value => value > 0);\n}',
    referenceCode: '/**\n * @param {number[]} readings - Finite readings. Do not modify this array.\n * @returns {number[]} Nonnegative readings in their original order.\n */\nfunction keepNonnegativeReadings(readings) { return readings.filter(value => value >= 0); }',
    verdict: 'buggy',
    explanation: 'The strict comparison drops zero. The specification includes zero, so [-1, 0, 2] should produce [0, 2], while this implementation produces [2].',
    fixtures: [[[], [], 'Empty input'], [[-1, 0, 2], [0, 2], 'Zero boundary'], [[-5, -2], [], 'All negative'], [[3, 0, 3], [3, 0, 3], 'Duplicates and zero']],
  },
  {
    signature: { name: 'sumOrderQuantities', parameters: ['orders'] },
    title: 'Total order quantities',
    specification: 'Return the total quantity across all orders, or 0 for an empty list.',
    code: '/**\n * @param {{quantity: number}[]} orders - Orders with finite quantities. Do not modify the array or its records.\n * @returns {number} Total quantity, or 0 for no orders.\n */\nfunction sumOrderQuantities(orders) {\n  return orders.reduce((total, order) => total + order.quantity, 0);\n}',
    referenceCode: '/**\n * @param {{quantity: number}[]} orders - Orders with finite quantities. Do not modify the array or its records.\n * @returns {number} Total quantity, or 0 for no orders.\n */\nfunction sumOrderQuantities(orders) { let total = 0; for (const order of orders) total += order.quantity; return total; }',
    verdict: 'correct',
    explanation: 'The explicit initial value handles the empty array and each record contributes its quantity exactly once. Zero and negative quantities are preserved in the arithmetic.',
    fixtures: [[[], 0, 'Empty input'], [[{ quantity: 3 }], 3, 'Single record'], [[{ quantity: 2 }, { quantity: 4 }], 6, 'Two records'], [[{ quantity: -3 }, { quantity: 0 }, { quantity: 5 }], 2, 'Negative and zero quantities']],
  },
  {
    signature: { name: 'largestReading', parameters: ['readings'] },
    title: 'Find the largest signed value',
    specification: 'Return the largest reading.',
    code: '/**\n * @param {number[]} readings - Nonempty array of finite readings. Do not modify this array.\n * @returns {number} Largest reading.\n */\nfunction largestReading(readings) {\n  let largest = 0;\n  for (const value of readings) largest = Math.max(largest, value);\n  return largest;\n}',
    referenceCode: '/**\n * @param {number[]} readings - Nonempty array of finite readings. Do not modify this array.\n * @returns {number} Largest reading.\n */\nfunction largestReading(readings) { return readings.reduce((largest, value) => Math.max(largest, value), readings[0]); }',
    verdict: 'buggy',
    explanation: 'Starting at zero introduces a value that may not occur in the input. For [-8, -3, -5], this returns 0; the correct largest value is -3.',
    fixtures: [[[1, 4, 2], 4, 'Positive values'], [[-8, -3, -5], -3, 'All negative'], [[-2], -2, 'Single negative'], [[-1, 0, -4], 0, 'Zero present']],
  },
  {
    signature: { name: 'uniqueLabels', parameters: ['labels'] },
    title: 'Keep first appearances',
    specification: 'Remove duplicate labels, preserving the order of their first appearance. Comparisons are case-sensitive.',
    code: '/**\n * @param {string[]} labels - Labels to deduplicate. Do not modify this array.\n * @returns {string[]} Distinct labels in order of first appearance.\n */\nfunction uniqueLabels(labels) {\n  return [...new Set(labels)];\n}',
    referenceCode: '/**\n * @param {string[]} labels - Labels to deduplicate. Do not modify this array.\n * @returns {string[]} Distinct labels in order of first appearance.\n */\nfunction uniqueLabels(labels) { const result = []; for (const value of labels) if (!result.includes(value)) result.push(value); return result; }',
    verdict: 'correct',
    explanation: 'A Set keeps insertion order and stores each distinct string once. Spreading it creates the requested new array without changing the original.',
    fixtures: [[[], [], 'Empty input'], [['cod', 'salmon', 'cod'], ['cod', 'salmon'], 'Repeated value'], [['A', 'a', 'A'], ['A', 'a'], 'Case sensitivity'], [['', '', 'x'], ['', 'x'], 'Empty strings']],
  },
  {
    signature: { name: 'sortTemperatures', parameters: ['temperatures'] },
    title: 'Sort temperatures numerically',
    specification: 'Return a new array of temperatures sorted from smallest to largest, keeping duplicates.',
    code: '/**\n * @param {number[]} temperatures - Finite temperatures. Do not modify this array.\n * @returns {number[]} Temperatures in ascending numeric order.\n */\nfunction sortTemperatures(temperatures) {\n  return [...temperatures].sort();\n}',
    referenceCode: '/**\n * @param {number[]} temperatures - Finite temperatures. Do not modify this array.\n * @returns {number[]} Temperatures in ascending numeric order.\n */\nfunction sortTemperatures(temperatures) { return [...temperatures].sort((a, b) => a - b); }',
    verdict: 'buggy',
    explanation: 'Without a comparator, sort compares string representations. Thus [2, 10, 1] becomes [1, 10, 2] rather than the numeric order [1, 2, 10].',
    fixtures: [[[], [], 'Empty input'], [[2, 10, 1], [1, 2, 10], 'Different digit lengths'], [[-2, -10, 0], [-10, -2, 0], 'Negative values'], [[3, 3, 1], [1, 3, 3], 'Duplicates']],
  },
  {
    signature: { name: 'hasEvenReading', parameters: ['readings'] },
    title: 'Detect an even reading',
    specification: 'Return true if any reading is even, including zero and negative even numbers. Return false otherwise.',
    code: '/**\n * @param {number[]} readings - Integer readings. Do not modify this array.\n * @returns {boolean} Whether any reading is even.\n */\nfunction hasEvenReading(readings) {\n  return readings.some(value => value % 2 === 0);\n}',
    referenceCode: '/**\n * @param {number[]} readings - Integer readings. Do not modify this array.\n * @returns {boolean} Whether any reading is even.\n */\nfunction hasEvenReading(readings) { for (const value of readings) if (value % 2 === 0) return true; return false; }',
    verdict: 'correct',
    explanation: 'some returns true as soon as an even value is found and false for an empty array. The remainder comparison also handles zero and negative even integers.',
    fixtures: [[[], false, 'Empty input'], [[1, 3, 5], false, 'All odd'], [[1, 0, 3], true, 'Zero is even'], [[-3, -4, 7], true, 'Negative even value']],
  },
  {
    signature: { name: 'firstMatchingIndex', parameters: ['values', 'target'] },
    title: 'Return the first matching position',
    specification: 'Return the index of the first occurrence of the target, or -1 if it is absent.',
    code: '/**\n * @param {number[]} values - Integer values. Do not modify this array.\n * @param {number} target - Integer to find.\n * @returns {number} First matching index, or -1 if absent.\n */\nfunction firstMatchingIndex(values, target) {\n  return values.indexOf(target) || -1;\n}',
    referenceCode: '/**\n * @param {number[]} values - Integer values. Do not modify this array.\n * @param {number} target - Integer to find.\n * @returns {number} First matching index, or -1 if absent.\n */\nfunction firstMatchingIndex(values, target) { return values.indexOf(target); }',
    verdict: 'buggy',
    explanation: 'A match at index zero is falsy, so the fallback incorrectly replaces it with -1. For {values:[7,8], target:7}, the correct result is 0.',
    fixtures: [[{ values: [], target: 1 }, -1, 'Empty values'], [{ values: [7, 8], target: 7 }, 0, 'First position'], [{ values: [2, 7, 7], target: 7 }, 1, 'First of multiple matches'], [{ values: [2, 3], target: 7 }, -1, 'Missing target']],
  },
  {
    signature: { name: 'clampReading', parameters: ['value', 'min', 'max'] },
    title: 'Clamp a reading to its range',
    specification: 'Keep the reading within the inclusive range from min to max. Return the nearest bound if it is outside the range; otherwise return it unchanged.',
    code: '/**\n * @param {number} value - Finite reading.\n * @param {number} min - Finite lower bound, no greater than max.\n * @param {number} max - Finite upper bound.\n * @returns {number} Reading limited to the inclusive range.\n */\nfunction clampReading(value, min, max) {\n  return Math.min(max, Math.max(min, value));\n}',
    referenceCode: '/**\n * @param {number} value - Finite reading.\n * @param {number} min - Finite lower bound, no greater than max.\n * @param {number} max - Finite upper bound.\n * @returns {number} Reading limited to the inclusive range.\n */\nfunction clampReading(value, min, max) { if (value < min) return min; if (value > max) return max; return value; }',
    verdict: 'correct',
    explanation: 'The inner maximum enforces the lower bound, then the outer minimum enforces the upper bound. Values already in range pass through, including both boundaries.',
    fixtures: [[{ value: 5, min: 0, max: 10 }, 5, 'Inside range'], [{ value: -3, min: 0, max: 10 }, 0, 'Below minimum'], [{ value: 12, min: 0, max: 10 }, 10, 'Above maximum'], [{ value: -2, min: -2, max: -2 }, -2, 'Equal bounds and negative value']],
  },
  {
    signature: { name: 'countOddReadings', parameters: ['readings'] },
    title: 'Count every odd integer',
    specification: 'Count the odd readings, including negative odd numbers. Return 0 for an empty array.',
    code: '/**\n * @param {number[]} readings - Integer readings. Do not modify this array.\n * @returns {number} Number of odd readings.\n */\nfunction countOddReadings(readings) {\n  return readings.filter(value => value % 2 === 1).length;\n}',
    referenceCode: '/**\n * @param {number[]} readings - Integer readings. Do not modify this array.\n * @returns {number} Number of odd readings.\n */\nfunction countOddReadings(readings) { return readings.filter(value => value % 2 !== 0).length; }',
    verdict: 'buggy',
    explanation: 'JavaScript remainders keep the sign of the dividend. A negative odd integer has remainder -1, so comparing only with 1 misses it. For [-3, -2, -1], the answer should be 2, but this returns 0.',
    fixtures: [[[], 0, 'Empty input'], [[1, 2, 3], 2, 'Positive odd integers'], [[-3, -2, -1], 2, 'Negative odd integers'], [[-5, 0, 4, 7], 2, 'Mixed signs and zero']],
  },
  {
    signature: { name: 'readingChanges', parameters: ['readings'] },
    title: 'Measure successive changes',
    specification: 'Return the change between each pair of consecutive readings: the later reading minus the earlier one. Return an empty array for fewer than two readings.',
    code: '/**\n * @param {number[]} readings - Integer readings from -1000 to 1000, inclusive. Do not modify this array.\n * @returns {number[]} Each reading minus the preceding reading.\n */\nfunction readingChanges(readings) {\n  return readings.slice(1).map((value, index) => value - readings[index]);\n}',
    referenceCode: '/**\n * @param {number[]} readings - Integer readings from -1000 to 1000, inclusive. Do not modify this array.\n * @returns {number[]} Each reading minus the preceding reading.\n */\nfunction readingChanges(readings) { const changes = []; for (let i = 1; i < readings.length; i++) changes.push(readings[i] - readings[i - 1]); return changes; }',
    verdict: 'correct',
    explanation: 'Slicing starts at the second reading. Its mapped index still points to the preceding reading in the original array, so every subtraction uses the intended pair. Inputs with fewer than two readings produce no differences.',
    fixtures: [[[], [], 'Empty input'], [[4], [], 'Single reading'], [[2, 5, 1], [3, -4], 'Increase then decrease'], [[-2, -2, 0, -3], [0, 2, -3], 'Repeated readings and mixed signs']],
  },
  {
    signature: { name: 'groupsOfThree', parameters: ['itemCount'] },
    title: 'Allocate groups of three',
    specification: 'Return the number of groups needed to hold all items, with at most three items per group. Return 0 for no items.',
    code: '/**\n * @param {number} itemCount - Nonnegative integer item count.\n * @returns {number} Number of groups needed.\n */\nfunction groupsOfThree(itemCount) {\n  return Math.round(itemCount / 3);\n}',
    referenceCode: '/**\n * @param {number} itemCount - Nonnegative integer item count.\n * @returns {number} Number of groups needed.\n */\nfunction groupsOfThree(itemCount) { return Math.ceil(itemCount / 3); }',
    verdict: 'buggy',
    explanation: 'Rounding to the nearest integer can discard a partially filled group. Four items need two groups, but Math.round(4 / 3) returns 1. The quotient must always round upward.',
    fixtures: [[0, 0, 'No items'], [1, 1, 'One item still needs a group'], [3, 1, 'Exactly one full group'], [4, 2, 'One remaining item'], [8, 3, 'Two remaining items']],
  },
  {
    signature: { name: 'normalizeLabelSpacing', parameters: ['label'] },
    title: 'Normalize label spacing',
    specification: 'Remove leading and trailing whitespace, then replace each remaining run of whitespace with one space. Preserve all other characters and their case. Whitespace includes spaces, tabs, and line breaks.',
    code: '/**\n * @param {string} label - Label to normalize; may contain any whitespace.\n * @returns {string} Label with trimmed and collapsed whitespace.\n */\nfunction normalizeLabelSpacing(label) {\n  return label.trim().replace(/\\s+/g, " ");\n}',
    referenceCode: '/**\n * @param {string} label - Label to normalize; may contain any whitespace.\n * @returns {string} Label with trimmed and collapsed whitespace.\n */\nfunction normalizeLabelSpacing(label) { return label.trim().split(/\\s+/).join(" "); }',
    verdict: 'correct',
    explanation: 'trim removes whitespace at both ends, and the global replacement collapses every internal whitespace run to one space. Non-whitespace characters stay unchanged, while empty and whitespace-only inputs produce an empty string.',
    fixtures: [['', '', 'Empty input'], ['  Reel  Data  ', 'Reel Data', 'Outer and repeated inner spaces'], ['\tCod\nsalmon\r\n', 'Cod salmon', 'Tabs and line breaks'], ['A-B', 'A-B', 'Already normalized'], [' \t\n ', '', 'Whitespace only']],
  },
];

export function createDemoLesson(context: TutorContext): ProposedLesson {
  const count = LESSON_SIZES.some(size => size === context.settings.batchSize) || (context.focus && context.settings.batchSize === 4) ? context.settings.batchSize : DEFAULT_LESSON_SIZE;
  const questions: ProposedQuestion[] = EXAMPLES.slice(0, count).map((example, index) => ({
    signature: structuredClone(example.signature),
    title: example.title,
    specification: example.specification,
    code: example.code,
    referenceCode: example.referenceCode,
    verdict: example.verdict,
    explanation: example.explanation,
    tests: example.fixtures.map(([input, expected, note]) => ({ input: structuredClone(example.signature.parameters.length === 1 ? [input] : example.signature.parameters.map(name => (input as Record<string, JsonValue>)[name])), expected: structuredClone(expected), note })),
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
      skillUses: [{ conceptId: 'demo-code-review', role: 'target', support: 'independent', ifCorrect: 'supports', ifIncorrect: 'inconclusive',
        rationale: 'The judgment concerns matching a function to its contract; errors do not isolate a particular component skill.' }],
      stage: index === 0 ? 'warmup' : index === count - 1 ? 'consolidate' : index >= Math.ceil(count / 2) ? 'stretch' : 'build',
      cognitiveDemand: index === 0 ? 1 : index === count - 1 ? 2 : index >= Math.ceil(count / 2) ? 3 : 2,
      difficultyRationale: 'A sample sequence moves from one comparison to combining operations, then finishes with a compact independent task. These are illustrative demands, not personalized estimates.',
      scaffolding: 'The specification supplies the required behavior and boundary rules; no earlier explanation is required.',
      ifIdk: 'Record uncertainty without inferring an incorrect rule or lack of ability.',
      familyId: `demo-task-${index + 1}`, counterpart: 'unasked',
      variantReason: 'Leave the opposite implementation unasked; use the reference for optional review rather than another copy of this task.',
    },
  }));
  if (context.focus?.concept.id === 'demo-code-review') {
    const samples = [
      { name: 'hasItem', params: ['items', 'target'], title: 'Find an item', spec: 'Return true if the target appears in the list.',
        docs: ['@param {string[]} items - Items to search. Do not modify this array.', '@param {string} target - Item to find.', '@returns {boolean} Whether the item is present.'],
        code: 'return items.indexOf(target) > 0;', reference: 'return items.includes(target);', verdict: 'buggy' as const,
        explanation: 'A match at index 0 is present, but the comparison excludes it.',
        tests: [[[['a'], 'a'], true], [[['a', 'b'], 'b'], true], [[[], 'a'], false], [[['a'], 'b'], false]] },
      { name: 'countAtLeast', params: ['values', 'minimum'], title: 'Count values at least a minimum', spec: 'Count values that are at least the minimum.',
        docs: ['@param {number[]} values - Finite numbers. Do not modify this array.', '@param {number} minimum - Finite minimum.', '@returns {number} Number of matching values.'],
        code: 'return values.filter(value => value >= minimum).length;', reference: 'return values.filter(value => value >= minimum).length;', verdict: 'correct' as const,
        explanation: 'The comparison includes values equal to the minimum.',
        tests: [[[[0, 1], 0], 2], [[[1, 2], 2], 1], [[[], 2], 0], [[[3, 4], 5], 0]] },
      { name: 'firstNegativeIndex', params: ['values'], title: 'Find the first negative value', spec: 'Return the index of the first negative value, or -1 if there is none.',
        docs: ['@param {number[]} values - Finite numbers. Do not modify this array.', '@returns {number} First matching index, or -1.'],
        code: 'return values.findIndex(value => value < 0) || -1;', reference: 'return values.findIndex(value => value < 0);', verdict: 'buggy' as const,
        explanation: 'Index 0 is falsy, so the fallback incorrectly changes it to -1.',
        tests: [[[[-1]], 0], [[[1, -2]], 1], [[[]], -1], [[[0, 2]], -1]] },
      { name: 'keepEvenValues', params: ['values'], title: 'Keep even values', spec: 'Return the even values in their original order.',
        docs: ['@param {number[]} values - Integers. Do not modify this array.', '@returns {number[]} Even values in their original order.'],
        code: 'return values.filter(value => value % 2 === 0);', reference: 'return values.filter(value => value % 2 === 0);', verdict: 'correct' as const,
        explanation: 'The remainder test includes zero and negative even integers.',
        tests: [[[[]], []], [[[0, 1]], [0]], [[[-4, 3]], [-4]], [[[2, 2]], [2, 2]]] },
      { name: 'hasAboveLimit', params: ['values', 'limit'], title: 'Find a value above the limit', spec: 'Return true if any value is above the limit.',
        docs: ['@param {number[]} values - Finite values. Do not modify this array.', '@param {number} limit - Finite limit.', '@returns {boolean} Whether a value exceeds the limit.'],
        code: 'return values.some(value => value >= limit);', reference: 'return values.some(value => value > limit);', verdict: 'buggy' as const,
        explanation: 'A value equal to the limit does not exceed it.',
        tests: [[[[1, 2], 2], false], [[[1, 3], 2], true], [[[], 0], false], [[[0], 1], false]] },
      { name: 'sumNonnegativeValues', params: ['values'], title: 'Sum nonnegative values', spec: 'Return the sum of all nonnegative values, or 0 if none qualify.',
        docs: ['@param {number[]} values - Finite numbers. Do not modify this array.', '@returns {number} Sum of the nonnegative values.'],
        code: 'return values.filter(value => value >= 0).reduce((total, value) => total + value, 0);',
        reference: 'return values.filter(value => value >= 0).reduce((total, value) => total + value, 0);', verdict: 'correct' as const,
        explanation: 'Only values at least zero contribute, with an initial total of zero.',
        tests: [[[[]], 0], [[[-2, 3]], 3], [[[0, 4]], 4], [[[-3, -1]], 0]] },
    ];
    // Six-card practice also includes two different applications from the demo.
    for (let index = 0; index < Math.min(samples.length, count); index++) {
      const item = samples[index];
      const doc = '/**\n' + item.docs.map(line => ` * ${line}\n`).join('') + ' */\n';
      const source = (body: string) => `${doc}function ${item.name}(${item.params.join(', ')}) {\n  ${body}\n}`;
      Object.assign(questions[index], { signature: { name: item.name, parameters: item.params }, title: item.title, specification: item.spec,
        code: source(item.code), referenceCode: source(item.reference), verdict: item.verdict, explanation: item.explanation,
        tests: item.tests.map(([input, expected]) => ({ input, expected, note: 'Boundary example.' })) });
      questions[index].plan!.familyId = `demo-focus-${index + 1}`;
    }
  }
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
