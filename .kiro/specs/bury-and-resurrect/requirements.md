# Requirements: Bury and Resurrect

## Introduction

The detail panel's two actions become real. **Bury** (an unused stone) opens a pull request that deletes the file; **Resurrect** (a ghost) opens a pull request that restores the file exactly as it was at its last existing commit. Each pull request is opened on a **demo fork** of the graveyard's repository, in a GitHub organisation set up for this, by one serverless function in `frontend/api/`. That function is the only live server code (tech.md). Nothing ever changes a branch directly: every change is a new branch and a pull request (product.md).

The work splits like the rest of the project: the request checks, branch names, tree changes, pull request text and limits are pure and property-tested; the GitHub client and the HTTP handler are thin I/O at the edge, tested against a fake GitHub API server on `127.0.0.1`. The scene gains two session-only animations, since the data file doesn't change until a pull request is merged.

## Glossary

- **Action**: `bury` or `resurrect`.
- **Demo**: a graveyard served from `frontend/public/graveyards/` (for example `demo.oikosledger`) that the server configuration maps to a fork. Only demos have working actions.
- **Fork**: a GitHub repository in the demo organisation (for example `repo-in-peace-demo/oikos_ledger`), with a **base branch** pull requests target.
- **Server configuration**: the mapping from demo name to fork and base branch, and the token. Read by the function only; never sent to the browser except the fork's public name (`owner/repo`), which the confirmation names.
- **Repo In Peace pull request**: an open pull request on a fork whose head branch starts with `rip/`.
- **Session**: one page load. Session state is lost on reload.

## Requirements

### 1. Where pull requests go

1. THE server configuration SHALL map each demo name to one fork (`owner/repo`) and its base branch. It SHALL live in server-side configuration (an environment variable), not in the data file and not in the browser bundle.
2. THE frontend SHALL learn which demos have working actions from the function (a read-only request), not from the data file or a hard-coded list.
3. WHEN a graveyard is a configured demo, loaded by its demo name, THE Bury and Resurrect buttons SHALL be enabled. A graveyard opened from a local file SHALL keep them disabled with the note "Pull requests are only available on the demo graveyards.", even if its contents are the same as a demo's. A demo that is not configured SHALL keep them disabled with the same note.
4. IF the function cannot be reached, or answers that pull requests are unavailable, THEN the buttons SHALL stay disabled with a note saying pull requests aren't available right now.

### 2. Bury

1. Bury SHALL be offered only on unused stones (`buryOffered`, interface spec).
2. IT SHALL create a new branch from the fork's base branch with exactly that one file removed, and open a pull request from it into the base branch, titled `RIP <path>`.
3. THE body SHALL contain the file's eulogy (when it has one, as a quotation), why it was flagged in the shared vocabulary (Unused: "nothing in the project imports it (Knip)"; its age state and rule; its last-changed date as a calendar day), the snapshot it was flagged at (date and short SHA), and a line saying it was opened by Repo In Peace from the demo graveyard.
4. THE branch SHALL start from the base branch's head. IF the file does not exist on the base branch head (it was already removed or moved), THEN no branch or pull request SHALL be created, and the answer SHALL say so: "<path> is no longer on <base> in <fork>, so there is nothing to bury."

### 3. Resurrect

1. Resurrect SHALL be offered only on ghosts.
2. IT SHALL create a new branch from the fork's base branch that adds the file at its old path with **the same blob** it had at its last existing commit (`lastExistingSha`), so the restored file is byte-for-byte identical, including its file mode. Nothing else SHALL change. No rewriting or modernising, ever (product.md).
3. THE pull request SHALL be titled `Resurrect <path>`. Its body SHALL contain the ghost's eulogy (when it has one), when and in which commit it was deleted (calendar day, short SHA, and who deleted it, as the data file and the panel already show), the commit it is restored from, and the Repo In Peace line. The deleter's name SHALL be plain text with no `@` mention, so nobody is notified; any `@` in it SHALL be neutralised.
4. THE branch SHALL start from the base branch's head. IF anything exists at that path on the base branch head (a file, or a folder of that name), THEN no branch or pull request SHALL be created, and the answer SHALL say so: "<path> already exists on <base> in <fork>, so there is nothing to resurrect."

### 4. The Git Data API, branches and duplicates

1. BOTH actions SHALL use the Git Data API: read the base branch's commit and tree, create a tree from it that differs by exactly one path (one removed for Bury; one added with the original blob for Resurrect), create a commit with the base commit as its only parent, and create the branch pointing at it. No file content SHALL pass through the function for Resurrect: the original blob is reused.
2. Branch names SHALL be deterministic and safe: `rip/bury/<slug>` and `rip/resurrect/<slug>`, where the slug is made from the path, is a valid git ref name component, and is different for different paths (a short hash of the full path is part of it).
3. **No duplicates:** IF an open pull request already exists for the same fork, action and path (its head is that branch), THEN the function SHALL return it and SHALL NOT open another. Two requests at the same moment SHALL still give one pull request.
4. IF the branch exists without an open pull request (an earlier one was closed), THEN the function SHALL replace it with a fresh commit on the current base and open a new pull request.

### 5. What the server checks (it never trusts the browser)

1. THE function SHALL accept only: a demo name from its configuration, an action, and a path. Any other field SHALL be ignored, and nothing else the browser sends (a fork name, a branch, a SHA, a eulogy, the file's facts) SHALL be used.
2. IT SHALL check the path against that demo's graveyard data file, read on the server: Bury only if the path is a current file with `unused: true`; Resurrect only if the path is a ghost. Every other combination, an unknown path, an unknown or unconfigured demo, or a malformed request SHALL be rejected with a clear message and no call to GitHub.
3. THE pull request's title and body SHALL be built on the server from that data file. They SHALL notify nobody: any `@name` or `#number` from the data (a eulogy, a name, a path) SHALL be neutralised so GitHub doesn't turn it into a mention or a cross-reference.
4. ONLY `POST` SHALL change anything; the read-only configuration request SHALL be a `GET` and SHALL change nothing.

### 6. Limits

1. WHEN a fork already has the cap of open Repo In Peace pull requests (50), a new one SHALL be refused with a message saying the demo is full and will be reset. Returning an existing pull request (Req 4.3) SHALL still work.
2. EACH client SHALL be throttled (a few pull requests per minute), and a throttled request SHALL be refused with a message saying when to try again (HTTP 429 with `Retry-After`).
3. GitHub's own errors (rate limits, permissions, a missing fork) SHALL be turned into short messages that say what happened, without GitHub's raw response.

### 7. The token

1. THE GitHub token SHALL be a fine-grained token limited to the demo forks, with Contents and Pull requests read and write (and Metadata read, which GitHub requires), read from an environment variable.
2. IT SHALL NEVER appear in a response, a log line, an error message or the browser bundle (P5).
3. IN production, WITHOUT a token or a valid configuration, the function SHALL refuse every action (and the configuration request SHALL say actions are unavailable). IN local development only, WITHOUT a token, the function SHALL return a fake pull request (a made-up number and a link that says it is fake) after the same checks, so the whole flow can be tried locally.

### 8. Reset

1. A reset command, run by the owner from a terminal with the token, SHALL close every open Repo In Peace pull request on every configured fork and delete every `rip/` branch on them, and report what it did. It SHALL touch nothing else (no other branches, no other pull requests).
2. IT SHALL have a dry-run mode that lists what it would close and delete.

### 9. The detail panel

1. ON a configured demo, clicking Bury or Resurrect SHALL first ask for confirmation, naming the fork, the action and the path, for example: "Open a pull request on repo-in-peace-demo/oikos_ledger that deletes app/lib/hooks/useUploadStatus.ts?" (and for Resurrect: "… that restores src/surface-placement.ts as it was at 1a2b3c4?").
2. WHILE the request runs, the panel SHALL show progress and the button SHALL not be clickable again.
3. ON success, the panel SHALL show a link to the pull request (`#<number>`, opening in a new tab, `rel="noopener noreferrer"`). ON failure, it SHALL show the function's message, or a friendly one when the function could not be reached, and let the user try again.
4. WHEN the answer is an existing pull request (Req 4.3), the panel SHALL say it was already open.
5. Everything from the function SHALL be put on the page as text; the link SHALL be used only if it is an `https://github.com/<fork>/pull/<n>` URL for the expected fork (or the fake link in development).

### 10. The scene, for the session

1. **Bury:** after a successful Bury, the stone SHALL sink into the ground over about 1.5 seconds, leaving a small mound of fresh earth with a tiny marker showing the pull request number.
2. **Resurrect:** after a successful Resurrect, the ghost SHALL settle to the ground and become a clean, upright stone (the fresh look) with a small marker showing the pull request number.
3. UNDER reduced motion, both SHALL change at once, with no movement.
4. THESE changes SHALL last for the session only. A reload SHALL show the graveyard as its data file says. The layout SHALL not move: the mound takes the stone's place, and the new stone the ghost's.
5. THE selection, the list and the detail panel SHALL show the pull request link for that grave for the rest of the session (the list as a small marker in the row, the panel as the link instead of the button). Hover, selection and search SHALL keep working on a buried stone's mound and a resurrected stone.
6. EVERY effect SHALL mean one fact (product.md): the mound and the marker mean "a pull request to delete this file is open", the new stone and its marker mean "a pull request to restore this file is open". The legend SHALL explain both while any is shown.

### 11. Tests

1. NO test SHALL call GitHub. The function's tests SHALL use a fake GitHub API server on `127.0.0.1`, started by the test, which records every request.
2. THE fake SHALL be able to answer as GitHub does for the calls used, including errors (404, 409, 422, 403 rate limit).

## Correctness properties

Each property gets a fast-check test.

| # | Property | Covers |
| --- | --- | --- |
| P1 | The server accepts Bury only for unused current files, and Resurrect only for ghosts, of a configured demo; every other combination, unknown path, unknown demo or malformed request is rejected before any GitHub call | 5.1, 5.2 |
| P2 | Branch names are deterministic for the same action and path, valid git ref names, and distinct for different paths and for the two actions | 4.2 |
| P3 | A Bury tree differs from its base tree by exactly one removed path; a Resurrect tree differs by exactly one added path, whose blob SHA and mode are the ghost's original | 2.2, 3.2, 4.1 |
| P4 | Repeated and concurrent requests for the same action and path return the same open pull request and never open a second | 4.3, 4.4 |
| P5 | The token never appears in any response body or header, log line or error message, whatever GitHub answers | 7.2, 6.3 |
| P6 | The throttle and the cap refuse exactly the requests over their limits, and a refused request makes no change on GitHub | 6.1, 6.2 |
| P7 | The pull request title and body are built only from the server's data file: changing anything the browser sends besides demo, action and path never changes them | 5.1, 5.3 |
| P8 | The frontend opens only a pull request link on the expected fork, and puts every message on the page as text | 9.5 |

## Out of scope (backlog)

- Signing in with GitHub to open pull requests on your own repositories.
- Merging pull requests, or updating the graveyard after a merge.
- Several files in one pull request.

## Decisions

Reviewed and approved, with the recommended answer to each open question:

1. **Local development:** a Vite dev plugin routes `/api/*` to the same handlers, so `npm run dev` and the e2e tests run the function. `vercel dev` also works.
2. **Server-side data:** the function reads the demo's graveyard file bundled with the deployment.
3. **Branch base:** the base branch's head. "Matches" means: Bury requires the file to exist on the base branch head; Resurrect requires the path to be absent there. Otherwise the request is refused with a clear message (Req 2.4, 3.4).
4. **Throttle:** in memory per instance, keyed on the client's IP (first `x-forwarded-for` address): 3 pull requests a minute and 20 an hour. The cap of 50 and the reset command are the hard limits.
5. **Repo In Peace pull requests** are recognised by the head branch prefix `rip/`; no labels.
6. **Configuration:** `RIP_DEMOS` (JSON: demo name to `repo` and `base`) and `GITHUB_TOKEN`, environment variables only.
7. **Fake pull requests in development:** numbers count up from 1; the link is a local page saying it is fake.
8. **After a pull request is opened,** that grave shows its link instead of the button for the rest of the session.
9. **The marker** is a small wooden stake with the number, drawn like the ghosts' toe tags.
10. **Names in the body:** Resurrect names the deleter as plain text with no `@` mention, so nobody is notified (Req 3.3); Bury names nobody.
