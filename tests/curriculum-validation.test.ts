import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateCurriculum } from '../server/curriculum-validation.ts';
import type { ConceptRecord, ConceptUpdate, Lesson, ProposedLesson, TutorContext } from '../src/types.ts';

function context(batchSize = 8): TutorContext {
  return {
    settings: { provider: 'demo', model: '', interests: '', batchSize, tutorMode: 'reflective' },
    history: [], hypotheses: [],
    metrics: { count: 0, accuracy: null, brier: null, calibration: [], byPurpose: [] },
  };
}

function concept(id = 'boundary-checks', name = 'Boundary checks'): ConceptUpdate {
  return {
    id, name, description: 'Reason about including and excluding an endpoint.', representations: ['integer comparisons'],
    prerequisiteIds: [], familiarity: 'unknown', evidenceAttemptIds: [],
    uncertainty: 'No demonstrated prior understanding has been established.', nextProbe: 'Check another boundary in a different representation.',
  };
}

function lesson(count = 8): ProposedLesson {
  return {
    objective: 'Practice small reasoning steps and transfer boundary checks.', rationale: 'Start from a cold-start assumption.',
    assumptions: ['No prior competence is assumed.'], reflection: 'The first answers will supply evidence.', hypotheses: [],
    curriculum: {
      conceptUpdates: [concept()], observations: [], frontier: [{ conceptId: 'boundary-checks', decision: 'introduce', reason: 'A bounded first concept.' }],
      mixRationale: 'Teach boundary reasoning while checking expectations and transferring the idea.', sequenceRationale: 'Prepare with simple cards, build reasoning, stretch, then consolidate.',
    },
    questions: Array.from({ length: count }, (_, index) => ({
      title: `Boundary example ${index}`, specification: `Return the input increased by exactly ${index}.`,
      code: `function solve(input) { return input + ${index + (index % 2 ? 0 : 1)}; }`,
      referenceCode: `function solve(input) { return input + ${index}; }`,
      verdict: index % 2 ? 'correct' : 'buggy', explanation: 'Compare the returned value against the requested increment.', tests: [],
      purpose: index === 0 ? 'diagnostic' : index === count - 1 ? 'transfer' : 'practice', hypothesisId: null,
      ifCorrect: 'Try another representation.', ifIncorrect: 'Show a small boundary trace.', prediction: { pCorrect: 0.5, rationale: 'Cold-start uncertainty remains.' },
      plan: {
        purposes: [index === 0 ? 'diagnostic' : index === count - 1 ? 'transfer' : 'practice'],
        educationalObjective: 'Practice checking the requested increment.', investigativeObjective: 'Investigate whether the learner distinguishes adjacent results.',
        conceptIds: ['boundary-checks'], prerequisiteIds: [],
        skillUses: [{ conceptId: 'boundary-checks', role: 'target', support: 'independent', ifCorrect: 'supports', ifIncorrect: 'inconclusive', rationale: 'The focused boundary judgment provides tentative supporting evidence.' }],
        stage: index === 0 ? 'warmup' : index === count - 1 ? 'consolidate' : index >= count / 2 ? 'stretch' : 'build',
        cognitiveDemand: index === 0 ? 1 : index === count - 1 ? 2 : index >= count / 2 ? 3 : 2,
        difficultyRationale: 'The later card combines more reasoning steps; the final card transfers without adding new demands.',
        scaffolding: 'No additional prerequisite is needed for these explicit integer operations.', ifIdk: 'Offer a worked trace without assuming a misconception.',
        familyId: `increment-${index}`, counterpart: 'unasked', variantReason: 'One representative example is sufficient for this independent problem.',
      },
    })),
  };
}

function memory(tutor: TutorContext, evidence: ConceptRecord['evidence'], id = 'boundary-checks'): ConceptRecord {
  const record: ConceptRecord = {
    ...concept(id, id === 'boundary-checks' ? 'Boundary checks' : id), exposures: evidence.length, correctJudgments: evidence.filter(item => item.correct === true).length,
    incorrectJudgments: evidence.filter(item => item.correct === false).length, uncertainJudgments: evidence.filter(item => item.correct === null).length,
    lastSeenAt: evidence.at(-1)?.answeredAt ?? null, evidence,
  };
  tutor.curriculum = { concepts: [record], variants: [], legacyLessons: [] };
  return record;
}

function evidence(attemptId = 'attempt-1', lessonId = 'previous-1', correct: boolean | null = true): ConceptRecord['evidence'][number] {
  return { attemptId, lessonId, title: 'Prior boundary exercise', answer: correct === null ? 'idk' : 'correct', correct, role: 'target', support: 'independent', source: 'planned', signal: correct === true ? 'supports' : 'inconclusive', rationale: 'Focused prior boundary judgment.', answeredAt: '2026-01-01T10:00:00.000Z' };
}

function observe(proposal: ProposedLesson, attemptIds = ['attempt-1'], conceptIds = ['boundary-checks']): void {
  proposal.curriculum!.observations = [{ attemptIds, conceptIds, observation: 'The learner made the recorded judgment on the earlier card.', interpretation: 'That answer may reflect boundary reasoning, but another context is untested.', nextAction: 'Try a new context and retain uncertainty.' }];
}

function history(tutor: TutorContext, legacy = false, flagged = false): void {
  const previous: Lesson = {
    ...lesson(), id: 'previous-1', createdAt: '2026-01-01T09:00:00.000Z', provider: 'demo', model: '', tutorMode: 'reflective', interests: '', predictionHash: 'test',
    questions: lesson().questions.map((question, index) => ({ ...question, id: `exercise-${index}`, validation: { checkedAt: '', testCount: 4, passedCount: 4, failures: [] } })),
  };
  if (legacy) {
    delete previous.curriculum;
    previous.questions.forEach(question => { delete question.plan; });
  }
  tutor.history = [{ lesson: previous, attempts: [{ id: 'attempt-1', lessonId: previous.id, exerciseId: 'exercise-0', answer: 'buggy', correct: true, answeredAt: '2026-01-01T10:00:00.000Z', elapsedMs: 1000, flagged }] }];
}

function pair(proposal: ProposedLesson, left = 1, right = 2): void {
  const familyId = `new-pair-${left}`;
  for (const index of [left, right]) {
    const plan = proposal.questions[index].plan!;
    plan.familyId = familyId;
    plan.counterpart = 'in-lesson';
    plan.purposes.push('introduction');
    plan.variantReason = 'Compare the boundary inclusion with the exclusion to teach how changing one condition changes the contract.';
  }
  proposal.questions[right].verdict = proposal.questions[left].verdict === 'correct' ? 'buggy' : 'correct';
}

test('given cold-start curricula at every supported size, when checking semantics, then staged diverse plans pass without enforcing prediction order', () => {
  for (const size of [6, 8, 12]) {
    const proposal = lesson(size);
    proposal.questions.forEach((question, index) => { question.prediction.pCorrect = index % 2 ? 0.9 : 0.2; });
    assert.doesNotThrow(() => validateCurriculum(proposal, context(size)));
  }
});

test('given missing curriculum or question plans, when publishing new lessons, then legacy optional types do not bypass planning', () => {
  const proposal = lesson();
  delete proposal.curriculum;
  assert.throws(() => validateCurriculum(proposal, context()), /curriculum: is required/);
  const unplanned = lesson();
  delete unplanned.questions[2].plan;
  assert.throws(() => validateCurriculum(unplanned, context()), /questions\[2\].plan: is required/);
});

test('given unstable duplicate or unresolved concept identities, when checking references, then validation rejects each case', () => {
  const cases: { edit: (proposal: ProposedLesson) => void; expected: RegExp }[] = [
    { edit: p => { p.curriculum!.conceptUpdates[0].id = 'space separated'; }, expected: /stable ID/ },
    { edit: p => { p.curriculum!.conceptUpdates.push(concept()); }, expected: /must be unique/ },
    { edit: p => { p.questions[2].plan!.conceptIds = ['missing']; }, expected: /needs a conceptUpdate/ },
    { edit: p => { p.questions[2].plan!.prerequisiteIds = ['missing']; }, expected: /needs a conceptUpdate/ },
    { edit: p => { p.curriculum!.frontier[0].conceptId = 'missing'; }, expected: /needs a conceptUpdate/ },
    { edit: p => { p.questions[2].plan!.conceptIds.push('boundary-checks'); }, expected: /must not repeat/ },
  ];
  for (const { edit, expected } of cases) {
    const proposal = lesson(); edit(proposal);
    assert.throws(() => validateCurriculum(proposal, context()), expected);
  }
});

test('given known normalized concept names, when assigning a new ID or renaming the old record, then prior identity cannot be erased', () => {
  const tutor = context(); memory(tutor, []);
  const proposal = lesson();
  proposal.curriculum!.conceptUpdates.push(concept('new-boundaries', '  BOUNDARY--checks  '));
  assert.throws(() => validateCurriculum(proposal, tutor), /reuse existing concept ID/);
  proposal.curriculum!.conceptUpdates[0].name = 'Endpoint checks';
  assert.throws(() => validateCurriculum(proposal, tutor), /retain the existing normalized concept name/);
});

test('given prerequisite self-links and cycles crossing memory, when resolving the graph, then invalid dependencies fail', () => {
  const proposal = lesson();
  proposal.curriculum!.conceptUpdates[0].prerequisiteIds = ['boundary-checks'];
  assert.throws(() => validateCurriculum(proposal, context()), /own prerequisite/);
  const tutor = context();
  const known = memory(tutor, []); known.prerequisiteIds = ['integer-order'];
  proposal.curriculum!.conceptUpdates = [concept('integer-order', 'Integer order')];
  proposal.curriculum!.conceptUpdates[0].prerequisiteIds = ['boundary-checks'];
  assert.throws(() => validateCurriculum(proposal, tutor), /prerequisite cycle/);
});

test('given unfamiliar concepts without evidence, when claiming introduced developing or familiar states, then unsupported familiarity fails', () => {
  for (const familiarity of ['introduced', 'developing', 'familiar'] as const) {
    const proposal = lesson(); proposal.curriculum!.conceptUpdates[0].familiarity = familiarity;
    assert.throws(() => validateCurriculum(proposal, context()), /require cited prior evidence/);
  }
});

test('given real memory evidence from two lessons, when claiming familiar with three correct citations, then the threshold and concept linkage are enforced', () => {
  const tutor = context();
  memory(tutor, [evidence('attempt-1'), evidence('attempt-2'), evidence('attempt-3', 'previous-2')]);
  const proposal = lesson(); observe(proposal);
  proposal.curriculum!.conceptUpdates[0].familiarity = 'familiar';
  proposal.curriculum!.conceptUpdates[0].evidenceAttemptIds = ['attempt-1', 'attempt-2', 'attempt-3'];
  assert.doesNotThrow(() => validateCurriculum(proposal, tutor));
  proposal.curriculum!.conceptUpdates[0].evidenceAttemptIds.pop();
  assert.throws(() => validateCurriculum(proposal, tutor), /3 cited correct judgments/);
  proposal.curriculum!.conceptUpdates[0].evidenceAttemptIds.push('made-up');
  assert.throws(() => validateCurriculum(proposal, tutor), /not a real unflagged/);
});

test('given repeated correct answers from one lesson or an IDK among three citations, when claiming familiar, then weak evidence cannot establish familiarity', () => {
  for (const items of [[evidence('attempt-1'), evidence('attempt-2'), evidence('attempt-3')], [evidence('attempt-1'), evidence('attempt-2'), evidence('attempt-3', 'previous-2', null)]]) {
    const tutor = context(); memory(tutor, items);
    const proposal = lesson(); observe(proposal);
    Object.assign(proposal.curriculum!.conceptUpdates[0], { familiarity: 'familiar', evidenceAttemptIds: items.map(item => item.attemptId) });
    assert.throws(() => validateCurriculum(proposal, tutor), /3 cited correct judgments/);
  }
});

test('given a real attempt for another concept, when citing it as evidence or observation, then incorrect concept linkage fails', () => {
  const tutor = context(); memory(tutor, [evidence()], 'other-concept');
  const proposal = lesson(); observe(proposal);
  proposal.curriculum!.conceptUpdates[0].evidenceAttemptIds = ['attempt-1'];
  assert.throws(() => validateCurriculum(proposal, tutor), /not linked to concept/);
  proposal.curriculum!.conceptUpdates[0].evidenceAttemptIds = [];
  assert.throws(() => validateCurriculum(proposal, tutor), /every observation concept and attempt must be linked/);
});

test('given flagged or orphaned raw attempts also present in stale memory, when citing evidence, then raw exclusion takes precedence', () => {
  for (const orphan of [false, true]) {
    const tutor = context(); memory(tutor, [evidence()]); history(tutor, false, !orphan);
    if (orphan) tutor.history[0].attempts[0].exerciseId = 'missing';
    const proposal = lesson(); proposal.curriculum!.conceptUpdates[0].evidenceAttemptIds = ['attempt-1'];
    assert.throws(() => validateCurriculum(proposal, tutor), /not a real unflagged/);
  }
});

test('given real legacy attempts, when adding explicit retrospective definitions and observations, then tentative annotations pass without proving familiarity', () => {
  const tutor = context(); history(tutor, true);
  const proposal = lesson(); observe(proposal);
  proposal.curriculum!.conceptUpdates[0].evidenceAttemptIds = ['attempt-1'];
  proposal.curriculum!.conceptUpdates[0].familiarity = 'introduced';
  assert.doesNotThrow(() => validateCurriculum(proposal, tutor));
  memory(tutor, []);
  proposal.curriculum!.conceptUpdates = [];
  assert.throws(() => validateCurriculum(proposal, tutor), /legacy attempts require an explicit conceptUpdate/);
});

test('given archived evidence beyond recent history, when omitting observations or copying interpretations, then reflection remains grounded and separated', () => {
  const tutor = context(); memory(tutor, [evidence()]);
  const proposal = lesson();
  assert.throws(() => validateCurriculum(proposal, tutor), /at least one grounded observation/);
  observe(proposal);
  proposal.curriculum!.observations[0].interpretation = proposal.curriculum!.observations[0].observation;
  assert.throws(() => validateCurriculum(proposal, tutor), /separate observed answers/);
});

test('given baseline mode with supplied reflective context, when planning, then only fresh definitions without evidence are permitted', () => {
  const tutor = context(); memory(tutor, [evidence()]); tutor.settings.tutorMode = 'baseline';
  const proposal = lesson();
  assert.doesNotThrow(() => validateCurriculum(proposal, tutor));
  observe(proposal);
  assert.throws(() => validateCurriculum(proposal, tutor), /baseline lessons cannot contain/);
  proposal.curriculum!.observations = [];
  proposal.curriculum!.conceptUpdates[0].evidenceAttemptIds = ['attempt-1'];
  assert.throws(() => validateCurriculum(proposal, tutor), /baseline concepts must remain unknown/);
  proposal.curriculum!.conceptUpdates = [];
  assert.throws(() => validateCurriculum(proposal, tutor), /needs a conceptUpdate/);
});

test('given insufficient purpose diversity or one verdict, when checking a batch, then teaching investigation transfer and both labels are required', () => {
  for (const mode of ['primary', 'teaching', 'investigation', 'transfer', 'verdict'] as const) {
    const proposal = lesson();
    if (mode === 'primary') proposal.questions[0].plan!.purposes = ['practice'];
    if (mode === 'teaching') proposal.questions.forEach(question => { question.purpose = 'diagnostic'; question.plan!.purposes = ['diagnostic']; });
    if (mode === 'investigation') { proposal.questions[0].purpose = 'practice'; proposal.questions[0].plan!.purposes = ['practice']; }
    if (mode === 'transfer') { proposal.questions.at(-1)!.purpose = 'practice'; proposal.questions.at(-1)!.plan!.purposes = ['practice']; }
    if (mode === 'verdict') proposal.questions.forEach(question => { question.verdict = 'correct'; });
    assert.throws(() => validateCurriculum(proposal, context()), /primary question purpose|teaching, investigation|both correct and buggy/);
  }
});

test('given inappropriate stage order or demand, when sequencing, then warmup preparation stretch and consolidation checks reject bypasses', () => {
  const cases: { edit: (proposal: ProposedLesson) => void; expected: RegExp }[] = [
    { edit: p => { p.questions[0].plan!.stage = 'build'; }, expected: /approachable warmup/ },
    { edit: p => { p.questions[0].plan!.cognitiveDemand = 3; }, expected: /approachable warmup/ },
    { edit: p => { p.questions[3].plan!.cognitiveDemand = 2.5; }, expected: /integer from 1 to 5/ },
    { edit: p => { p.questions[2].plan!.cognitiveDemand = 4; }, expected: /jump by more than 1/ },
    { edit: p => { p.questions[2].plan!.cognitiveDemand = 1; }, expected: /cannot decrease/ },
    { edit: p => { p.questions[3].plan!.stage = 'warmup'; }, expected: /stages must progress/ },
    { edit: p => { p.questions[3].plan!.stage = 'stretch'; p.questions[3].plan!.cognitiveDemand = 3; }, expected: /second half/ },
    { edit: p => { p.questions[4].plan!.cognitiveDemand = 2; }, expected: /second half with cognitiveDemand/ },
    { edit: p => { p.questions.at(-1)!.plan!.stage = 'stretch'; p.questions.at(-1)!.plan!.cognitiveDemand = 3; }, expected: /final consolidation/ },
    { edit: p => { p.questions.at(-1)!.plan!.cognitiveDemand = 5; }, expected: /maintain or lower/ },
    { edit: p => { p.questions.slice(0, 4).forEach(question => { question.plan!.stage = 'warmup'; }); }, expected: /brief contiguous warmup/ },
  ];
  for (const { edit, expected } of cases) { const proposal = lesson(); edit(proposal); assert.throws(() => validateCurriculum(proposal, context()), expected); }
});

test('given optional stretch omitted, when a batch builds and consolidates, then no artificial stretch is required', () => {
  const proposal = lesson();
  proposal.questions.slice(1, -1).forEach(question => { question.plan!.stage = 'build'; question.plan!.cognitiveDemand = 2; });
  assert.doesNotThrow(() => validateCurriculum(proposal, context()));
});

test('given an unseen transitive prerequisite, when stretching, then hidden assertions of support cannot replace supplied scaffolding', () => {
  const proposal = lesson();
  proposal.curriculum!.conceptUpdates.push(concept('integer-order', 'Integer order'));
  proposal.questions[4].plan!.prerequisiteIds = ['integer-order'];
  proposal.questions[4].plan!.skillUses!.push({ ...proposal.questions[4].plan!.skillUses![0], conceptId: 'integer-order', role: 'exercised' });
  assert.throws(() => validateCurriculum(proposal, context()), /stretch prerequisite "integer-order"/);
  proposal.questions[4].plan!.scaffolding = 'Integer order is explained using an explicit number-line example on the card.';
  assert.throws(() => validateCurriculum(proposal, context()), /stretch prerequisite "integer-order"/);
  proposal.questions[4].specification += ' Integer order compares positions on a number line: 2 comes after 1, so 2 > 1.';
  assert.doesNotThrow(() => validateCurriculum(proposal, context()));
  proposal.questions[4].plan!.scaffolding = 'None needed.';
  proposal.questions[1].plan!.conceptIds = ['integer-order'];
  proposal.questions[1].plan!.skillUses = [{ ...proposal.questions[1].plan!.skillUses![0], conceptId: 'integer-order' }];
  assert.doesNotThrow(() => validateCurriculum(proposal, context()));
});

test('given prior correct prerequisite evidence, when stretching without earlier preparation, then demonstrated readiness is accepted', () => {
  const tutor = context(); const prior = memory(tutor, [evidence()], 'integer-order'); prior.name = 'Integer order';
  const proposal = lesson(); observe(proposal, ['attempt-1'], ['integer-order']);
  proposal.questions[4].plan!.prerequisiteIds = ['integer-order'];
  proposal.questions[4].plan!.skillUses!.push({ ...proposal.questions[4].plan!.skillUses![0], conceptId: 'integer-order', role: 'exercised' });
  assert.doesNotThrow(() => validateCurriculum(proposal, tutor));
  prior.evidence[0].correct = false;
  assert.throws(() => validateCurriculum(proposal, tutor), /stretch prerequisite/);
});

test('given a target with an unlisted dependency chain, when stretching, then concept definitions also establish required prerequisites', () => {
  const proposal = lesson();
  proposal.curriculum!.conceptUpdates.push(concept('new-target', 'New target'), concept('intermediate', 'Intermediate rule'), concept('unseen', 'Unseen rule'));
  proposal.curriculum!.conceptUpdates[1].prerequisiteIds = ['intermediate'];
  proposal.curriculum!.conceptUpdates[2].prerequisiteIds = ['unseen'];
  proposal.questions[4].plan!.conceptIds = ['new-target'];
  proposal.questions[4].plan!.skillUses = [{ ...proposal.questions[4].plan!.skillUses![0], conceptId: 'new-target' }];
  proposal.questions[1].plan!.conceptIds = ['intermediate'];
  proposal.questions[1].plan!.skillUses = [{ ...proposal.questions[1].plan!.skillUses![0], conceptId: 'intermediate' }];
  assert.throws(() => validateCurriculum(proposal, context()), /stretch prerequisite "unseen"/);
});

test('given frontier decisions inconsistent with actual cards, when checking introduction and deferral, then the chosen direction must match the lesson', () => {
  const proposal = lesson(); proposal.curriculum!.frontier[0].decision = 'defer';
  assert.throws(() => validateCurriculum(proposal, context()), /deferred frontier concept cannot be targeted/);
  proposal.curriculum!.conceptUpdates.push(concept('future', 'Future concept'));
  proposal.curriculum!.frontier = [{ conceptId: 'future', reason: 'Try next.', decision: 'introduce' }];
  assert.throws(() => validateCurriculum(proposal, context()), /introduced frontier concept must be targeted/);
  proposal.curriculum!.frontier[0].decision = 'defer';
  assert.doesNotThrow(() => validateCurriculum(proposal, context()));
});

test('given one introductory mirror pair with fresh concepts, when declaring both variants, then a meaningful build-stage pair passes', () => {
  const proposal = lesson(); pair(proposal);
  proposal.questions[2].specification = proposal.questions[1].specification;
  proposal.questions[2].referenceCode = proposal.questions[1].referenceCode;
  assert.doesNotThrow(() => validateCurriculum(proposal, context()));
});

test('given malformed introductory pairs, when checking family declarations, then both cards must justify the same new concept', () => {
  const cases: { edit: (proposal: ProposedLesson) => void; expected: RegExp }[] = [
    { edit: p => { p.questions[2].plan!.counterpart = 'defer'; }, expected: /both mirror cards must declare/ },
    { edit: p => { p.questions[2].plan!.purposes = ['practice']; }, expected: /both mirror cards must declare/ },
    { edit: p => { p.questions[2].verdict = p.questions[1].verdict; }, expected: /opposite verdicts/ },
    { edit: p => { p.questions[2].plan!.variantReason = 'Useful.'; }, expected: /explain how this counterpart teaches/ },
    { edit: p => { p.questions[3].plan!.familyId = p.questions[1].plan!.familyId; }, expected: /at most two cards/ },
    { edit: p => { p.questions[1].plan!.familyId = 'other-family'; }, expected: /exactly two cards/ },
    { edit: p => { p.curriculum!.conceptUpdates.push(concept('other', 'Other concept')); p.questions[2].plan!.conceptIds = ['other']; p.questions[2].plan!.skillUses![0].conceptId = 'other'; }, expected: /identical conceptIds/ },
  ];
  for (const { edit, expected } of cases) { const proposal = lesson(); pair(proposal); edit(proposal); assert.throws(() => validateCurriculum(proposal, context()), expected); }
});

test('given two introductory pairs at any batch size, when planning mirror contrasts, then the one-pair limit remains fixed', () => {
  for (const count of [6, 8, 12]) {
    const proposal = lesson(count);
    proposal.questions.slice(1, -1).forEach(question => { question.plan!.stage = 'build'; question.plan!.cognitiveDemand = 2; });
    pair(proposal, 1, 2); pair(proposal, 3, 4);
    assert.throws(() => validateCurriculum(proposal, context(count)), /at most one two-card mirror family/);
  }
});

test('given actual or flagged prior exposures, when renaming a concept and resetting familiarity, then introductory mirrors remain forbidden', () => {
  for (const flagged of [false, true]) {
    const tutor = context(); history(tutor, false, flagged);
    const proposal = lesson(); pair(proposal); proposal.curriculum!.conceptUpdates[0].name = 'New endpoint label';
    if (!flagged) observe(proposal);
    assert.throws(() => validateCurriculum(proposal, tutor), /without prior actual exposure/);
  }
});

test('given a familiar concept and deferred counterpart, when asking only one variant in a later lesson, then deferral never requires a mirror or counts as exposure', () => {
  const tutor = context(); const known = memory(tutor, [evidence()]); known.familiarity = 'introduced';
  tutor.curriculum!.variants = [{ familyId: 'increment-1', conceptIds: ['boundary-checks'], title: 'Earlier contrast', counterpart: 'defer', reason: 'Save another representation.', askedCount: 1, lastAskedAt: '2026-01-01T10:00:00.000Z' }];
  const proposal = lesson(); observe(proposal); proposal.questions[1].plan!.counterpart = 'unasked';
  assert.doesNotThrow(() => validateCurriculum(proposal, tutor));
  const fresh = context(); memory(fresh, []);
  fresh.curriculum!.variants = [{ ...tutor.curriculum!.variants[0], familyId: 'new-pair-1', askedCount: 0, lastAskedAt: null }];
  const paired = lesson(); pair(paired);
  assert.doesNotThrow(() => validateCurriculum(paired, fresh));
});

test('given existing family memory, when replacing its concepts or reusing an asked family for a pair, then stable family meaning is retained', () => {
  const tutor = context(); memory(tutor, []);
  tutor.curriculum!.variants = [{ familyId: 'increment-1', conceptIds: ['other'], title: 'Prior family', counterpart: 'defer', reason: 'Wait.', askedCount: 0, lastAskedAt: null }];
  assert.throws(() => validateCurriculum(lesson(), tutor), /existing family must retain/);
  tutor.curriculum!.variants[0] = { ...tutor.curriculum!.variants[0], familyId: 'new-pair-1', conceptIds: ['boundary-checks'], askedCount: 1 };
  const proposal = lesson(); pair(proposal);
  assert.throws(() => validateCurriculum(proposal, tutor), /already asked family/);
});

test('given undeclared mirrors under different family IDs, when sharing a specification or whitespace-normalized reference, then naming cannot evade pair limits', () => {
  for (const field of ['specification', 'referenceCode'] as const) {
    const proposal = lesson();
    proposal.questions[2][field] = ` \n ${proposal.questions[1][field].replaceAll(' ', '  ')} \n`;
    assert.throws(() => validateCurriculum(proposal, context()), /undeclared mirror/);
  }
  const proposal = lesson();
  proposal.questions[2].referenceCode = proposal.questions[1].referenceCode.replace('return', '/* same algorithm */ return');
  assert.throws(() => validateCurriculum(proposal, context()), /undeclared mirror/);
});

test('given distinct simple functions or opposite specification operators, when checking similarity, then generic code shapes do not create false mirrors', () => {
  const proposal = lesson();
  proposal.questions[1].specification = 'Return true when input > 0.';
  proposal.questions[2].specification = 'Return true when input < 0.';
  proposal.questions[1].referenceCode = 'function solve(input) { return input > 0; }';
  proposal.questions[2].referenceCode = 'function solve(input) { return input < 0; }';
  assert.doesNotThrow(() => validateCurriculum(proposal, context()));
});

test('given substantial references with tiny edits and near-identical specifications, when assigning separate families, then conservative mirror detection rejects them', () => {
  const proposal = lesson();
  const code = 'function solve(input) { const values = input.values; let total = 0; let count = 0; for (let index = 0; index < values.length; index++) { const value = values[index]; if (value >= 0 && value < 100) { total += value; count += 1; } } return { total: total, count: count, accepted: count > 0 }; }';
  proposal.questions[1].referenceCode = code;
  proposal.questions[2].referenceCode = code.replace('value < 100', 'value < 101');
  proposal.questions[1].specification = 'Return the total and count of accepted integer readings that meet both lower and upper boundary conditions for this collection.';
  proposal.questions[2].specification = 'Return the total and count of accepted integer readings that meet both lower and upper boundary conditions for this sequence.';
  assert.throws(() => validateCurriculum(proposal, context()), /undeclared mirror/);
});

test('given legacy answers retrospectively linked to an unknown concept, when proposing an introductory pair, then the annotation cannot erase its prior encounter', () => {
  for (const citation of [false, true]) {
    const tutor = context(); history(tutor, true);
    const proposal = lesson(); observe(proposal); pair(proposal);
    if (citation) proposal.curriculum!.conceptUpdates[0].evidenceAttemptIds = ['attempt-1'];
    assert.throws(() => validateCurriculum(proposal, tutor), /without prior actual exposure/);
  }
});

test('given three correct legacy answers annotated only after the fact, when claiming familiar, then retrospective labels do not establish demonstrated familiarity', () => {
  const tutor = context(); history(tutor, true);
  tutor.history[0].attempts.push({ ...tutor.history[0].attempts[0], id: 'attempt-2', exerciseId: 'exercise-1' });
  const second = structuredClone(tutor.history[0]);
  second.lesson.id = 'previous-2';
  second.attempts = [{ ...second.attempts[0], id: 'attempt-3', lessonId: 'previous-2' }];
  tutor.history.push(second);
  const proposal = lesson(); observe(proposal);
  Object.assign(proposal.curriculum!.conceptUpdates[0], { familiarity: 'familiar', evidenceAttemptIds: ['attempt-1', 'attempt-2', 'attempt-3'] });
  assert.throws(() => validateCurriculum(proposal, tutor), /3 cited correct judgments/);
});
