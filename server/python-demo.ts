import type { ProposedLesson, TutorContext, Verdict } from '../src/types.ts';
import { createDemoLesson } from './demo.ts';

interface Sample {
  name: string;
  params: string[];
  args: string[];
  returns: string;
  candidate: string;
  reference: string;
  verdict: Verdict;
  explanation: string;
  imports?: string;
}

const samples: Sample[] = [
  { name: 'keep_nonnegative_readings', params: ['readings'], args: ['Finite readings; do not modify.'], returns: 'Nonnegative readings in order.', candidate: 'return [value for value in readings if value > 0]', reference: 'return [value for value in readings if value >= 0]', verdict: 'buggy', explanation: 'The strict comparison excludes zero, even though the specification includes it.' },
  { name: 'sum_order_quantities', params: ['orders'], args: ['Orders with finite quantity fields; do not modify.'], returns: 'The sum of all quantities.', candidate: "return sum(order['quantity'] for order in orders)", reference: "return sum(order['quantity'] for order in orders)", verdict: 'correct', explanation: 'sum starts at zero, so the empty list works and each quantity contributes once.' },
  { name: 'largest_reading', params: ['readings'], args: ['A nonempty list of finite readings; do not modify.'], returns: 'The largest reading.', candidate: 'largest = 0\nfor value in readings:\n    largest = max(largest, value)\nreturn largest', reference: 'return max(readings)', verdict: 'buggy', explanation: 'Starting at zero returns zero for an all-negative list even when zero is absent.' },
  { name: 'unique_labels', params: ['labels'], args: ['Labels to deduplicate; do not modify.'], returns: 'Distinct labels in their original order.', candidate: 'return list(dict.fromkeys(labels))', reference: 'result = []\nfor label in labels:\n    if label not in result:\n        result.append(label)\nreturn result', verdict: 'correct', explanation: 'Dictionary keys preserve insertion order, and each label appears only once.' },
  { name: 'sort_temperatures', params: ['temperatures'], args: ['Finite temperatures; do not modify.'], returns: 'A new list in ascending numeric order.', candidate: 'return sorted(temperatures, key=str)', reference: 'return sorted(temperatures)', verdict: 'buggy', explanation: 'Sorting by string representation places 10 before 2 rather than using numeric order.' },
  { name: 'has_even_reading', params: ['readings'], args: ['Integer readings; do not modify.'], returns: 'Whether any reading is even.', candidate: 'return any(value % 2 == 0 for value in readings)', reference: 'return any(value % 2 == 0 for value in readings)', verdict: 'correct', explanation: 'any checks for an even value and returns False for an empty list.' },
  { name: 'first_matching_index', params: ['values', 'target'], args: ['Integer values; do not modify.', 'Integer to find.'], returns: 'The first matching index, or -1.', candidate: 'return (values.index(target) or -1) if target in values else -1', reference: 'return values.index(target) if target in values else -1', verdict: 'buggy', explanation: 'A match at index zero is falsy, so the fallback incorrectly replaces it with -1.' },
  { name: 'clamp_reading', params: ['value', 'lower', 'upper'], args: ['Finite reading.', 'Finite lower bound, no greater than upper.', 'Finite upper bound.'], returns: 'The reading constrained to the inclusive range.', candidate: 'return min(upper, max(lower, value))', reference: 'return min(upper, max(lower, value))', verdict: 'correct', explanation: 'max enforces the lower bound and min enforces the upper bound.' },
  { name: 'count_odd_readings', params: ['readings'], args: ['Integer readings; do not modify.'], returns: 'Number of odd readings.', candidate: 'return sum(1 for value in readings if value > 0 and value % 2 == 1)', reference: 'return sum(1 for value in readings if value % 2 != 0)', verdict: 'buggy', explanation: 'The positive-value check wrongly excludes negative odd integers.' },
  { name: 'reading_changes', params: ['readings'], args: ['Integer readings from -1000 to 1000; do not modify.'], returns: 'Each reading minus its predecessor.', candidate: 'return [later - earlier for earlier, later in zip(readings, readings[1:])]', reference: 'return [readings[index] - readings[index - 1] for index in range(1, len(readings))]', verdict: 'correct', explanation: 'zip pairs each reading with its successor, so each subtraction is later minus earlier.' },
  { name: 'groups_of_three', params: ['item_count'], args: ['Nonnegative integer item count.'], returns: 'The number of groups needed.', candidate: 'return round(item_count / 3)', reference: 'return (item_count + 2) // 3', verdict: 'buggy', explanation: 'Rounding to the nearest integer can discard a partially filled group.' },
  { name: 'normalize_label_spacing', params: ['label'], args: ['Label that may contain whitespace.'], returns: 'The label with trimmed and collapsed whitespace.', candidate: "return ' '.join(label.split())", reference: "return ' '.join(label.split())", verdict: 'correct', explanation: 'split removes outer whitespace and separates whitespace runs; join puts one space between words.' },
];

const focused: Sample[] = [
  { name: 'has_item', params: ['items', 'target'], args: ['Items to search; do not modify.', 'Item to find.'], returns: 'Whether the item appears in the list.', candidate: 'return items.index(target) > 0 if target in items else False', reference: 'return target in items', verdict: 'buggy', explanation: 'A match at index 0 is present, but the comparison excludes it.' },
  { name: 'count_at_least', params: ['values', 'minimum'], args: ['Finite numbers; do not modify.', 'Finite minimum.'], returns: 'The number of matching values.', candidate: 'return sum(1 for value in values if value >= minimum)', reference: 'return len([value for value in values if value >= minimum])', verdict: 'correct', explanation: 'The comparison includes values equal to the minimum.' },
  { name: 'first_negative_index', params: ['values'], args: ['Finite numbers; do not modify.'], returns: 'The first matching index, or -1.', candidate: 'return next((index for index, value in enumerate(values) if value < 0), -1) or -1', reference: 'return next((index for index, value in enumerate(values) if value < 0), -1)', verdict: 'buggy', explanation: 'Index 0 is falsy, so the fallback incorrectly changes it to -1.' },
  { name: 'keep_even_values', params: ['values'], args: ['Integer values; do not modify.'], returns: 'Even values in their original order.', candidate: 'return [value for value in values if value % 2 == 0]', reference: 'return [value for value in values if value % 2 == 0]', verdict: 'correct', explanation: 'The remainder test includes zero and negative even integers.' },
  { name: 'has_above_limit', params: ['values', 'limit'], args: ['Finite values; do not modify.', 'Finite limit.'], returns: 'Whether any value exceeds the limit.', candidate: 'return any(value >= limit for value in values)', reference: 'return any(value > limit for value in values)', verdict: 'buggy', explanation: 'A value equal to the limit does not exceed it.' },
  { name: 'sum_nonnegative_values', params: ['values'], args: ['Finite numbers; do not modify.'], returns: 'The sum of the nonnegative values.', candidate: 'return sum(value for value in values if value >= 0)', reference: 'return sum(value for value in values if value >= 0)', verdict: 'correct', explanation: 'Only values at least zero contribute, and sum returns zero for an empty sequence.' },
];

function source(item: Sample, body: string): string {
  const doc = `    """${item.returns}\n\n    Args:\n${item.params.map((name, index) => `        ${name}: ${item.args[index]}`).join('\n')}\n\n    Returns:\n        ${item.returns}\n    """\n`;
  return `${item.imports ?? ''}def ${item.name}(${item.params.join(', ')}):\n${doc}${body.split('\n').map(line => `    ${line}`).join('\n')}`;
}

export function createPythonDemoLesson(context: TutorContext): ProposedLesson {
  const base = context.focus ? { ...context, focus: { ...context.focus, concept: { ...context.focus.concept, id: 'demo-code-review' } } } : context;
  const proposal = createDemoLesson(base);
  const examples = context.focus ? focused : samples;
  const id = context.focus?.concept.id ?? 'python-demo-code-review';
  const name = context.focus?.concept.name ?? 'Python function review';
  proposal.objective = 'Sample local practice: judge small Python functions against their specifications.';
  proposal.assumptions[0] = 'You can read basic Python functions and list operations.';
  const concept = proposal.curriculum!.conceptUpdates[0];
  Object.assign(concept, { id, name, representations: ['Python functions'] });
  proposal.curriculum!.frontier[0].conceptId = id;
  for (let index = 0; index < proposal.questions.length; index++) {
    const question = proposal.questions[index];
    const item = examples[index];
    question.signature = { name: item.name, parameters: item.params };
    question.code = source(item, item.candidate);
    question.referenceCode = source(item, item.reference);
    question.verdict = item.verdict;
    question.explanation = item.explanation;
    question.specification = question.specification.replace(/\barray\b/gi, 'list').replace(/\barrays\b/gi, 'lists');
    if (!context.focus && index === 7) question.specification = 'Keep the reading within the inclusive range from lower to upper. Return the nearest bound if it is outside the range; otherwise return it unchanged.';
    question.plan!.conceptIds = [id];
    question.plan!.skillUses = question.plan!.skillUses!.map(use => ({ ...use, conceptId: id }));
    question.plan!.familyId = `python-demo-${context.focus ? 'focus' : 'task'}-${index + 1}`;
  }
  return proposal;
}
