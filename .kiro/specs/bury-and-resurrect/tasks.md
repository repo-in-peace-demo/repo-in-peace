# Tasks: Bury and Resurrect

References are to `requirements.md` and `design.md` in this folder. Every property test uses fast-check, and test files sit beside their modules. No test calls GitHub: the function's tests use the fake GitHub server on `127.0.0.1`, started by the test.

**I don't run installs, builds, deploys, the GitHub setup, the reset command, or the full suites.** While building I run only the typecheck and the single test files I change. Commands for you are marked **Run**.

Status key: `[x]` done, `[ ]` not started.

---

## Part 1: Ground

- [x] 1. Secrets and project wiring
  - [x] 1.1 `frontend/.gitignore`: `.env` and `.env*.local`, checked with `git check-ignore -v frontend/.env.local`.
  - [x] 1.2 `frontend/tsconfig.json` includes `api`, `server` and `scripts`; `vite.config.ts` runs `server/**/*.test.ts` in Vitest too.
  - [x] 1.3 `frontend/package.json`: `tsx` as a dev dependency and the `reset-demo-prs` script. `frontend/vercel.json` with `includeFiles` for the demo data files.
  - [x] 1.4 The calendar-day formatting the panel uses (`calendarDay`) is available to the server: moved to `shared/vocabulary.ts` and re-exported from `grave-facts.ts`, so nothing else changes.
  - **Run:** `cd frontend && npm install && npm run typecheck && npm test` (nothing else should change).
  - _Requirements: 7.2_

## Part 2: The pure server logic (`frontend/server/pr/`)

- [x] 2. Configuration and requests (`config.ts`, `request.ts`)
  - [x] 2.1 `readConfig`: `GITHUB_TOKEN`, `RIP_DEMOS` (validated: names, `owner/repo`, branch names), `RIP_PR_CAP`, mode. Malformed configuration is a problem that names the entry, never the token.
  - [x] 2.2 `parseRequest`: `graveyard`, `action`, `path` with their types and lengths; other fields ignored.
  - [x] 2.3 **Examples:** valid and broken `RIP_DEMOS`; bodies with missing, extra and wrong-typed fields.
  - _Requirements: 1.1, 5.1, 7.3_

- [x] 3. The check against the data file (`check.ts`)
  - [x] 3.1 `checkAgainstGraveyard`: Bury only on unused current files, Resurrect only on ghosts; 404 and 409 messages from the design.
  - [x] 3.2 **P1 (pure part):** for random graveyards and paths (from the files, the ghosts and elsewhere), exactly the eligible combinations pass.
  - _Requirements: 2.1, 3.1, 5.2_

- [x] 4. Branch names (`branch.ts`)
  - [x] 4.1 `branchName(action, path)` and `isValidRefName` (git's `check-ref-format` rules, written out).
  - [x] 4.2 **P2:** deterministic; always valid; distinct for distinct paths (including paths differing only in case, separators or dropped characters) and for the two actions.
  - _Requirements: 4.2_

- [x] 5. The tree change (`tree-change.ts`)
  - [x] 5.1 `treeEntry` (Bury: `sha: null` with the existing mode; Resurrect: the original sha and mode) and `lookupPath` over a tree walker; `applyTreeChange` for the tests.
  - [x] 5.2 **P3:** over random base trees, Bury removes exactly the chosen path; Resurrect adds exactly one path with the ghost's original sha and mode. Resurrect is refused when the path, or a file at any parent folder's path, exists.
  - _Requirements: 2.2, 2.4, 3.2, 3.4, 4.1_

- [x] 6. The pull request text (`pr-text.ts`)
  - [x] 6.1 Titles and bodies as in the design, from the data file and the fork only, in the shared vocabulary; `neutralise` for `@` and `#<digit>`; paths and SHAs in code spans; the eulogy as an escaped quotation; the deleter's name as plain text; nobody named in a Bury.
  - [x] 6.2 **P7:** random extra fields in the request never change the text; no `@` or `#<digit>` from the data survives un-neutralised; paths are always in code spans, whatever characters they hold.
  - [x] 6.3 **Examples:** the two bodies from the design, exactly; a eulogy with `> ` and `**`; a name with `@`.
  - _Requirements: 2.3, 3.3, 5.3_

- [x] 7. Limits and redaction (`limits.ts`, `redact.ts`)
  - [x] 7.1 `Throttle` (3 a minute, 20 an hour, an injected clock, pruning, at most 10,000 keys).
  - [x] 7.2 `redact`: the token, and any `github_pat_` or `ghp_` string.
  - [x] 7.3 **P6 (pure part):** for random request times, exactly the requests over each rule are refused, with a correct `Retry-After`.
  - [x] 7.4 **P5 (pure part):** for random tokens embedded anywhere in random text, `redact` leaves none.
  - **Run (checkpoint A):** `cd frontend && npm run typecheck && npm test`
  - _Requirements: 6.2, 7.2_

## Part 3: GitHub, the function and the reset

- [x] 8. The fake GitHub server (`frontend/test/fake-github.ts`)
  - [x] 8.1 An in-memory repository (blobs, nested trees, commits, refs, pull requests) seeded from a file list and a history; the endpoints of the design with GitHub's shapes and status codes (including 422 for an existing ref or pull request and for deleting a missing path, and paginated lists); a record of every request; injected failures (403 rate limit, 500, slow, an error body containing the token).
  - [x] 8.2 Its own tests: a tree change and commit read back as GitHub would return them.
  - _Requirements: 11_

- [x] 9. The GitHub client and opening a pull request (`github.ts`, `open-pr.ts`)
  - [x] 9.1 `githubClient` (headers, the API version, a 15 s timeout, `GitHubError` kinds, messages from kinds only).
  - [x] 9.2 `openPullRequest`, the ten steps of the design, with the base-branch refusals (Req 2.4, 3.4), the cap, and the fallbacks at the branch and the pull request.
  - [x] 9.3 **P3 end to end:** the fake server's resulting commit differs from the base by exactly the one path.
  - [x] 9.4 **P4:** the same request repeated, and 2 to 8 at once: one `POST /pulls` succeeds and every answer has the same number. A closed earlier pull request leads to a new one on a force-updated branch.
  - [x] 9.5 **Examples:** Bury of a file gone from the base; Resurrect onto an existing path; a ghost whose blob the fork lacks; the cap reached (existing pull requests still returned); each injected GitHub failure gives its short message.
  - _Requirements: 2, 3, 4, 6.1, 6.3_

- [x] 10. The handler and the function (`graveyards.ts`, `handler.ts`, `api/pr.ts`)
  - [x] 10.1 `handlePr`: `GET` configuration, `POST` with the order of work, the status table, headers, the log line, the `Origin` check, the fake flow in development.
  - [x] 10.2 `api/pr.ts`: the environment and mode (`VERCEL_ENV`), the real client, the data reader.
  - [x] 10.3 **P1 end to end:** random (demo, action, path) and malformed bodies through `handlePr`; the fake server records no request for any refused one.
  - [x] 10.4 **P5:** the fake server echoing the token in error bodies and headers; no response body, header or log line contains it.
  - [x] 10.5 **P6 end to end:** throttled requests make no GitHub call.
  - [x] 10.6 **Examples:** production without a token (`GET` unavailable, `POST` 503); development without a token (fake numbers counting up, the same number again for a repeat); wrong content type, too large a body, a cross-site `Origin`.
  - _Requirements: 1.2, 5, 6, 7_

- [x] 11. Local development and the reset (`vite-plugins/api-dev.ts`, `scripts/reset-demo-prs.ts`)
  - [x] 11.1 The dev plugin: `/api/pr` to `handlePr` in development mode (reading `frontend/.env.local` through Vite's `loadEnv`, unprefixed), and the `/api/fake-pr/<n>` page.
  - [x] 11.2 The reset command, with `--dry-run`, tested against the fake server: it closes only `rip/` pull requests and deletes only `rip/` branches.
  - **Run (checkpoint B):** `cd frontend && npm run typecheck && npm test`, then `npm run dev` and `curl -s localhost:5173/api/pr` (should show `"fake":true`).
  - (Added while building: `RIP_FAKE_PRS=1`, set by `playwright.config.ts` for its dev server, drops the token, so the e2e tests never open a real pull request even with a token in `.env.local`. The plugin's middleware is tested on a plain `node:http` server, since Vitest skips the plugin.)
  - _Requirements: 7.3, 8_

## Part 4: The frontend

- [x] 12. Client and session store (`ui/pr-client.ts`, `store/pr-store.ts`)
  - [x] 12.1 `availability`, `openPr`, `safePrLink`, the friendly messages; the session store, cleared when the scene unmounts.
  - [x] 12.2 **P8:** `safePrLink` accepts only the expected fork's pull request URLs (and the fake path when fake), for random strings, other hosts and repos, `javascript:` and look-alike URLs.
  - _Requirements: 1.2 to 1.4, 9.5_

- [x] 13. The detail panel, list and hover (`DetailPanel.tsx`, `ListView.tsx`, `HoverLabel.tsx`, `index.css`)
  - [x] 13.1 Enabled or disabled with the notes; the inline confirmation naming the fork, the action and the path; progress; the link, "already open", fake marking; error and Try again; Escape cancels the confirmation first.
  - [x] 13.2 The list row's `PR #n` marker and the hover's `· PR #n open`.
  - [x] 13.3 **Browser checks** in `e2e/pull-requests.spec.ts` (fake flow): Bury and Resurrect through confirmation to the fake link; the same Bury again says already open; the list and hover markers; a local file shows the demo-only note; `page.route` aborting `/api/pr` shows the unavailable note.
  - **Run:** `cd frontend && npx playwright test e2e/pull-requests.spec.ts`
  - _Requirements: 9, 10.5_

- [ ] 14. The scene (`model/pr-scene.ts`, `Stones.tsx`, `Ghosts.tsx`, `Mounds.tsx`, `pr-marker-atlas.ts`, `Picker.tsx`, `Legend.tsx`, `dev-api.ts`)
  - [x] 14.1 `overrideFrame` and `overridePickBox` (pure): the timings of the design; reduced motion gives the end state; the layout is unchanged. Tests: frames are monotonic in time; pick boxes stay on the grave's slot.
  - [ ] 14.2 Bury: the stone sinks with its moss, cracks, glow and candle, then the mound and the stake rise. Resurrect: the ghost settles and becomes a clean, upright stone (the shortest height) with the stake.
  - [ ] 14.3 The stake's glyph atlas; picking on the mound and the new stone; the legend's **Pull requests (this session)** group; `getPullRequests` and `getOverrideFrame` in the dev API.
  - [ ] 14.4 **Browser checks:** after a fake Bury the stone is below ground and a mound shows `#1`; after a fake Resurrect a stone stands at the ghost's slot; reduced motion changes at once; a reload restores the data file's graveyard; the legend group appears and goes.
  - [ ] 14.5 Screenshot tests `bury mound` and `resurrect stone` (close up, after the change).
  - **Run:** `npx playwright test e2e/pull-requests.spec.ts`, then `SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts -g "bury mound|resurrect stone"`. I check the pictures by eye.
  - _Requirements: 10_

## Part 5: Documentation and going live

- [ ] 15. Documentation
  - [ ] 15.1 `frontend/README.md`: the function, local development (fake flow, `.env.local`), the reset command, the environment variables.
  - [ ] 15.2 The main `README.md`: one paragraph on Bury and Resurrect and the demo forks.
  - [ ] 15.3 `docs/kiro-notes.md`: this spec's decisions (one function, server-side checks, the base-head rule, the duplicate handling, no mentions, the session-only scene).
  - [ ] 15.4 `docs/backlog.md`: signing in with GitHub, merging, several files per pull request.
  - _Requirements: all_

- [ ] 16. **Final checkpoint** (yours to run)
  - [ ] 16.1 **Run:**
    ```
    cd frontend && npm run typecheck && npm test && npm run e2e
    ```
  - [ ] 16.2 The setup steps in `design.md`: the organisation, the forks (with the remote check before any force-push), the token, `.env.local`, then one real Bury and one real Resurrect from `npm run dev`, and the reset command (dry run first).
  - [ ] 16.3 Vercel: settings, the two production variables, deploy; `/api/pr` shows the forks; one real pull request from the deployed site; reset.
  - [ ] 16.4 **Manual check:** each pull request on GitHub changes exactly one file (the Resurrect diff shows the file restored byte for byte); the body names nobody with `@`; no notification went to anyone; a second click on the same grave returns the same pull request.
  - _Requirements: all_
