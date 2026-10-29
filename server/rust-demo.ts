import type { ProposedLesson, TutorContext, Verdict } from '../src/types.ts';
import { createDemoLesson } from './demo.ts';

interface Sample { name: string; parameters: [string, string][]; returns: string; candidate: string; reference: string; verdict: Verdict; explanation: string; imports?: string }
const samples: Sample[] = [
  { name: 'keep_nonnegative_readings', parameters: [['readings', '&[i64]']], returns: 'Vec<i64>', candidate: 'readings.iter().copied().filter(|value| *value > 0).collect()', reference: 'readings.iter().copied().filter(|value| *value >= 0).collect()', verdict: 'buggy', explanation: 'The strict comparison excludes zero.' },
  { name: 'sum_order_quantities', parameters: [['orders', '&[HashMap<String, i64>]']], returns: 'i64', candidate: 'orders.iter().map(|order| order["quantity"]).sum()', reference: 'orders.iter().map(|order| order["quantity"]).sum()', verdict: 'correct', explanation: 'Each quantity contributes once, and the sum of an empty slice is zero.', imports: 'use std::collections::HashMap;\n\n' },
  { name: 'largest_reading', parameters: [['readings', '&[i64]']], returns: 'i64', candidate: 'let mut largest = 0;\nfor &value in readings { largest = largest.max(value); }\nlargest', reference: '*readings.iter().max().unwrap()', verdict: 'buggy', explanation: 'Starting at zero gives the wrong result when all readings are negative.' },
  { name: 'unique_labels', parameters: [['labels', '&[String]']], returns: 'Vec<String>', candidate: 'let mut result = Vec::new();\nfor label in labels { if !result.contains(label) { result.push(label.clone()); } }\nresult', reference: 'let mut result = Vec::new();\nfor label in labels { if !result.contains(label) { result.push(label.clone()); } }\nresult', verdict: 'correct', explanation: 'A label is added only on its first appearance.' },
  { name: 'sort_temperatures', parameters: [['temperatures', '&[i64]']], returns: 'Vec<i64>', candidate: 'let mut result = temperatures.to_vec();\nresult.sort_by_key(|value| value.to_string());\nresult', reference: 'let mut result = temperatures.to_vec();\nresult.sort();\nresult', verdict: 'buggy', explanation: 'Sorting the string forms places 10 before 2 instead of comparing the numbers.' },
  { name: 'has_even_reading', parameters: [['readings', '&[i64]']], returns: 'bool', candidate: 'readings.iter().any(|value| value % 2 == 0)', reference: 'readings.iter().any(|value| value % 2 == 0)', verdict: 'correct', explanation: 'any finds an even value and returns false for an empty slice.' },
  { name: 'first_matching_index', parameters: [['values', '&[i64]'], ['target', 'i64']], returns: 'i64', candidate: 'match values.iter().position(|value| *value == target) { Some(index) if index > 0 => index as i64, _ => -1 }', reference: 'values.iter().position(|value| *value == target).map_or(-1, |index| index as i64)', verdict: 'buggy', explanation: 'A match at index zero is incorrectly treated as absent.' },
  { name: 'clamp_reading', parameters: [['value', 'i64'], ['lower', 'i64'], ['upper', 'i64']], returns: 'i64', candidate: 'value.max(lower).min(upper)', reference: 'value.max(lower).min(upper)', verdict: 'correct', explanation: 'The maximum applies the lower bound, and the minimum applies the upper bound.' },
  { name: 'count_odd_readings', parameters: [['readings', '&[i64]']], returns: 'i64', candidate: 'readings.iter().filter(|value| *value % 2 == 1).count() as i64', reference: 'readings.iter().filter(|value| *value % 2 != 0).count() as i64', verdict: 'buggy', explanation: 'Negative odd integers have remainder -1, so comparing only with 1 misses them.' },
  { name: 'reading_changes', parameters: [['readings', '&[i64]']], returns: 'Vec<i64>', candidate: 'readings.windows(2).map(|pair| pair[1] - pair[0]).collect()', reference: 'readings.windows(2).map(|pair| pair[1] - pair[0]).collect()', verdict: 'correct', explanation: 'Each window holds neighboring values in order.' },
  { name: 'groups_of_three', parameters: [['item_count', 'i64']], returns: 'i64', candidate: 'item_count / 3', reference: '(item_count + 2) / 3', verdict: 'buggy', explanation: 'Integer division drops a partially filled group.' },
  { name: 'normalize_label_spacing', parameters: [['label', '&str']], returns: 'String', candidate: 'label.split_whitespace().collect::<Vec<_>>().join(" ")', reference: 'label.split_whitespace().collect::<Vec<_>>().join(" ")', verdict: 'correct', explanation: 'Splitting on whitespace and joining with one space removes extra spacing.' },
];
const focused: Sample[] = [
  { name: 'has_item', parameters: [['items', '&[String]'], ['target', '&str']], returns: 'bool', candidate: 'items.iter().position(|item| item == target).map_or(false, |index| index > 0)', reference: 'items.iter().any(|item| item == target)', verdict: 'buggy', explanation: 'A match at index zero is incorrectly excluded.' },
  { name: 'count_at_least', parameters: [['values', '&[i64]'], ['minimum', 'i64']], returns: 'i64', candidate: 'values.iter().filter(|value| **value >= minimum).count() as i64', reference: 'values.iter().filter(|value| **value >= minimum).count() as i64', verdict: 'correct', explanation: 'The comparison includes values equal to the minimum.' },
  { name: 'first_negative_index', parameters: [['values', '&[i64]']], returns: 'i64', candidate: 'values.iter().position(|value| *value < 0).filter(|index| *index > 0).map_or(-1, |index| index as i64)', reference: 'values.iter().position(|value| *value < 0).map_or(-1, |index| index as i64)', verdict: 'buggy', explanation: 'A match at index zero is incorrectly excluded.' },
  { name: 'keep_even_values', parameters: [['values', '&[i64]']], returns: 'Vec<i64>', candidate: 'values.iter().copied().filter(|value| value % 2 == 0).collect()', reference: 'values.iter().copied().filter(|value| value % 2 == 0).collect()', verdict: 'correct', explanation: 'The remainder test includes zero and negative even numbers.' },
  { name: 'has_above_limit', parameters: [['values', '&[i64]'], ['limit', 'i64']], returns: 'bool', candidate: 'values.iter().any(|value| *value >= limit)', reference: 'values.iter().any(|value| *value > limit)', verdict: 'buggy', explanation: 'A value equal to the limit is not above it.' },
  { name: 'sum_nonnegative_values', parameters: [['values', '&[i64]']], returns: 'i64', candidate: 'values.iter().filter(|value| **value >= 0).sum()', reference: 'values.iter().filter(|value| **value >= 0).sum()', verdict: 'correct', explanation: 'Only nonnegative values contribute, and an empty sum is zero.' },
];
function source(item: Sample, body: string, specification: string): string {
  return `${item.imports ?? ''}/// ${specification.replace(/\s+/g, ' ')}\nfn ${item.name}(${item.parameters.map(([name, type]) => `${name}: ${type}`).join(', ')}) -> ${item.returns} {\n${body.split('\n').map(line => `    ${line}`).join('\n')}\n}`;
}
export function createRustDemoLesson(context: TutorContext): ProposedLesson {
  const base = context.focus ? { ...context, focus: { ...context.focus, concept: { ...context.focus.concept, id: 'demo-code-review' } } } : context;
  const proposal = createDemoLesson(base); const examples = context.focus ? focused : samples;
  const id = context.focus?.concept.id ?? 'rust-demo-code-review'; const name = context.focus?.concept.name ?? 'Rust function review';
  proposal.objective = 'Sample local practice: judge small Rust functions against their specifications.';
  proposal.assumptions[0] = 'You can read basic Rust functions and slices.';
  Object.assign(proposal.curriculum!.conceptUpdates[0], { id, name, representations: ['Rust functions'] });
  proposal.curriculum!.frontier[0].conceptId = id;
  for (let index = 0; index < proposal.questions.length; index++) {
    const question = proposal.questions[index]; const item = examples[index];
    question.specification = question.specification.replace(/\barrays\b/gi, 'lists').replace(/\barray\b/gi, 'list');
    if (!context.focus && index === 7) question.specification = 'Keep the reading within the inclusive range from lower to upper. Return the nearest bound if outside it.';
    question.signature = { name: item.name, parameters: item.parameters.map(([name]) => name) };
    question.code = source(item, item.candidate, question.specification);
    question.referenceCode = source(item, item.reference, question.specification);
    question.verdict = item.verdict; question.explanation = item.explanation;
    question.plan!.conceptIds = [id]; question.plan!.skillUses = question.plan!.skillUses!.map(use => ({ ...use, conceptId: id }));
    question.plan!.familyId = `rust-demo-${context.focus ? 'focus' : 'task'}-${index + 1}`;
  }
  return proposal;
}
