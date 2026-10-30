import { useState } from 'react';
import type { AppState, GuideConcept } from './types';
import { contextLabel } from './learning-contexts';

export function KnowledgePanel({ state, pending, onGuide, onUndo }: { state: AppState; pending: boolean; onGuide: (concept: GuideConcept) => void; onUndo: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [context, setContext] = useState('');
  const graph = state.knowledge;
  if (!graph) return null;
  const canonical = (id: string) => { const seen = new Set<string>(); while (Object.hasOwn(graph.aliases, id) && !seen.has(id)) { seen.add(id); id = graph.aliases[id]; } return id; };
  const aliasesFor = (id: string) => graph.concepts.filter(item => item.id !== id && canonical(item.id) === id).flatMap(item => [item.name, ...item.aliases]);
  const concepts = graph.concepts.filter(item => !Object.hasOwn(graph.aliases, item.id));
  const label = (id: string) => graph.concepts.find(item => item.id === id)?.name ?? contextLabel(id, state.contexts);
  const filtered = concepts.filter(item => `${item.name} ${item.description} ${item.domainTags.join(' ')} ${[...item.aliases, ...aliasesFor(item.id)].join(' ')}`.toLowerCase().includes(query.toLowerCase()) && (!context || Boolean(state.conceptMemory?.find(record => record.id === item.id)?.contextPractice?.[context]) || item.contextIds.includes(context) || graph.relationships.some(edge => edge.active && edge.kind === 'application' && canonical(edge.fromId) === item.id && edge.toId === context)));
  const undone = new Set(graph.history.flatMap(item => item.change.type === 'undo-merge' ? [item.change.mergeId] : []));
  return <details id="knowledge-record" className="panel knowledge-panel" data-testid="knowledge-panel"><summary>Knowledge & contexts · {concepts.length} concepts</summary>
    <p className="fine-print">Evidence belongs to the context where you used a skill. Relationships suggest directions; they do not establish understanding.</p>
    <div className="knowledge-filters"><label>Search concepts<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Concept, alias, or domain" /></label><label>Context<select value={context} onChange={event => setContext(event.target.value)}><option value="">All contexts</option>{state.contexts?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
    <div className="knowledge-concepts">{filtered.map(concept => {
      const record = state.conceptMemory?.find(item => item.id === concept.id);
      const aliases = aliasesFor(concept.id);
      const relationships = graph.relationships.filter(item => item.active && (canonical(item.fromId) === concept.id || (item.kind !== 'application' && canonical(item.toId) === concept.id)));
      return <details className="plain-details" key={concept.id}><summary>{concept.name}<span className="knowledge-summary">{record?.summary ?? 'No answered evidence yet.'}</span></summary>
        <p>{concept.description}</p><p className="fine-print">{concept.scope === 'general' ? 'General concept' : `Specific to ${concept.contextIds.map(id => contextLabel(id, state.contexts)).join(', ')}`}{concept.domainTags.length ? ` · ${concept.domainTags.join(', ')}` : ''}</p>
        {(concept.aliases.length > 0 || aliases.length > 0) && <p className="fine-print">Also known as: {[...concept.aliases, ...aliases].join(', ')}</p>}
        {Object.values(record?.contextPractice ?? {}).map(practice => <div className="knowledge-practice" key={practice.contextId}><h4>{contextLabel(practice.contextId, state.contexts)} · {practice.familiarity}</h4><p className="fine-print">{practice.supporting} supporting · {practice.challenging} challenging · {practice.uncertainJudgments} IDK · {practice.exposures} encounters</p><p>{practice.uncertainty}</p><p><strong>Next probe:</strong> {practice.nextProbe}</p><button className="button compact quiet" disabled={pending} onClick={() => onGuide({ id: concept.id, name: concept.name, description: concept.description, contextId: practice.contextId })}>Concept guide</button>{practice.evidence.length > 0 && <details className="plain-details"><summary>Evidence</summary><ul>{practice.evidence.map(item => <li key={item.attemptId}>{item.title} · {item.answer === 'idk' ? 'IDK' : item.correct ? 'Right' : 'Wrong'} · {item.role} · {item.support}</li>)}</ul></details>}</div>)}
        {relationships.length > 0 && <div><h4>Relationships</h4><ul>{relationships.map(item => <li key={item.id}>{label(item.fromId)} → {label(item.toId)} · {item.kind}<p className="fine-print">{item.rationale}</p></li>)}</ul></div>}
        {!record?.exposures && <button className="button compact quiet" disabled={pending} onClick={() => onGuide({ id: concept.id, name: concept.name, description: concept.description, contextId: concept.contextIds[0] ?? state.settings.preferredContexts?.[0] ?? 'javascript' })}>Concept guide</button>}
      </details>;
    })}{!filtered.length && <p className="muted">No matching concepts yet.</p>}</div>
    {graph.history.length > 0 && <details className="plain-details"><summary>Identity & relationship history</summary>{[...graph.history].reverse().map(item => <div className="knowledge-revision" key={item.id}>{item.change.type === 'merge' ? <><p>{label(item.change.fromId)} → {label(item.change.toId)}</p><p className="fine-print">{item.change.reason}</p>{undone.has(item.id) ? <span className="fine-print">Undone</span> : <button className="button compact quiet" disabled={pending} onClick={() => onUndo(item.id)}>Undo merge</button>}</> : item.change.type === 'undo-merge' ? <p className="fine-print">Merge undone · {item.createdAt}</p> : <p className="fine-print">Relationship revision: {label(item.change.relationship.fromId)} → {label(item.change.relationship.toId)} · {item.change.relationship.kind} · {item.change.relationship.active ? 'Active' : 'Retired'} · {item.change.relationship.rationale}</p>}</div>)}</details>}
  </details>;
}
