# How we used Kiro

Notes for the write-up: how the specs, steering, hooks, a custom agent, MCP and property tests shaped Repo In Peace. Kept short and factual; each spec's own `requirements.md`, `design.md` and `tasks.md` in `.kiro/specs/` holds the detail.

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
| `importers` | Who imports each file and which files are entry points, from TypeScript's parser and resolver on the snapshot; the detail panel lists the importers as links that fly to them |

## Requirements → design → tasks

Every spec went the same way: requirements with open questions, answered by the human; a design with its correctness properties; tasks; and each step approved before the next. After each task: a commit, the task ticked, and a short report of what was verified and what wasn't. What the steps changed, one example per spec:

| Spec | Decided at | What changed |
| --- | --- | --- |
| `repo-analyser` | requirements | every time-based score is measured to the snapshot commit, never the clock, so the same snapshot gives the same bytes (property P2) |
| `graveyard-scene` | design | one source for each effect (moss is age, lean is ancient, cracks are unused), checked by a property (P8) that no other field changes an effect |
| `interface` | open questions | Bury only on unused stones, whatever their age ("cracked or ancient" would have offered to delete stable code) |
| `eulogies` | requirements review | no schema bump: the two new fields are optional, so output without `--eulogies` stays byte-identical |
| `bury-and-resurrect` | design | the server decides: the function checks every request against the demo's data file, so the browser can't ask for anything else |
| `importers` | open questions | the panel's words follow Knip's verdict; the import graph only explains it, and disagreements are reported, never written into the data |

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
- **Session only.** The scene changes (a sinking stone and a fresh grave, a settling ghost and a new stone, stakes reading "PR #N") last for the visit, since the data file doesn't change until a merge. The first screenshots caught a ghost's tag still floating in front of its new stone: camera-facing cards ignore an instance's scale, so hidden instances are moved below the ground.

## The importers spec: decisions

- **Knip decides, the graph explains.** The panel's words always follow Knip's verdict, so they never contradict the cracked stone; the graph only says why ("only imported by other unused files"). Where the two disagree the analyser reports it and changes nothing. P2 and P3 check that the report holds exactly the files that disagree.
- **The snapshot, not the working tree.** The resolver's file system answers from the snapshot commit's blobs (`io/resolve.ts`), so the graph matches the rest of the data; uncommitted changes get a warning.
- **TypeScript, not a new dependency.** Its parser and `resolveModuleName` already handle `paths`, `extends` and every import form, so `typescript` moved to the analyser's dependencies instead of adding dependency-cruiser.
- **The golden file kept.** Rather than regenerating it, the test removes the two new fields and still compares byte for byte with the old file; a second golden file holds the whole output.
- **A gap the spec exposed.** The committed demo eulogies had been edited in place by later cleaning rules, so no cache key could give them back, and regenerating the demos would have replaced them. `--eulogies-from` copies them from the committed file by path, with no model.
- **Tests that tested nothing.** The end-to-end property's random repositories hold only comments, so they have no imports; P4 got its own generator, with random imports in five forms written in random order.
- **Wording met real labels.** The design's "Entry point: loaded by {label}" read as "loaded by Vite entry" with the labels the analyser actually writes, so the panel says "Entry point: Vite entry".

## Hooks (`.kiro/hooks/`, wired in `.kiro/agents/rip-dev.json`)

Kiro CLI reads hooks from an agent's configuration, not from files of their own, so the four scripts live in `.kiro/hooks/` and the workspace agent `rip-dev` runs them (`kiro-cli chat --agent rip-dev`). Each is a small Node script that reads the hook event on stdin.

| Hook | When | What it does | Where it helped |
| --- | --- | --- | --- |
| `guard-commands.mjs` | before a shell command | blocks the full suites (`npm test`, `npm run e2e`, `vitest run` or `playwright test` with no file, or with only `src`), installs, builds and deploys (`vercel`, `git push`), telling the agent to give the human the command; allows `tsc --noEmit` and single test files | In this project Kiro once ran `npx vitest run src`, the whole frontend suite (1,066 tests) under another name, against the working agreement. That command is in the guard's own test list (`node .kiro/hooks/guard-commands.test.mjs`: 22 blocked, 15 allowed, all from real sessions) and is now blocked. |
| `test-on-edit.mjs` | after a write | for a file under `frontend/src/model/`, `analyser/src/core/` or `shared/`, runs its `x.test.ts` and `x.property.test.ts` with that package's Vitest; a failure exits 1 with the failing tests | The sky director's bat property failed on its first run (a bat's lowest point at 6.58°, under the 6.6° framing treetops); that run was by hand, and this hook makes it automatic. Kiro CLI's documentation says a post-tool hook's stderr is shown to the user as a warning; it doesn't say the model receives it. |
| `session-context.mjs` | session start | adds the branch, `git status --short`, the last 5 commit subjects and the unticked tasks of the most recently changed `tasks.md` | The importers work resumed from a summary saying task 7 was uncommitted after a cancelled call; the hook states that from git at the start, instead of trusting a summary. |
| `data-check.mjs` | after a write | when a demo graveyard file or `shared/graveyard-schema*` changes, validates both demos with `validateGraveyard` (through the analyser's tsx) | Checked on a copy with an importer that isn't a file of the data: `files[0].importedBy[0]: "nope.ts" is not a file in the data`, exit 1. The demos pass (oikos 129 files, 16 empty eulogies; spatialql 120 files, 2 ghosts, 9 empty). |

## A custom agent: `grave-reviewer`

`.kiro/agents/grave-reviewer.json` has only `read`, `grep` and `glob`, so it can't change anything. Its prompt checks a graveyard file for honesty: eulogies that contradict the data (a used file mourned, a stated age or date, a wrong line count), leaked prompt text, author names, and Knip-versus-graph disagreements, quoting each finding. Run once on both demos (2 min, report in `docs/grave-review-demos.md`), it found **4 real contradictions in oikos** that every earlier check had missed: `schema.ts` called "three hundred eighty-two lines" (it has 282); two ancient files given a season ("winter's chill"), which the time-agnostic rule misses because it drops month names but not seasons; and a used modal told "your days are numbered". It found no leaked prompt text, no author names and no Knip disagreements on either demo, which matches the analyser's own report. The four eulogies were then rewritten by hand in the demo file (short, and true to the file: the two one-line files are a comment promising queries that were never written), and seasons became times in the cleaning rules (CLEANING_VERSION 6) so future runs drop them. The 18 "Autumn's…" sentences the review listed as borderline were left as they are.

## MCP: GitHub, read-only

`rip-dev` configures GitHub's remote MCP server (`https://api.githubcopilot.com/mcp/`) with only the `repos` and `pull_requests` toolsets and `X-MCP-Readonly: true`, authenticated by a fine-grained token in `RIP_GITHUB_MCP_TOKEN`, separate from the PR function's token. The check it is for: list the open Repo In Peace pull requests on both forks and confirm each changes exactly one file. Before the token was set, the same question asked of GitHub's public REST API gave: **no open pull requests on either fork**; 5 closed, none merged, each changing exactly one file (oikos #1 to #3: one file removed each, the three Burys; spatialql #1 and #2: `src/data/surface-placement.test.ts` added, the same Resurrect twice, on the same deterministic branch). The run through MCP (2026-11-24, `list_pull_requests` with `state: open` on each fork, then `pull_request_read` with `get_files`): **spatialql has no open pull requests; oikos_ledger has one**, #4 "RIP app/components/bank_accounts/BankAccountsSection.tsx" (a Bury, branch `rip/bury/app-components-bank_accounts-bankaccountssection.tsx-ee845538` into `main`). It changes exactly one file, `app/components/bank_accounts/BankAccountsSection.tsx`, status `removed`, 82 deletions and no additions. That matches the check: one file per pull request, and a Bury only deletes. #4 is new since the REST check above, which found none open.

## Property-based testing

70 numbered correctness properties across the six specs (repo-analyser 7, graveyard-scene 21, interface 16, eulogies 12, bury-and-resurrect 8, importers 6), plus those of the later additions (the gravedigger, the screaming ghost, the sky director): 384 `fc.assert` calls in all. What they caught:

- **In the code:** the packer stretching 0.6% of large synthetic graveyards to 2.6 times as long as wide (below); a keyword rule taking "let it rest" for code; long file paths taken for secrets; markdown, emoji and quotes wrapping each other; a bat path dipping under the framing trees.
- **In the tests:** the pull-request text test's own helper mis-reading a backslash inside a code span (it now scans as CommonMark does); a eulogy property older than the time-agnostic rule, failing on a random sentence "Aa ago!" (seed 375800081); and the end-to-end property's random repositories, which hold only comments, so the import graph's P4 needed its own generator.

## Kiro surprised me

- **The packer behind a flaky test.** A layout property failed on some runs and not others. The cause was real: an area-saving packing rule added in the scene's density pass could make 0.6% of large synthetic graveyards 2.6 times as long as wide. It is capped at 2.2 (commit `dc42ff5`; 8,400 synthetic trees at most 2.186), with the reason in the scene's design.
- **A test that never ended.** During the framing work, `camera-pose.test.ts` hung with a test worker at 100% CPU for minutes. Kiro traced it to the new establishing-shot search in `framing.ts`: its "double the distance until it fits" loop had no limit, and with a 30° field of view no distance fits the graveyard, so the distance doubled to infinity and the loop never ended. Two older tests used 30°, which is why it showed up only there. The loop now stops after 64 doublings with a clear error (`MAX_DOUBLINGS`), and the app falls back to the old camera formula (`legacyShot`) if it ever happens.
- **Stones 0.2 too tall.** The stone shader moved the arch up by 0.5, the arch of a stone 1.0 wide. When stones widened to 1.4 (task 25), every stone was drawn 0.2 taller than its height. It surfaced while boxing stones for the sign-occlusion work, and the arch now follows `STONE_W` (`d657611`).
- **The eulogy-cache trap.** Regenerating the demos for the import graph looked safe, since eulogies are cached. But the committed eulogies had been rewritten in place by later cleaning rules, so no cache key matched them, and a regeneration would have asked the model again and replaced every word. Kiro raised it in the design instead of running it; `--eulogies-from` copies them from the committed file, and the regenerated demos matched the committed ones byte for byte once the two new fields were taken out.
- **`auth.config.ts` as an entry point.** Reading the regenerated oikos data, Kiro found the NextAuth module labelled "Entry point: config" by a catch-all `*.config` rule, though two files import it. The rule now knows only real tool configs (`339d925`), with a test that `app/auth.config.ts` is not an entry point.

## Where specs and steering caught things

- **Snapshot-relative ages** (tech.md) are the reason the hover line shows calendar dates and the detail panel shows both: an age counted from the snapshot reads as "days ago" from today unless the panel says otherwise.
- **No uploads** (the "browser only reads data files" rule) shaped Open a graveyard file: the File API only, with no request carrying the file's content.
- **Pure logic apart from rendering** let a property test find a real layout bug while building the interface: a packing rule added during the scene's density pass could stretch 0.6% of large synthetic graveyards to 2.6 times as long as wide. It is now capped at 2.2, with the reason recorded in the scene's design.
- **The working agreement** (the human runs installs, builds, deploys and the full suites) kept each step small: Kiro ran the typecheck and the test files it touched (single Vitest files, and single Playwright files with `@slow` left out), looked at its own screenshots, and gave the human the commands for the rest. The one lapse (`npx vitest run src`) is why `guard-commands` exists.
- **Every effect means one fact** (product.md) kept decoration from being read as data: the witch, bats, shooting stars, lightning and the gravedigger are in no legend and can't be picked, and the lightning lights only its patch of sky, never the stones whose moss and cracks carry data.
- **No rewriting** (product.md) made Resurrect reuse the original blob and mode, so a restored file is byte for byte what it was.
