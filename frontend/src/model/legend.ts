import type { RepoMeta } from '@shared/graveyard-schema';
import { FACT_GROUPS, FACT_LOOKS, FACT_NAMES, INDEPENDENCE_NOTE, factRuleSentence, type FactId, type GroupId } from './grave-facts';

/**
 * The words of the legend, grouped by dimension in the same groups and order as the stats panel (Age, Usage, Activity, History),
 * then a Layout group for the ground. Every name and rule comes from the one vocabulary (`grave-facts.ts`), with the data file's
 * own thresholds, so the legend says exactly what the stats panel, the list and the hover line say. Pure.
 */

export type LegendId = FactId | 'floor';

export interface LegendEntry {
  id: LegendId;
  /** The fact's name: "Stale". */
  title: string;
  /** How it looks, then its rule: "Moss creeping up, more with age. Last changed 21–45 days before the snapshot." */
  text: string;
}

export interface LegendGroup {
  id: GroupId | 'layout';
  title: string;
  /** A line under the heading, when the group needs one. */
  note?: string;
  entries: LegendEntry[];
}

export interface Legend {
  /** The day every age is measured from, as a sentence. */
  snapshotLine: string;
  groups: LegendGroup[];
}

/** The snapshot's day as YYYY-MM-DD, from the ISO date of the data file. */
export function snapshotDay(meta: RepoMeta): string {
  return meta.snapshotDate.slice(0, 10);
}

const sentence = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

export function buildLegend(meta: RepoMeta): Legend {
  const t = meta.thresholds;
  const groups: LegendGroup[] = FACT_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    ...(group.id === 'age' ? { note: `When the file last changed, before the snapshot. ${INDEPENDENCE_NOTE}` } : {}),
    entries: group.facts.map((id) => ({ id, title: FACT_NAMES[id], text: `${sentence(FACT_LOOKS[id])} ${factRuleSentence(id, t)}` })),
  }));
  groups.push({ id: 'layout', title: 'Layout', entries: [{ id: 'floor', title: 'Darker ground', text: 'A folder nested deeper.' }] });
  return { snapshotLine: `Ages are measured from the snapshot: ${snapshotDay(meta)}.`, groups };
}

/** Every entry, in order. */
export const legendEntries = (legend: Legend): LegendEntry[] => legend.groups.flatMap((g) => g.entries);
