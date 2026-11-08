import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardPresentation } from '../src/card-presentation.ts';

test('given a code review, when displaying its card, then the task, source, and default question remain separate', () => {
  const card = cardPresentation({ kind: 'code-review', specification: 'Return the final item.', code: 'def last(items):\n    return items[-1]', contextId: 'python', language: 'python' });
  assert.equal(card.description, 'Return the final item.');
  assert.equal(card.source, 'def last(items):\n    return items[-1]');
  assert.equal(card.sourceLanguage, 'python');
  assert.equal(card.question, 'Does this implementation match the description?');
});

test('given a new answer review, when displaying its card, then the source and proposed claim have distinct places', () => {
  const card = cardPresentation({ kind: 'answer-review', specification: 'Trace the names after this code runs.', source: 'basket = ["tea"]\nother = basket', code: '', contextId: 'python', questionText: 'Do both names refer to one list?', proposedAnswer: 'Yes, both names refer to the same list.' });
  assert.equal(card.description, 'Trace the names after this code runs.');
  assert.equal(card.sourceLanguage, 'python');
  assert.equal(card.question, 'Do both names refer to one list?');
  assert.equal(card.claim, 'Yes, both names refer to the same list.');
});

test('given the current lesson’s older Python trace format, when displaying it, then the card shows a plain setup, source, and claim without a redundant diagram', () => {
  const card = cardPresentation({ id: '121fc23c-6035-4c0c-8af8-3d143d57cfee', kind: 'answer-review', specification: 'Judge the final-state claim after this Python snippet.\n\nbasket = ["tea"]\nshopping = basket\n\nInitial diagram:\nbasket → list A ["tea"]\nshopping → list A\n\nshopping.append("rice")', code: '', contextId: 'python', proposedAnswer: 'basket now contains ["tea", "rice"].' });
  assert.equal(card.description, 'A basket starts with tea. The snippet adds rice through another name.');
  assert.equal(card.source, 'basket = ["tea"]\nshopping = basket\nshopping.append("rice")');
  assert.equal(card.sourceLanguage, 'python');
  assert.equal(card.question, 'After running, basket contains ["tea", "rice"].');
  assert.equal(card.claim, undefined);
});

test('given a generated answer review with a complete claim as its question, when displaying it, then the claim appears once', () => {
  const card = cardPresentation({ kind: 'answer-review', specification: 'A basket starts with tea.', source: 'basket = ["tea"]', code: '', contextId: 'python', questionText: 'basket contains ["tea"].', proposedAnswer: 'basket contains ["tea"].' });
  assert.equal(card.question, 'basket contains ["tea"].');
  assert.equal(card.claim, undefined);
});
