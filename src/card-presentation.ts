import type { Language, LearningContext, ProposedQuestion } from './types.ts';
import { BASE_CONTEXTS } from './learning-contexts.ts';

type Card = Pick<ProposedQuestion, 'kind' | 'specification' | 'code' | 'source' | 'questionText' | 'proposedAnswer' | 'contextId' | 'language'>;

export interface CardPresentation {
  description: string;
  source: string;
  sourceLanguage: Language | null;
  question: string;
  claim?: string;
  support?: string;
}

// Older trace cards put the snippet inside the task text. This changes only how
// they are displayed; the sealed question, answer, and prediction stay intact.
function legacySnippet(specification: string): { description: string; source: string; support?: string } | null {
  const match = /^(.*\b(?:Python|JavaScript|Rust) snippet\.)\n\n([\s\S]+)$/.exec(specification);
  if (!match) return null;
  const description = match[1];
  let source = match[2];
  let support: string | undefined;
  const diagram = /^([\s\S]*?)\n\nInitial diagram:\n([\s\S]*?)\n\n([\s\S]+)$/.exec(source);
  if (diagram) {
    support = diagram[2];
    source = `${diagram[1]}\n${diagram[3]}`;
  }
  return { description, source, ...(support ? { support } : {}) };
}

export function cardPresentation(question: Card, contexts: LearningContext[] = BASE_CONTEXTS): CardPresentation {
  const isAnswer = question.kind === 'answer-review';
  const legacy = isAnswer && !question.source ? legacySnippet(question.specification) : null;
  const contextLanguage = contexts.find(item => item.id === question.contextId)?.language;
  return {
    description: legacy?.description ?? question.specification,
    source: isAnswer ? question.source || legacy?.source || '' : question.code,
    sourceLanguage: isAnswer ? contextLanguage ?? null : question.language ?? contextLanguage ?? null,
    question: question.questionText || (isAnswer ? 'Is this proposed claim correct?' : 'Does this implementation match the description?'),
    ...(isAnswer ? { claim: question.proposedAnswer } : {}),
    ...(legacy?.support ? { support: legacy.support } : {}),
  };
}
