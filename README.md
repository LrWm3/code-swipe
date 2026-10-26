# Code Swipe — local tutor lab

Read a little JavaScript. Decide whether it's correct or buggy. See the counterexample, then let a tutor figure out what to try next.

This branch rebuilds Code Swipe around a single teaching agent, powered by your installed **Codex** or **OpenCode** CLI. It keeps a notebook of tentative learner hypotheses, plans short lessons, and commits its predictions *before* you answer. Your answers shape the next lesson. No account system, Firebase, subjects, Elo, or mastery tree.

## Try it

Requires Node.js 22+ and npm. From this directory:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:3000**. Click **Try practice demo** for an instant, offline walkthrough, or use your signed-in CLI:

```sh
codex login
# or
opencode auth login
```

Choose your provider in **Setup**, add any interests, and start a lesson. Leave the model blank for the CLI default, or enter a Codex model name / OpenCode `provider/model` identifier. Restart the server after installing a missing CLI. Tested with Codex 0.153.4 and OpenCode 1.17.13; older versions may need updating.

Use the buttons, left/right arrow keys, or the card's swipe handle. Feedback appears after each answer. Finish the batch, then start another lesson to have the tutor reflect on the results. Open **Notebook** to inspect its reasoning and committed predictions. Flag a flawed exercise to exclude that answer from future evidence and metrics.

The demo uses curated examples and neutral predictions. It is not adaptive. For the actual experiment, switch to Codex or OpenCode.

## What this v1 does

- Plans 4, 6, or 8 questions at a time, with explicit assumptions, alternative explanations, and predictions.
- Runs each reference solution and candidate against generated fixtures inside QuickJS, with time and memory limits. Failed batches get one repair attempt before being rejected.
- Saves immutable plan artifacts before showing a question. Answers append to local history; retries do not duplicate them.
- Tracks Brier score and calibration separately for each provider and tutor mode. These measure prediction quality, not learning or mastery.
- Offers a fresh-context baseline that gets the same generation and validation pipeline without learner history or persistent hypotheses.

Exercises are currently **pure, synchronous JavaScript functions** using JSON inputs and outputs. Tests are finite checks, not proofs: a generated specification, reference solution, or fixture can still be wrong. The flag button exists for that reason.

## Local data and model calls

History lives in `.code-swipe/`, which Git ignores. The server listens on loopback only. Your browser needs no API key. Codex/OpenCode still sends lesson context to whichever model provider your CLI uses; those requests use your existing account and its normal limits or charges. “Local” describes the app and its storage, not necessarily inference.

The tutor receives recent answered lessons plus evidence supporting current hypotheses. Baseline mode receives neither. CLI tools, workspace instructions, and plugins are disabled for these planning calls; this app supplies the complete context. OpenCode's global configuration is isolated, so choose a model explicitly if its default is unsuitable. Existing CLI authentication remains in use.

**Export record** downloads plans and raw answers, including answers for any unfinished lesson. Keep it private if you want to preserve the exercise. Back up the entire data directory to restore it; export is for inspection, not an import format. Run only one server against a given data directory.

Optional settings are listed in [.env.example](.env.example). Copy it to `.env` to change the port, data directory, executable paths, or per-call planning timeout. Cancel/retry is available if a provider stalls. Starting the server again keeps completed work and allows a fresh attempt after an interrupted run.

```sh
npm run lint
npm test
npm run build
npm start
```

See [the architecture notes](docs/local-tutor.md) for the experiment's boundaries and [the original project notes](docs/original-project.md) for its earlier design. The original gameplay recording shows that earlier version:

![Original Code Swipe gameplay](docs/assets/code-swipe-gameplay.gif)

Created with Google App Studio
