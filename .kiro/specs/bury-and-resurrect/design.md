# Design: Bury and Resurrect

References are to `requirements.md` in this folder. Decisions 1 to 10 there are settled.

## Overview

```
browser (detail panel)                    frontend/api/pr.ts (Vercel function: GET, POST)
  GET /api/pr  ─────────────────────────▶  config: which demos have working actions
  POST /api/pr {graveyard, action, path} ▶  parse ─▶ throttle ─▶ check against the server's data file ─▶ openPullRequest
                                                                                                           │ GitHub REST API
  ◀── {number, url, existing}  ◀──────────────────────────────────────────────────────────────────────────┘ (Git Data API, Pulls)
session store (pr-store) ─▶ list marker, panel link, scene overrides (sink + mound, settle + stone)
```

- **One function**, `frontend/api/pr.ts`, exporting Web-standard `GET` and `POST` handlers (Vercel's Node runtime; no dependency). It is thin: it reads the environment and calls `handlePr` in `frontend/server/pr/handler.ts`, which takes everything it needs as arguments, so tests call it directly with `Request` objects and a fake GitHub.
- **Pure logic** lives in `frontend/server/pr/` (outside `api/`, so Vercel doesn't make each file a function): request parsing, the check against the data file, branch names, the tree change, the pull request text, the limits. Each has fast-check tests beside it.
- **I/O at the edge:** the GitHub client (`github.ts`, Node's `fetch`), reading the demo data file (`graveyards.ts`), and the handler.
- **Local development:** a Vite dev plugin (`vite-plugins/api-dev.ts`) routes `/api/pr` (and the dev-only `/api/fake-pr/<n>` page) to the same `handlePr`, so `npm run dev` and the e2e tests run the real function code. `vercel dev` works too.
- **Frontend:** a client (`ui/pr-client.ts`), a session store (`store/pr-store.ts`), a pure scene-override model (`model/pr-scene.ts`), and changes to the detail panel, list, hover label, legend and scene.

## Configuration (`server/pr/config.ts`)

Environment variables, never prefixed `VITE_`, so Vite never puts them in the bundle:

| Variable | Example | |
| --- | --- | --- |
| `GITHUB_TOKEN` | `github_pat_…` | the fine-grained token (Req 7.1) |
| `RIP_DEMOS` | `{"demo.oikosledger":{"repo":"repo-in-peace-demo/oikos_ledger","base":"main"},"demo.spatialql":{"repo":"repo-in-peace-demo/spatialql","base":"main"}}` | demo name to fork and base branch (Req 1.1) |
| `RIP_PR_CAP` | `50` | optional, the open pull request cap (Req 6.1) |

```ts
type Mode = 'production' | 'development';
interface PrConfig { mode: Mode; token: string | undefined; demos: ReadonlyMap<string, { repo: string; base: string }>; cap: number }
function readConfig(env: Record<string, string | undefined>, mode: Mode): PrConfig | { problem: string };
```

- `RIP_DEMOS` is validated: an object; each key a demo name by the app's rule (`[A-Za-z0-9._-]{1,100}`) with a file in `public/graveyards/`; each `repo` `owner/name` with GitHub's characters; each `base` a valid branch name. A malformed value is a configuration problem: in production every action is refused, and the log says which entry is wrong (never the token).
- **Mode:** `api/pr.ts` uses `development` only when `VERCEL_ENV === 'development'` (`vercel dev`); everything else, including Preview deployments, is `production`. The Vite dev plugin passes `development`.
- **Without a token:** in production, `GET` answers `{ available: false }` and `POST` 503 "Pull requests aren't set up on this deployment." In development, the fake flow (below).

## The HTTP contract (`server/pr/handler.ts`)

```ts
interface PrDeps {
  config: PrConfig;
  github: (token: string) => GitHubClient;          // the real client, or one pointed at the fake server
  readGraveyard: (name: string) => Promise<Graveyard>; // reads public/graveyards/<name>.graveyard.json, validated, cached
  throttle: Throttle;                                // per instance
  clientKey: (request: Request) => string;           // first x-forwarded-for address, or the socket's in development
  log: (line: string) => void;
}
function handlePr(request: Request, deps: PrDeps): Promise<Response>;
```

- **`GET /api/pr`** → `200 { available: true, demos: { "demo.oikosledger": { repo, base } }, fake: boolean }`, or `{ available: false }`. Changes nothing (Req 5.4).
- **`POST /api/pr`** with `Content-Type: application/json` and a body of at most 2 KB: `{ graveyard, action, path }`. Other fields are ignored (Req 5.1).

| Answer | Status | When |
| --- | --- | --- |
| `{ number, url, repo, existing: false, fake? }` | 201 | a new pull request |
| `{ number, url, repo, existing: true, fake? }` | 200 | an open one already existed (Req 4.3) |
| `{ error }` | 400 | malformed body, missing or wrong-typed fields, unknown action |
| | 403 | `Origin` present and not this site; a cross-site request |
| | 404 | unknown or unconfigured demo; a path not in its data file |
| | 409 | the path isn't eligible (Bury on a used or missing file, Resurrect on a non-ghost); the base branch doesn't match (Req 2.4, 3.4); the fork is full (Req 6.1) |
| | 413, 415 | body too large; not JSON |
| | 429 | throttled, with `Retry-After` (Req 6.2) |
| | 502 | GitHub failed (Req 6.3) |
| | 503 | not configured in production |

- Every answer has `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`, and goes through `redact` (P5).
- **Order of work:** method and content type → body parse (`request.ts`) → `Origin` check → throttle (`limits.ts`) → config lookup → data file check (`check.ts`) → `openPullRequest` (or the fake). Nothing reaches GitHub until every local check has passed (P1).
- **Log:** one line per `POST`: `pr bury demo.oikosledger app/lib/x.ts -> #12 (new)` or `-> refused: <reason>`. Never a header, a body from GitHub, or the token.

### Parsing and checking (`request.ts`, `check.ts`, P1, P7)

```ts
type Action = 'bury' | 'resurrect';
function parseRequest(body: unknown): { graveyard: string; action: Action; path: string } | { error: string; status: 400 };
type Eligible = { action: 'bury'; file: FileEntry } | { action: 'resurrect'; ghost: Ghost };
function checkAgainstGraveyard(g: Graveyard, action: Action, path: string): Eligible | { error: string; status: 404 | 409 };
```

- `path` is a string of 1 to 1,024 characters; it is used only after it matches a path in the data file exactly, so it can't name anything else.
- Bury: a current file with `unused: true` (`buryOffered`), else 409 "Only unused files can be buried; <path> is used." Resurrect: a ghost, else 409 "Only deleted files can be resurrected." A path in neither list: 404.
- The data file is read on the server with the shared `validateGraveyard`, once per instance per demo.

### Reading the data file (`graveyards.ts`)

`readFile(join(process.cwd(), 'public', 'graveyards', `${name}.graveyard.json`))`, only for a name in the configuration. `frontend/vercel.json` bundles those files with the function:

```json
{ "functions": { "api/pr.ts": { "includeFiles": "public/graveyards/*.graveyard.json" } } }
```

The function's working directory is the project root (`frontend/`) both on Vercel and in the Vite plugin.

## Opening a pull request (`server/pr/open-pr.ts`, P3, P4)

```ts
interface Fork { owner: string; repo: string; base: string }
function openPullRequest(gh: GitHubClient, fork: Fork, eligible: Eligible, g: Graveyard, cap: number): Promise<OpenResult>;
type OpenResult = { number: number; url: string; existing: boolean } | { refused: string; status: 409 };
```

Steps, with the GitHub REST endpoints (API version header `2026-03-10`):

1. **Branch name** `rip/bury/<slug>` or `rip/resurrect/<slug>` (`branch.ts`, below).
2. **Existing pull request?** `GET /repos/{o}/{r}/pulls?state=open&head={o}:{branch}`. If there is one, return it (`existing: true`). This comes before the cap, so a full fork still returns existing ones.
3. **Cap:** `GET /repos/{o}/{r}/pulls?state=open&per_page=100` (up to 10 pages), counting those whose head is in the fork and starts with `rip/`. At the cap: refused, "This demo has 50 open Repo In Peace pull requests, the most it allows. It's reset regularly; try again later."
4. **Base:** `GET /git/ref/heads/{base}` → base commit SHA; `GET /git/commits/{sha}` → base tree SHA.
5. **Look up the path** in the base tree by walking it one folder at a time (`GET /git/trees/{sha}` per folder, no `recursive`, so a large repository never hits the truncation limit). `lookupPath(tree, path)` returns the entry (`mode`, `type`, `sha`) or nothing.
   - Bury: the entry must be a blob (Req 2.4), else refused "<path> is no longer on <base> in <fork>, so there is nothing to bury."
   - Resurrect: there must be no entry at the path and no file at any of its parent folders' paths (Req 3.4), else refused "<path> already exists on <base> in <fork>, so there is nothing to resurrect."
6. **Resurrect only, the original blob:** `GET /git/commits/{lastExistingSha}` → its tree, then the same walk to the path → `{ mode, sha }` of a blob. If it isn't there (the fork doesn't have that history), refused "The fork doesn't have <path> at <short sha>." No content is downloaded.
7. **Tree:** `POST /git/trees` with `base_tree` = base tree and one entry (`tree-change.ts`): Bury `{ path, mode: <existing mode>, type: 'blob', sha: null }` (deletes it); Resurrect `{ path, mode, type: 'blob', sha: <original blob> }`.
8. **Commit:** `POST /git/commits` with that tree, `parents: [base commit]`, message `RIP <path>` or `Resurrect <path>` plus a blank line and "Opened by Repo In Peace from the demo graveyard.". Author and committer default to the token's owner.
9. **Branch:** `POST /git/refs` `refs/heads/{branch}`. On 422 (already exists): look for an open pull request again (step 2); if there is one, return it (a concurrent request won); otherwise `PATCH /git/refs/heads/{branch}` with `force: true` to point it at the new commit (Req 4.4: an old branch whose pull request was closed).
10. **Pull request:** `POST /pulls` `{ title, body, head: branch, base, maintainer_can_modify: false }`. On 422 "A pull request already exists": look it up (step 2) and return it.

**Concurrency (P4):** two requests for the same path race only at steps 9 and 10. The second either finds the first's pull request, or force-points the branch at its own commit (the same one-file change on the same base) and gets 422 at step 10, then returns the first's pull request. Either way there is one pull request. The fake GitHub server's test runs N requests at once and checks exactly one `POST /pulls` succeeds.

### Branch names (`branch.ts`, P2)

`branchName(action, path) = rip/<action>/<stem>-<hash8>`:
- `stem`: the path lower-cased, every run of characters outside `[a-z0-9._-]` replaced by `-`, `/` included; `..`, a leading `.` or `-`, a trailing `.` or `.lock`, and runs of `-` collapsed; cut to 60 characters; `file` when nothing is left.
- `hash8`: the first 8 hex characters of SHA-256 of the exact path, so `a/b.ts` and `a-b.ts` differ.
- The result always passes `isValidRefName` (git's `check-ref-format` rules, written out in the test): no `..`, no control characters, no `~^:?*[\`, no `@{`, no component starting with `.` or ending in `.lock`, no trailing `/` or `.`.

### The tree change (`tree-change.ts`, P3)

`treeEntry(eligible, found)` returns the single entry for `POST /git/trees`. For the property test, `applyTreeChange(baseFiles, entry)` applies it to a flat `path → {mode, sha}` map the way GitHub does; P3 checks that the result differs from the base by exactly one path, removed (Bury) or added with the ghost's original `sha` and `mode` (Resurrect). The fake GitHub server uses the same semantics on its nested trees, so the end-to-end test checks the commit GitHub would hold.

### The pull request text (`pr-text.ts`, P7)

Built only from the server's data file and the fork:

```
Title: RIP app/lib/hooks/useUploadStatus.ts

> Here lies useUploadStatus.ts, once vibrant and full of promise. Now, only memories remain.

**Why it was flagged** (snapshot 2026-08-18, `58b6eee`)
- Unused: nothing in the project imports it (Knip).
- Ancient: last changed Jul 3, over 45 days before the snapshot.

This pull request deletes `app/lib/hooks/useUploadStatus.ts` and nothing else.

Opened by Repo In Peace from the demo graveyard.
```

```
Title: Resurrect src/surface-placement.ts

> <ghost eulogy, when there is one>

**Deleted** Oct 12 by Ann Author in `1a2b3c4`.
This pull request restores `src/surface-placement.ts` exactly as it was at `9f8e7d6`, its last commit before deletion, and nothing else.

Opened by Repo In Peace from the demo graveyard.
```

- The age line uses the shared vocabulary (`FACT_NAMES`, `factRule`) and the same calendar-day formatting as the panel (moved to `shared/` if it isn't there, so the server and the browser agree).
- **Notifying nobody (Req 3.3, 5.3):** paths and SHAs go in code spans (backticks in a path are escaped by choosing a longer fence). Everything else from the data (the eulogy, the deleter's name) goes through `neutralise`: every `@` is followed by a zero-width joiner (`@\u2060`) and every `#` before a digit likewise, so GitHub makes no mention, team mention or cross-reference. The deleter's name is plain text, never `@handle`. The Bury body names nobody.
- The eulogy is a Markdown quotation with any leading `>` or Markdown in it escaped, so it can't add headings or links.

### Limits (`limits.ts`, P6)

```ts
class Throttle { constructor(rules: Array<{ limit: number; windowMs: number }>, now: () => number); take(key: string): { ok: true } | { ok: false; retryAfterSeconds: number } }
```

- Rules: 3 per 60 s and 20 per hour per client key (Decision 4). Every `POST` that parses counts, so probing costs the same as opening. Old entries are pruned on each call; at most 10,000 keys are kept (the oldest dropped).
- The cap is checked in `openPullRequest` (step 3), against GitHub, so it holds across instances.

### The GitHub client (`github.ts`, P5)

```ts
interface GitHubClient { request<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> }
function githubClient(token: string, baseUrl = 'https://api.github.com', fetchImpl = fetch): GitHubClient;
```

- Headers: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2026-03-10`, `User-Agent: repo-in-peace`. A 15 s timeout per call.
- Errors become `GitHubError { status, kind }` with `kind` one of `not-found`, `forbidden`, `rate-limited` (403/429 with `x-ratelimit-remaining: 0` or `retry-after`), `conflict`, `validation`, `server`, `network`. The message the user sees comes from `kind` ("GitHub refused the request: the token can't write to <fork>."), never from GitHub's body.
- `redact(text, token)` replaces the token (and any `github_pat_`/`ghp_` string) with `[redacted]`; the handler applies it to every response body and log line as a last guard.

## Fake pull requests in development

With `mode: 'development'` and no token, after every local check (so the checks are tried for real), the handler answers from an in-memory map `fork + branch → number`: a new number counting from 1 (`201`), or the same number again (`200`, `existing: true`). The URL is `/api/fake-pr/<n>`, which the dev plugin serves as a small page: "This is a fake pull request #<n> from local development: <title>. No request was sent to GitHub." `GET /api/pr` answers `fake: true`. The repo names are taken from `RIP_DEMOS` when set, otherwise `repo-in-peace-demo/<repository name from the data file>` for every demo file, so the flow works with no configuration at all.

## Reset (`frontend/scripts/reset-demo-prs.ts`, Req 8)

```
cd frontend
npm run reset-demo-prs -- --dry-run     # lists what it would close and delete
npm run reset-demo-prs                  # does it
```

Reads `GITHUB_TOKEN` and `RIP_DEMOS` from the environment (or `frontend/.env.local`). For each fork: lists open pull requests whose head is a `rip/` branch in the fork and closes each (`PATCH /pulls/{n}` `state: closed`); lists `GET /git/matching-refs/heads/rip/` and deletes each (`DELETE /git/refs/heads/...`). Prints one line per pull request and branch, and a total. Touches nothing outside `rip/`. Runs with `tsx` (Node 20 can't run TypeScript directly), added as a dev dependency of the frontend.

## Frontend

### Client (`ui/pr-client.ts`, P8)

```ts
type PrAvailability = { kind: 'available'; repo: string; fake: boolean } | { kind: 'local-file' } | { kind: 'not-configured' } | { kind: 'unavailable' };
function availability(source: GraveyardSource, config: PrConfigAnswer | 'unreachable'): PrAvailability;
function openPr(graveyard: string, action: Action, path: string): Promise<PrOutcome>;
function safePrLink(url: unknown, repo: string, fake: boolean): string | null;
```

- `GET /api/pr` once per scene load; a failure or `available: false` → `unavailable` ("Pull requests aren't available right now."). A graveyard opened from a file → `local-file` ("Pull requests are only available on the demo graveyards."), also a demo not in the configuration.
- `safePrLink` accepts only `https://github.com/<repo>/pull/<digits>` for the expected repo (case-insensitive owner and name), or `/api/fake-pr/<digits>` when `fake`. Anything else: the panel shows the number as text with no link.
- Errors show the function's `error` text (as text), or "Couldn't reach the server. Check your connection and try again." Throttled: "Too many pull requests from here; try again in N seconds."

### Session store (`store/pr-store.ts`)

`Map<"file:<path>" | "ghost:<path>", { action, number, url | null, existing, openedAt }>` plus per-grave request state (`idle | confirming | opening | error`). `useSyncExternalStore` like the selection store. Cleared when the scene unmounts (leaving for the boot screen) and on reload.

### Detail panel (`ui/DetailPanel.tsx`)

- **Enabled** when `availability` is `available`. Click → an inline confirmation in the panel (not `window.confirm`): "Open a pull request on repo-in-peace-demo/oikos_ledger that deletes app/lib/hooks/useUploadStatus.ts?" (Resurrect: "… that restores src/surface-placement.ts as it was at 9f8e7d6?"), with **Open pull request** and **Cancel**; Escape cancels the confirmation before it clears the selection.
- **Opening:** the button reads "Opening…", `aria-busy`, not clickable; a polite live region announces the result.
- **Done:** "Pull request #12 opened" (or "Pull request #12 was already open") as a link with `target="_blank" rel="noopener noreferrer"`, replacing the button for the session (Decision 8). Fake: "(fake, local development)".
- **Error:** the message and a **Try again** button.
- **Disabled:** the button with `aria-disabled` and the note for the availability.

### List, hover, search

- A list row with a pull request shows a small `PR #12` marker after its name (text, in the row's accessible name).
- The hover summary gains `· PR #12 open`.
- Search is unchanged; buried and resurrected graves stay findable by path.

### Scene overrides (`model/pr-scene.ts`, pure)

```ts
type GraveOverride =
  | { kind: 'buried'; path: string; number: number; startedAt: number }   // the stone at its slot
  | { kind: 'risen'; path: string; number: number; startedAt: number };   // the ghost at its slot
interface OverrideFrame { sink: number /*0..1*/; mound: number /*0..1*/ } | { settle: number; solid: number };
function overrideFrame(o: GraveOverride, now: number, reducedMotion: boolean): OverrideFrame;
function overridePickBox(o: GraveOverride, model: SceneModel): Box;   // where hover and click find it now
```

- **Bury** (Req 10.1): over 1.5 s, `sink` eases from 0 to 1 (ease-in): the stone instance moves down by its full height plus its base, so it ends below the ground and is hidden; its moss, cracks, glow and candle go with it. From 1.2 s, `mound` rises 0 → 1 over 0.3 s: a low dome of fresh earth (a new small instanced mesh, `Mounds.tsx`, one colour darker and warmer than the ground, slightly rough) at the stone's slot, with the **PR marker** (below) at its head.
- **Resurrect** (Req 10.2): over 1.2 s, `settle` 0 → 1: the ghost stops bobbing, descends to the ground and its opacity rises to 1; then over 0.3 s, `solid` 0 → 1: the ghost is hidden and a clean, upright stone (the fresh look: no moss, no lean, no cracks) appears at the ghost's slot through the existing fade dither, with the PR marker at its foot. Its height is the graveyard's shortest stone, since the data has no line count for a ghost; the legend says so.
- **Reduced motion** (Req 10.3): `overrideFrame` returns the end state at once.
- **Layout never moves** (Req 10.4): overrides only change the drawing of their own grave; positions come from the scene model. The pick box follows (P: an override's pick box sits on its grave's slot).
- **PR marker** (Decision 9): a small wooden stake with a white-painted plate showing `#12`. Digits come from one glyph atlas (`#0123456789`, drawn once on a canvas, like the ghosts' toe-tag atlas), composed per marker, so no texture is made per number.
- The ghosts' and stones' instanced meshes read the overrides each frame through a small store, as the selection ring does; only overridden instances change.

### Legend (`ui/Legend.tsx`, Req 10.6)

While at least one override exists, a group **Pull requests (this session)** appears: "Fresh earth with a stake: a pull request to delete this file is open." and "Clean stone with a stake: a pull request to restore this file is open (its height doesn't show its size)." Each line only when that kind exists.

### Dev API (`scene/dev-api.ts`)

`getPullRequests()` (the session store) and `getOverrideFrame(path)` for the browser tests.

## Files

| File | |
| --- | --- |
| `frontend/api/pr.ts` | Vercel entry: `GET`, `POST`, environment → `handlePr` |
| `frontend/server/pr/config.ts`, `request.ts`, `check.ts`, `branch.ts`, `tree-change.ts`, `pr-text.ts`, `limits.ts`, `redact.ts` | pure, each with tests beside it |
| `frontend/server/pr/github.ts`, `open-pr.ts`, `graveyards.ts`, `handler.ts` | I/O and orchestration, tested against the fake GitHub server |
| `frontend/test/fake-github.ts` | the fake GitHub API server on `127.0.0.1` (below) |
| `frontend/vite-plugins/api-dev.ts` | `/api/pr` and `/api/fake-pr/<n>` in `npm run dev` |
| `frontend/scripts/reset-demo-prs.ts` | the reset command |
| `frontend/vercel.json` | bundles the demo data files with the function |
| `frontend/src/ui/pr-client.ts`, `store/pr-store.ts`, `model/pr-scene.ts`, `scene/Mounds.tsx`, `scene/pr-marker-atlas.ts` | the frontend side |
| `frontend/src/ui/DetailPanel.tsx`, `ListView.tsx`, `HoverLabel.tsx`, `Legend.tsx`, `scene/Stones.tsx`, `scene/Ghosts.tsx`, `scene/Picker.tsx`, `scene/dev-api.ts`, `index.css` | changed |
| `frontend/.gitignore` | `.env`, `.env*.local` (Req 7.2: the token file is never committed) |
| `frontend/tsconfig.json`, `vite.config.ts` | `api`, `server`, `scripts` included; Vitest also runs `server/**/*.test.ts` |

## The fake GitHub server (`frontend/test/fake-github.ts`, Req 11)

A `node:http` server on `127.0.0.1` and a random port, started by each test, holding an in-memory repository: blobs, nested trees, commits, refs and pull requests, seeded from a small file list and a history (so a ghost's `lastExistingSha` exists). It implements exactly the endpoints above with GitHub's status codes and shapes (including 422 for an existing ref or pull request, 422 for deleting a missing path, 404 for unknown objects, and paginated pull request lists), records every request with its headers and body, and can be told to fail a given call (403 rate limit with `x-ratelimit-remaining: 0`, 500, a slow answer, an error body that contains the token).

## Correctness properties and their tests

| # | Test |
| --- | --- |
| P1 | `check.property.test.ts`: for random graveyards (from the frontend's synthetic generator) and random (demo, action, path) with demos inside and outside the configuration, paths from the files, the ghosts and elsewhere, and malformed bodies, `handlePr` accepts exactly Bury on unused files and Resurrect on ghosts of configured demos; the fake GitHub server records no request for any refused one |
| P2 | `branch.property.test.ts`: deterministic; `isValidRefName`; distinct for distinct paths (including paths that differ only in case, separators or characters the stem drops) and for the two actions |
| P3 | `tree-change.property.test.ts`: random base trees; Bury removes exactly the chosen path; Resurrect adds exactly one path with the original sha and mode; plus the end-to-end check on the fake server's resulting commit |
| P4 | `open-pr.test.ts`: the same request repeated, and 2 to 8 at once, against the fake server: one `POST /pulls` succeeds, every answer has the same number; a closed earlier pull request leads to a new one on a force-updated branch |
| P5 | `redact.property.test.ts` and `handler.test.ts`: random tokens, the fake server echoing the token in error bodies and headers; no response body, header or log line contains it |
| P6 | `limits.property.test.ts`: random request times; `take` refuses exactly the requests over each rule, with a correct `Retry-After`; refused requests make no GitHub call; at the cap only existing pull requests are returned |
| P7 | `pr-text.property.test.ts`: random extra fields and values in the browser's body never change the title or body; `@` and `#<digit>` from the data never survive un-neutralised; paths are always in code spans |
| P8 | `pr-client.property.test.ts`: `safePrLink` accepts only the expected fork's pull request URLs (and the fake path when fake), for random strings, other hosts, other repos, `javascript:` and look-alike URLs |

Also: `pr-scene.test.ts` (reduced motion gives the end state; frames are monotonic; pick boxes stay on the slot), and browser checks in `e2e/pull-requests.spec.ts` against the dev server's fake flow: Bury on an unused stone (confirm, progress, fake link, the stone sinks and a mound with `#1` appears, the list row and hover show the marker, the legend gains its group), Resurrect on a ghost, the same Bury again shows "already open", reduced motion changes at once, a reload restores the data file's graveyard, a local file shows the disabled note, and an unreachable function (`page.route` aborting `/api/pr`) shows the unavailable note. Screenshot tests `bury mound` and `resurrect stone`.

## Setup steps (for you; nothing here is run for you)

### 1. The GitHub organisation

1. Go to <https://github.com/account/organizations/new>, choose **Free**, name it `repo-in-peace-demo` (or another free name; use it everywhere below), and finish.
2. In the organisation: **Settings → Third-party Access → Personal access tokens → Settings**. Under fine-grained tokens, choose **Allow access via fine-grained personal access tokens**. For approval, either **Do not require administrator approval**, or require it and approve your own token in step 3.5.

### 2. The forks

For each demo's source repository (`oikos_ledger` and `spatialql`):

1. Open the source repository on GitHub, **Fork**, owner `repo-in-peace-demo`, keep the name, and leave **Copy the `main` branch only** ticked (the label names the default branch) (the default branch carries the history the ghosts need). Or with the GitHub CLI:
   ```
   gh repo fork <source-owner>/oikos_ledger --org repo-in-peace-demo --default-branch-only --clone=false
   gh repo fork <source-owner>/spatialql   --org repo-in-peace-demo --default-branch-only --clone=false
   ```
2. In each fork: **Settings → General → Features**: untick Issues, Wikis, Discussions and Projects (only pull requests are used). **Settings → Actions → General**: **Disable actions**, so the demo pull requests never run the repositories' workflows.
3. Note each fork's default branch (`main` or `master`): it is the base branch in `RIP_DEMOS`.
4. Optional but recommended: make each fork's base branch the commit the demo graveyard was made from, so every unused stone can be buried and every ghost resurrected (otherwise the server refuses graves that have changed since). The snapshot SHAs are in the data files (`meta.snapshotSha`): `58b6eee…` for oikos_ledger, `c2d92f7…` for spatialql. This force-pushes **the fork only**:
   ```
   git clone https://github.com/repo-in-peace-demo/oikos_ledger.git /tmp/oikos-fork && cd /tmp/oikos-fork
   git remote -v
   ```
   **Check before pushing:** both `origin` lines must read `https://github.com/repo-in-peace-demo/oikos_ledger.git` (fetch and push). If either names any other owner (your own account, the source repository), **stop**: you would be rewriting the wrong repository. The push below also refuses by itself unless `origin` is in `repo-in-peace-demo`:
   ```
   git remote get-url --push origin | grep -q '^https://github.com/repo-in-peace-demo/' \
     && git cat-file -e '58b6eeeb6aa911e66bd29827016cfc98359b83c4^{commit}' \
     && git push --force origin 58b6eeeb6aa911e66bd29827016cfc98359b83c4:refs/heads/main \
     || echo "Stopped: origin is not the repo-in-peace-demo fork, or the snapshot commit is missing."
   ```
   Then the same for spatialql (`/tmp/spatialql-fork`, `c2d92f7b915abd8ddc3cf350e293d8896f317b3a`, and its base branch in place of `main`).

### 3. The token

1. GitHub → your avatar → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Name** `repo-in-peace-demo-prs`; **Expiration**: past the hackathon judging (for example 90 days); **Resource owner**: `repo-in-peace-demo`.
3. **Repository access**: **Only select repositories** → the two forks.
4. **Permissions → Repository permissions**: **Contents: Read and write**, **Pull requests: Read and write**. (**Metadata: Read-only** is added automatically.) Nothing else.
5. **Generate**, and copy the token once (it starts `github_pat_`). If the organisation requires approval, approve it under the organisation's **Settings → Personal access tokens → Pending requests**.

### 4. Locally

```
cd frontend
npm install                                   # adds tsx for the reset command
cat > .env.local <<'EOF'
GITHUB_TOKEN=github_pat_...
RIP_DEMOS={"demo.oikosledger":{"repo":"repo-in-peace-demo/oikos_ledger","base":"main"},"demo.spatialql":{"repo":"repo-in-peace-demo/spatialql","base":"main"}}
EOF
git check-ignore -v .env.local                # must print the .gitignore rule; if it prints nothing, stop
npm run dev                                   # Bury or Resurrect on a demo now opens a real pull request
npm run reset-demo-prs -- --dry-run
npm run reset-demo-prs
```

Without `.env.local`, `npm run dev` uses the fake flow.

### 5. Vercel

1. Install and log in to the CLI (or use the dashboard throughout):
   ```
   npm install -g vercel
   vercel login
   cd frontend && vercel link             # create or pick the project
   ```
2. Project **Settings → Build and Deployment**: **Root Directory** `frontend`; **Framework Preset** Vite (detected); build `npm run build`, output `dist`; **Include files outside the root directory in the Build Step**: on (the app and the function import `../shared`). Node.js version 22.x.
3. Environment variables, for **Production** only (Preview deployments then answer "unavailable", which keeps the token off preview builds):
   ```
   vercel env add GITHUB_TOKEN production      # paste the token when asked
   vercel env add RIP_DEMOS production         # paste the JSON on one line
   ```
   Then in the dashboard (**Settings → Environment Variables**) check that `GITHUB_TOKEN` is marked **Sensitive**, so it can't be read back.
4. Deploy: `vercel --prod` (or push to the branch the project deploys from).
5. Check: open the deployed site, `…/api/pr` should show `"available":true` and the two forks; bury one unused stone, open the pull request link, then run the reset command locally.
6. If the token expires or leaks: revoke it in GitHub (**Fine-grained tokens → Revoke**), make a new one (step 3), `vercel env rm GITHUB_TOKEN production`, `vercel env add GITHUB_TOKEN production`, and redeploy.
