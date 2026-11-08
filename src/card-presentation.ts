import type { Language, LearningContext, ProposedQuestion } from './types.ts';
import { BASE_CONTEXTS } from './learning-contexts.ts';

type Card = Pick<ProposedQuestion, 'kind' | 'specification' | 'code' | 'source' | 'questionText' | 'proposedAnswer' | 'contextId' | 'language'> & { id?: string };

export interface CardPresentation {
  description: string;
  source: string;
  sourceLanguage: Language | null;
  question: string;
  claim?: string;
}

// Presentation copy for the sealed Python names-and-objects lesson. The
// original prompts and predictions remain in the archive without edits.
const traceDescriptions: Record<string, string> = {
  '121fc23c-6035-4c0c-8af8-3d143d57cfee': 'A basket starts with tea. The snippet adds rice through another name.',
  '4e2a00f9-d029-4662-a316-cd5b63e6d053': 'Two lists start with the same item. The snippet changes one of them.',
  '1e4ce9ec-c23f-4c91-b5f5-ea7cf5cc9ec7': 'Two names start with one list. The snippet gives one name a new list, then appends to it.',
  '93934003-f7b0-4894-b68c-69fd324c294c': 'Two names refer to a stock dictionary. The snippet updates it through the second name.',
  '811fb342-161f-451f-9898-e64be68f8a35': 'Three names initially refer to one list. The snippet reassigns one name and updates both lists.',
  '7b8aa157-787f-431b-9384-2ac1b7f6db9b': 'Two lists start with equal contents. The snippet reassigns a name, then compares the lists.',
  '53427c5a-fd70-40f4-b877-9d9d1926dd6e': 'Two names start with one settings dictionary. The snippet changes an entry, then reassigns one name.',
  'e0a333e5-5141-43d2-916e-8a74ccf45c00': 'Two lists start with equal contents. The snippet changes one list, then redirects its name to the other.',
};
const traceQuestions: Record<string, string> = {
  '121fc23c-6035-4c0c-8af8-3d143d57cfee': 'After running, basket contains ["tea", "rice"].',
  '4e2a00f9-d029-4662-a316-cd5b63e6d053': 'After running, evening contains ["cycle"] because the lists started with equal contents.',
  '1e4ce9ec-c23f-4c91-b5f5-ea7cf5cc9ec7': 'After running, archived contains ["draft"] and pending contains ["published", "reviewed"].',
  '93934003-f7b0-4894-b68c-69fd324c294c': 'After running, stock remains {"mugs": 4}; only shop_view has the updated entries.',
  '811fb342-161f-451f-9898-e64be68f8a35': 'After running, route and active contain ["north", "east"], while backup contains ["south", "west"].',
  '7b8aa157-787f-431b-9384-2ac1b7f6db9b': 'After running, saved == first and saved is first both evaluate to True.',
  '53427c5a-fd70-40f4-b877-9d9d1926dd6e': 'After running, earlier contains {"theme": "dark"} and settings contains {"theme": "blue"}.',
  'e0a333e5-5141-43d2-916e-8a74ccf45c00': 'After running, left contains [2, 4, 6] and right contains [2, 6].',
};

// Older trace cards put the snippet inside the task text. This changes only how
// they are displayed; the sealed question, answer, and prediction stay intact.
function legacySnippet(specification: string): { description: string; source: string } | null {
  const match = /^(.*\b(?:Python|JavaScript|Rust) snippet\.)\n\n([\s\S]+)$/.exec(specification);
  if (!match) return null;
  const description = match[1];
  let source = match[2];
  const diagram = /^([\s\S]*?)\n\nInitial diagram:\n([\s\S]*?)\n\n([\s\S]+)$/.exec(source);
  if (diagram) {
    source = `${diagram[1]}\n${diagram[3]}`;
  }
  return { description, source };
}

export function cardPresentation(question: Card, contexts: LearningContext[] = BASE_CONTEXTS): CardPresentation {
  const isAnswer = question.kind === 'answer-review';
  const legacy = isAnswer && !question.source ? legacySnippet(question.specification) : null;
  const contextLanguage = contexts.find(item => item.id === question.contextId)?.language;
  const traceDescription = question.id ? traceDescriptions[question.id] : undefined;
  const claimIsQuestion = Boolean(traceDescription) || Boolean(isAnswer && (!question.questionText || question.questionText.trim() === question.proposedAnswer?.trim() || /^Is (this|the) (proposed )?claim (about the source )?correct\?$/i.test(question.questionText)));
  return {
    description: traceDescription ?? legacy?.description ?? question.specification,
    source: isAnswer ? question.source || legacy?.source || '' : question.code,
    sourceLanguage: isAnswer ? contextLanguage ?? null : question.language ?? contextLanguage ?? null,
    question: (question.id && traceQuestions[question.id]) || (claimIsQuestion ? question.proposedAnswer ?? '' : question.questionText || 'Does this implementation match the description?'),
    ...(isAnswer && !claimIsQuestion ? { claim: question.proposedAnswer } : {}),
  };
}
