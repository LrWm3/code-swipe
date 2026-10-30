import type { ConceptUpdate, KnowledgeConcept, KnowledgeGraph, KnowledgePlan, ProposedLesson, StoreData, TutorContext } from '../src/types.ts';
import { BASE_CONTEXTS } from '../src/learning-contexts.ts';
import { KNOWLEDGE_KINDS } from '../src/types.ts';
import { knowledgeKind } from '../src/knowledge-organization.ts';

export const normalizedName = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const validId = (value: string) => /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(value);

export function legacyDefinition(concept: Pick<ConceptUpdate, 'id' | 'name' | 'description' | 'representations'>): KnowledgeConcept {
  const context = /^(python|rust|javascript)[-_]/.exec(concept.id)?.[1];
  return { id: concept.id, kind: 'skill', name: concept.name, description: concept.description, representations: [...concept.representations], aliases: [], domainTags: [], scope: context ? 'context-specific' : 'general', contextIds: context ? [context] : [] };
}

export function canonicalId(id: string, aliases: Record<string, string> = {}): string {
  const visited = new Set<string>();
  while (Object.hasOwn(aliases, id)) {
    if (visited.has(id)) throw new Error('Concept alias cycle.');
    visited.add(id);
    id = aliases[id];
  }
  return id;
}

export function buildKnowledgeGraph(data: StoreData): KnowledgeGraph {
  const concepts = new Map((data.knowledgeSeed?.concepts ?? []).map(concept => [concept.id, structuredClone(concept)]));
  const contexts = new Map(BASE_CONTEXTS.map(context => [context.id, structuredClone(context)]));
  const relationships = new Map((data.knowledgeSeed?.relationships ?? []).map(relation => [relation.id, structuredClone(relation)]));
  for (const context of data.knowledgeSeed?.contexts ?? []) contexts.set(context.id, structuredClone(context));
  const legacy = (concept: Parameters<typeof legacyDefinition>[0]) => {
    if (!concepts.has(concept.id)) concepts.set(concept.id, legacyDefinition(concept));
    else if (!data.lessons.some(lesson => lesson.curriculum?.knowledge?.concepts.some(item => item.id === concept.id))) {
      Object.assign(concepts.get(concept.id)!, { name: concept.name, description: concept.description, representations: [...concept.representations] });
    }
  };
  for (const review of data.skillRetrofits ?? []) for (const concept of review.concepts) legacy(concept);
  for (const lesson of data.lessons) {
    for (const concept of lesson.curriculum?.conceptUpdates ?? []) {
      legacy(concept);
      for (const prerequisite of concept.prerequisiteIds) {
        const id = `legacy_${prerequisite}_${concept.id}`;
        relationships.set(id, { id, kind: 'prerequisite', fromId: prerequisite, toId: concept.id, contextIds: [], rationale: 'Advisory dependency recorded in an archived curriculum plan.', active: true });
      }
    }
    for (const context of lesson.curriculum?.knowledge?.contexts ?? []) contexts.set(context.id, structuredClone(context));
    for (const concept of lesson.curriculum?.knowledge?.concepts ?? []) concepts.set(concept.id, { ...concepts.get(concept.id), ...structuredClone(concept), kind: concept.kind ?? concepts.get(concept.id)?.kind ?? 'skill' });
    for (const relationship of lesson.curriculum?.knowledge?.relationships ?? []) relationships.set(relationship.id, structuredClone(relationship));
  }
  const history = structuredClone(data.graphRevisions ?? []);
  const undone = new Set(history.flatMap(event => event.change.type === 'undo-merge' ? [event.change.mergeId] : []));
  const aliases: Record<string, string> = Object.create(null);
  for (const event of history) {
    if (event.change.type === 'merge' && !undone.has(event.id)) {
      aliases[event.change.fromId] = canonicalId(event.change.toId, aliases);
      canonicalId(event.change.fromId, aliases);
    }
    if (event.change.type === 'relationship') relationships.set(event.change.relationship.id, structuredClone(event.change.relationship));
  }
  return { concepts: [...concepts.values()], contexts: [...contexts.values()], relationships: [...relationships.values()], aliases, history };
}

export function graphWithPlan(graph: KnowledgeGraph, plan: KnowledgePlan): KnowledgeGraph {
  const concepts = new Map(graph.concepts.map(item => [item.id, structuredClone(item)]));
  const contexts = new Map(graph.contexts.map(item => [item.id, structuredClone(item)]));
  const relationships = new Map(graph.relationships.map(item => [item.id, structuredClone(item)]));
  for (const item of plan.concepts) concepts.set(item.id, structuredClone(item));
  for (const item of plan.contexts) contexts.set(item.id, structuredClone(item));
  for (const item of plan.relationships) relationships.set(item.id, structuredClone(item));
  const aliases = { ...graph.aliases };
  for (const merge of plan.merges) aliases[merge.fromId] = canonicalId(merge.toId, aliases);
  for (const id of Object.keys(aliases)) canonicalId(id, aliases);
  return { concepts: [...concepts.values()], contexts: [...contexts.values()], relationships: [...relationships.values()], aliases, history: graph.history };
}

export function validateKnowledgePlan(plan: KnowledgePlan, context: TutorContext): KnowledgeGraph {
  const previous = context.knowledge ?? { concepts: (context.curriculum?.concepts ?? []).map(item => item.definition ?? legacyDefinition(item)), contexts: BASE_CONTEXTS, relationships: [], aliases: {}, history: [] };
  const graph = graphWithPlan(previous, plan);
  const definitions = new Map(graph.concepts.map(item => [item.id, item]));
  const contexts = new Map(graph.contexts.map(item => [item.id, item]));
  const unique = (ids: string[], name: string) => {
    if (new Set(ids).size !== ids.length || ids.some(id => !validId(id))) throw new Error(`${name} needs unique stable IDs.`);
  };
  unique(plan.concepts.map(item => item.id), 'knowledge.concepts');
  unique(plan.contexts.map(item => item.id), 'knowledge.contexts');
  unique(plan.relationships.map(item => item.id), 'knowledge.relationships');
  for (const item of graph.contexts) {
    unique(item.parentIds, `context ${item.id} parents`);
    if (item.parentIds.some(id => id === item.id || !contexts.has(id))) throw new Error(`Context ${item.id} has an invalid parent.`);
    const original = BASE_CONTEXTS.find(base => base.id === item.id);
    if (original && JSON.stringify(original) !== JSON.stringify(item)) throw new Error(`Keep built-in context ${item.id} unchanged; define a separate context for a specialization.`);
  }
  const scopes = new Map<string, string>();
  for (const item of graph.concepts) {
    if (!KNOWLEDGE_KINDS.includes(knowledgeKind(item))) throw new Error(`Knowledge record ${item.id} needs a valid kind.`);
    const existingDefinition = previous.concepts.find(concept => concept.id === item.id);
    if (existingDefinition && (knowledgeKind(existingDefinition) === 'topic') !== (knowledgeKind(item) === 'topic')) throw new Error('Keep grouping topics separate from assessable knowledge identities.');
    if (existingDefinition && (existingDefinition.scope !== item.scope || [...existingDefinition.contextIds].sort().join(',') !== [...item.contextIds].sort().join(','))) throw new Error(`Keep concept ${item.id}'s meaning and scope stable; introduce a separate specialization instead.`);
    if (existingDefinition && normalizedName(existingDefinition.name) !== normalizedName(item.name) && !item.aliases.some(alias => normalizedName(alias) === normalizedName(existingDefinition.name))) throw new Error(`Retain ${existingDefinition.name} as an alias when refining the name of ${item.id}.`);
    unique(item.contextIds, `concept ${item.id} contexts`);
    if (item.contextIds.some(id => !contexts.has(id)) || (item.scope === 'context-specific' && !item.contextIds.length) || (item.scope === 'general' && item.contextIds.length)) throw new Error(`Concept ${item.id} needs a consistent scope and existing contexts.`);
    const identity = `${knowledgeKind(item)}:${normalizedName(item.name)}:${item.scope}:${[...item.contextIds].sort().join(',')}:${[...item.domainTags].map(normalizedName).sort().join(',')}`;
    const existing = scopes.get(identity);
    if (existing && canonicalId(existing, graph.aliases) !== canonicalId(item.id, graph.aliases)) throw new Error(`Concept ${item.id} duplicates ${existing}; reuse its identity or declare an equivalent-concept merge.`);
    scopes.set(identity, item.id);
  }
  const hierarchical = new Map<string, string[]>();
  const grouping = new Map<string, string[]>();
  const components = new Map<string, string[]>();
  for (const relation of graph.relationships) {
    if (!definitions.has(relation.fromId) || !(relation.kind === 'application' ? contexts.has(relation.toId) : definitions.has(relation.toId)) || relation.contextIds.some(id => !contexts.has(id))) throw new Error(`Relationship ${relation.id} has an unknown endpoint or context.`);
    const from = canonicalId(relation.fromId, graph.aliases);
    const to = relation.kind === 'application' ? relation.toId : canonicalId(relation.toId, graph.aliases);
    if (relation.active && relation.kind !== 'application' && from === to) throw new Error(`Relationship ${relation.id} cannot link a concept to itself.`);
    if (relation.active && ['prerequisite', 'specialization'].includes(relation.kind)) hierarchical.set(from, [...hierarchical.get(from) ?? [], to]);
    if (relation.kind === 'part-of' && knowledgeKind(definitions.get(relation.toId)!) !== 'topic') throw new Error('part-of must link a record to a grouping topic.');
    if (relation.kind === 'uses' && (knowledgeKind(definitions.get(relation.fromId)!) === 'topic' || knowledgeKind(definitions.get(relation.toId)!) === 'topic')) throw new Error('uses links assessable concepts, techniques, skills, or representations; group topics with part-of.');
    if (relation.kind === 'prerequisite' && [definitions.get(relation.fromId)!, definitions.get(relation.toId)!].some(item => knowledgeKind(item) === 'topic')) throw new Error('A curriculum grouping is not a learner prerequisite.');
    if (relation.active && relation.kind === 'part-of') grouping.set(from, [...grouping.get(from) ?? [], to]);
    if (relation.active && relation.kind === 'uses') components.set(from, [...components.get(from) ?? [], to]);
  }
  const checkCycles = (edges: Map<string, string[]>, label: string) => {
    const seen = new Set<string>(), visiting = new Set<string>();
    const visit = (id: string) => {
      if (visiting.has(id)) throw new Error(`${label} cycle at ${id}.`);
      if (seen.has(id)) return;
      visiting.add(id); for (const next of edges.get(id) ?? []) visit(next); visiting.delete(id); seen.add(id);
    };
    for (const id of edges.keys()) visit(id);
  };
  checkCycles(new Map(graph.contexts.map(item => [item.id, item.parentIds])), 'Context hierarchy');
  checkCycles(hierarchical, 'Knowledge hierarchy');
  checkCycles(grouping, 'Topic grouping');
  checkCycles(components, 'Knowledge composition');
  const merged = new Set<string>();
  for (const merge of plan.merges) {
    const from = definitions.get(merge.fromId), to = definitions.get(merge.toId);
    if (!from || !to || from.id === to.id || merged.has(from.id) || Object.hasOwn(previous.aliases, from.id)) throw new Error('Merge needs distinct existing identities, each source at most once.');
    merged.add(from.id);
    if (from.scope !== to.scope || [...from.contextIds].sort().join(',') !== [...to.contextIds].sort().join(',')) throw new Error('Merge only equivalent concepts with identical scope; retain general concepts and specializations separately.');
    if (knowledgeKind(from) !== knowledgeKind(to)) throw new Error('Merge only equivalent records at the same knowledge level.');
    if (graph.relationships.some(edge => edge.active && ['prerequisite', 'specialization'].includes(edge.kind) && [edge.fromId, edge.toId].includes(from.id) && [edge.fromId, edge.toId].includes(to.id))) throw new Error('A prerequisite or specialization is not a duplicate concept.');
    if (previous.concepts.some(item => item.id === from.id) && !previous.concepts.some(item => item.id === to.id)) throw new Error('Keep the existing identity as the canonical merge target.');
  }
  return graph;
}

/** Rewrite references only in a new draft, never in the sealed archive. */
export function canonicalizeProposal(proposal: ProposedLesson, graph: KnowledgeGraph): ProposedLesson {
  const result = structuredClone(proposal);
  const resolve = (id: string) => canonicalId(id, graph.aliases);
  const ids = (values: string[]) => [...new Set(values.map(resolve))];
  for (const question of result.questions) if (question.plan) {
    question.plan.conceptIds = ids(question.plan.conceptIds);
    question.plan.prerequisiteIds = ids(question.plan.prerequisiteIds);
    const uses = new Map<string, NonNullable<typeof question.plan.skillUses>[number]>();
    for (const use of question.plan.skillUses ?? []) {
      use.conceptId = resolve(use.conceptId);
      const old = uses.get(use.conceptId);
      if (old && JSON.stringify(old) !== JSON.stringify(use)) throw new Error('Merged skill roles conflict; provide one consistent attribution for the canonical concept.');
      uses.set(use.conceptId, use);
    }
    question.plan.skillUses = [...uses.values()];
  }
  for (const item of result.curriculum?.observations ?? []) item.conceptIds = ids(item.conceptIds);
  for (const item of result.curriculum?.frontier ?? []) item.conceptId = resolve(item.conceptId);
  for (const item of result.curriculum?.knowledge?.assessments ?? []) item.conceptId = resolve(item.conceptId);
  return result;
}

