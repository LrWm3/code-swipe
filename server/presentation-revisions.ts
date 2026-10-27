import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Exercise, JsonValue, PresentationRevision, StoreData } from '../src/types.ts';
import { validateQuestionFormat } from './question-format.ts';
import { execute } from './validation.ts';

type RevisionQuestion = PresentationRevision['questions'][number];

export function presentationArchiveHash(data: StoreData): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

function fields(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Error('Invalid presentation revision fields.');
}

function text(value: unknown, max: number): void {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid presentation revision text.');
}

export function revisedArguments(input: JsonValue, sources: (string | null)[]): JsonValue[] {
  return sources.map(key => {
    if (key === null) return input;
    if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.hasOwn(input, key)) {
      throw new Error(`Legacy fixture has no own field ${key}.`);
    }
    return input[key];
  });
}

export function revisedQuestion(original: Exercise, revision: RevisionQuestion): Exercise {
  return {
    ...original, signature: revision.signature, specification: revision.specification,
    code: revision.code, referenceCode: revision.referenceCode,
    tests: original.tests.map(test => ({ ...test, input: revisedArguments(test.input, revision.parameterSources) })),
    validation: { ...original.validation, failures: original.validation.failures.map(failure => ({
      ...failure, input: revisedArguments(failure.input, revision.parameterSources),
    })) },
  };
}

// Structural checks also run on startup. Execution checks run before importing.
export function validatePresentationRevision(review: PresentationRevision, data: StoreData, checkArchive = true): void {
  fields(review, ['id', 'createdAt', 'archiveHash', 'method', 'questions']);
  text(review.id, 100); text(review.method, 2_000);
  if (typeof review.createdAt !== 'string' || !Number.isFinite(Date.parse(review.createdAt))) throw new Error('Invalid presentation revision date.');
  if (typeof review.archiveHash !== 'string' || !/^[a-f0-9]{64}$/.test(review.archiveHash)) throw new Error('Invalid archive hash.');
  if (checkArchive && review.archiveHash !== presentationArchiveHash(data)) throw new Error('Archive changed since this presentation review; review the current data again.');
  if (!Array.isArray(review.questions) || !review.questions.length || review.questions.length > 1_000) throw new Error('A revision needs 1–1,000 questions.');
  const seen = new Set(data.presentationRevisions?.flatMap(item => item.questions.map(question => question.exerciseId)) ?? []);
  for (const item of review.questions) {
    fields(item, ['lessonId', 'exerciseId', 'predictionHash', 'signature', 'parameterSources', 'specification', 'code', 'referenceCode', 'note']);
    text(item.lessonId, 100); text(item.exerciseId, 100); text(item.predictionHash, 64);
    text(item.specification, 2_000); text(item.code, 6_000); text(item.referenceCode, 6_000); text(item.note, 2_000);
    const lesson = data.lessons.find(lesson => lesson.id === item.lessonId);
    const original = lesson?.questions.find(question => question.id === item.exerciseId);
    if (!original || original.signature || lesson.predictionHash !== item.predictionHash
      || !data.attempts.some(attempt => attempt.exerciseId === original.id && attempt.lessonId === lesson.id)) {
      throw new Error('Presentation revisions must reference answered, sealed legacy questions with matching prediction hashes.');
    }
    if (seen.has(item.exerciseId)) throw new Error('A question already has a presentation revision.');
    seen.add(item.exerciseId);
    validateQuestionFormat(item);
    if (!Array.isArray(item.parameterSources) || item.parameterSources.length !== item.signature.parameters.length
      || item.parameterSources.some(key => key !== null && (typeof key !== 'string' || !key.length || key.length > 80))) {
      throw new Error('Parameter sources must map each new argument to the legacy input or one of its fields.');
    }
    revisedQuestion(original, item); // Check every fixture and recorded failure can be mapped.
  }
}

export async function verifyPresentationBehavior(review: PresentationRevision, data: StoreData): Promise<number> {
  validatePresentationRevision(review, data);
  let checked = 0;
  for (const item of review.questions) {
    const original = data.lessons.find(lesson => lesson.id === item.lessonId)!.questions.find(question => question.id === item.exerciseId)!;
    for (const fixture of original.tests) {
      const args = revisedArguments(fixture.input, item.parameterSources);
      for (const field of ['code', 'referenceCode'] as const) {
        const before = await execute(original[field], fixture.input, `${original.title}: original ${field}`);
        const after = await execute(item[field], args, `${original.title}: revised ${field}`, undefined, item.signature);
        if (!isDeepStrictEqual(before, after)) throw new Error(`${original.title}: ${field} changed behavior for a saved fixture.`);
        if (field === 'referenceCode' && (after.error || !isDeepStrictEqual(after.actual, fixture.expected))) {
          throw new Error(`${original.title}: reference no longer matches its saved expected result.`);
        }
      }
      checked++;
    }
  }
  return checked;
}
