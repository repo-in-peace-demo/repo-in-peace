---
inclusion: always
---

# Product: Repo In Peace

## What it is
Repo In Peace turns a GitHub repository into a haunted 3D graveyard so developers can find and bury dead code. It resurrects SGI's FSN (File System Navigator), the early-1990s 3D file browser for IRIX, for the Kiroween 2026 hackathon (Resurrection category).

## Who it's for
- Open-source maintainers who want a quick picture of what has rotted in their repo
- Engineers joining a codebase who need to see what is alive before touching it
- Tech leads planning a cleanup sprint

## Visual language (every effect means one thing)
| In the repo | In the graveyard |
| --- | --- |
| Folder | Crypt or fenced plot; nested folders sit inside |
| File | Tombstone; height = lines of code |
| Recently changed (last commit < 3 months before snapshot) | Clean, upright stone |
| Stale (3–12 months untouched) | Moss creeping up; more moss with age |
| Ancient (> 12 months untouched) | Leaning, heavily overgrown |
| Unused file (Knip) | Cracked stone, faint red glow |
| Deleted file (in git history, not in current tree) | Translucent ghost near its old spot |
| Hot file (many commits in the last month) | Lit candle at the base |

Never add an effect that doesn't map to a fact in the data. The scene must stay readable, not just spooky.

## Actions
- **Bury** (cracked or ancient stone): opens a PR that deletes the file.
- **Resurrect** (ghost): opens a PR that restores the file exactly as it was at its last commit. No rewriting or modernising, ever.
- Both always go through a pull request. Nothing changes a branch directly.

## Eulogies
Each grave gets a short eulogy: two sentences, atmospheric and lightly witty, accurate about what the file did. Never mocking of authors. Never invent facts about the code.

## Non-goals
- AI rewriting code
- Live analysis of arbitrary repos on a server
- Languages other than JavaScript/TypeScript
- Private repos

## Rules from the hackathon
- No SGI, IRIX or FSN logos; no film footage, music or audio we don't own. Recreate the era's look ourselves; sounds and fonts must be original or CC0.