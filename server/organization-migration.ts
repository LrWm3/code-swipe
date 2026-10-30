import { createHash } from 'node:crypto';
import type { KnowledgeConcept, KnowledgeKind, KnowledgeRelationship, StoreData } from '../src/types.ts';
import { buildKnowledgeGraph } from './knowledge-graph.ts';

const topicDefinitions = [
  ['topic_iteration_control_flow', 'Iteration and control flow', 'Repeating operations over sequences and controlling how execution proceeds.'],
  ['topic_accumulation_reduction', 'Accumulation and reduction', 'Combining contributions while traversing a collection to produce summaries or intermediate results.'],
  ['topic_searching_selection', 'Searching and selection', 'Finding qualifying items and choosing results according to comparisons and selection rules.'],
  ['topic_dictionaries_sets', 'Dictionaries and sets', 'Associating values with keys, grouping information, and reasoning about distinct membership.'],
  ['topic_boolean_value_semantics', 'Boolean logic and value semantics', 'Combining conditions and interpreting values, truthiness, and missing information.'],
  ['topic_numeric_operations_boundaries', 'Numeric operations and boundaries', 'Reasoning about numerical differences, comparisons, and the edges of a permitted range.'],
] as const;
const conceptDefinitions = [
  ['iteration', 'Iteration', 'Repeat an operation over a sequence while reasoning about loop state and termination.', 'topic_iteration_control_flow'],
  ['accumulation', 'Accumulation', 'Combine successive contributions into an evolving aggregate, such as a count, sum, or running result.', 'topic_accumulation_reduction'],
  ['key_value_mappings', 'Key–value mappings', 'Associate each distinct key with a value that can be retrieved, inserted, or updated.', 'topic_dictionaries_sets'],
  ['set_membership', 'Sets and membership', 'Distinguish membership in a collection from the number and order of occurrences.', 'topic_dictionaries_sets'],
  ['boolean_logic', 'Boolean logic', 'Combine propositions using conjunction, disjunction, and negation.', 'topic_boolean_value_semantics'],
  ['missing_values', 'Missing values and defaulting', 'Distinguish absent information from meaningful supplied values when selecting a fallback.', 'topic_boolean_value_semantics'],
  ['selection_criteria', 'Selection criteria', 'Choose a result according to a predicate, comparison, ordering, and any specified tie rule.', 'topic_searching_selection'],
  ['boundary_conditions', 'Boundary conditions', 'Reason about equality, endpoints, and values at the edges of a range or traversal.', 'topic_numeric_operations_boundaries'],
] as const;
// This is a reviewed port of the existing notebook, not a required curriculum.
// New topics and records remain agent-defined; unknown historical records stay visible.
const assignments: Record<string, { kind: KnowledgeKind; topics: string[]; uses: string[] }> = {
  array_scan: { kind: 'skill', topics: ['topic_iteration_control_flow'], uses: ['iteration'] },
  scan_termination: { kind: 'skill', topics: ['topic_iteration_control_flow'], uses: ['iteration'] },
  consecutive_state: { kind: 'technique', topics: ['topic_iteration_control_flow'], uses: ['iteration', 'accumulation'] },
  running_total: { kind: 'technique', topics: ['topic_accumulation_reduction'], uses: ['accumulation'] },
  selective_accumulation: { kind: 'technique', topics: ['topic_accumulation_reduction'], uses: ['accumulation', 'boolean_logic'] },
  conditional_counting: { kind: 'technique', topics: ['topic_accumulation_reduction'], uses: ['accumulation', 'boolean_logic'] },
  prefix_accumulation: { kind: 'technique', topics: ['topic_accumulation_reduction'], uses: ['accumulation', 'iteration'] },
  search_positions: { kind: 'skill', topics: ['topic_searching_selection'], uses: ['selection_criteria', 'boundary_conditions', 'missing_values'] },
  extrema_initialization: { kind: 'skill', topics: ['topic_searching_selection'], uses: ['selection_criteria', 'accumulation'] },
  adjacent_comparisons: { kind: 'technique', topics: ['topic_searching_selection'], uses: ['iteration', 'selection_criteria'] },
  tie_selection: { kind: 'skill', topics: ['topic_searching_selection'], uses: ['selection_criteria'] },
  frequency_counting: { kind: 'technique', topics: ['topic_dictionaries_sets'], uses: ['key_value_mappings', 'accumulation'] },
  grouped_accumulation: { kind: 'technique', topics: ['topic_dictionaries_sets'], uses: ['key_value_mappings', 'accumulation'] },
  output_uniqueness: { kind: 'skill', topics: ['topic_dictionaries_sets'], uses: ['set_membership'] },
  keyed_replacement: { kind: 'technique', topics: ['topic_dictionaries_sets'], uses: ['key_value_mappings'] },
  grouped_extrema: { kind: 'technique', topics: ['topic_dictionaries_sets'], uses: ['key_value_mappings', 'selection_criteria', 'accumulation'] },
  compound_conditions: { kind: 'skill', topics: ['topic_boolean_value_semantics'], uses: ['boolean_logic'] },
  numeric_truthiness: { kind: 'concept', topics: ['topic_boolean_value_semantics'], uses: ['boolean_logic'] },
  null_defaulting: { kind: 'skill', topics: ['topic_boolean_value_semantics'], uses: ['missing_values'] },
  signed_difference: { kind: 'concept', topics: ['topic_numeric_operations_boundaries'], uses: [] },
  absolute_difference: { kind: 'concept', topics: ['topic_numeric_operations_boundaries'], uses: ['signed_difference'] },
  inclusive_boundaries: { kind: 'skill', topics: ['topic_numeric_operations_boundaries', 'topic_iteration_control_flow'], uses: ['boundary_conditions'] },
  python_scan_representation: { kind: 'representation', topics: ['topic_iteration_control_flow'], uses: ['iteration'] },
  rust_scan_representation: { kind: 'representation', topics: ['topic_iteration_control_flow'], uses: ['iteration'] },
};

export function migrateOrganization(data: StoreData, backupDirectory: string, at = new Date().toISOString()) {
  if (data.version === 3) return { data, report: { needed: false, classified: data.organizationMigration?.classifiedIds.length ?? 0, added: data.organizationMigration?.addedIds.length ?? 0, lessons: data.lessons.length, answers: data.attempts.length } };
  if (data.version !== 2) throw new Error('Migrate the notebook to knowledge version 2 before organizing it.');
  const graph = buildKnowledgeGraph(data);
  const concepts = new Map<string, KnowledgeConcept>(graph.concepts.map(item => [item.id, { ...item, kind: assignments[item.id]?.kind ?? item.kind ?? 'skill' as KnowledgeKind }]));
  const relationships = new Map(graph.relationships.map(item => [item.id, item]));
  const addedIds: string[] = [];
  const classifiedIds = graph.concepts.filter(item => assignments[item.id]).map(item => item.id);
  const newRelationships: KnowledgeRelationship[] = [];
  const addNode = (id: string, name: string, description: string, kind: KnowledgeKind) => {
    if (concepts.has(id)) {
      if (concepts.get(id)!.name !== name || concepts.get(id)!.kind !== kind) throw new Error(`Organization identity ${id} conflicts with an existing record.`);
      return;
    }
    const item: KnowledgeConcept = { id, name, description, kind, aliases: [], domainTags: ['programming'], scope: 'general', contextIds: [], representations: [kind === 'topic' ? 'Curriculum grouping' : 'Cross-language reasoning'] };
    concepts.set(id, item); addedIds.push(id);
  };
  const addRelation = (kind: 'part-of' | 'uses', fromId: string, toId: string) => {
    if (!concepts.has(fromId) || !concepts.has(toId)) return;
    const id = `org_${createHash('sha256').update(`${kind}:${fromId}:${toId}`).digest('hex').slice(0, 24)}`;
    if (relationships.has(id)) return;
    const relationship: KnowledgeRelationship = { id, kind, fromId, toId, contextIds: [], active: true, rationale: kind === 'part-of' ? 'Reviewed curriculum grouping of an existing record; membership does not confer understanding.' : 'This existing skill or technique draws on the linked concept; archived evidence remains attached to its original record.' };
    relationships.set(id, relationship); newRelationships.push(relationship);
  };
  if (classifiedIds.length) {
    for (const [id, name, description] of topicDefinitions) addNode(id, name, description, 'topic');
    for (const [id, name, description, topic] of conceptDefinitions) { addNode(id, name, description, 'concept'); addRelation('part-of', id, topic); }
    for (const id of classifiedIds) {
      for (const topic of assignments[id].topics) addRelation('part-of', id, topic);
      for (const target of assignments[id].uses) addRelation('uses', id, target);
    }
  }
  const updated: StoreData = { ...structuredClone(data), version: 3,
    knowledgeSeed: { concepts: [...concepts.values()], contexts: graph.contexts, relationships: [...relationships.values()] },
    graphRevisions: [...data.graphRevisions ?? [], ...newRelationships.map((relationship, index) => ({ id: `organization-relationship-${index}`, createdAt: at, source: 'migration' as const, change: { type: 'relationship' as const, relationship } }))],
    organizationMigration: { fromVersion: 2, at, backupDirectory, classifiedIds, addedIds } };
  return { data: updated, report: { needed: true, classified: classifiedIds.length, added: addedIds.length, topics: [...concepts.values()].filter(item => item.kind === 'topic').length, relationships: newRelationships.length, lessons: data.lessons.length, answers: data.attempts.length, backupDirectory, unclassified: graph.concepts.filter(item => !assignments[item.id] && !item.kind).map(item => item.id) } };
}
