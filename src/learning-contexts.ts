import type { Language, LearningContext, Lesson, ProposedQuestion } from './types';

export const BASE_CONTEXTS: LearningContext[] = [
  { id: 'javascript', name: 'JavaScript', description: 'JavaScript programming and language behavior.', parentIds: [], language: 'javascript' },
  { id: 'python', name: 'Python', description: 'Python programming and language behavior.', parentIds: [], language: 'python' },
  { id: 'rust', name: 'Rust', description: 'Rust programming and language behavior.', parentIds: [], language: 'rust' },
  { id: 'numpy', name: 'NumPy', description: 'Numerical arrays and array operations in NumPy.', parentIds: ['python'], language: 'python' },
  { id: 'pandas', name: 'pandas', description: 'Tabular data manipulation with pandas.', parentIds: ['python'], language: 'python' },
  { id: 'react', name: 'React', description: 'Components, state, and rendering in React.', parentIds: ['javascript'], language: 'javascript' },
  { id: 'linux', name: 'Linux', description: 'Linux systems, processes, and administration.', parentIds: [], language: null },
  { id: 'networking', name: 'Networking', description: 'Protocols, addressing, and network behavior.', parentIds: [], language: null },
];
export function isLanguage(value: unknown): value is Language { return ['javascript', 'python', 'rust'].includes(value as string); }
export function questionContext(question: ProposedQuestion, lesson?: Pick<Lesson, 'language'>): string {
  return question.contextId ?? question.language ?? lesson?.language ?? 'javascript';
}
export function questionLanguage(question: ProposedQuestion, lesson?: Pick<Lesson, 'language'>): Language | undefined {
  return question.kind === 'answer-review' ? undefined : question.language ?? lesson?.language ?? 'javascript';
}
export function contextLabel(id: string, contexts: LearningContext[] = BASE_CONTEXTS): string {
  return contexts.find(item => item.id === id)?.name ?? id;
}
export function guideContext(guide: { contextId?: string; language?: Language }): string { return guide.contextId ?? guide.language ?? 'javascript'; }
export function contextIsExcluded(id: string, contexts: LearningContext[], excluded: string[] = []): boolean {
  const visited = new Set<string>();
  const visit = (next: string): boolean => {
    if (visited.has(next)) return false;
    visited.add(next);
    return excluded.includes(next) || (contexts.find(item => item.id === next)?.parentIds ?? []).some(visit);
  };
  return visit(id);
}

