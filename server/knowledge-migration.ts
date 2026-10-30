import type { StoreData } from '../src/types.ts';
import { buildKnowledgeGraph } from './knowledge-graph.ts';

export function migrateKnowledge(data: StoreData, backupDirectory: string, at = new Date().toISOString()) {
  if (data.version >= 2) return { data, report: { needed: false, concepts: data.knowledgeSeed?.concepts.length ?? 0, lessons: data.lessons.length, attempts: data.attempts.length } };
  const graph = buildKnowledgeGraph(data);
  const updated: StoreData = { ...structuredClone(data), version: 2,
    settings: { ...data.settings, preferredContexts: data.settings.preferredContexts ?? [data.settings.language ?? 'javascript'], excludedContexts: data.settings.excludedContexts ?? [] },
    knowledgeSeed: { concepts: graph.concepts, contexts: graph.contexts, relationships: graph.relationships }, graphRevisions: graph.relationships.map((relationship, index) => ({ id: `migration-relationship-${index}`, createdAt: at, source: 'migration' as const, change: { type: 'relationship' as const, relationship } })),
    migration: { fromVersion: 1, at, backupDirectory } };
  return { data: updated, report: { needed: true, concepts: graph.concepts.length, contexts: graph.contexts.length, relationships: graph.relationships.length, lessons: data.lessons.length, attempts: data.attempts.length, backupDirectory } };
}
