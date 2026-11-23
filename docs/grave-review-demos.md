<!-- Written by the grave-reviewer agent (.kiro/agents/grave-reviewer.json), read-only, run once on 2026-11-24:
     kiro-cli chat --agent grave-reviewer --no-interactive --trust-tools=read,grep,glob "Review both demo graveyard files … Output only the Markdown report."
     (2 min 9 s, 3.27 credits). Kept as it wrote it, except this note and the one at the end. -->

# Graveyard honesty review

## demo.oikosledger.graveyard.json
129 graves, 0 ghosts. Findings: 4 contradictions with the data (check 1), 0 leaked prompts, 0 author names, 0 Knip/graph reports.

### 1. Eulogies that contradict the data
- app/lib/db/queries/recommendations.ts (unused, ancient): "Here lies recommendations.ts, last used in spring's embrace, now winter's chill claims it, unused, ancient, yet not erased." Rule: time stated. It names a season, "spring", and a "winter's chill". The data holds no such date. Last change is 2026-06-13 and the snapshot is 2026-08-18.
- app/lib/db/queries/insights.ts (unused, ancient): "Here lies insights.ts, once vibrant in its queries, now winter's chill, long unused, doth it bequeath." Rule: time stated. It names a season and claims a duration ("long unused") that the data does not give.
- app/lib/db/schema.ts (used, stale, linesOfCode 282): "A weathered schema, steadfast and sound, three hundred eighty-two lines, still in demand." Rule: contradicts the data. It states 382 lines.
- app/components/uploads/UploadStatementModal.tsx (used, stale; imported by TransactionsPanel.tsx): "Still standing tall, though your days are numbered. You've watched many transactions pass through, but now you wait in silence." Rule: a used file mourned. It predicts the file's end and calls it idle, though the file is used.

### 2. Leaked prompt text
No findings. No Path:, Age:, Last change:, Facts:, Begin by, content markers or instructions to the model appear.

### 3. Author names
No findings. No lastCommitAuthor value, handle or e-mail appears in a eulogy.

### 4. Knip versus the import graph
No findings.
- All 12 unused files have an empty importedBy, or are imported only by other unused files. BankAccountsSection.tsx and TransactionList.tsx are imported only by DashboardClient.tsx, which is itself unused.
- Every used file with an empty importedBy has an entry.

### Borderline
- **Season as time of year.** Rule: time stated. The snapshot is 2026-08-18, so "Autumn" fits neither the snapshot nor the June last-change dates. Files: app/app/api/auth/route.ts, app/app/api/bank_accounts/[account_id]/route.ts, app/app/api/insights/query/route.ts, app/app/api/voice/route.ts, app/components/guest/GuestContext.tsx, app/components/transactions/CategoryBadge.tsx, app/components/transactions/MethodBadge.tsx, app/components/ui/card.tsx ("many seasons"), app/components/uploads/UploadHistoryModal.tsx. These may count as atmosphere rather than a stated time.
- **Vague durations.** Rule: age or time stated.
  - app/app/api/bank_accounts/route.ts: "unchanged for many nights".
  - app/app/api/transactions/balances/route.ts: "unchanged for some time".
  - app/lib/hooks/useTransactionCategories.ts: "hasn't changed in quite some time".
  - app/components/transactions/TransactionGroup.tsx: "days gone by".
  - app/app/api/accounts/compare/route.ts: "keeping watch over recent changes".
- **Old-sounding words on stale (not ancient) files.** "Weathered", "worn thin" and "long-standing" are used on:
  - app/components/nav/NavSidebar.tsx
  - app/components/transactions/TransactionsPanel.tsx
  - app/lib/currency.ts
  - app/lib/db/schema.ts
  - app/lib/logger.ts
  - app/lib/hooks/useMacro.ts

 None of them says "ancient" or "old" outright.
- **Used file implied dormant.**
  - app/lib/db/queries/macro.ts (used, stale): "Its lines remain sharp, though the world around has moved on."
  - app/components/uploads/UploadHistoryModal.tsx (used): "its codebase lies fallow".
- **Importer claims on framework entries.** app/app/api/analytics/route.ts: "Still relied upon by others." app/app/api/auth/[...nextauth]/route.ts and app/middleware.ts: "Still relied upon by newer code." Their importedBy is empty, because the framework is the caller.
- **Prompt vocabulary echoed.**
  - app/components/guest/GuestContext.tsx: "long-standing, not unused, still cling."
  - app/components/ui/label.tsx: "Begin to decay slowly… Age well".
  - Several eulogies open "If I could speak…", "If only I could speak…" or "If these walls could speak…".

## demo.spatialql.graveyard.json
120 graves, 2 ghosts. Findings: none in checks 1 to 4. Borderline: see below.

### 1. Eulogies that contradict the data
No findings.

### 2. Leaked prompt text
No findings.

### 3. Author names
No findings. This includes the ghosts' deletedBy.

### 4. Knip versus the import graph
No findings.
- Both unused files, src/assets.ts and src/components.ts, have an empty importedBy.
- Every used file with an empty importedBy has an entry.

### Borderline
- **Used file written as if gone.** Rule: used file mourned.
  - src/tween.ts (used, stale): "If only frames could still see the grace of your animations, dear TweenPool."
  - src/data/join.ts (used, stale): "awaiting the SQL engine's return".
- **Cold file called busy.** Rule: cold file described as busy. These files are not hot.
  - src/dev-layout.ts (2 commits): "alive and ever-changing".
  - src/anchor-settle.ts (2 commits): "Still evolving".
  - src/data/puzzle-checks.test.ts (1 commit): "changing and being used".
  - src/welcome-page.ts (2 commits): "Still in the thick of things".
- **Ghost in the present tense.** src/data/surface-placement.test.ts: "If I could speak now, my tests would still hold true." This speaks as if the file still exists, though the rest of the line ("Gone but not forgotten… flew") treats it as deleted.
- **Content not matching the file.** src/pinch.ts (not a test file): "Morning has brought new fixes to the pinch tests". It also states a change.
- **Season as time of year.** Rule: time stated. The snapshot is 2026-10-18, so "Autumn" fits the date, but the data does not give it. Files: src/anchor-settle.test.ts, src/recenter-prompt.ts, src/recenter-trigger.ts, src/view-comfort.ts, src/welcome-layout.ts, src/data/join-result.test.ts, src/data/key-tints.test.ts, src/data/query.test.ts, src/data/copy-glyphs.test.ts, src/data/puzzle-text.test.ts.
- **Old-sounding words on stale files.** No file is ancient here (threshold 30 days). "Long-standing", "long weathered" and "long-serving" appear on:
  - src/data/compare.ts
  - src/data/key-tints.ts
  - src/data/sample-data.ts
  - src/data/query.test.ts
  - src/xr-support.test.ts
- **Echoed prompt phrasing.** "If I could speak…" or "If only I could speak…" opens eulogies such as src/challenge-start.ts, src/contact-poke.ts, src/press-dip.ts, src/reach-banner.ts, src/dev-flags.test.ts, src/data/recenter-countdown.test.ts and src/challenge-mode.ts.

---

**Checked by hand after the run (Kiro, default agent):** the four findings under check 1 for oikos are real. `app/lib/db/schema.ts` has 282 lines, not 382; `recommendations.ts` and `insights.ts` name a season ("spring", "winter's chill"), which the time-agnostic rule (CLEANING_VERSION 5) misses because it drops month names but not seasons; `UploadStatementModal.tsx` is used (2 importers) and is told "your days are numbered". All four were then rewritten by hand in the demo file, and seasons were added to the time-agnostic rule (CLEANING_VERSION 6) for future runs; the borderline "Autumn's…" sentences were left as they are. The Knip-versus-graph result agrees with the analyser's own report at regeneration (no disagreements on either demo). The borderline items were not checked one by one.
