export const TAG_CATEGORIES_REVERSE: Record<string, string[]> = {
  "Logic": [
    "null-pointer", "boundary-condition", "index-error", "off-by-one",
    "infinite-loop", "type-mismatch", "unhandled-exception",
    "floating-point-error", "unintended-mutation", "incorrect-implementation"
  ],
  "Performance": [
    "unnecessary-copy", "quadratic-loop", "memory-leak", "inefficient-lookup",
    "cache-miss", "race-condition", "deadlock", "thread-starvation", "state-desync",
    "blocking-event-loop", "orphaned-promise", "database-n-plus-one", "blocking-io",
    "excessive-network-calls", "connection-pool-exhaustion"
  ],
  "Security": [
    "sql-injection", "xss", "buffer-overflow", "broken-auth",
    "path-traversal", "hardcoded-secrets", "csrf", "insecure-deserialization",
    "ssrf", "weak-crypto", "privilege-escalation", "cors-misconfiguration"
  ],
  "Architecture": [
    "circular-dependency", "tight-coupling", "improper-abstraction",
    "god-object", "dead-code", "violation-of-dry", "magic-numbers",
    "solid-violation", "leaky-abstraction", "feature-envy"
  ]
};

export const TAG_CATEGORIES: Record<string, string> = Object.fromEntries(
  Object.entries(TAG_CATEGORIES_REVERSE).flatMap(([category, tags]) =>
    tags.map((tag) => [tag, category])
  )
);

export const LANGUAGE_STYLE_SUPPORT: Record<string, { iteration: string[], conditional: string[] }> = {
  "Python": {
    iteration: ["imperative", "for-each", "functional-pipeline", "fold-reduce", "recursive"],
    conditional: ["imperative-branching", "pattern-matching"]
  },
  "JavaScript": {
    iteration: ["imperative", "for-each", "functional-pipeline", "fold-reduce", "recursive"],
    conditional: ["imperative-branching"]
  },
  "Rust": {
    iteration: ["imperative", "for-each", "functional-pipeline", "fold-reduce", "recursive"],
    conditional: ["imperative-branching", "pattern-matching"]
  },
  "Java": {
    iteration: ["imperative", "for-each", "functional-pipeline", "fold-reduce", "recursive"],
    conditional: ["imperative-branching", "pattern-matching"]
  },
  "Kotlin": {
    iteration: ["imperative", "for-each", "functional-pipeline", "fold-reduce", "recursive"],
    conditional: ["imperative-branching", "pattern-matching"]
  },
  "Deno": {
    iteration: ["imperative", "for-each", "functional-pipeline", "fold-reduce", "recursive"],
    conditional: ["imperative-branching"]
  },
  "C": {
    iteration: ["imperative", "recursive"],
    conditional: ["imperative-branching"]
  },
  "C++": {
    iteration: ["imperative", "for-each", "functional-pipeline", "fold-reduce", "recursive"],
    conditional: ["imperative-branching"]
  },
  "C#": {
    iteration: ["imperative", "for-each", "functional-pipeline", "fold-reduce", "recursive"],
    conditional: ["imperative-branching", "pattern-matching"]
  }
};
