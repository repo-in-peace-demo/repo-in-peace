# Tasks: Eulogies

References are to `requirements.md` and `design.md` in this folder. Every property test uses fast-check, and test files sit beside their modules. No test uses a real model or the network beyond a fake server on `127.0.0.1` started by the test.

**I don't run installs, builds, Ollama, the analyser on real repositories, or the full suites.** While building I run only the typecheck and the single test files I change. Commands for you are marked **Run**.

Status key: `[x]` done, `[ ]` not started.

---

## Part 1: Shared ground

- [x] 1. Shared vocabulary (`shared/vocabulary.ts`)
  - [x] 1.1 Move `FactId`, `FACT_NAMES`, `factNameOne`, `GroupId`, `FactGroup`, `FACT_GROUPS`, `INDEPENDENCE_NOTE` and `factRule` (and `factRuleSentence` and `factsOf`, which are vocabulary too; `FACT_LOOKS`, how each looks in the scene, stays in the frontend) from `frontend/src/model/grave-facts.ts`. `grave-facts.ts` re-exports them, so no frontend import or test changes.
  - [x] 1.2 Check that the analyser can import it by a relative path, as it does the schema. The analyser's `tsconfig` already includes `../shared`.
  - **Run:** `cd frontend && npm run typecheck && npm test` (nothing should change).
  - _Requirements: 3.1_

- [x] 2. Schema: optional fields (`shared/graveyard-schema.ts`)
  - [x] 2.1 Add `RepoMeta.eulogyModel?: string` and `Ghost.eulogy?: string`, with their checks: a non-empty string or absent, and a string or absent.
  - [x] 2.2 **P9:** a file is valid with and without the fields, and a wrong type is rejected. The frontend's `graveyard-load` tests load a file with the fields. The demo files, which have no fields, still load.
  - [x] 2.3 `analyser/src/core/serialise.ts`: write `eulogyModel` last in `meta` and `eulogy` last in a ghost, only when defined. The golden test stays unchanged.
  - **Run:** `cd analyser && npm run typecheck && npm test`, and `cd ../frontend && npm test`.
  - _Requirements: 5_

- [x] 3. Git: subject and e-mail (`io/git-log-parse.ts`, `core/commit-record.ts`, `core/history.ts`)
  - [x] 3.1 `GIT_LOG_ARGS` gets `%ae` and `%s`, with the subject last and parsed as everything after the fifth separator. Update `test/fixtures/make-git-log-sample.sh`, the sample and the parser tests, including a subject containing a separator character.
  - [x] 3.2 `history` keeps each file's last subject, each ghost's deleting subject, and the people (names and e-mails). None of them goes into the data: the golden output is unchanged.
  - **Run:** `cd analyser && npm test` (includes the live git tests).
  - _Requirements: 3.1, 3.2, 3.3_

## Part 2: The pure eulogy pipeline

- [x] 4. Contents and redaction (`core/eulogy-contents.ts`, `core/redact.ts`)
  - [x] 4.1 `cutContents`.
    - **P6:** for any bytes and budget, the result is at most the budget, a prefix, valid UTF-8, and ends at a newline when one fits.
    - **Examples:** NUL is binary, zero bytes is empty, and a 10 KB file is cut to under 4096 bytes and marked cut.
  - [x] 4.2 `redact` (and `mentionsPerson`, for the output check). A person is a name, an e-mail, or the handle in an e-mail (the part before `@`; after the `+` in GitHub's noreply addresses).
    - **P7:** no name or e-mail of `people` survives, in any case or at any position.
    - **Examples:** "Merge PR #4 from alice/fix" becomes "Merge PR #4 from someone/fix", and an unknown e-mail becomes "someone".
  - _Requirements: 3.3, 3.4_

- [x] 5. Inputs and the prompt (`core/eulogy-input.ts`, `core/eulogy-prompt.ts`)
  - [x] 5.1 `fileInput` and `ghostInput`, with the state and flags in the shared vocabulary ("Stale (21–45 days)", "Unused (nothing imports it (Knip))", "Hot (…)").
  - [x] 5.2 `buildPrompt` and `PROMPT_VERSION`.
    - **P7, second half:** for any input, the prompt contains no name or e-mail of `people`.
    - **Examples:** the retry line is added only on a retry; cut, binary and empty contents are described; the worked example is not about a real file.
  - _Requirements: 3, 4.2, 4.3_

- [x] 6. Cleaning (`core/eulogy-clean.ts`)
  - [x] 6.1 Reasoning blocks are removed first, then the checks, then the cleaning, as in the design.
  - [x] 6.2 **P1, the format:** for any text, including injected markdown, quotes, emoji, line breaks, many sentences and great length, an accepted result is at most 2 sentences and 240 code points, on one line, with no markdown or wrapping quotes.
  - [x] 6.3 **P2, rejection:** a generated code-like, URL, secret-like, e-mail or author string inserted anywhere is rejected with its reason, and the file's own name is not.
    - **Examples:** `useEffect()`, `=>`, a `const x`, `https://`, `ghp_…`, `AKIA…`, a 40-character hex string and `a@b.io` are each rejected, while "index.ts kept the lanterns lit." is accepted.
  - [x] 6.4 **P11, reasoning blocks:** for any answer, a closed, unclosed or upper-case `<think>` or `<thinking>` block cleans to the answer alone, or to empty.
  - _Requirements: 4_

- [x] 7. Cache key (`core/eulogy-key.ts`)
  - [x] 7.1 `cacheKey`: a SHA-256 of canonical JSON (sorted keys).
  - [x] 7.2 **P3:** changing any one field (the model, the version, any input field, or one byte of contents) changes the key. Equal values built in a different key order give the same key.
  - _Requirements: 6.4_

- [x] 8. The run (`core/eulogy-run.ts`)
  - [x] 8.1 `runEulogies`, with:
    - the worker pool, sorted by path;
    - the cache first;
    - one retry on a rejection;
    - an empty eulogy on a thrown request;
    - stopping after 5 request errors in a row;
    - the model check on the first 8 answers;
    - progress and the summary.
  - [x] 8.2 **P5, isolation:** with a fake client that fails, rejects or answers per path at random, every result key is a job's path, and each job's eulogy is the same as when run alone.
  - [x] 8.3 **P12, the model check:** when the first 8 answers are all rejected, the run stops with the model message. When any of them passes, or when some are cache hits, it doesn't.
  - [x] 8.4 **Examples:**
    - concurrency 1 to 4 gives the same results;
    - 5 errors in a row stop the run, with `stoppedEarly`;
    - the summary counts add up to the number of jobs.
  - **Run (checkpoint A):** `cd analyser && npm run typecheck && npm test`
  - _Requirements: 6.1 to 6.3b_

## Part 3: The edges and the pipeline

- [ ] 9. Command line (`cli-args.ts`, `cli.ts`)
  - [ ] 9.1 The five flags, the `eulogies` option, the usage errors from the design, and the help text.
  - [ ] 9.2 The default cache path resolves from the analyser's own folder, and a cache inside the clone is refused.
  - [ ] 9.3 **P8:**
    - `--eulogies` needs `--eulogy-model`;
    - the other eulogy flags need `--eulogies`;
    - only `localhost`, `127.0.0.1` and `[::1]` are accepted, and `http://192.168.1.5:11434` and `http://example.com` are refused with the message;
    - concurrency is 1 to 4.
  - _Requirements: 1, 6.1, 6.5_

- [ ] 10. The Ollama client and the cache file (`io/ollama.ts`, `io/eulogy-cache.ts`)
  - [ ] 10.1 `checkOllama`, and `ollamaClient` with `think: false`, the options and a 60 s timeout.
  - [ ] 10.2 **Fake-server tests:** a `node:http` server on `127.0.0.1` and a random port, started by each test, covering:
    - not running (a closed port): the "start Ollama" message;
    - `/api/tags` without the model: the `ollama pull` message, listing what is installed;
    - a `name` that matches `name:latest`;
    - an answer returned as is;
    - a slow answer timing out (with a short timeout passed in);
    - a non-JSON answer throwing;
    - **a reasoning model:** it answers `<think>I should mention the lanterns…</think>Here lies the router, which kept every path in order. It never once got lost.` The request body is checked to carry `think: false`, and through the pipeline's fake-client path the written eulogy is the epitaph alone.
  - [ ] 10.3 The cache file:
    - read missing, read malformed (reported and treated as empty), and write atomically;
    - entries for another model are kept;
    - empty eulogies are never stored.
  - [ ] 10.4 `analyser/.gitignore`: `.cache/`.
  - _Requirements: 2, 6.1, 6.4, 6.5_

- [ ] 11. The pipeline (`pipeline.ts`)
  - [ ] 11.1 The eulogy step, as in the design: check first, one `mapBlobs` batch, the run, apply the eulogies, validate again, then write. With `--eulogies` every ghost gets `eulogy` and `meta.eulogyModel` is set.
  - [ ] 11.2 **P4, byte-identical:** the golden test is unchanged. For generated repositories, the output without the flag equals the output of the same data with no optional fields.
  - [ ] 11.3 **P10, re-run:** with a fake client counting calls, a run fills the cache, and a second run makes no call and writes the same file byte for byte.
  - [ ] 11.4 **Failure cases, end to end with fakes:**
    - Ollama not running: exit 1, no output file, nothing asked.
    - The model missing: the `ollama pull` message.
    - One grave's request failing: only that eulogy is empty, and the summary says why.
    - The first 8 answers all rejected: exit 1, no output file, the "try another model" message.
  - **Run (checkpoint B):** `cd analyser && npm run typecheck && npm test`
  - _Requirements: 1.2, 2, 5, 6_

## Part 4: The frontend and the docs

- [ ] 12. The epitaph in the detail panel (`ui/DetailPanel.tsx`, `index.css`)
  - [ ] 12.1 A non-empty eulogy shows as an epitaph, with "written by <model>" when `meta.eulogyModel` is set. Ghosts use `ghost.eulogy ?? ''`, and the placeholder stays for an empty eulogy. Text only.
  - [ ] 12.2 **Browser check** in `e2e/interface.spec.ts`. It loads a copy of a demo file with eulogies and a model set, written by the test to a temporary file and opened through Open a graveyard file. It checks:
    - the epitaph and the credit for a stone and for a ghost;
    - the placeholder for a grave with an empty eulogy;
    - a eulogy containing `<b>x</b>` shown as text.
  - [ ] 12.3 Screenshot test `interface epitaph`: the same file, a stone with its epitaph.
  - **Run:** `npx playwright test e2e/interface.spec.ts -g "epitaph"`, then the screenshot. **Commit** with it.
  - _Requirements: 8_

- [ ] 13. Documentation
  - [ ] 13.1 `analyser/README.md`, a "Eulogies" section:
    - installing Ollama;
    - choosing and pulling a model, with what to weigh: size, speed, and following instructions (a few named examples, no default);
    - the five flags;
    - what is sent and where: privacy, this machine only;
    - the cache and how to clear it;
    - what the summary means;
    - what to do when the run stops for the model.
  - [ ] 13.2 The repository `README.md`: one line on eulogies and where they come from.
  - [ ] 13.3 `.kiro/specs/repo-analyser/requirements.md`: Req 1.4 amended for the local Ollama call with `--eulogies` only.
  - [ ] 13.4 `docs/kiro-notes.md`: this spec's decisions (local model only, the schema without a bump, the cache outside `public/`, the strict filters, reasoning blocks).
  - _Requirements: 7_

- [ ] 14. **Final checkpoint** (yours to run)
  - [ ] 14.1 **Run:**
    ```
    cd analyser && npm run typecheck && npm test
    cd ../frontend && npm run typecheck && npm test && npm run e2e
    ```
  - [ ] 14.2 **Run:** install Ollama, pull a model, and regenerate both demo files with eulogies, with the commands I give when task 13 is done (I write them; you run them).
  - [ ] 14.3 **Manual check:**
    - open both demo files and read a few eulogies against the tone rules: two sentences, accurate, no author names, no code;
    - the credit names the model;
    - the summary's empty count is small;
    - a second run is fast (all from the cache) and gives the same file;
    - without `--eulogies`, and with `--analysed-at` set to the committed file's `meta.analysedAt`, the file is byte-identical to the one committed before this spec (`git diff` shows nothing).
  - _Requirements: all_
