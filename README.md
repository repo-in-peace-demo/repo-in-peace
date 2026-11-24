<p align="center"><img src="frontend/public/brand/logo.svg" alt="Repo In Peace logo: a carved tombstone with a shovel leaning on it and a mound of earth at its foot" width="200"></p>

# Repo In Peace

Repo In Peace turns a JavaScript or TypeScript repository into a haunted 3D graveyard, so you can find and bury dead code. Folders are fenced plots, files are tombstones (taller for more lines), and every effect means one fact: moss for a file left untouched, a lean for an ancient one, cracks and a faint red glow for a file Knip reports unused, a lit candle for a hot one, and a translucent ghost for a deleted file. It is a nod to SGI's FSN, the early-1990s 3D file browser, made for Kiroween 2026 (Resurrection).

## For judges: how to test

**1. Open it.** <LIVE_URL>. No login or setup. Use a desktop browser with WebGL (recent Chrome, Edge, Firefox or Safari). A mouse is easiest; on a trackpad, one-finger drag orbits and Shift + drag pans.

**2. Pick a graveyard.** The boot screen lists the two demos: `spatialql` has ghosts (deleted files); `oikos_ledger` has the most variety. Direct links skip the boot screen:
- <LIVE_URL>/?graveyard=demo.spatialql
- <LIVE_URL>/?graveyard=demo.oikosledger

**3. Things to try (about 5 minutes).**
- Watch the camera rise into the overview, then find clean, mossy, leaning, cracked (unused) and candlelit (busy) stones, and the floating ghosts. The **Legend** explains each.
- Click a cracked stone: its facts, which files import it, and its eulogy.
- Open the **List** (sorted by decay, most dead first) and click a row to fly to it. Press `/` to search.
- **Bury** an unused stone: confirm, watch the gravedigger, then follow the link to the pull request on GitHub. It deletes exactly that one file on a demo fork.
- **Resurrect** a ghost in spatialql: the ghost rises, a stone forms, and a new pull request restores the file as it was.
- Press `?` for all the controls; Home, or a double-click on empty space, returns to the overview.

**4. About the pull requests.** They go to demo forks in the `repo-in-peace-demo` organisation, never to the original repositories, and always as a pull request. Bury twice on the same file and you get the same pull request. Limits: 3 pull requests a minute and 20 an hour per visitor, and at most 50 open on each fork; if a limit is hit, the app says so. The forks are reset from time to time.

**5. Analyse your own repo (optional).** See [Analyse your own repo](#analyse-your-own-repo).

**6. Known limits.** JavaScript and TypeScript repositories only; desktop browsers; with "Reduce motion" on, the animations are replaced by instant changes.

## How it fits together

```
analyser/   a local git clone in, one graveyard data file (JSON) out       (Node, TypeScript)
shared/     the data file's versioned schema, used by both sides
frontend/   the graveyard in the browser: boot screen → digging → scene    (Vite, React, three.js)
```

The analyser runs ahead of time. The browser only reads data files (the demos in `frontend/public/graveyards/`, or a file you pick), and never calls the GitHub API or uploads anything; Bury and Resurrect go through one serverless function (below).

## Walk a graveyard

```
cd frontend
npm install
npm run dev        # http://localhost:5173/
```

1. **Landing page.** The bare address shows the logo, the title and two buttons; **Enter the graveyard** (or **Take the tour**, which for now does the same) opens the boot screen at `?boot`, and Back returns to the landing page.
2. **Boot screen.** A green terminal that types a short boot (any key or click skips it) and lists the demo graveyards with their file counts; the first is marked, so Enter opens it. **Open a graveyard file…** (or a file dropped on the screen) reads a `.graveyard.json` in your browser only. No file yet? See [Analyse your own repo](#analyse-your-own-repo).
3. **Digging.** A short screen while the file loads and the scene is built, with the real counts ("exhuming 129 graves…").
4. **Scene.** The camera rises from a low shot into the overview (any input ends the move). Hover a grave for a summary line, click it for the detail panel, browse every grave in the list, or search with `/` or Cmd+K. "← Graveyards" (or the browser's Back) returns to the boot screen.

A direct link such as `?graveyard=demo.oikosledger` skips the landing page and the boot screen and goes straight to digging, then the scene. A file opened from disk is not kept across a reload: a reload returns to the boot screen.

## Bury and Resurrect

On the demo graveyards, **Bury** on an unused stone opens a real pull request that deletes the file, and **Resurrect** on a ghost opens one that restores it byte for byte as it was at its last commit. Both go to demo forks in a GitHub organisation of their own, never to the original repositories, and always as a pull request. A small serverless function (`frontend/api/pr.ts`) opens them; it checks every request against the demo's data file on the server and holds the only token, scoped to the forks. For the rest of the visit a gravedigger buries the stone and a fresh grave takes its place, or the ghost screams, rises into the sky and a stone forms where it was, each with a stake showing the pull request number. See `frontend/README.md`.

## Analyse your own repo

You need Node 20 or later and git. The analyser reads a **full** git clone of a JavaScript or TypeScript repository on your machine and writes one graveyard file; nothing is uploaded.

**1. Get Repo In Peace and install the analyser**

```
git clone https://github.com/sl2902/repo-in-peace.git
cd repo-in-peace/analyser
npm install
```

**2. Clone the repository you want to see, with its full history, and install its dependencies** (Knip needs them to tell which files are used)

```
git clone https://github.com/<owner>/<repo>.git ~/graveyards/<repo>
(cd ~/graveyards/<repo> && npm install)
```

Already have a shallow clone? `git -C ~/graveyards/<repo> fetch --unshallow`.

**3. Run the analyser**

```
npm run analyse -- ~/graveyards/<repo> --out ~/graveyards/<repo>.graveyard.json
```

The common flags:

| Flag | When |
| --- | --- |
| `--knip-dir app` | the JS/TS lives in a subfolder with its own `package.json` (repeat for several) |
| `--knip-config knip.json` | the repo has no Knip config, and its defaults flag test files or scripts as unused |
| `--stale-after 30 --ancient-after 90` | an active repo, where 90 and 360 days (the defaults) would call everything fresh |
| `--analysed-at 2026-11-01T00:00:00Z` | the same file byte for byte on every run |
| `--eulogies --eulogy-model qwen2.5:7b` | an epitaph for every grave, written by a model on your machine through [Ollama](https://ollama.com) |

All the options, and how to choose a model, are in [`analyser/README.md`](analyser/README.md).

**4. Open it**

On the [live site](https://repo-in-peace-pi.vercel.app), or locally (`cd ../frontend && npm install && npm run dev`, then <http://localhost:5173/>), choose **Open a graveyard file…** on the boot screen and pick `<repo>.graveyard.json`, or drop it on the screen. It is read in your browser and never uploaded; a reload returns to the boot screen.

To list it on the boot screen of your local copy instead, write it into `frontend/public/graveyards/`: `--out ../frontend/public/graveyards/<repo>.graveyard.json`. Bury and Resurrect work only on the demo graveyards.

## Licence

MIT, see `LICENSE`. Everything the scene shows is made in code; see `docs/credits.md`.
