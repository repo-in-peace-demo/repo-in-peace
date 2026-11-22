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

1. **Boot screen.** A bare address opens a green terminal that types a short boot (any key or click skips it) and lists the demo graveyards with their file counts; the first is marked, so Enter opens it. **Open a graveyard file…** (or a file dropped on the screen) reads a `.graveyard.json` in your browser only.
2. **Digging.** A short screen while the file loads and the scene is built, with the real counts ("exhuming 129 graves…").
3. **Scene.** The camera rises from a low shot into the overview (any input ends the move). Hover a grave for a summary line, click it for the detail panel, browse every grave in the list, or search with `/` or Cmd+K. "← Graveyards" (or the browser's Back) returns to the boot screen.

A direct link such as `?graveyard=demo.oikosledger` skips the boot screen and goes straight to digging, then the scene. A file opened from disk is not kept across a reload: a reload returns to the boot screen.

## Bury and Resurrect

On the demo graveyards, **Bury** on an unused stone opens a real pull request that deletes the file, and **Resurrect** on a ghost opens one that restores it byte for byte as it was at its last commit. Both go to demo forks in a GitHub organisation of their own, never to the original repositories, and always as a pull request. A small serverless function (`frontend/api/pr.ts`) opens them; it checks every request against the demo's data file on the server and holds the only token, scoped to the forks. For the rest of the visit the stone sinks under a mound of fresh earth, or the ghost becomes a stone, each with a stake showing the pull request number. See `frontend/README.md`.

## Make your own graveyard

```
cd analyser
npm install
npm run analyse -- <path-to-a-full-clone> --out ../frontend/public/graveyards/<name>.graveyard.json
```

Add `--eulogies --eulogy-model <model>` to have a language model on your own machine (through [Ollama](https://ollama.com)) write a short epitaph for every grave; nothing is sent anywhere else. See `analyser/README.md` for choosing a model.

A file dropped into `frontend/public/graveyards/` appears on the boot screen on the next load (the demo list is made from the folder). Or keep it anywhere and use **Open a graveyard file…**. See `analyser/README.md` for the options and `frontend/README.md` for the frontend.

## Licence

MIT, see `LICENSE`. Everything the scene shows is made in code; see `docs/credits.md`.
