import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FileEntry, RepoMeta, Thresholds } from '@shared/graveyard-schema';
import { thresholdsArb } from '../../test/arbitraries';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { MS_PER_DAY } from './age';
import { FACT_GROUPS, FACT_NAMES, factRule, factRuleSentence, stateName, stateSentence, stoneSummary, type FactId } from './grave-facts';
import { buildLegend, legendEntries } from './legend';
import { statsLayout, statsRows } from './overlay-text';
import type { Stats } from './stats';

/**
 * One vocabulary (interface spec, "one vocabulary, grouped by dimension"): for any thresholds, the stats panel, the legend, the detail
 * panel and the hover line use the same names and the same threshold wording for the same fact, because they all take it from
 * `grave-facts.ts`. The hover line carries no threshold (it gives the calendar day); it shares the state's name.
 */

const SNAPSHOT = Date.parse('2026-08-18T00:38:17.000Z');
const meta = (t: Thresholds): RepoMeta => ({ name: 'r', snapshotSha: 'a'.repeat(40), snapshotDate: new Date(SNAPSHOT).toISOString(), analysedAt: new Date(SNAPSHOT).toISOString(), schemaVersion: 2, thresholds: t });
const zero: Stats = { files: 0, folders: 0, ghosts: 0, fresh: 0, stale: 0, ancient: 0, unused: 0, hot: 0 };
const statOf: Record<FactId, keyof Stats> = { fresh: 'fresh', stale: 'stale', ancient: 'ancient', unused: 'unused', hot: 'hot', ghost: 'ghosts' };
const AGE: readonly FactId[] = ['fresh', 'stale', 'ancient'];

const fileIn = (state: FileEntry['decayState'], t: Thresholds): FileEntry => {
  const age = state === 'fresh' ? 0 : state === 'stale' ? t.staleAfterDays : t.ancientAfterDays + 1;
  return { path: 'a.ts', folder: '', linesOfCode: 3, lastCommitDate: new Date(SNAPSHOT - age * MS_PER_DAY).toISOString(), lastCommitAuthor: 'Ann', recentCommits: 0, unused: false, decayScore: 0, decayState: state, hot: false, eulogy: '' };
};

describe('one vocabulary', () => {
  it('for any thresholds: the stats panel, the legend and the detail panel give the same name and the same threshold wording for every fact', () => {
    fc.assert(
      fc.property(thresholdsArb, (t) => {
        const m = meta(t);
        const stats = statsRows(zero, m);
        const legend = legendEntries(buildLegend(m));
        for (const group of FACT_GROUPS) {
          for (const fact of group.facts) {
            const rule = factRule(fact, t);
            const statRow = stats.find((r) => r.id === statOf[fact])!;
            const legendEntry = legend.find((e) => e.id === fact)!;
            if (statRow.label !== FACT_NAMES[fact] || legendEntry.title !== FACT_NAMES[fact]) return false;
            // The legend gives the rule as a sentence (capitalised when it starts one), built from the same rule.
            if (statRow.rule !== rule || !legendEntry.text.endsWith(factRuleSentence(fact, t)) || !factRuleSentence(fact, t).toLowerCase().includes(rule.toLowerCase())) return false;
            if (AGE.includes(fact)) {
              const file = fileIn(fact as FileEntry['decayState'], t);
              // The detail panel quotes the same rule; the hover line starts with the same name.
              if (!stateSentence(file, m).endsWith(`(${FACT_NAMES[fact]} is ${rule})`)) return false;
              if (!stoneSummary(file, m).startsWith(`${stateName(file)} · last changed `)) return false;
            }
          }
        }
        return true;
      }),
    );
  });

  it('for any thresholds: the stats panel and the legend show the same groups in the same order', () => {
    fc.assert(
      fc.property(thresholdsArb, (t) => {
        const stats = statsLayout(zero, meta(t)).groups.map((g) => `${g.title}:${g.rows.map((r) => r.label).join(',')}`);
        const legend = buildLegend(meta(t)).groups.filter((g) => g.id !== 'layout').map((g) => `${g.title}:${g.entries.map((e) => e.title).join(',')}`);
        return JSON.stringify(stats) === JSON.stringify(legend);
      }),
    );
  });

  it('never says "untouched", "last commit" or "last touched" anywhere it speaks of a file\'s age', () => {
    for (const name of REAL_GRAVEYARDS) {
      const g = loadRealGraveyard(name);
      const words = [
        ...legendEntries(buildLegend(g.meta)).map((e) => `${e.title} ${e.text}`),
        ...buildLegend(g.meta).groups.map((x) => x.note ?? ''),
        ...statsRows(zero, g.meta).map((r) => `${r.label} ${r.rule ?? ''}`),
        ...g.files.flatMap((f) => [stateSentence(f, g.meta), stoneSummary(f, g.meta)]),
      ].join('\n');
      expect(words).not.toMatch(/untouched|last commit|last touched/i);
    }
  });
});
