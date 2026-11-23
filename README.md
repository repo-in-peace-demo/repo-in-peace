# Repo In Peace

Repo In Peace turns a JavaScript or TypeScript repository into a haunted 3D graveyard, so you can find and bury dead code. Folders are fenced plots, files are tombstones (taller for more lines), and every effect means one fact: moss for a file left untouched, a lean for an ancient one, cracks and a faint red glow for a file Knip reports unused, a lit candle for a hot one, and a translucent ghost for a deleted file. It is a nod to SGI's FSN, the early-1990s 3D file browser, made for Kiroween 2026 (Resurrection).

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

1. **Boot screen.** A bare address opens a green terminal that types a short boot (any key or click skips it) and lists the demo graveyards with their file counts; the first is marked, so Enter opens it. **Open a graveyard file…** (or a file dropped on the screen) reads a `.graveyard.json` in your browser only. No file yet? See [Analyse your own repo](#analyse-your-own-repo).
2. **Digging.** A short screen while the file loads and the scene is built, with the real counts ("exhuming 129 graves…").
3. **Scene.** The camera rises from a low shot into the overview (any input ends the move). Hover a grave for a summary line, click it for the detail panel, browse every grave in the list, or search with `/` or Cmd+K. "← Graveyards" (or the browser's Back) returns to the boot screen.

A direct link such as `?graveyard=demo.oikosledger` skips the boot screen and goes straight to digging, then the scene. A file opened from disk is not kept across a reload: a reload returns to the boot screen.

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
