# Local tutor v1

The experiment asks whether one teaching agent can form increasingly useful, falsifiable theories about a learner from code-review decisions, explicit uncertainty, and optional learner feedback. The app controls evidence and timing; the agent chooses the curriculum. There is no fixed subject taxonomy or learner score.

## One planning cycle

1. Read the current interests, recent answered lessons, unchanged predictions, raw answers, and working hypotheses. Include older lessons when current hypotheses cite them. Flagged and accidental answers are excluded. IDK remains an observation of uncertainty, with no correct/incorrect grade. Read optional learner notes and recorded review exposure alongside the answers.
2. Reflect on surprises. Keep observations separate from explanations; preserve alternatives and contradictory evidence. Propose discriminating pairs, useful practice, and transfer to another context.
3. Produce a complete lesson: objective, assumptions, reflection, hypotheses, exercises, tests, predicted success probabilities, and what either outcome would imply.
4. Validate structure, references to real evidence, and every executable fixture. A failure permits one complete repair. No valid batch means no published exercises.
5. Write the full plan to a new read-only file and hash it before exposing the first card. Never revise its predictions after an answer.
6. Record each answer exactly once and immediately show the next card. Explanations, counterexamples, and predictions appear only when the learner opens a review. At the end, accept optional notes and accidental-answer exclusions before the next planning cycle.

This is intentionally a single bounded agent call plus an optional repair, not a general agent framework. The local server provides context retrieval, validation, persistence, and progress. The CLI only produces the proposed lesson and cannot run arbitrary tools. There is no background model use until the learner requests the next lesson. Review exposure can affect later probes. The prompt receives review openings and estimated foreground viewing time, and must not assume every explanation was read. Viewing time does not prove attention or understanding. Old answers without telemetry have unknown review exposure.

## Data and accountability

`state.json` contains settings, lessons, answers, lesson feedback, and review sessions. Existing version-1 notebooks load without modifying sealed plans or original answers. `plans/<id>.json` contains each immutable full lesson; SHA-256 covers the entire artifact, including fixtures and predictions. Startup verifies these files match. `state.backup.json` holds the previous state write. `runs/<id>.json` records planning status without CLI logs or credentials. State replacement is atomic. Do not run two servers with the same data directory.

Evidence IDs must identify real, unflagged answers. A supported claim needs supporting evidence; a contradicted claim needs counterevidence. New hypotheses remain tentative. These checks prevent fabricated citations, but do not prove that the interpretation follows from the evidence. The learner can inspect the notebook and flag defective questions.

The reflective prompt uses up to 12 recent lessons plus older evidence cited by current hypotheses, subject to a 280 KB context budget. Oldest lessons are omitted first when necessary, and current hypotheses lose citations to omitted evidence rather than inventing support. All history remains in the local archive. Baseline mode gets interests and batch size with no history, hypotheses, or historical metrics. It still commits predictions and passes identical validation. Switching modes is exploratory, not a randomized study: familiarity and provider differences can confound comparisons.

Brier score is the mean of `(pCorrect - actualCorrect)^2`; lower is better. Calibration bins compare predicted and observed success. Metrics exclude flagged attempts and IDK responses, and are scoped by provider and mode. The resulting score describes answered judgments, not abstention behavior; changing how often the learner uses IDK can change the sample. Small samples are noisy. A lower Brier score does not establish better teaching: easy, familiar exercises can be predictable. Practice, diagnostic, transfer, and genuinely delayed retention items are tracked separately. Retention requires relevant evidence at least 24 hours old; the app cannot establish a causal learning benefit from these labels.

Review sessions use cumulative, idempotent durations so retried requests cannot double-count time. The browser pauses its clock when the tab is hidden or the window loses focus. It periodically flushes progress and keeps a local retry queue for interrupted connections, preserving the browser's original opening timestamp even if delivery is delayed. A crash before the next flush can still lose a little time. Lesson notes are untrusted learner reports, not an oracle for exercise validity. Marking an accidental answer excludes it without rewriting the original judgment; removing that annotation does not undo an independent flawed-question flag.

## Execution boundary

The first version supports a pure synchronous `solve(input)` function with JSON-compatible inputs and outputs. New questions favor short behavior-first descriptions, meaningful parameter names, and JSDoc input/return types. Object inputs are used only when needed, with their shape visible in code. Additional languages require their own isolated validation runtimes; the tutor/history model does not depend on JavaScript. Each fixture runs in a fresh QuickJS WASM runtime with a memory limit and execution deadline. No Node, filesystem, network, module loader, clock, random source, or host callbacks are exposed. The reference must pass all fixtures. A candidate labeled correct must pass all; a candidate labeled buggy must have a real mismatch or runtime exception. Timeouts and harness failures reject the exercise instead of counting as evidence of a bug.

Expected results and reference code come from the same agent. Execution catches contradictions and concrete bugs; it cannot prove alignment with the written specification or exhaustive correctness. V1 deliberately avoids arbitrary runtimes and package installation. More independent/property-based oracles, held-out assessments, and delayed follow-up sessions would strengthen a later experiment.

## Providers

Codex runs with ephemeral sessions, read-only sandboxing, a strict output schema, and tool/plugin/instruction discovery disabled. A version preflight rejects Codex older than 0.153.4 before making a model request; the app never silently drops isolation options for an older executable. `CODE_SWIPE_CODEX_BIN` can select a supported installation when the server inherits a different PATH from the terminal. OpenCode uses a dedicated temporary config/session directory and denies all tools while retaining existing authentication. Both run without a shell, with bounded output, a deadline, and cancellation. Temporary files are removed afterward. Errors distinguish unsupported options, schema incompatibility, authentication, limits, network failures, and process exits without exposing raw CLI logs. A normal provider error does not silently substitute demo data.

The default per-call deadline is three minutes; a repair may use another call. Cancellation kills the child process group on Linux/macOS. Windows only guarantees termination of the direct CLI process. Model output and validation reports are checked before publication. Only local requests can trigger planning; the HTTP server checks Host, Origin, request type, and browser cross-site metadata.

To start a separate experiment without altering an existing notebook, set `CODE_SWIPE_DATA_DIR` to a new directory. The old data remains available by pointing back to it. No migration from the previous Firebase-based version is included.
