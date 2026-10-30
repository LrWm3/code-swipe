import { useState } from 'react';
import type { AppState, GuideConcept, KnowledgeConcept, KnowledgeKind } from './types';
import { KNOWLEDGE_KINDS } from './types';
import { contextLabel } from './learning-contexts';
import { KIND_LABELS, knowledgeKind, resolveKnowledgeId, teachingAnchor, topicIds } from './knowledge-organization';

export function KnowledgePanel({ state, pending, onGuide, onUndo }: { state: AppState; pending: boolean; onGuide: (concept: GuideConcept) => void; onUndo: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [context, setContext] = useState('');
  const [kind, setKind] = useState<KnowledgeKind | ''>('');
  const graph = state.knowledge;
  if (!graph) return null;
  const canonical = (id: string) => resolveKnowledgeId(id, graph.aliases);
  const aliasesFor = (id: string) => graph.concepts.filter(item => item.id !== id && canonical(item.id) === id).flatMap(item => [item.name, ...item.aliases]);
  const definitions = graph.concepts.filter(item => !Object.hasOwn(graph.aliases, item.id));
  const topics = definitions.filter(item => knowledgeKind(item) === 'topic');
  const order = { concept: 0, technique: 1, skill: 2, representation: 3, topic: 4 };
  const records = definitions.filter(item => knowledgeKind(item) !== 'topic').sort((left, right) => order[knowledgeKind(left)] - order[knowledgeKind(right)] || left.name.localeCompare(right.name));
  const label = (id: string) => graph.concepts.find(item => item.id === canonical(id))?.name ?? contextLabel(id, state.contexts);
  const memberships = new Map(records.map(item => [item.id, topicIds(graph, item.id)]));
  const filtered = records.filter(item => {
    const memory = state.conceptMemory?.find(record => record.id === item.id);
    const terms = `${item.name} ${item.description} ${item.domainTags.join(' ')} ${[...item.aliases, ...aliasesFor(item.id)].join(' ')} ${(memberships.get(item.id) ?? []).map(label).join(' ')}`;
    return (!kind || knowledgeKind(item) === kind) && terms.toLowerCase().includes(query.toLowerCase()) && (!context || Boolean(memory?.contextPractice?.[context]) || memory?.coverage?.contextIds.includes(context) || item.contextIds.includes(context) || graph.relationships.some(edge => edge.active && edge.kind === 'application' && canonical(edge.fromId) === item.id && edge.toId === context));
  });
  const undone = new Set(graph.history.flatMap(item => item.change.type === 'undo-merge' ? [item.change.mergeId] : []));
  const openGuide = (record: KnowledgeConcept, contextId: string) => {
    const target = teachingAnchor(graph, record.id);
    if (target) onGuide({ id: target.id, name: target.name, description: target.description, kind: knowledgeKind(target), contextId, ...(target.id !== record.id ? { practiceNames: [record.name] } : {}) });
  };
  const renderRecord = (concept: KnowledgeConcept) => {
    const record = state.conceptMemory?.find(item => item.id === concept.id);
    const aliases = aliasesFor(concept.id);
    const relationships = graph.relationships.filter(item => item.active && (canonical(item.fromId) === concept.id || (item.kind !== 'application' && canonical(item.toId) === concept.id)));
    return <details className="plain-details knowledge-record" key={concept.id} data-knowledge-id={concept.id}><summary><span className="knowledge-kind">{KIND_LABELS[knowledgeKind(concept)]}</span>{concept.name}<span className="knowledge-summary">{record?.summary ?? 'No direct assessment yet.'}</span></summary>
      <p>{concept.description}</p><p className="fine-print">{concept.scope === 'general' ? 'Applies across contexts' : `Specific to ${concept.contextIds.map(id => contextLabel(id, state.contexts)).join(', ')}`}{concept.domainTags.length ? ` · ${concept.domainTags.join(', ')}` : ''}</p>
      {(concept.aliases.length > 0 || aliases.length > 0) && <p className="fine-print">Also known as: {[...concept.aliases, ...aliases].join(', ')}</p>}
      {Boolean(record?.coverage?.answered) && <details className="plain-details"><summary>Related practice · {record!.coverage!.answered} answered cards</summary><p className="fine-print">Practice on these linked records supplies context for teaching. Direct familiarity stays on the records that were assessed.</p><ul>{record!.coverage!.recordIds.map(id => <li key={id}>{label(id)}</li>)}</ul></details>}
      {Object.values(record?.contextPractice ?? {}).map(practice => <div className="knowledge-practice" key={practice.contextId}><h4>{contextLabel(practice.contextId, state.contexts)} · {practice.familiarity}</h4><p className="fine-print">{practice.supporting} supporting · {practice.challenging} challenging · {practice.uncertainJudgments} IDK · {practice.exposures} encounters</p><p>{practice.uncertainty}</p><p><strong>Next probe:</strong> {practice.nextProbe}</p><button className="button compact quiet" disabled={pending} onClick={() => openGuide(concept, practice.contextId)}>Study guide</button>{practice.evidence.length > 0 && <details className="plain-details"><summary>Evidence</summary><ul>{practice.evidence.map(item => <li key={item.attemptId}>{item.title} · {item.answer === 'idk' ? 'IDK' : item.correct ? 'Right' : 'Wrong'} · {item.role} · {item.support}</li>)}</ul></details>}</div>)}
      {relationships.length > 0 && <details className="plain-details"><summary>Connections</summary><ul>{relationships.map(item => <li key={item.id}>{label(item.fromId)} → {label(item.toId)} · {item.kind}<p className="fine-print">{item.rationale}</p></li>)}</ul></details>}
      {!record?.exposures && <button className="button compact quiet" disabled={pending} onClick={() => openGuide(concept, context || concept.contextIds[0] || state.currentLesson?.contextIds?.[0] || state.currentLesson?.language || state.settings.preferredContexts?.[0] || record?.coverage?.contextIds[0] || 'javascript')}>Study guide</button>}
    </details>;
  };
  const ungrouped = filtered.filter(item => !memberships.get(item.id)?.length);
  return <details id="knowledge-record" className="panel knowledge-panel" data-testid="knowledge-panel"><summary>Knowledge & contexts · {topics.length} topics · {records.length} learning records</summary>
    <p className="fine-print">Topics organize concepts, techniques, specific skills, and representations. A record can belong to several topics. Evidence remains specific to the capability and context actually assessed.</p>
    <div className="knowledge-filters"><label>Search knowledge<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Topic, concept, skill, or alias" /></label><label>Context<select value={context} onChange={event => setContext(event.target.value)}><option value="">All contexts</option>{state.contexts?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Record type<select value={kind} onChange={event => setKind(event.target.value as KnowledgeKind | '')}><option value="">All learning records</option>{KNOWLEDGE_KINDS.filter(item => item !== 'topic').map(item => <option key={item} value={item}>{KIND_LABELS[item]}</option>)}</select></label></div>
    <div className="knowledge-concepts">{topics.map(topic => {
      const members = filtered.filter(item => memberships.get(item.id)?.includes(topic.id));
      if (!members.length) return null;
      const coverage = state.conceptMemory?.find(item => item.id === topic.id)?.coverage;
      return <details className="knowledge-topic" key={topic.id} open={Boolean(query || context || kind) || undefined} data-topic-id={topic.id}><summary>{topic.name}<span className="knowledge-summary">{members.length} linked records · {coverage?.answered ?? 0} answered cards in related practice</span></summary><p className="fine-print">{topic.description}</p><div className="knowledge-topic-records">{members.map(renderRecord)}</div></details>;
    })}{ungrouped.length > 0 && <section className="knowledge-ungrouped"><h3>{topics.length ? 'Not grouped yet' : 'Learning records'}</h3>{ungrouped.map(renderRecord)}</section>}{!filtered.length && <p className="muted">No matching knowledge records yet.</p>}</div>
    {graph.history.length > 0 && <details className="plain-details"><summary>Identity & relationship history</summary>{[...graph.history].reverse().map(item => <div className="knowledge-revision" key={item.id}>{item.change.type === 'merge' ? <><p>{label(item.change.fromId)} → {label(item.change.toId)}</p><p className="fine-print">{item.change.reason}</p>{undone.has(item.id) ? <span className="fine-print">Undone</span> : <button className="button compact quiet" disabled={pending} onClick={() => onUndo(item.id)}>Undo merge</button>}</> : item.change.type === 'undo-merge' ? <p className="fine-print">Merge undone · {item.createdAt}</p> : <p className="fine-print">Relationship revision: {label(item.change.relationship.fromId)} → {label(item.change.relationship.toId)} · {item.change.relationship.kind} · {item.change.relationship.active ? 'Active' : 'Retired'} · {item.change.relationship.rationale}</p>}</div>)}</details>}
  </details>;
}
