export interface Card {
  id: string;
  funcName: string;
  docstring: string;
  language: string;
  errorType: string;
  code: string;
  is_correct: boolean;
  explanation: string;
  availableAt?: number;
  baseElo?: number;
  tags?: string[];
  iterationStyle?: string;
  conditionalStyle?: string;
  idiomStyle?: string;
}
