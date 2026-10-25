import assert from "node:assert/strict";
import { test } from "node:test";
import { getOfflineCards } from "../src/offlineCards";

test("given matching offline exercises, when a category is selected, then returns only that language and category", () => {
  const cards = getOfflineCards("python", ["Security"]);
  assert.ok(cards.length > 0);
  assert.ok(cards.every((card) => card.language === "Python" && card.errorType === "Security"));
});

test("given no exercises in a category, when offline practice starts, then falls back within the selected language", () => {
  const cards = getOfflineCards("C++", ["Logic"]);
  assert.ok(cards.length > 0);
  assert.ok(cards.every((card) => card.language === "C++"));
});

test("given an unsupported offline language, when exercises are requested, then never substitutes another language", () => {
  assert.deepEqual(getOfflineCards("Java", ["Logic"]), []);
});
