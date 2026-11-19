---
inclusion: always
---

# Tech

## Stack
- **Language:** TypeScript everywhere, `strict` mode on. No `any` without a comment explaining why.
- **Frontend:** Vite + React + Three.js via react-three-fiber (with drei helpers).
- **Analyser:** Node.js command-line tool in TypeScript. Reads a local git clone; uses the git CLI for history and Knip's JSON reporter for unused files.
- **PR function:** one Vercel serverless function in TypeScript, calling the GitHub REST API.
- **Tests:** Vitest for unit tests, fast-check for property-based tests.
- **Hosting:** Vercel. The frontend is static; the PR function is the only live server code.

## Architecture rules
- The analyser runs ahead of time and writes one **graveyard data file** (JSON) per repo. The browser only loads these files. The browser never calls the GitHub API.
- The graveyard data file has a versioned schema shared by the analyser and the frontend from one types module. Change the schema only through that module.
- All time-based scores are computed relative to the **snapshot commit date**, never the current clock, so the same snapshot always produces the same output.
- Layout must be deterministic: the same data file always produces the same scene.
- The PR function uses a fine-grained GitHub token scoped to the demo fork only, read from an environment variable. Never log or expose it. Rate-limit requests per client.

## Testing rules
- Every spec lists its correctness properties; each one gets a fast-check property test.
- Keep pure logic (scoring, layout, data shaping) separate from rendering and I/O so it can be property-tested.

## Working agreement
- Don't run install, build, migration or deploy commands. Write the code and tell me which command to run; I run them myself.
- Prefer small, readable modules over clever abstractions.