import type { TutorContext } from '../src/types.ts';
import { canonicalId } from './knowledge-graph.ts';
import { knowledgeKind } from '../src/knowledge-organization.ts';

/** Supply a relevant neighborhood plus older alternatives, within a byte budget. */
export function selectPlanningKnowledge(context: TutorContext) {
  const graph = context.knowledge!;
  const memory = context.curriculum?.concepts ?? [];
  const terms = (`${context.settings.interests} ${context.learningPlan?.goal ?? ''} ${context.learningPlan?.step.objective ?? ''}`.toLowerCase().match(/[a-z][a-z0-9_]{3,}/g) ?? []).filter(term => !['with', 'from', 'that', 'this', 'want', 'more', 'learn', 'about', 'questions'].includes(term));
  const score = (id: string) => {
    const concept = graph.concepts.find(item => item.id === id)!;
    const record = memory.find(item => item.id === id);
    const text = `${concept.name} ${concept.description} ${concept.domainTags.join(' ')}`.toLowerCase();
    return (context.focus?.concept.id === id ? 1000 : 0) + terms.filter(term => text.includes(term)).length * 12
      + Object.keys(record?.contextPractice ?? {}).filter(id => context.settings.preferredContexts?.includes(id)).length * 4
      + (!record?.exposures && !record?.coverage?.answered && knowledgeKind(concept) !== 'topic' ? 3 : 0);
  };
  const canonical = graph.concepts.filter(item => canonicalId(item.id, graph.aliases) === item.id);
  const ranked = [...canonical].sort((a, b) => score(b.id) - score(a.id));
  const selected = new Set(ranked.slice(0, 40).map(item => item.id));
  // Keep older, less-recently exercised alternatives visible even with a long history.
  const oldest = [...memory].sort((a, b) => Date.parse(a.practice?.lastExercisedAt ?? '1970-01-01') - Date.parse(b.practice?.lastExercisedAt ?? '1970-01-01'));
  oldest.slice(0, 12).forEach(item => selected.add(item.id));
  for (const edge of graph.relationships) if (edge.active && (selected.has(edge.fromId) || selected.has(edge.toId))) {
    if (selected.size < 80) selected.add(edge.fromId);
    if (edge.kind !== 'application' && selected.size < 80) selected.add(edge.toId);
  }
  const bounded: ReturnType<typeof selectRecord>[] = [];
  let bytes = 0;
  for (const record of memory.filter(item => selected.has(item.id)).sort((a, b) => score(b.id) - score(a.id))) {
    const item = selectRecord(record);
    const size = Buffer.byteLength(JSON.stringify(item));
    if (bytes + size <= 110_000) { bounded.push(item); bytes += size; }
  }
  // The compact index prevents duplication of an identity outside the selected neighborhood.
  const conceptIndex = canonical.map(({ id, name, kind, scope, contextIds, aliases, domainTags }) => ({ id, name, kind: kind ?? 'skill', scope, contextIds, aliases, domainTags }));
  return { graph: { ...graph, concepts: graph.concepts.filter(item => selected.has(canonicalId(item.id, graph.aliases))), relationships: graph.relationships.filter(item => selected.has(item.fromId) && (item.kind === 'application' || selected.has(item.toId))), history: graph.history.slice(-20) }, memory: bounded, conceptIndex };
}

function selectRecord(record: NonNullable<TutorContext['curriculum']>['concepts'][number]) {
  return { id: record.id, name: record.name, kind: record.definition?.kind ?? 'skill', summary: record.summary, coverage: record.coverage, practice: record.practice, contextPractice: record.contextPractice };
}
