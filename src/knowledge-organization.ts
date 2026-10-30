import type { KnowledgeConcept, KnowledgeGraph, KnowledgeKind } from './types';

export const KIND_LABELS: Record<KnowledgeKind, string> = { topic: 'Topic', concept: 'Concept', technique: 'Technique', skill: 'Specific skill', representation: 'Representation' };
export function knowledgeKind(record: Pick<KnowledgeConcept, 'kind'>): KnowledgeKind { return record.kind ?? 'skill'; }
export function resolveKnowledgeId(id: string, aliases: Record<string, string>): string {
  const seen = new Set<string>();
  while (Object.hasOwn(aliases, id) && !seen.has(id)) { seen.add(id); id = aliases[id]; }
  return id;
}

/** Classification and component links guide teaching, never propagate assessment. */
export function componentIds(graph: KnowledgeGraph, parentId: string): string[] {
  const resolve = (id: string) => resolveKnowledgeId(id, graph.aliases);
  const result = new Set<string>();
  const visit = (parent: string) => {
    if (result.has(parent)) return;
    result.add(parent);
    for (const edge of graph.relationships) if (edge.active) {
      if (['part-of', 'uses'].includes(edge.kind) && resolve(edge.toId) === parent) visit(resolve(edge.fromId));
      if (edge.kind === 'specialization' && resolve(edge.fromId) === parent) visit(resolve(edge.toId));
    }
  };
  visit(resolve(parentId));
  return [...result];
}

export function topicIds(graph: KnowledgeGraph, recordId: string): string[] {
  const resolve = (id: string) => resolveKnowledgeId(id, graph.aliases);
  const result = new Set<string>(), visited = new Set<string>();
  const visit = (child: string) => {
    if (visited.has(child)) return;
    visited.add(child);
    for (const edge of graph.relationships) if (edge.active && ['part-of', 'uses'].includes(edge.kind) && resolve(edge.fromId) === child) {
      const parent = resolve(edge.toId);
      if (knowledgeKind(graph.concepts.find(item => item.id === parent) ?? {}) === 'topic') result.add(parent);
      visit(parent);
    }
  };
  visit(resolve(recordId));
  return [...result];
}

/** Choose a reusable explanation for a narrow assessment target. */
export function teachingAnchor(graph: KnowledgeGraph, recordId: string): KnowledgeConcept | undefined {
  const resolve = (id: string) => resolveKnowledgeId(id, graph.aliases);
  const record = graph.concepts.find(item => item.id === resolve(recordId));
  if (!record || knowledgeKind(record) === 'topic') return;
  if (knowledgeKind(record) !== 'skill') return record;
  for (const edge of graph.relationships) if (edge.active && edge.kind === 'uses' && resolve(edge.fromId) === record.id) {
    const parent = graph.concepts.find(item => item.id === resolve(edge.toId));
    if (parent && ['concept', 'technique'].includes(knowledgeKind(parent))) return parent;
  }
  return record;
}
