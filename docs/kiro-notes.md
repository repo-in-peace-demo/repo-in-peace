# How we used Kiro

Notes for the write-up: how the specs, steering and property tests shaped Repo In Peace. Kept short and factual; each spec's own `requirements.md`, `design.md` and `tasks.md` in `.kiro/specs/` holds the detail.

## Steering

Three always-on steering files (`.kiro/steering/`) set the rules every spec followed:

- **product.md**: every effect maps to one fact in the data; the scene must stay readable, not just spooky; eulogies never invent facts; Bury and Resurrect only ever open a pull request.
- **tech.md**: TypeScript strict everywhere; one shared, versioned schema; every time-based score relative to the snapshot commit, never the clock; deterministic layout; pure logic kept apart from rendering so it can be property-tested; and a working agreement that Kiro writes the code and names the commands, and the human runs installs, builds and the full test suites.
- **structure.md**: where pure logic, scene components and panels live, and that `.kiro/` is always committed.

## Specs

| Spec | What it built |
| --- | --- |
| `repo-analyser` | A local git clone in, one graveyard data file out: ages, sizes, decay, Knip's unused files, and ghosts for deleted files |
| `graveyard-scene` | The 3D scene: nested plots, tombstones, moss, cracks, candles and ghosts, signs, the camera and its limits, the atmosphere, the opening move |
| `interface` | Everything around the scene: boot screen → digging → scene, the hover line, the detail panel, the list and search |
| `bury-and-resurrect` | Real pull requests on demo forks from the detail panel, through one serverless function, with session-only scene changes |
| `eulogies` | A two-sentence epitaph for every grave, written at analysis time by a local model through Ollama, stored in the data file and shown in the detail panel |

## The interface spec, step by step

1. **Requirements, then questions.** Kiro wrote the requirements and a list of open questions instead of guessing. Answering them changed the spec:
   - **Bury only on unused stones**, whatever their age. The first wording ("cracked or ancient") would have offered to delete old code that is still used, which is stable, not dead. The concept doc was corrected to match.
   - **Ghosts after the stones** in the default sort: a clean-up list should not push the unused stones down with files that are already gone.
   - **Filters**: kinds (fresh, stale, ancient, ghosts) combine with OR, flags (unused, hot) with AND, and the two groups with AND. Read literally, "every active filter" would have made fresh + stale match nothing.
   - **The demo list** comes from a Vite plugin reading the folder, so the analyser stays unaware of it.
   - A **richer hover line** was added during review, with calendar dates rather than snapshot-relative ages, which are easy to misread at a glance.
2. **Design**, then **tasks**, reviewed before any code. One task (freeing the GPU resources of a scene when leaving it, with a check that switches demos five times) was added in review.
3. **Pure model first** (routes and app flow, the demo list, the boot text, the shared wording, panel placement, list rows, the virtual window, search ranking), each with property tests, then one section of the interface per task, each with a browser check and a screenshot.

## The flow: boot screen → digging → scene

- A bare address shows the **boot screen**. `?graveyard=<name>` links go straight in, so the address can be shared and Back returns to the boot screen.
- The **digging screen** shows the real counts and never adds more than a second of waiting.
- The **scene** opens with its opening move. Leaving it frees its GPU resources.
- A file can be opened from disk; it is read in the browser and never uploaded (and, by choice, not kept across a reload: `docs/backlog.md`).

## Properties that guard it

Each property is a fast-check test beside its module (`frontend/src/model/*.property.test.ts`):

| | Property |
| --- | --- |
| P1 | Filtering returns exactly the rows of a selected kind (OR) that have every selected flag (AND) |
| P2 | Sorting is deterministic, ties fall back to path, reversing twice is the identity, and stones come before ghosts |
| P3 | Search ranks an exact name above a prefix, above a name match, above a path-only match |
| P4 | Whatever selects a grave (scene, list, search), the store holds it and exactly one list row is highlighted (checked end to end in the browser) |
| P5 | The state sentence names the file's decay state, its age and the data file's threshold |
| P6 to P13 | The demo list, the version check for picked files, the digging screen's timing, the panel's side, path shortening, the hover line, UTC dates (tested in a +14 h time zone), and Bury exactly on unused stones |

## The eulogies spec: decisions

- **A local model only.** The Ollama URL must name this machine (`localhost`, `127.0.0.1`, `[::1]`), and cloud models (`…:cloud`) are refused. The cloud rule was added while writing the README, when Ollama's download page showed that such models are reached through the local server, so the URL check alone did not keep contents on the machine. Repo-analyser Req 1.4 (no network) was amended for this one call.
- **No schema bump.** `ghost.eulogy` and `meta.eulogyModel` are optional and written only with `--eulogies`, so the schema stays at version 2 and, without the flag, the output is byte-identical (checked against the golden file and on generated repositories).
- **The cache lives in `analyser/.cache/`**, ignored by git, not in `frontend/public/`. It holds model output for many repositories and is not something to serve.
- **Strict filters, no repair.** An answer with code, an e-mail, a URL, a secret-like string or an author's name is rejected, asked for once more, then left empty. Names, e-mails and handles are also redacted from what the model sees, and only commit subjects are sent. The panel then says "Words failed us for this one." If the first 8 answers are all rejected, the run stops and suggests another model, rather than writing a graveyard of empty stones.
- **Reasoning models.** Requests send `think: false`, and any `<think>` block (closed, unclosed or stray) is removed before the checks. A fake-server test covers a model that thinks anyway.
- **Found by property tests while building:** a keyword rule that took "let it rest" for code; long file paths taken for secrets; markdown, emoji and quotes wrapping each other (`" > A`), which needed removing together until nothing changed. Also, the model check counts answers in path order, so whether a run stops never depends on which request finished first.
- **Found by reading the first real run** (251 eulogies from `qwen2.5:7b`): every one began "Here lies", copying the single example; two were cut mid-thought by the length cut; `logger.ts` was called "old and unused" though it is stale and used; living files were called "forgotten" and "silent". The revision gives each grave a tone from its facts and an opening picked from its path, keeps only whole sentences, rejects open quotes and claims the facts contradict, and puts a cleaning-rules version in the cache key beside the prompt version, because the cache stores cleaned text. Replaying the first run's eulogies through the new checks found a false hit ("never forgotten") before the regeneration.
- **Found by reading the second run:** the per-tone examples were copied (one word for word onto 4 graves, its last sentence onto 27, its opening onto about half), and "for decades" or "since time immemorial" was said of files 16 to 65 days old. The prompt now has no example and gives each file's age in days; copies of the old examples and age claims on files under a year old are rejected.
- **Found by reading the third run:** openings varied and ages were mostly right, but the model echoed the prompt ("Age: 16 days before snapshot", "Begin by speaking to the file…"), said "here lies" of used files, gave wrong ages ("for two decades" on a 20-day-old file), and passed doc comments off as epitaphs. Each became a check; that was the last eulogy round: the demos are committed with the fourth run's result, whatever it is.
- **Time-agnostic, after the last run:** giving the model each file's age made it write "Last updated 17 days ago" on dozens of graves, which reads relative to today, not the snapshot (`src/panel.ts`: "Last updated just four days ago"). The prompt now gives no age and asks for none, and a cleaning rule drops any sentence stating an age or time. The rule was applied to the committed eulogies without re-running the model: 68 of 231 changed, 5 emptied.
- **Found by the code, not the design:** `git cat-file --batch` answers with a blob's SHA, not the `<commit>:<path>` it was asked for, so ghosts' contents need a `git rev-parse` step first.

## The Bury and Resurrect spec: decisions

- **One function, the server decides.** `api/pr.ts` accepts only a demo name, an action and a path, and checks them against the demo's data file on the server: Bury only on a file marked unused, Resurrect only on a ghost. The title and body are built there too. P1 runs random requests (with a fork name and an `@everyone` eulogy added by the "browser") through the handler and checks that only eligible ones reach GitHub, and that what reaches it carries nothing the browser sent.
- **The base head rule.** The branch starts from the fork's base branch head; Bury needs the file to be there, Resurrect needs the path to be free, otherwise it refuses with a message, so a pull request never conflicts with what the fork has now.
- **Byte for byte.** Resurrect reuses the original blob and mode from the last existing commit; no file content passes through the function. Trees are read one folder at a time, so a large repository never hits GitHub's truncation limit.
- **One pull request per grave.** Deterministic branch names (`rip/<action>/<stem>-<hash8>`, checked against `git check-ref-format`), an existing open pull request returned first, and fallbacks at the two places concurrent requests can collide. The fake GitHub server's test runs up to eight at once and checks that one pull request is opened, and that the requests really overlapped.
- **Nobody notified.** `@` and `#<digit>` from the data get a word joiner; paths and SHAs go in code spans. A property test found that its own helper mis-read a backslash inside a code span; the helper now scans as CommonMark does.
- **The token stays put.** Fine-grained, forks only; messages come from fixed error kinds, never from GitHub's body; every response and log line is redacted as a last guard (P5 echoes the token in GitHub's errors and headers). The e2e dev server ignores any token (`RIP_FAKE_PRS=1`), so a test can't open a real pull request.
- **Session only.** The scene changes (sinking stone and mound, settling ghost and new stone, numbered stakes) last for the visit, since the data file doesn't change until a merge. The first screenshots caught a ghost's tag still floating in front of its new stone: camera-facing cards ignore an instance's scale, so hidden instances are moved below the ground.

## Where specs and steering caught things

- **Snapshot-relative ages** (tech.md) are the reason the hover line shows calendar dates and the detail panel shows both: an age counted from the snapshot reads as "days ago" from today unless the panel says otherwise.
- **No uploads** (the "browser only reads data files" rule) shaped Open a graveyard file: the File API only, with no request carrying the file's content.
- **Pure logic apart from rendering** let a property test find a real layout bug while building the interface: a packing rule added during the scene's density pass could stretch 0.6% of large synthetic graveyards to 2.6 times as long as wide. It is now capped at 2.2, with the reason recorded in the scene's design.
- **The working agreement** (the human runs the long commands) kept each step small: Kiro ran only the typecheck and the test files it touched, and every browser check and screenshot was run by the human and looked at before the next step.
