import { createHash } from 'node:crypto';
import type { Attempt, ProposedQuestion, SkillEvidence, SkillRetrofit, SkillUse, StoreData } from '../src/types.ts';

export function archiveHash(data: StoreData): string {
  return createHash('sha256').update(JSON.stringify({ lessons: data.lessons, attempts: data.attempts,
    feedback: data.feedback ?? [], discussions: data.discussions ?? [], skillRetrofits: data.skillRetrofits ?? [] })).digest('hex');
}

export function validateSkillUses(value: unknown, targets?: string[], prerequisites: string[] = []): asserts value is SkillUse[] {
  if (!Array.isArray(value) || !value.length || value.length > 12) throw new Error('skillUses requires 1–12 explicit skill roles.');
  const seen = new Set<string>();
  for (const use of value) {
    if (!use || typeof use !== 'object' || Object.keys(use).sort().join(',') !== 'conceptId,ifCorrect,ifIncorrect,rationale,role,support'
      || !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(use.conceptId)
      || !['target', 'exercised', 'incidental'].includes(use.role) || !['independent', 'scaffolded'].includes(use.support)
      || !['supports', 'inconclusive'].includes(use.ifCorrect) || !['challenges', 'inconclusive'].includes(use.ifIncorrect)
      || typeof use.rationale !== 'string' || !use.rationale.trim() || use.rationale.length > 1000) throw new Error('Invalid skillUses entry.');
    if (seen.has(use.conceptId)) throw new Error('skillUses must not repeat a concept.');
    seen.add(use.conceptId);
    if (use.role === 'incidental' && use.ifCorrect !== 'inconclusive') throw new Error('Incidental skills cannot receive supporting evidence.');
    if (use.role !== 'target' && use.ifIncorrect !== 'inconclusive') throw new Error('A composite failure cannot challenge supporting or incidental skills.');
    if (targets && (use.role === 'target') !== targets.includes(use.conceptId)) throw new Error('skillUses target roles must match conceptIds.');
  }
  if ([...(targets ?? []), ...prerequisites].some(id => !seen.has(id))) throw new Error('skillUses must cover every target and listed prerequisite.');
  if (value.filter(use => use.ifIncorrect === 'challenges').length > 1) throw new Error('One binary failure cannot independently challenge multiple skills.');
}

export function questionSkills(question: ProposedQuestion, retrofit?: SkillRetrofit['questions'][number]): { use: SkillUse; source: SkillEvidence['source'] }[] {
  if (question.plan?.skillUses) return question.plan.skillUses.map(use => ({ use, source: 'planned' }));
  if (retrofit) return retrofit.uses.map(use => ({ use: { ...use, rationale: `${use.rationale} Retrospective review: ${retrofit.note}` }, source: 'retrospective' }));
  // Old target tags preserve encounter history, not proof of using every tagged skill.
  return [...new Set([...(question.plan?.conceptIds ?? []), ...(question.plan?.prerequisiteIds ?? [])])].map(conceptId => ({
    use: { conceptId, role: question.plan?.conceptIds.includes(conceptId) ? 'target' : 'incidental', support: 'scaffolded',
      ifCorrect: 'inconclusive', ifIncorrect: 'inconclusive', rationale: 'Legacy tag; how this answer bears on this skill has not been reviewed.' }, source: 'legacy',
  }));
}

export function interpretSkill(use: SkillUse, source: SkillEvidence['source'], attempt: Attempt): SkillEvidence {
  return { role: use.role, support: use.support, source, rationale: use.rationale,
    signal: attempt.flagged || attempt.correct === null || source === 'legacy' || use.role === 'incidental' ? 'inconclusive'
      : attempt.correct ? use.ifCorrect : use.role === 'target' ? use.ifIncorrect : 'inconclusive' };
}

export function supportingEvidence(evidence: Partial<SkillEvidence> & { correct?: boolean | null }): boolean {
  return evidence.correct !== false && evidence.correct !== null && evidence.signal === 'supports' && (evidence.role === 'target' || evidence.role === 'exercised');
}

export function independentSupport(evidence: Partial<SkillEvidence> & { correct?: boolean | null }): boolean {
  return supportingEvidence(evidence) && evidence.support === 'independent';
}

export function familiaritySupport(evidence: Partial<SkillEvidence> & { correct?: boolean | null }): boolean {
  // Retrospective interpretation helps planning, but is not a precommitted assessment.
  return supportingEvidence(evidence) && evidence.source === 'planned';
}

export function validateRetrofit(retrofit: SkillRetrofit, data: StoreData, checkArchive = true): void {
  if (!retrofit || typeof retrofit.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(retrofit.id)
    || !Number.isFinite(Date.parse(retrofit.createdAt)) || typeof retrofit.method !== 'string' || !retrofit.method.trim()
    || !/^[a-f0-9]{64}$/.test(retrofit.archiveHash) || !Array.isArray(retrofit.concepts) || !Array.isArray(retrofit.questions) || !retrofit.questions.length) throw new Error('Invalid skill retrofit.');
  if (checkArchive && retrofit.archiveHash !== archiveHash(data)) throw new Error('The archive changed after review; review the new answers and feedback before importing.');
  // Later lessons may legitimately refine a definition introduced by this review.
  const definitions = new Map(data.lessons.filter(lesson => Date.parse(lesson.createdAt) <= Date.parse(retrofit.createdAt))
    .flatMap(lesson => lesson.curriculum?.conceptUpdates ?? []).map(concept => [concept.id, concept]));
  for (const earlier of data.skillRetrofits ?? []) for (const concept of earlier.concepts) if (!definitions.has(concept.id)) definitions.set(concept.id, { ...concept, familiarity: 'unknown', evidenceAttemptIds: [], uncertainty: '', nextProbe: '' });
  const ids = new Set<string>();
  for (const concept of retrofit.concepts) {
    if (!concept || !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(concept.id) || ids.has(concept.id)
      || ![concept.name, concept.description].every(item => typeof item === 'string' && item.trim())
      || !Array.isArray(concept.representations) || !concept.representations.length || !concept.representations.every(item => typeof item === 'string' && item.trim())
      || !Array.isArray(concept.prerequisiteIds) || !concept.prerequisiteIds.every(item => typeof item === 'string')) throw new Error('Invalid retrofit concept definition.');
    ids.add(concept.id);
    if (definitions.has(concept.id)) throw new Error(`Retrofit cannot redefine existing concept ${concept.id}.`);
    definitions.set(concept.id, { ...concept, familiarity: 'unknown', evidenceAttemptIds: [], uncertainty: '', nextProbe: '' });
  }
  const visited = new Set<string>();
  function visit(id: string, path = new Set<string>()): void {
    if (path.has(id)) throw new Error('Retrofit prerequisite cycle.');
    if (visited.has(id)) return;
    const definition = definitions.get(id);
    if (!definition) throw new Error(`Unknown retrofit concept ${id}.`);
    for (const next of definition.prerequisiteIds) visit(next, new Set([...path, id]));
    visited.add(id);
  }
  for (const id of definitions.keys()) visit(id);
  const seen = new Set((data.skillRetrofits ?? []).flatMap(item => item.questions.map(question => question.exerciseId)));
  for (const entry of retrofit.questions) {
    const lesson = data.lessons.find(item => item.id === entry.lessonId);
    const question = lesson?.questions.find(item => item.id === entry.exerciseId);
    if (!lesson || !question || lesson.predictionHash !== entry.predictionHash || seen.has(entry.exerciseId)
      || question.plan?.skillUses || !data.attempts.some(item => item.lessonId === entry.lessonId && item.exerciseId === entry.exerciseId)
      || typeof entry.note !== 'string' || !entry.note.trim() || entry.note.length > 2000) throw new Error('Retrofit requires a unique answered legacy question, matching commitment, and review note.');
    seen.add(entry.exerciseId);
    validateSkillUses(entry.uses);
    const useIds = new Set(entry.uses.map(use => use.conceptId));
    if ([...(question.plan?.conceptIds ?? []), ...(question.plan?.prerequisiteIds ?? [])].some(id => !useIds.has(id))) throw new Error('Retrofit must preserve original target and prerequisite encounters.');
    for (const use of entry.uses) if (!definitions.has(use.conceptId)) throw new Error(`Undefined retrofit skill ${use.conceptId}.`);
  }
}
