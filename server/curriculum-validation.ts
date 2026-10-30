import type { ConceptUpdate, ProposedLesson, ProposedQuestion, QuestionPlan, TutorContext } from '../src/types.ts';
import { questionSkills, interpretSkill, supportingEvidence, familiaritySupport, validateSkillUses } from './skill-evidence.ts';
import { canonicalId } from './knowledge-graph.ts';

export class CurriculumValidationError extends Error {
  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`);
    this.name = 'CurriculumValidationError';
  }
}

function reject(path: string, detail: string): never {
  throw new CurriculumValidationError(path, detail);
}

function normalized(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function identifier(value: string, path: string): void {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(value)) reject(path, 'use a stable ID of at most 80 letters, numbers, underscores, or hyphens, starting with a letter.');
}

function unique(values: string[], path: string): void {
  if (new Set(values).size !== values.length) reject(path, 'must not repeat entries.');
}

function sameSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every(value => right.includes(value));
}

interface Evidence {
  lessonId: string;
  correct: boolean | null;
  conceptIds: Set<string>;
  legacy: boolean;
  supportingIds: Set<string>;
  familiarIds: Set<string>;
}

interface PriorState {
  evidence: Map<string, Evidence>;
  exposed: Set<string>;
  families: Map<string, { conceptIds: string[]; asked: boolean }>;
}

function priorState(context: TutorContext): PriorState {
  const state: PriorState = { evidence: new Map(), exposed: new Set(), families: new Map() };
  if (context.settings.tutorMode === 'baseline') return state;
  const seenAttempts = new Set<string>();
  const excludedAttempts = new Set<string>();
  const retrofits = new Map((context.skillRetrofits ?? []).flatMap(item => item.questions.map(entry => [entry.exerciseId, entry] as const)));
  const resolve = (id: string) => canonicalId(id, context.knowledge?.aliases);
  for (const { lesson, attempts } of context.history) {
    for (const question of lesson.questions) {
      if (!question.plan) continue;
      const previous = state.families.get(question.plan.familyId);
      state.families.set(question.plan.familyId, { conceptIds: [...new Set(question.plan.conceptIds.map(resolve))], asked: previous?.asked ?? false });
    }
    for (const attempt of attempts) {
      seenAttempts.add(attempt.id);
      const question = lesson.questions.find(item => item.id === attempt.exerciseId);
      if (attempt.lessonId !== lesson.id || !question) {
        excludedAttempts.add(attempt.id);
        continue;
      }
      const skills = questionSkills(question, retrofits.get(question.id)).map(({ use, source }) => ({ id: resolve(use.conceptId), ...interpretSkill(use, source, attempt) }));
      for (const skill of skills) state.exposed.add(skill.id);
      if (question.plan) state.families.set(question.plan.familyId, { conceptIds: [...new Set(question.plan.conceptIds.map(resolve))], asked: true });
      if (attempt.flagged) {
        excludedAttempts.add(attempt.id);
        continue;
      }
      state.evidence.set(attempt.id, {
        lessonId: lesson.id,
        correct: attempt.answer === 'idk' ? null : attempt.correct,
        conceptIds: new Set(skills.map(skill => skill.id)),
        legacy: !question.plan,
        supportingIds: new Set(skills.filter(supportingEvidence).map(skill => skill.id)),
        familiarIds: new Set(skills.filter(familiaritySupport).map(skill => skill.id)),
      });
    }
  }
  for (const concept of context.curriculum?.concepts ?? []) {
    if (concept.exposures > 0 || concept.evidence.length > 0) state.exposed.add(concept.id);
    for (const evidence of concept.evidence) {
      // Recent raw attempts override memory, especially exclusions and original concept tags.
      if (seenAttempts.has(evidence.attemptId)) continue;
      const previous = state.evidence.get(evidence.attemptId);
      if (previous && (previous.lessonId !== evidence.lessonId || previous.correct !== evidence.correct)) {
        excludedAttempts.add(evidence.attemptId);
        continue;
      }
      if (previous) {
        previous.conceptIds.add(concept.id);
        if (supportingEvidence(evidence)) previous.supportingIds.add(concept.id);
        if (familiaritySupport(evidence)) previous.familiarIds.add(concept.id);
      }
      else state.evidence.set(evidence.attemptId, {
        lessonId: evidence.lessonId,
        correct: evidence.answer === 'idk' ? null : evidence.correct,
        conceptIds: new Set([concept.id]),
        legacy: false,
        supportingIds: new Set(supportingEvidence(evidence) ? [concept.id] : []),
        familiarIds: new Set(familiaritySupport(evidence) ? [concept.id] : []),
      });
    }
  }
  for (const family of context.curriculum?.variants ?? []) {
    const previous = state.families.get(family.familyId);
    state.families.set(family.familyId, { conceptIds: family.conceptIds, asked: family.askedCount > 0 || previous?.asked === true });
  }
  for (const id of excludedAttempts) state.evidence.delete(id);
  return state;
}

// Preserve strings and operators while removing formatting and comments. This
// catches cosmetically changed references without equating different literals.
function codeTokens(source: string, entryName: string): string[] {
  const python = /^\s*def\s+\w+\s*\(/m.test(source);
  if (python) {
    // Ignore the required leading docstring, but preserve ordinary literals and //.
    const withoutDocstring = source.replace(/(\bdef\s+\w+\s*\([^\n]*\)[^\n]*:\s*\n[ \t]*)(?:"""[\s\S]*?"""|'''[\s\S]*?''')/, '$1');
    return (withoutDocstring.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[^\r\n]*|\w+|\/\/|\*\*|==|!=|<=|>=|[^\s]/g) ?? [])
      .filter(token => !token.startsWith('#'))
      .map((token, index, tokens) => token === entryName && tokens[index - 1] === 'def' ? '$entry' : token);
  }
  return (source.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|[$\w]+|===|!==|=>|==|!=|<=|>=|\+\+|--|&&|\|\||\?\?|\*\*|[^\s]/g) ?? [])
    .filter(token => !token.startsWith('//') && !token.startsWith('/*'))
    .map((token, index, tokens) => token === entryName && ['function', 'fn'].includes(tokens[index - 1]) ? '$entry' : token);
}

function overlap(left: string[], right: string[]): number {
  const counts = new Map<string, number>();
  for (const item of left) counts.set(item, (counts.get(item) ?? 0) + 1);
  let shared = 0;
  for (const item of right) {
    const count = counts.get(item) ?? 0;
    if (count > 0) { shared++; counts.set(item, count - 1); }
  }
  return 2 * shared / (left.length + right.length || 1);
}

export function mirrors(left: ProposedQuestion, right: ProposedQuestion): boolean {
  const specification = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  if (specification(left.specification) === specification(right.specification)) return true;
  if (left.kind === 'answer-review' || right.kind === 'answer-review') return left.kind === right.kind && specification(left.referenceAnswer ?? '') === specification(right.referenceAnswer ?? '') && Boolean(left.referenceAnswer?.trim());
  const leftTokens = codeTokens(left.referenceCode, left.signature?.name ?? 'solve');
  const rightTokens = codeTokens(right.referenceCode, right.signature?.name ?? 'solve');
  if (leftTokens.join('\0') === rightTokens.join('\0')) return true;
  // Near-duplicate detection is deliberately limited to substantial code with
  // matching targets and nearly identical wording. Tiny functions are too generic.
  if (!left.plan || !right.plan || Math.min(leftTokens.length, rightTokens.length) < 48 || !sameSet(left.plan.conceptIds, right.plan.conceptIds)) return false;
  if (overlap(normalized(left.specification).split(' '), normalized(right.specification).split(' ')) < 0.85) return false;
  const bigrams = (tokens: string[]) => tokens.slice(1).map((token, index) => `${tokens[index]}\0${token}`);
  return overlap(bigrams(leftTokens), bigrams(rightTokens)) >= 0.96;
}

function suppliedScaffolding(question: ProposedQuestion, concept: ConceptUpdate): boolean {
  const scaffold = normalized(question.plan!.scaffolding);
  if (scaffold.length < 24 || scaffold.split(' ').length < 5 || /^(none|no scaffolding|not needed|unnecessary)\b/.test(scaffold)) return false;
  const names = [normalized(concept.id), normalized(concept.name)];
  if (!names.some(name => scaffold.includes(name))) return false;
  // The hidden plan must point to support actually supplied on the visible card.
  const visible = normalized(`${question.specification}\n${question.code}`);
  return names.some(name => visible.includes(name));
}

/** Semantic checks run after the closed lesson schema has checked field shapes. */
export function validateCurriculum(lesson: ProposedLesson, context: TutorContext): void {
  if (!lesson.curriculum) reject('curriculum', 'is required for every new lesson.');
  const curriculum = lesson.curriculum;
  const contextual = Boolean(curriculum.knowledge);
  const baseline = context.settings.tutorMode === 'baseline';
  const prior = priorState(context);
  const familyConflicts = lesson.questions.flatMap((question, index) => {
    const plan = question.plan;
    const family = plan && prior.families.get(plan.familyId);
    return plan && family && !sameSet(family.conceptIds, plan.conceptIds)
      ? [`questions[${index}] ${plan.familyId}: existing [${family.conceptIds.join(', ')}], proposed [${plan.conceptIds.join(', ')}]`] : [];
  });
  if (familyConflicts.length) reject('questions.plan.familyId', `an existing family must retain its conceptIds. Repair every conflict: ${familyConflicts.join('; ')}.`);
  const known = new Map((baseline ? [] : context.curriculum?.concepts ?? []).map(concept => [concept.id, concept]));
  const definitions = new Map<string, ConceptUpdate>(known);
  const updates = new Map<string, ConceptUpdate>();
  const names = new Map<string, string>();
  for (const concept of known.values()) names.set(normalized(concept.name), concept.id);
  for (let index = 0; index < curriculum.conceptUpdates.length; index++) {
    const concept = curriculum.conceptUpdates[index];
    const path = `curriculum.conceptUpdates[${index}]`;
    identifier(concept.id, `${path}.id`);
    if (updates.has(concept.id)) reject(`${path}.id`, 'must be unique in this lesson.');
    const name = normalized(concept.name);
    if (!name) reject(`${path}.name`, 'must describe a concept.');
    if (!contextual && known.has(concept.id) && normalized(known.get(concept.id)!.name) !== name) reject(`${path}.name`, 'retain the existing normalized concept name and ID; revise the description without erasing prior identity.');
    const previousId = names.get(name);
    if (!contextual && previousId && previousId !== concept.id) reject(`${path}.id`, `reuse existing concept ID "${previousId}" for this normalized name; renaming cannot erase prior exposure.`);
    names.set(name, concept.id);
    updates.set(concept.id, concept);
    definitions.set(concept.id, concept);
  }

  function references(ids: string[], path: string): void {
    unique(ids, path);
    for (const id of ids) {
      identifier(id, path);
      if (!definitions.has(id)) reject(path, `concept "${id}" needs a conceptUpdate or an existing curriculum memory definition.`);
    }
  }

  for (const [id, concept] of definitions) {
    const index = curriculum.conceptUpdates.findIndex(update => update.id === id);
    const path = index < 0 ? `curriculum.memory.${id}` : `curriculum.conceptUpdates[${index}]`;
    references(concept.prerequisiteIds, `${path}.prerequisiteIds`);
    if (concept.prerequisiteIds.includes(id)) reject(`${path}.prerequisiteIds`, 'a concept cannot be its own prerequisite.');
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) reject('curriculum.conceptUpdates', `prerequisite cycle includes "${id}".`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const prerequisite of definitions.get(id)!.prerequisiteIds) visit(prerequisite);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of definitions.keys()) visit(id);

  for (let index = 0; index < curriculum.conceptUpdates.length; index++) {
    const concept = curriculum.conceptUpdates[index];
    const path = `curriculum.conceptUpdates[${index}]`;
    unique(concept.evidenceAttemptIds, `${path}.evidenceAttemptIds`);
    if (baseline && (concept.evidenceAttemptIds.length || concept.familiarity !== 'unknown')) reject(path, 'baseline concepts must remain unknown without learner evidence.');
    const evidence = concept.evidenceAttemptIds.map(id => {
      const found = prior.evidence.get(id);
      if (!found) reject(`${path}.evidenceAttemptIds`, `attempt "${id}" is not a real unflagged supplied historical or memory attempt.`);
      if (!found.conceptIds.has(concept.id) && !found.legacy) reject(`${path}.evidenceAttemptIds`, `attempt "${id}" is not linked to concept "${concept.id}".`);
      prior.exposed.add(concept.id);
      return found;
    });
    if (concept.familiarity !== 'unknown' && !evidence.length) reject(`${path}.familiarity`, 'introduced, developing, and familiar claims require cited prior evidence; otherwise use unknown.');
    if (concept.familiarity === 'familiar') {
      const correct = evidence.filter(item => item.familiarIds.has(concept.id));
      if (correct.length < 3 || new Set(correct.map(item => item.lessonId)).size < 2) reject(`${path}.familiarity`, 'familiar requires at least 3 cited correct judgments with planned supporting evidence across at least 2 previous lessons. Scaffolded evidence still reflects the support provided.');
    }
  }

  if (baseline && curriculum.observations.length) reject('curriculum.observations', 'baseline lessons cannot contain learner-history observations.');
  if (prior.evidence.size > 0 && !curriculum.observations.length) reject('curriculum.observations', 'include at least one grounded observation from prior unflagged answers.');
  for (let index = 0; index < curriculum.observations.length; index++) {
    const observation = curriculum.observations[index];
    const path = `curriculum.observations[${index}]`;
    references(observation.conceptIds, `${path}.conceptIds`);
    unique(observation.attemptIds, `${path}.attemptIds`);
    if (!observation.attemptIds.length) reject(`${path}.attemptIds`, 'an observation requires a real prior attempt.');
    const evidence = observation.attemptIds.map(id => {
      const found = prior.evidence.get(id);
      if (!found) reject(`${path}.attemptIds`, `attempt "${id}" is not a real unflagged supplied historical or memory attempt.`);
      return found;
    });
    // Legacy cards have no original concept tags. An explicit current definition
    // may annotate an observation tentatively, but cannot prove familiarity.
    const linked = (entry: Evidence, id: string) => entry.conceptIds.has(id) || (entry.legacy && updates.has(id));
    if (observation.conceptIds.some(id => !evidence.some(entry => linked(entry, id))) || evidence.some(entry => !observation.conceptIds.some(id => linked(entry, id)))) {
      reject(path, 'every observation concept and attempt must be linked; legacy attempts require an explicit conceptUpdate.');
    }
    for (const id of observation.conceptIds) prior.exposed.add(id);
    if (normalized(observation.observation) === normalized(observation.interpretation)) reject(`${path}.interpretation`, 'separate observed answers from tentative explanations.');
  }

  const purposes = new Set<string>();
  const targets = new Set<string>();
  const earlier = new Set<string>();
  const missingPrerequisites: string[] = [];
  const families = new Map<string, number[]>();
  const stageOrder = { warmup: 0, build: 1, stretch: 2, consolidate: 3 };
  let previous: QuestionPlan | undefined;
  let warmups = 0;
  let hasBuild = false;
  for (let index = 0; index < lesson.questions.length; index++) {
    const question = lesson.questions[index];
    const path = `questions[${index}].plan`;
    if (!question.plan) reject(path, 'is required for every new question.');
    const plan = question.plan;
    references(plan.conceptIds, `${path}.conceptIds`);
    references(plan.prerequisiteIds, `${path}.prerequisiteIds`);
    if (!plan.conceptIds.length) reject(`${path}.conceptIds`, 'target at least one defined concept.');
    try { validateSkillUses(plan.skillUses, plan.conceptIds, plan.prerequisiteIds); }
    catch (error) { reject(`${path}.skillUses`, (error as Error).message); }
    references(plan.skillUses!.map(use => use.conceptId), `${path}.skillUses`);
    unique(plan.purposes, `${path}.purposes`);
    if (!plan.purposes.includes(question.purpose)) reject(`${path}.purposes`, 'must include the primary question purpose.');
    for (const purpose of plan.purposes) purposes.add(purpose);
    for (const id of plan.conceptIds) targets.add(id);
    identifier(plan.familyId, `${path}.familyId`);
    const family = prior.families.get(plan.familyId);
    if (family && !sameSet(family.conceptIds, plan.conceptIds)) reject(`${path}.familyId`, 'an existing family must retain its conceptIds.');
    families.set(plan.familyId, [...families.get(plan.familyId) ?? [], index]);
    if (!Number.isInteger(plan.cognitiveDemand) || plan.cognitiveDemand < 1 || plan.cognitiveDemand > 5) reject(`${path}.cognitiveDemand`, 'must be an integer from 1 to 5.');
    if (index === 0 && (plan.stage !== 'warmup' || plan.cognitiveDemand > 2)) reject(path, 'begin with an approachable warmup at cognitiveDemand 1 or 2.');
    if (previous && stageOrder[plan.stage] < stageOrder[previous.stage]) reject(`${path}.stage`, 'stages must progress warmup -> build -> optional stretch -> consolidate.');
    const contextSwitch = contextual && index > 0 && question.contextId !== lesson.questions[index - 1].contextId;
    if (previous && plan.stage !== 'consolidate' && ((!contextSwitch && plan.cognitiveDemand < previous.cognitiveDemand) || plan.cognitiveDemand > previous.cognitiveDemand + 1)) reject(`${path}.cognitiveDemand`, 'before consolidation, demand cannot decrease within one context and can increase by at most 1; a context switch may lower demand for a bridge.');
    if (contextSwitch && normalized(plan.difficultyRationale).split(' ').length < 6) reject(`${path}.difficultyRationale`, 'explain the context switch and its cognitive demand.');
    if (contextual && normalized(plan.scaffolding).split(' ').length < 5) reject(`${path}.scaffolding`, 'explain preparation, support, diagnostic intent, or why exploration is reasonable.');
    if (previous && plan.stage === 'consolidate' && plan.cognitiveDemand > previous.cognitiveDemand) reject(`${path}.cognitiveDemand`, 'consolidation must maintain or lower the preceding demand.');
    if (plan.stage === 'warmup') warmups++;
    if (plan.stage === 'build') hasBuild = true;
    if (plan.stage === 'stretch') {
      if (index < Math.ceil(lesson.questions.length / 2) || plan.cognitiveDemand < 3) reject(path, 'stretch belongs in the second half with cognitiveDemand at least 3.');
      const prerequisites = new Set(plan.prerequisiteIds);
      function gather(id: string): void {
        for (const prerequisite of definitions.get(id)!.prerequisiteIds) {
          if (prerequisites.has(prerequisite)) continue;
          prerequisites.add(prerequisite);
          gather(prerequisite);
        }
      }
      for (const id of [...plan.conceptIds, ...plan.prerequisiteIds]) gather(id);
      for (const id of contextual ? [] : prerequisites) {
        const supported = [...prior.evidence.values()].some(entry => entry.supportingIds.has(id));
        if (!supported && !earlier.has(id) && !suppliedScaffolding(question, definitions.get(id)!)) missingPrerequisites.push(`${path}.prerequisiteIds: stretch prerequisite "${id}" needs prior supporting evidence (including scaffolded success), earlier preparation, or explicit scaffolding on this card`);
      }
    }
    for (const id of plan.conceptIds) earlier.add(id);
    // Meaningfully using a skill in an earlier card provides preparation, not
    // evidence that the learner has already understood it.
    for (const use of plan.skillUses ?? []) if (use.role === 'exercised') earlier.add(use.conceptId);
    previous = plan;
  }
  if (missingPrerequisites.length) reject('questions', `${missingPrerequisites.slice(0, 16).join('; ')}${missingPrerequisites.length > 16 ? '; additional prerequisites also need preparation' : ''}.`);
  if (!hasBuild || previous?.stage !== 'consolidate' || warmups > Math.ceil(lesson.questions.length / 3)) reject('questions.plan.stage', 'include a brief contiguous warmup (at most ceil(batchSize/3)), build, and final consolidation.');
  if (purposes.size < 2 || !['practice', 'introduction', 'transfer'].some(purpose => purposes.has(purpose)) || !['diagnostic', 'frontier', 'robustness', 'calibration', 'strategy-evaluation'].some(purpose => purposes.has(purpose)) || !purposes.has('transfer')) {
    reject('questions.plan.purposes', 'include teaching, investigation, and at least one transfer opportunity across the batch.');
  }
  if (new Set(lesson.questions.map(question => question.verdict)).size !== 2) reject('questions.verdict', 'include both correct and buggy implementations.');

  const frontierIds = new Set<string>();
  curriculum.frontier.forEach((entry, index) => {
    const path = `curriculum.frontier[${index}]`;
    references([entry.conceptId], `${path}.conceptId`);
    const key = contextual ? `${entry.conceptId}\0${entry.contextId}` : entry.conceptId;
    if (frontierIds.has(key)) reject(`${path}.conceptId`, 'list each frontier concept/context once.');
    frontierIds.add(key);
    if (!contextual && entry.decision === 'introduce' && !targets.has(entry.conceptId)) reject(`${path}.decision`, 'an introduced frontier concept must be targeted in this lesson.');
    if (!contextual && entry.decision === 'defer' && targets.has(entry.conceptId)) reject(`${path}.decision`, 'a deferred frontier concept cannot be targeted in this lesson.');
  });

  let pairs = 0;
  for (const [familyId, indices] of families) {
    const path = `questions[${indices[0]}].plan`;
    if (indices.length > 2) reject(`${path}.familyId`, 'a family may contain at most two cards.');
    if (indices.length === 1) {
      if (lesson.questions[indices[0]].plan!.counterpart === 'in-lesson') reject(`${path}.counterpart`, 'in-lesson requires exactly two cards in this family.');
      continue;
    }
    if (++pairs > 1) reject(`${path}.familyId`, 'at most one two-card mirror family is allowed per lesson.');
    const [left, right] = indices.map(index => lesson.questions[index]);
    if (prior.families.get(familyId)?.asked) reject(`${path}.familyId`, 'an already asked family cannot introduce a new same-lesson mirror pair.');
    if (!sameSet(left.plan!.conceptIds, right.plan!.conceptIds) || left.verdict === right.verdict) reject(path, 'a mirror pair requires identical conceptIds and opposite verdicts.');
    for (const index of indices) {
      const plan = lesson.questions[index].plan!;
      const at = `questions[${index}].plan`;
      if (plan.counterpart !== 'in-lesson' || !plan.purposes.includes('introduction')) reject(at, 'both mirror cards must declare counterpart=in-lesson and introduction purpose.');
      if (!['build', 'consolidate'].includes(plan.stage)) reject(`${at}.stage`, 'an introductory mirror pair belongs in build or consolidation.');
      if (normalized(plan.variantReason).split(' ').length < 6) reject(`${at}.variantReason`, 'explain how this counterpart teaches the new concept and why both cards are useful.');
      for (const id of plan.conceptIds) {
        if (prior.exposed.has(id) || definitions.get(id)!.familiarity !== 'unknown' || (known.has(id) && known.get(id)!.familiarity !== 'unknown')) reject(`${at}.conceptIds`, `same-lesson mirrors require unknown concepts without prior actual exposure; "${id}" is already encountered or claimed familiar.`);
      }
    }
  }
  for (let left = 0; left < lesson.questions.length; left++) {
    for (let right = left + 1; right < lesson.questions.length; right++) {
      if (lesson.questions[left].plan!.familyId !== lesson.questions[right].plan!.familyId && mirrors(lesson.questions[left], lesson.questions[right])) {
        reject(`questions[${right}].plan.familyId`, `undeclared mirror of questions[${left}]; shared specifications or equivalent reference code must use the same family and obey the pair limit.`);
      }
    }
  }
}
