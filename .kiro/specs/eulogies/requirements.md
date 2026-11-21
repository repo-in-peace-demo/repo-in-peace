# Requirements: Eulogies

## Introduction

Every grave gets a short epitaph, written once when the analyser runs, by a local open-source model served by Ollama on the same machine, and stored in the graveyard data file. The detail panel shows it with a credit to the model. The deployed app never calls a model, and nothing leaves the machine. The tone follows `product.md`: two sentences, atmospheric and lightly witty, accurate about what the file did, never mocking of authors, never inventing facts.

The work splits like the rest of the project: the eulogy pipeline is pure (building the prompt, trimming contents, checking and cleaning the output, the cache key), tested with fast-check and a fake model client; the Ollama client and the cache file are thin I/O at the edge.

## Glossary

- **Eulogy**: the epitaph of one grave (a current file or a ghost), plain text, at most two sentences and `EULOGY_MAX_CHARS` (240) characters.
- **Model**: an Ollama model, named by the user (`--eulogy-model`), for example `qwen2.5:7b`.
- **Prompt version**: a number in the analyser's code, raised whenever the prompt's wording or its inputs change, so cached eulogies are regenerated.
- **Contents budget**: the most of a file's contents sent to the model, `CONTENTS_BUDGET_BYTES` (4096), from the start of the file.
- **Cache**: a JSON file of eulogies already written, keyed by a hash of the model, the prompt version and the exact inputs.

## Requirements

### 1. Turning it on

1. THE analyser SHALL take three new optional flags: `--eulogies` turns eulogies on; `--eulogy-model <name>` names the Ollama model, with no default; `--ollama-url <url>` names the Ollama server, default `http://localhost:11434`.
2. WITHOUT `--eulogies` THE analyser SHALL behave exactly as before: no request is made, every eulogy is `""`, and the output is byte-identical to what it wrote before this spec (apart from the agreed schema change, Req 5).
3. `--eulogies` without `--eulogy-model` SHALL be a command-line error (exit 2) that says how to choose and pull a model. `--eulogy-model` or `--ollama-url` without `--eulogies` SHALL also be an error, so a typo does not silently skip the eulogies.
4. THE Ollama URL SHALL be on this machine: its host SHALL be `localhost`, `127.0.0.1` or `::1`. Any other host SHALL be a command-line error, because file contents are sent to it (Req 7).
5. THE analyser's rule that it reads only the local clone and calls no network service (repo-analyser Req 1.4) SHALL be amended: with `--eulogies`, and only then, it MAY call the given local Ollama server, and nothing else.

### 2. Before generating

1. WITH `--eulogies` THE analyser SHALL check, before writing any eulogy, that the Ollama server answers and that the model is installed. IF the server does not answer THEN it SHALL stop (exit 1, no output file) with a message to start Ollama (`ollama serve`, or open the app). IF the model is not installed THEN it SHALL stop with a message naming the command to install it (`ollama pull <name>`) and listing the models that are installed.
2. These checks SHALL come after the analysis itself has succeeded (git and Knip), so an unusable clone is still reported first, and before the first eulogy request.

### 3. What the model is given

1. For each **current file** the model SHALL be given: the file name, its path, its state and flags in the project's one vocabulary (for example "Stale (21–45 days), Unused"; the names and rules of the interface spec, moved to `shared/` so the analyser and the frontend use the same words), its lines of code, the subject line of its last commit, and its contents at the snapshot commit, cut to the contents budget.
2. For each **ghost** the model SHALL be given: the file name, its path, the date it was deleted (a calendar day, UTC), the subject line of the deleting commit, and its contents at its last existing commit, cut to the contents budget.
3. THE model SHALL NOT be given author names or e-mail addresses. Commit subjects SHALL have any author names and e-mail addresses of the repository removed before they are sent.
4. Contents SHALL be cut to at most the contents budget in bytes, at the last whole line within it (or at the budget when the first line is longer), never splitting a UTF-8 character, and marked as cut when they were. A binary or empty file SHALL be described as such, with no contents.
5. THE prompt SHALL state the tone and the rules of Req 4 in plain words and ask for the eulogy alone.

### 4. What a eulogy must be

1. At most two sentences and at most 240 characters, plain text, on one line: no markdown, no quotes around it, no emoji, no line breaks.
2. Atmospheric and lightly witty, accurate about what the file does or did. Never mocking of authors, and never naming an author or a handle.
3. It SHALL NOT invent facts, and SHALL NOT quote code, strings, URLs or anything that looks like a key or a token.
4. A pure post-processing step SHALL enforce the format: trim; remove markdown (emphasis, headings, list markers, code marks); remove wrapping quotes; collapse whitespace to single spaces; cut to the first two sentences; cut to the length limit at a word boundary, ending with a full stop when it was cut.
5. THE post-processing SHALL reject the output (leave the eulogy empty) WHEN it contains a code-like string (a code fence or backtick, an arrow `=>`, a call with brackets, a semicolon at a clause end, braces, `import`/`export`/`const`/`function` followed by an identifier), a URL or domain, a secret-like string (a long run of hexadecimal or base64 characters, a JWT, a known key prefix such as `sk-`, `ghp_`, `AKIA`), an e-mail address, any author name or handle of the repository, or nothing left after cleaning. Mentioning the file's own name (for example `index.ts`) SHALL be allowed.
6. WHEN the output is rejected THE analyser SHALL ask once more with the same inputs and a reminder of the rules; IF that is rejected too THEN the eulogy SHALL stay empty.

### 5. The data file

1. THE schema SHALL go to version 3: every ghost gets an `eulogy` field (a string, `""` when none) like the files' existing one, and `meta` gets `eulogyModel` (the model's name, or `null` when the analyser ran without `--eulogies`).
2. THE frontend SHALL load both version 2 and version 3 files. A version 2 file SHALL be read as having empty ghost eulogies and no model. The analyser SHALL always write version 3.
3. Every eulogy written SHALL belong to a file or a ghost in the same data file; the eulogy field SHALL be the only thing eulogies change in the data.

### 6. Requests, failures and the cache

1. Requests SHALL use a low temperature (0.2) and a fixed seed, ask for a short answer (at most about 120 tokens), run at most `--eulogy-concurrency` at a time (1 to 4, default 2), and each SHALL time out after 60 seconds.
2. IF one grave's request fails (timeout, an error from the server, or output rejected twice) THEN its eulogy SHALL stay empty and the analyser SHALL go on; the other graves are never affected. At the end it SHALL report on stderr how many eulogies were written, taken from the cache, and left empty, and why.
3. IF the server stops answering part-way THEN the analyser SHALL leave the rest empty after a few consecutive failures, rather than wait out every timeout, and say so. The output file is still written.
4. Results SHALL be cached in a JSON file, keyed by a hash (SHA-256) of the model name, the prompt version and the exact inputs of Req 3. A re-run with the same inputs SHALL reuse the cached eulogy without a request, so re-runs are fast and give the same text; a change of model, prompt version or any input SHALL ask the model again. Empty results SHALL NOT be cached (they are tried again next time).
5. THE cache file SHALL NOT be inside the frontend's public folder or any folder that is served or committed by default: by default it is `analyser/.cache/eulogies.json` (git-ignored), and `--eulogy-cache <file>` names another. A cache file that cannot be read SHALL be reported and treated as empty; it is written atomically at the end, and every 25 eulogies, so an interrupted run keeps what it had.
6. Progress SHALL go to stderr (how many of how many), and stdout stays empty as now.

### 7. Privacy

1. Everything SHALL run on this machine: file contents and commit subjects are sent only to the local Ollama server named by `--ollama-url` (Req 1.4), and only with `--eulogies`.
2. THE analyser README SHALL say so, and say how to choose and install a model.

### 8. The frontend

1. THE detail panel SHALL show a non-empty eulogy as an epitaph: italic, set apart from the facts, with a small credit "written by <model>" from `meta.eulogyModel`. A ghost's eulogy SHALL be shown the same way.
2. AN empty eulogy SHALL keep the placeholder of the interface spec.
3. THE eulogy SHALL be shown as text only, never as markup (it came from a model).

## Correctness properties

Each property gets a fast-check test. No model and no network in the tests: a fake client returns chosen outputs.

| # | Property | Covers |
| --- | --- | --- |
| P1 | Post-processing output is always at most two sentences and at most 240 characters, on one line, with no markdown or wrapping quotes, for any input. | Req 4.1, 4.4 |
| P2 | Any output containing a code-like, URL, secret-like or e-mail string, or an author's name, is rejected (empty), wherever in the text it appears. | Req 4.3, 4.5 |
| P3 | The cache key changes whenever the model, the prompt version or any input changes, and is the same for the same inputs. | Req 6.4 |
| P4 | Without `--eulogies`, the analyser's output is byte-identical to the output before this spec, apart from the version-3 fields (`meta.eulogyModel: null`, empty ghost eulogies). | Req 1.2, 5.1 |
| P5 | Every eulogy written belongs to a file or ghost present in the data; a failure (or a rejection) for one grave never changes another's eulogy. | Req 5.3, 6.2 |
| P6 | Cut contents never exceed the budget in bytes, are a prefix of the original, never split a UTF-8 character, and end at a line end when one fits. | Req 3.4 |

Supporting properties:

- **P7** The prompt never contains an author name or e-mail address of the repository, for any file and commit subject (Req 3.3).
- **P8** The command line: `--eulogies` needs `--eulogy-model`; the model and URL flags need `--eulogies`; a non-local URL is refused; concurrency is 1 to 4 (Req 1.3, 1.4, 6.1).
- **P9** The frontend reads a version 2 file exactly as a version 3 file with empty ghost eulogies and no model (Req 5.2).
- **P10** With a fake client, a re-run against a filled cache makes no request and gives the same data file (Req 6.4).

## Out of scope

- Calling any model from the deployed app.
- The PR function, and the bury and resurrect animations (spec 5).
- Translating eulogies, or rewriting them by hand in the app.

## Open questions for review

1. **Schema version 3** (Req 5.1). I propose a version bump with `ghost.eulogy` and `meta.eulogyModel` always present, the frontend reading 2 and 3. The alternative is to stay at version 2 and add both as optional fields written only with `--eulogies`; then the output without `--eulogies` stays byte-identical with no exceptions, but files and ghosts would differ (one has the field always, the other sometimes). Which?
2. **The cache's place** (Req 6.5). "Next to the output" would put it in `frontend/public/graveyards/` for the demo files, which the site serves to anyone, and it holds file contents' hashes and the eulogies of every model tried. I propose `analyser/.cache/eulogies.json` (git-ignored) with `--eulogy-cache` to move it. Agreed?
3. **Local only** (Req 1.4). I propose refusing any Ollama host other than this machine, since file contents are sent. A remote Ollama on your own network would then not be usable. Agreed?
4. **The shared vocabulary** (Req 3.1). To give the model the state and flags "in our shared wording", I propose moving the names and rules (`FACT_NAMES`, `factRule`) from `frontend/src/model/grave-facts.ts` to `shared/vocabulary.ts`, imported by both. The frontend's behaviour does not change.
5. **Commit subjects** (Req 3.1, 3.2). The analyser's git log does not read messages today. I propose adding the subject line (`%s`) to the one log it already reads, so there is no extra git call per file, and sending only the subject, not the body.
6. **Author names in commit subjects** (Req 3.3, 4.5). Commit subjects can contain names ("Merge PR from alice"). I propose removing the repository's author names and e-mails from subjects before sending, and rejecting any eulogy that contains one. Agreed?
7. **Concurrency** (Req 6.1). A flag `--eulogy-concurrency` (1 to 4, default 2), or a fixed 2?
8. **The secret and code filters** (Req 4.5) will reject some harmless eulogies (one mentioning `useEffect()` with brackets, say). I prefer rejecting too much over leaking: a rejected eulogy is retried once, then left empty. Agreed?
