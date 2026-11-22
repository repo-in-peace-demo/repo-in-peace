# Design: Eulogies

## Overview

The analyser builds the graveyard as now. With `--eulogies`, before it writes the file, it checks the local Ollama server, gathers each grave's inputs from git, asks the model for an epitaph (or takes it from the cache), cleans and checks each answer, and writes the eulogies into the data. Without `--eulogies` none of this runs, and the output is byte-identical to before.

```
 runPipeline ─ git, Knip, history, assemble, validate ─┬─ (no --eulogies) ───────────────────────────────▶ toJson ─▶ write
                                                       └─ --eulogies: checkOllama ─▶ gatherInputs ─▶ runEulogies ─▶ apply ─▶ validate ─▶ toJson ─▶ write
                                                                                     (git cat-file)   (client, cache)
```

Pure parts (fast-check, no network): the inputs, the contents cut, the prompt, the redaction of authors, the cleaning and checks, the cache key, the run's ordering, retry and failure rules (with a fake client), the CLI rules. I/O at the edges: the Ollama client (`fetch`), the cache file, git.

## Shared vocabulary

`shared/vocabulary.ts` gets the names and rules now in `frontend/src/model/grave-facts.ts`: `FactId`, `FACT_NAMES`, `factNameOne`, `GroupId`, `FactGroup`, `FACT_GROUPS`, `INDEPENDENCE_NOTE`, `factRule`. `grave-facts.ts` re-exports them unchanged, so the frontend's imports and tests stay as they are. The analyser imports them by a relative path, as it does the schema.

## Schema (`shared/graveyard-schema.ts`, version 2)

```ts
interface RepoMeta { /* … */ thresholds: Thresholds; /** The Ollama model that wrote the eulogies, when the analyser ran with --eulogies. */ eulogyModel?: string }
interface Ghost    { /* … */ lastExistingSha: string; /** Written with --eulogies ("" when none was); absent otherwise. */ eulogy?: string }
```

- `validateGraveyard`: `meta.eulogyModel`, when present, must be a non-empty string; `ghost.eulogy`, when present, a string. Absent is fine.
- `toJson` (`analyser/src/core/serialise.ts`): `eulogyModel` comes last in `meta`, after `thresholds`, and `eulogy` last in a ghost, each written only when defined. With neither defined the text is what it was, byte for byte. The golden test (`test/golden/default-thresholds.json`) guards this, and P4 checks it for generated repositories.

## Command line (`analyser/src/cli-args.ts`)

```
--eulogies                  Write a eulogy for every grave with a local model (Ollama).
--eulogy-model <name>       The Ollama model, for example qwen2.5:7b. Needed with --eulogies.
--ollama-url <url>          The Ollama server on this machine. Default http://localhost:11434.
--eulogy-concurrency <n>    Requests at a time, 1 to 4. Default 2.
--eulogy-cache <file>       The cache of eulogies. Default analyser/.cache/eulogies.json.
```

The parsed options gain:

```ts
eulogies?: { model: string; ollamaUrl: string; concurrency: number; cachePath: string };
```

`eulogies` is absent without `--eulogies`.

Usage errors (exit 2), each saying what to do:
- `--eulogies` with no model: "Choose a model with --eulogy-model, for example qwen2.5:7b (see the README); install it with ollama pull <name>."
- `--eulogy-model`, `--ollama-url`, `--eulogy-concurrency` or `--eulogy-cache` without `--eulogies`.
- A URL that isn't `http:` or `https:`, or whose host isn't `localhost`, `127.0.0.1` or `[::1]` (Req 1.4).
- A concurrency that isn't a whole number from 1 to 4.
- A cloud model (`isCloudModel`: a tag of `cloud` or ending in `-cloud`), which Ollama runs on its servers even through a local URL (Req 1.4, added in task 13).

The default cache path resolves against the analyser package's folder, not the current folder, so it is the same place wherever the command runs. `--eulogy-cache` resolves against the current folder like `--out`. A cache path inside the clone is refused, as the output is.

## Git: subjects and e-mails

`GIT_LOG_ARGS` adds the author's e-mail and the subject to the header: `--format=%x1e%H%x1f%P%x1f%cI%x1f%an%x1f%ae%x1f%s`.
- The subject is last. Everything after the fifth unit separator is the subject, so a subject with a separator character in it still parses.
- `CommitRecord` gains `authorEmail` and `subject`.
- `core/history.ts` tracks each file's last commit subject and each ghost's deleting commit subject. They go in `FileHistory.lastCommitSubject` and `RawGhost.deletedSubject`, which are internal: `assembleGraveyard` does not copy them into the data.
- `history` also returns the set of author names and e-mails seen (`HistoryResult.people`) for redaction.
- The fixture sample (`test/fixtures/make-git-log-sample.sh`) and the parser tests are updated for the two new fields.

## Inputs (`analyser/src/core/eulogy-input.ts`)

```ts
interface Contents { text: string; cut: boolean; kind: 'text' | 'binary' | 'empty' }
type EulogyInput =
  | { kind: 'file'; path: string; name: string; state: string; flags: string[]; lines: number; subject: string; contents: Contents }
  | { kind: 'ghost'; path: string; name: string; deletedDay: string; subject: string; contents: Contents };
function fileInput(file: FileEntry, history: FileHistory, thresholds: Thresholds, contents: Contents, people: People): EulogyInput;
function ghostInput(ghost: RawGhost, contents: Contents, people: People): EulogyInput;
```

- **State and flags** come from the shared vocabulary: `Stale (21–45 days)`, `Unused (nothing in the project imports it (Knip))`, `Hot (5+ commits in the 30 days before the snapshot)`.
- **Lines and day:** `lines` is the file's lines of code, and `deletedDay` is `YYYY-MM-DD` in UTC.
- **Subject:** passed through `redact` first.

**Contents** (`core/eulogy-contents.ts`, P6): `cutContents(bytes: Uint8Array, budget = CONTENTS_BUDGET_BYTES)`.
- A NUL byte in the first 8 KB, or invalid UTF-8, means `binary`, with no text. Zero bytes means `empty`.
- Otherwise the text is decoded from the longest prefix of at most `budget` bytes that ends at a line end (`\n`). If the first line alone is longer than the budget, it is cut at the budget, backed off to a UTF-8 character boundary. `cut` is true when anything was left out.
- Read from git with the existing batch reader (`mapBlobs`): a current file by its blob SHA, and a ghost by `<lastExistingSha>:<path>`, which `git cat-file --batch` accepts. Both are one batch.

**Redaction** (`core/redact.ts`, P7): `redact(text, people)` replaces every author name, e-mail address and handle of the repository with "someone". A handle is the part of an e-mail before the `@` (after the `+` in GitHub's noreply addresses), at least 3 characters, not only digits, and not a service name like `noreply`; names shorter than 2 characters are not matched.
- Matching is case-insensitive, on word boundaries, longest first.
- Any other e-mail-like string becomes "someone" too.
- It runs on the subjects, and on the contents after they are cut (changed while building: a file can name its author in a comment, and Req 3.3 says the model is never given one). The path and the file name are given as they are, because the eulogy must be accurate about them. The output check (below) still rejects any author name in a eulogy.

## Prompt (`analyser/src/core/eulogy-prompt.ts`)

```ts
const PROMPT_VERSION = 4; // 4: no age given and none asked for
function buildPrompt(input: EulogyInput, retry: boolean): { system: string; prompt: string };
```

- **System message:** "You write epitaphs for files in a code graveyard."
  - The rules, in plain words: two sentences at most and under 240 characters; atmospheric and lightly witty; accurate about what the file does or did, from its contents and name only; never mock or name its authors; never quote code, strings, identifiers with brackets, URLs, keys or tokens; plain text with no quotes, markdown or emoji. Answer with the epitaph only.
  - Match the tone given; call a file unused only if its flags say so, and ancient only if its state does; don't start with "Here lies" unless the tone allows it; prose, not verse.
- **No example eulogy** (second revision, task 16). Version 2 gave one per tone, about an invented `lantern-keeper.example.ts`; the model copied the alive one word for word onto 4 graves, its second sentence onto 27, and its opening ("Every dusk") onto about half. Tone and opening are now described in words only, and copies of the former examples are rejected (below).
- **No ages or dates** (time-agnostic, task 18): the `Age` line of version 3 is gone, and the rules say "Don't mention dates, ages or how recently the file changed". A eulogy is read long after the snapshot, so "four days ago" reads as four days before today, and the panel already shows the dates. (Version 3 gave the age in days and forbade claiming years; the model then wrote "Last updated 17 days ago" on dozens of graves.) The rules still forbid the file name on a line of its own.
- **Tone** (revision after the first real run, task 15), from the grave's facts (`toneOf`):
  - **alive** (fresh and used): living and at work; never forgotten, silent, dormant, dead, unused or ancient;
  - **serving** (stale or ancient, and used): weathered and long-standing, still at its post;
  - **mourned** (unused): may be mourned like a real grave ("here lies" fits);
  - **departed** (a ghost): gone, remembered for what it did.
- **Opening** (revision after the first real run, task 15): one of seven ways to begin (what it does, the graveyard at night, speaking to the file, its name, a time of day, what it keeps, what it would say), chosen from a SHA-256 of the path, so it is the same on every run and the graveyard's eulogies don't all begin alike. The first run's single "Here lies" example made all 251 begin that way.
- **User message:** the facts as labelled lines (`File`, `Path`, `State`, `Flags`, `Lines`, `Last change`, or `Deleted`, `Deleting change`), then `Tone`, `Opening` and the tone's example, then the contents between plain markers with a note if they were cut, "binary file", or "empty file".
- **Retry** adds one line: "Your last answer broke a rule (it quoted code or a name, said something the facts above contradict, left a quote open, or was too long). Write it again, following every rule."

## Cleaning and checks (`analyser/src/core/eulogy-clean.ts`, P1, P2)

```ts
type Cleaned = { ok: true; text: string } | { ok: false; reason: RejectReason };
type RejectReason = 'empty' | 'code' | 'url' | 'secret' | 'email' | 'author' | 'quotes' | 'long' | 'facts' | 'example' | 'prompt' | 'contents';
function cleanEulogy(raw: string, context: { people: People; input?: EulogyInput }): Cleaned;
const CLEANING_VERSION = 5; // part of the cache key: raise it whenever these rules change
```

**Reasoning blocks go first** (P11). Everything from `<think>` or `<thinking>` (any case) to its closing tag is removed. An opening tag with no closing tag removes everything after it, which leaves nothing, so the answer is rejected as `empty`. A stray closing tag removes everything before it.

**Checks next, on the text that's left,** so markdown removal can't hide code:
- **Code:**
  - a code fence or backtick;
  - `=>`, `;` followed by a space or the end, or `{` or `}`;
  - an identifier followed by `(` (except the file's own name);
  - a keyword in a code shape: `const`/`let`/`var` name `=`, `import`/`export` name `from` (or `{`), `function` name `(`, `class` Name `{`, `return` value `;`, `require(` (refined while building: a keyword followed by any word would reject "let it rest" or "return to dust").
- **URL:** `://`, `www.`, or a domain-like `word.tld/…` or `word.(com|org|net|io|dev|app)`. The file's own name, and other file names with a known source extension (`.ts .tsx .js .jsx .mjs .cjs .json`), are allowed.
- **Secret** (checked with file names and paths removed, so a path is never taken for a key):
  - a run of 24 or more hexadecimal characters, or 32 or more base64 characters with a digit among them;
  - a JWT (`eyJ…`.`…`);
  - a known key prefix (`sk-`, `ghp_`, `gho_`, `xox[abp]-`, `AKIA`, `AIza`, `-----BEGIN`).
- **E-mail:** anything `x@y.z`.
- **Author:** any name or e-mail in `people` (case-insensitive, word boundaries).

E-mails are checked before URLs, since an address's domain looks like one.

**Then cleaning:**
- Remove emoji, then markdown: heading marks, list markers and blockquote `>` (again until none is left, as they can be stacked), and emphasis `*` and `_` pairs.
- Remove emoji (Extended_Pictographic and variation selectors) and wrapping quotes (straight and curly, also with a leading "Epitaph:" or "Eulogy:" label).
- Remove a file name the answer wrote as a heading (second revision, task 16): a source file name or path at the very start, alone on its line, before a colon or dash, or before a capitalised word ("daily-flow.test.ts Every dawn…"). A name that is the subject of the first sentence ("route.ts has marked…") stays.
- Also drop a single word alone on the first line, a name used as a heading ("PanelSystem\nA lively guardian…") (third revision, task 17).
- Join lines broken inside a sentence (revision after the first real run, task 15): a break after a lowercase letter or `, ; : —` followed by a capitalised word becomes a space, and the word loses its capital, unless it is "I", has more capitals or digits, or is spelled that way in the file's path or contents (a name such as "Meta"; (third revision, task 17): only if the contents use it after a lowercase word, comma or digit, since "Last" or "Re-exports" starting a comment is an ordinary word). A line ending in a file name keeps the capital of the next word ({R}).
- Collapse all whitespace, including line breaks, to single spaces, and trim. Then remove what is left around the one line (a leading marker, a label, wrapping quotes) together, until nothing changes, since they can wrap each other.
- Drop every sentence that states an age or a time (time-agnostic, task 18) (`withoutTimeSentences`, `statesTime`): "… ago"; a number with days, weeks, months or years ("17 days", "six days young", "twenty-three days"); "over a month"; "for many days", "through the years"; "fortnight", "last week", "this year"; "recently updated", "updated just now"; "last updated/changed/seen/checked…"; "since time immemorial", "since its last change", "since the summer"; "long since", "these days", "lately", "of late"; "though young"; "recent activity", "a fresh change"; a month's name (not May or March, which are also words). The other sentences stay; nothing left is `empty`. A sentence also ends before a digit ("… in focus. 6 days young…"). Words about time that claim no age stay ("every dawn", "by the month", "not for a day", "today's date").
- Keep whole sentences (revision after the first real run, task 15): the first two if they fit in 240 characters (code points), else the first alone; if the first alone doesn't fit, `long` (and the retry). A sentence ends at `.`, `!` or `?`, perhaps with a closing quote, followed by a space and a capital letter, or at the end. A dot inside a file name (`index.ts`) doesn't end one. (The first version cut at a word and added a full stop, which left "…true to the daily and the.")
- An answer with no closing stop gets a full stop.
- Empty after cleaning is `empty`.

**Then checked again, on the cleaned text** (revision after the first real run, task 15). The age checks below stay as a safety net, though the time rule now drops those sentences first (time-agnostic, task 18):
- **Quotes:** straight double quotes in pairs, and curly and angled ones matched; otherwise `quotes`. An answer that opens with a quote is `quotes` too. Wrapping quotes are removed only as a pair, or one at either end with no partner, so a quotation that ends the eulogy keeps its closing quote. Single quotes are not counted, as they are also apostrophes.
- **Facts** (`contradictsFacts`, files only):
  - a used file called "unused", or "no longer used/imported/called", "never used", "nothing imports it";
  - a file that is not ancient called "ancient";
  - a fresh, used file called forgotten, dormant, silent, dead, abandoned or buried;
  - a file under 365 days old said to be years old (second revision, task 16): "for/over/in years, decades, ages, aeons, centuries", "years old/ago", "since time immemorial", "since ancient times", "since the dawn of time", "since time began", "time out of mind", "of yore". Words about time that claim no age ("the years of every account", "many seasons") are allowed.
  - (third revision, task 17) the age patterns also take a number word or "the" before the unit ("for two decades", "despite the years", "through the years");
  - (third revision, task 17) a stated number of days, weeks, fortnights or months ("17 days ago", "forty days and nights", "over a month", "twenty-three days") that is not the file's age: days within 1, weeks and months within a third (at least 3 days); "over"/"more than" and "under"/"less than" as bounds; not a count inside a window ("in the last 30 days"); "a"/"an" only with a bound or "ago", "past", "old" (so "not for a day" passes);
  - (third revision, task 17) "here lies", "rest in peace", "laid to rest" or "R.I.P." on a used file (the unused and the deleted may be mourned).
- **Echo of the prompt** (third revision, task 17) (`echoesPrompt`, `prompt`): a label (`Age:`, `Last change:`, `State:`, `Flags:`, `Tone`, `Opening`, `Path:`, `Contents:`) or instruction wording ("begin by/with", "like a real grave", "the tone", "snapshot", "epitaph", "write it again").
- **Copy of the contents** (third revision, task 17) (`copiesContents`, `contents`): eight words in a row from the file's contents (a doc comment presented as the eulogy). Seven are allowed.
- **Copies of an example** (second revision, task 16) (`copiesExample`): "lantern keeper", or any run of five words in a row from one of the former examples (`FORMER_EXAMPLES`, from prompt versions 1 and 2), is `example`. Four words in a row are allowed.
  - Care for false hits: a word right after "not", "never", "far from", "hardly" and the like doesn't count ("never forgotten", "far from ancient"), nor "unused" before a thing other than the file ("unused imports", "unused slots"), nor "ancient" before "history", "art", "lore", "wisdom" and the like. "Silently" is allowed. Replayed on the first run's 251 eulogies, the checks rejected 14 (`logger.ts`'s "old and unused", `useUploads.ts`'s "no longer called", and "silent guardian" on living files) and one open quote, and no false hit was left.

## Cache (`analyser/src/core/eulogy-key.ts`, `analyser/src/io/eulogy-cache.ts`, P3)

```ts
function cacheKey(model: string, versions: { prompt: number; cleaning: number }, input: EulogyInput): string; // sha256 hex of a canonical JSON
// EULOGY_VERSIONS = { prompt: PROMPT_VERSION, cleaning: CLEANING_VERSION }. The cache stores cleaned text, so a change to the
// cleaning rules must change the key too (added in task 15).
interface CacheFile { version: 1; entries: Record<string, { eulogy: string; model: string; at: string }> }
```

- **Canonical JSON:** the keys are sorted, so the same values always give the same key. `input` is included whole, with the cut contents and the redacted subject, so any change of what the model sees changes the key.
- **Reading:** a missing file is an empty cache. An unreadable or malformed file is reported ("the eulogy cache at … could not be read; starting a new one") and treated as empty.
- **Writing:**
  - written atomically with the existing `writeFileAtomic`, every 25 new eulogies and at the end;
  - only non-empty eulogies are stored;
  - entries for other repositories and models stay, so one cache serves several runs;
  - `at` is the run's `analysedAt`, not the clock.
- **Ignored by git:** `analyser/.gitignore` gets `.cache/`.

## Ollama client (`analyser/src/io/ollama.ts`)

```ts
interface EulogyClient { generate(request: { system: string; prompt: string }): Promise<string> }
function ollamaClient(url: string, model: string, timeoutMs = 60_000): EulogyClient;
async function checkOllama(url: string, model: string): Promise<void>; // throws AnalyserError with what to run
```

- **`checkOllama`** calls `GET {url}/api/tags`.
  - A refused connection, a timeout (5 s) or a non-JSON answer: "Ollama is not running at {url}. Start it with `ollama serve` (or open the Ollama app), then run the analyser again."
  - The model not in `models[].name` (a name without a tag also matches `<name>:latest`): "The model {model} is not installed. Install it with `ollama pull {model}`. Installed: a, b, c."
- **`generate`** calls `POST {url}/api/generate` with `{ model, system, prompt, stream: false, think: false, options: { temperature: 0.2, seed: 7, num_predict: 120 } }` and returns `response`. `think: false` asks a reasoning model to leave its reasoning out; servers that don't know the field ignore it, and any reasoning field in the answer (`thinking`) is never read. It has a 60 s timeout through `AbortSignal.timeout`. Any non-2xx answer, malformed JSON or abort throws.
- It uses Node's own `fetch`, so no dependency is added.

## The run (`analyser/src/core/eulogy-run.ts`, P5, P10)

```ts
interface RunResult { eulogies: Map<string, string>; written: number; cached: number; empty: Array<{ path: string; reason: string }>; stoppedEarly: boolean }
async function runEulogies(jobs: ReadonlyArray<{ path: string; input: EulogyInput }>, deps: {
  client: EulogyClient; cache: Map<string, string>; model: string; concurrency: number; people: People; log: (m: string) => void;
  onNew?: (key: string, eulogy: string) => void }): Promise<RunResult>;
```

- **Order:** jobs are sorted by path, and a fixed pool of `concurrency` workers takes them in order. Results go by path into a map, so the order things finish in never matters.
- **Each job:**
  - The cache is checked first.
  - Then `generate` runs, followed by `cleanEulogy`. A rejection retries once with `retry: true`. A second rejection leaves it empty with the reason.
  - A thrown request (timeout, server error) leaves it empty with the error, and isn't retried.
- **Stopping early:** after 5 request errors in a row with no success in between, the run stops taking new jobs. The rest stay empty, it reports "Ollama stopped answering after N eulogies; the rest are left empty", and `stoppedEarly` is true.
- **A model that never follows the rules** (P12): the run counts answered requests (not cache hits, not thrown requests). If each of the first 8 is rejected after its retry, the run throws `AnalyserError`: "The model {model} wrote no usable eulogy in its first 8 answers (they quoted code, named authors, or broke the format). Try another model, see the README." The pipeline writes no output and keeps nothing new in the cache. One answer that passes switches the check off for the rest of the run. Refined while building:
  - The first 8 answered jobs are counted **in path order**, not in the order requests finish, so the outcome never depends on timing or on `--eulogy-concurrency`.
  - New eulogies are held back from `onNew` (and so from the cache file) until the check has passed. A run that fails it keeps nothing.
- **Isolation:** a job's result depends only on its own input and the client's answers to it, so one failure never touches another (P5).
- **Progress:** `Eulogies: 40/251 (12 from the cache)`, at most once a second, plus a summary at the end:
  ```
  Eulogies: 230 written, 15 from the cache, 6 left empty (4 rejected twice, 2 timed out).
  ```

## Pipeline (`analyser/src/pipeline.ts`)

After the graveyard is assembled and validated, and only with `options.eulogies`:
1. `checkOllama` runs. It fails before any eulogy request. (Refined while building: it runs right after the cheap option checks, before the snapshot, Knip and history, so a stopped server or a missing model fails at once instead of after the slow work.)
2. The inputs are gathered: one `mapBlobs` batch for the files' blobs and the ghosts' blobs, reduced with `cutContents`, then `fileInput` and `ghostInput`. (Refined while building: `cat-file --batch` answers with the object's SHA, not the name it was asked for, so the ghosts' `<lastExistingSha>:<path>` names are first turned into blob SHAs by `resolveBlobNames` in `io/git.ts`, through `git rev-parse` in chunks of 200. A name git cannot resolve gives empty contents.)
3. The cache is read, `runEulogies` runs, and the cache is written every 25 new eulogies and at the end.
4. The eulogies are applied: each file's `eulogy` and each ghost's `eulogy` (`""` when none) are set, along with `meta.eulogyModel`. This is the only change to the data (P5).
5. The data is validated again, then written.

Each eulogy left empty is logged with its reason (`left empty: src/f3.ts (request failed: …)`), the first 20 of them.

`PipelineDeps` gains `eulogyClient?: (url, model) => EulogyClient` and `checkOllama?`, so tests pass a fake client and never touch the network.

## Frontend

- `ui/DetailPanel.tsx`:
  - **Epitaph:** a non-empty eulogy shows in a `<figure className="detail-epitaph">` with the eulogy in a `<blockquote>`. It's italic, slightly larger, centred, between thin rules.
  - **Credit:** `<figcaption>written by {meta.eulogyModel}</figcaption>`, small and dim, shown only when `eulogyModel` is set.
  - **Ghosts:** they use `ghost.eulogy ?? ''`.
  - **Empty:** a dimmed line, "No eulogies were written for this graveyard." when `meta.eulogyModel` is absent, "Words failed us for this one." when it is set (Req 8.2, changed after task 12; it replaces the interface spec's placeholder, which promised eulogies "in a later version").
  - **Text only:** everything is text nodes.
- `index.css`: `.detail-epitaph`.
- **No other frontend change:** the optional fields need none, and the validator accepts them (P9).

## Files

| New | What |
| --- | --- |
| `shared/vocabulary.ts` | the names and rules, moved |
| `analyser/src/core/eulogy-contents.ts`, `eulogy-input.ts`, `redact.ts`, `eulogy-prompt.ts`, `eulogy-clean.ts`, `eulogy-key.ts`, `eulogy-run.ts` | the pure pipeline, each with tests beside it |
| `analyser/src/io/ollama.ts`, `analyser/src/io/eulogy-cache.ts` | the client and the cache file |
| `analyser/.gitignore` | `.cache/` |

| Changed | What |
| --- | --- |
| `shared/graveyard-schema.ts` | the optional fields and their checks |
| `frontend/src/model/grave-facts.ts` | re-exports the vocabulary |
| `analyser/src/cli-args.ts`, `cli.ts` | the flags; help text |
| `analyser/src/io/git-log-parse.ts`, `core/commit-record.ts`, `core/history.ts` | e-mail and subject; last subjects; people |
| `analyser/src/core/serialise.ts` | the optional fields, only when present |
| `analyser/src/pipeline.ts` | the eulogy step |
| `frontend/src/ui/DetailPanel.tsx`, `index.css` | the epitaph and credit |
| `analyser/README.md`, `README.md` | how to install Ollama and choose a model, privacy, the flags |
| `.kiro/specs/repo-analyser/requirements.md` | Req 1.4 amended |

## Testing

| Property | Test |
| --- | --- |
| P1 format | `eulogy-clean.property.test.ts`: any text (with injected markdown, quotes, emoji, line breaks, many sentences, very long), and the output if `ok` is ≤ 2 sentences, ≤ 240 code points, one line, no markdown marks or wrapping quotes |
| P2 rejection | the same file: a clean sentence with a generated code-like, URL, secret-like, e-mail or author string inserted anywhere is rejected; the file's own name is not |
| P3 cache key | `eulogy-key.property.test.ts`: changing any one field (model, version, any input field, one byte of contents) changes the key; equal inputs built in a different key order give the same key |
| P4 byte-identical | `pipeline.test.ts`: the golden test unchanged; and for generated repositories, the output with the eulogy code present and no flag equals the output of `toJson` without the optional fields |
| P5 isolation | `eulogy-run.property.test.ts` with a fake client that fails, rejects or answers per path at random: every key of the result is a job's path; a job's eulogy is the same as when run alone |
| P6 contents | `eulogy-contents.property.test.ts`: any bytes, any budget: ≤ budget, a prefix, valid UTF-8, ends at a newline when one fits; NUL means binary |
| P7 redaction | `redact.property.test.ts`: no name or e-mail of `people` survives, in any case |
| P8 CLI | `cli-args.test.ts`: the combinations and URLs |
| P9 schema | `shared/graveyard-schema.test.ts` and the frontend's `graveyard-load` tests: with and without the fields; wrong types rejected |
| P10 cache re-run | `pipeline.test.ts` with a fake client counting calls: a second run makes no call and writes the same file |

| P11 reasoning blocks | `eulogy-clean.property.test.ts`: any answer wrapped in, or preceded by, a `<think>` or `<thinking>` block (closed, unclosed, upper case) cleans to the answer alone or to empty |
| P12 the model check | `eulogy-run.property.test.ts`: a fake client whose first 8 answers are all rejected stops the run with the model message; any passing answer among them, or cache hits, never do |

The Ollama client gets a test against a local HTTP server started in the test, on a random port of `127.0.0.1`, covering not running, model missing, a timeout, an answer, and a reasoning model that answers with a `<think>…</think>` block before the epitaph. That last one checks that `think: false` is sent and that the eulogy written is the epitaph alone. It's the analyser's own loopback, so no real model is involved.

## Not in this design

- Any call from the deployed app.
- The PR function (spec 5).
- Editing eulogies by hand.
