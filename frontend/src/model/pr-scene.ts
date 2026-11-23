import { CELL_D, CELL_W, MIN_STONE_H, STONE_D, STONE_W } from './layout-constants';
import { PICK_PADDING, type PickTarget } from './pick';
import type { SceneModel } from './scene-model';

/**
 * How the scene shows the session's pull requests (bury-and-resurrect Req 10). Pure: the renderers ask it, per frame, where each
 * overridden grave is in its animation and where hover and click find it now. Overrides change only the drawing of their own grave;
 * the layout never moves (Req 10.4).
 *  - Bury: the stone sinks over 1.5 s (ease-in), then a fresh grave rises in its place: a long, low heap of dark soil lying lengthwise
 *    (front to back) in the stone's cell, with a wooden stake at its head carrying a plaque "PR #N".
 *  - Resurrect: the ghost settles to the ground over 1.2 s and turns opaque, then a clean upright stone with a stake replaces it.
 * Under reduced motion both are at their end at once (Req 10.3).
 */

export type GraveOverride =
  | { kind: 'buried'; path: string; index: number; number: number; startedAt: number }
  | { kind: 'risen'; path: string; index: number; number: number; startedAt: number };

export interface BuryFrame {
  /** 0 standing, 1 under the ground. */
  sink: number;
  /** 0 no mound, 1 the full mound and stake. */
  mound: number;
}
export interface RiseFrame {
  /** 0 floating as before, 1 on the ground and opaque. */
  settle: number;
  /** 0 still a ghost, 1 a stone. */
  solid: number;
}

export const SINK_S = 1.5;
export const MOUND_START_S = 1.2;
export const MOUND_S = 0.3;
export const SETTLE_S = 1.2;
export const SOLID_S = 0.3;

/**
 * The fresh grave: narrower than the stone was wide, as long as the cell is deep (a grave lies lengthwise, front to back, where the
 * stone stood), and low. Changed after review: the first mound was a round brown dome.
 */
export const MOUND_HALF_W = 0.55; // second review: 0.42 by 0.22 high read as a small dark block
export const MOUND_HALF_D = 0.74;
export const MOUND_H = 0.2; // fourth review: lower, so the gentler slopes read as a heap
/** The stake, pushed into the head (the back, -z) of the grave, and its plaque, facing the front (+z), so it reads over the heap. */
export const STAKE_H = 0.85;
export const PLATE_W = 0.95; // second review: the 0.62 plaque could not be read close up
export const PLATE_H = 0.3;
/** "PR #" and up to four digits. */
export const MAX_GLYPHS = 8;

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const easeIn = (t: number): number => t * t * t;
const easeInOut = (t: number): number => 0.5 - 0.5 * Math.cos(Math.PI * t);

/** The session's pull requests that change this scene: a Bury on one of its stones, a Resurrect on one of its ghosts. By path. */
export function overridesOf(model: Pick<SceneModel, 'lookup'>, prs: ReadonlyMap<string, { action: string; number: number; openedAt: number }>): GraveOverride[] {
  const out: GraveOverride[] = [];
  for (const [key, pr] of prs) {
    const kind = key.startsWith('file:') ? 'file' : key.startsWith('ghost:') ? 'ghost' : null;
    if (kind === null) continue;
    const path = key.slice(kind.length + 1);
    const entry = model.lookup.get(path);
    if (entry === undefined || entry.kind !== kind) continue;
    if (kind === 'file' && pr.action === 'bury') out.push({ kind: 'buried', path, index: entry.index, number: pr.number, startedAt: pr.openedAt });
    if (kind === 'ghost' && pr.action === 'resurrect') out.push({ kind: 'risen', path, index: entry.index, number: pr.number, startedAt: pr.openedAt });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function buryFrame(startedAt: number, nowMs: number, reducedMotion: boolean): BuryFrame {
  if (reducedMotion) return { sink: 1, mound: 1 };
  const t = Math.max(0, nowMs - startedAt) / 1000;
  return { sink: easeIn(clamp01(t / SINK_S)), mound: clamp01((t - MOUND_START_S) / MOUND_S) };
}

export function riseFrame(startedAt: number, nowMs: number, reducedMotion: boolean): RiseFrame {
  if (reducedMotion) return { settle: 1, solid: 1 };
  const t = Math.max(0, nowMs - startedAt) / 1000;
  return { settle: easeInOut(clamp01(t / SETTLE_S)), solid: clamp01((t - SETTLE_S) / SOLID_S) };
}

/** The resurrected stone's height: the graveyard's shortest stone, since a ghost has no line count (the legend says so). */
export function risenHeight(model: Pick<SceneModel, 'stones'>): number {
  const shortest = model.stones.reduce((h, s) => Math.min(h, s.layout.height), Number.POSITIVE_INFINITY);
  return Number.isFinite(shortest) ? shortest : MIN_STONE_H;
}

/** Where an overridden grave is: its slot from the layout. */
export function slotOf(o: GraveOverride, model: Pick<SceneModel, 'stones' | 'ghosts'>): { x: number; z: number } {
  const at = o.kind === 'buried' ? model.stones[o.index]!.layout : model.ghosts[o.index]!.layout;
  return { x: at.x, z: at.z };
}

/** The foot of the stake, on the ground in front of the grave (the side that faces +z, as the engraving and the ghosts' eyes do). */
export function stakeSpot(o: GraveOverride, model: Pick<SceneModel, 'stones' | 'ghosts'>): { x: number; z: number } {
  const { x, z } = slotOf(o, model);
  return o.kind === 'buried' ? { x, z: z - MOUND_HALF_D + 0.1 } : { x: x + STONE_W * 0.42, z: z + STONE_D / 2 + 0.3 };
}

/** Where hover and click find an overridden grave now: the mound and stake, or the new stone. The same slot as before. */
export function overridePickTarget(o: GraveOverride, model: Pick<SceneModel, 'stones' | 'ghosts'>): PickTarget {
  const { x, z } = slotOf(o, model);
  if (o.kind === 'buried') {
    return {
      kind: 'file',
      path: o.path,
      min: { x: x - MOUND_HALF_W - PICK_PADDING, y: 0, z: z - MOUND_HALF_D - PICK_PADDING },
      max: { x: x + MOUND_HALF_W + PICK_PADDING, y: STAKE_H + PICK_PADDING, z: z + MOUND_HALF_D + PICK_PADDING },
    };
  }
  const h = risenHeight(model as Pick<SceneModel, 'stones'>);
  return {
    kind: 'ghost',
    path: o.path,
    min: { x: x - STONE_W / 2 - PICK_PADDING, y: 0, z: z - STONE_D / 2 - PICK_PADDING },
    max: { x: x + STONE_W / 2 + PICK_PADDING, y: h + PICK_PADDING, z: z + STONE_D / 2 + 0.3 + PICK_PADDING },
  };
}

/** The pick targets with every override's box in place of its grave's. */
export function pickTargetsWith(model: Pick<SceneModel, 'stones' | 'ghosts' | 'pickTargets'>, overrides: readonly GraveOverride[]): PickTarget[] {
  if (overrides.length === 0) return model.pickTargets;
  const replaced = new Map(overrides.map((o) => [`${o.kind === 'buried' ? 'file' : 'ghost'}:${o.path}`, overridePickTarget(o, model)]));
  return model.pickTargets.map((t) => replaced.get(`${t.kind}:${t.path}`) ?? t);
}

/** The glyphs of a plaque, as cells of the marker atlas (`0123456789#PR `): "PR #" then the number's last four digits. */
export const HASH_GLYPH = 10;
export const P_GLYPH = 11;
export const R_GLYPH = 12;
export const SPACE_GLYPH = 13;
export function markerGlyphs(number: number): number[] {
  const digits = String(Math.max(0, Math.floor(number))).slice(-(MAX_GLYPHS - 4));
  return [P_GLYPH, R_GLYPH, SPACE_GLYPH, HASH_GLYPH, ...[...digits].map(Number)];
}

/** How far the grave's marks reach from the slot's centre on each side, for the check that they stay in the stone's layout cell. */
export function marksExtent(kind: GraveOverride['kind']): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const stakeX = kind === 'buried' ? 0 : STONE_W * 0.42;
  const stakeZ = kind === 'buried' ? -MOUND_HALF_D + 0.1 : STONE_D / 2 + 0.3;
  const plate = { minX: stakeX - PLATE_W / 2, maxX: stakeX + PLATE_W / 2, minZ: stakeZ - 0.05, maxZ: stakeZ + 0.1 };
  const body = kind === 'buried' ? { minX: -MOUND_HALF_W - 0.1, maxX: MOUND_HALF_W + 0.1, minZ: -MOUND_HALF_D - 0.06, maxZ: MOUND_HALF_D + 0.06 } : { minX: -STONE_W / 2, maxX: STONE_W / 2, minZ: -STONE_D / 2, maxZ: STONE_D / 2 };
  return { minX: Math.min(plate.minX, body.minX), maxX: Math.max(plate.maxX, body.maxX), minZ: Math.min(plate.minZ, body.minZ), maxZ: Math.max(plate.maxZ, body.maxZ) };
}
export const CELL_HALF = { x: CELL_W / 2, z: CELL_D / 2 };

/** The legend lines for what the session shows, each only when that kind is shown (Req 10.6). */
export function prLegendLines(overrides: readonly GraveOverride[]): Array<{ id: 'pr-buried' | 'pr-risen'; title: string; text: string }> {
  const lines: Array<{ id: 'pr-buried' | 'pr-risen'; title: string; text: string }> = [];
  if (overrides.some((o) => o.kind === 'buried')) lines.push({ id: 'pr-buried', title: 'Fresh grave with a stake', text: 'A pull request to delete this file is open.' });
  if (overrides.some((o) => o.kind === 'risen')) lines.push({ id: 'pr-risen', title: 'Clean stone with a stake', text: "A pull request to restore this file is open. Its height doesn't show its size." });
  return lines;
}
