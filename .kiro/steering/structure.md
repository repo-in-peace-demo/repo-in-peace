---
inclusion: always
---

# Structure

```
repo-in-peace/
├── .kiro/              specs, steering, hooks (always committed)
├── shared/             graveyard data file schema and types, used by analyser and frontend
├── analyser/           command-line tool: git clone in, graveyard data file out
├── frontend/           Vite + React + Three.js app
│   ├── api/            the one serverless function (bury / resurrect PRs)
│   └── public/graveyards/   pre-analysed graveyard data files served to the browser
├── docs/               concept doc, Kiro usage notes for the write-up
├── LICENSE             MIT
└── README.md
```

## Conventions
- Pure logic lives in files named for what they compute (e.g. `decay.ts`, `layout.ts`), with tests beside them (`decay.test.ts`, `decay.property.test.ts`).
- Rendering components live under `frontend/src/scene/`; panels and list view under `frontend/src/ui/`.
- Never add `.kiro` or any of its folders to `.gitignore`.