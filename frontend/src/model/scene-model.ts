import type { FileEntry, Ghost, Graveyard } from '@shared/graveyard-schema';
import { DEFAULT_FOV_Y, buildFlyTargets, startPose, type CameraPose, type FlyTarget } from './camera-pose';
import { layout, type Layout, type PlotLayout, type StoneLayout, type GhostLayout } from './layout';
import { buildLegend, type Legend } from './legend';
import { buildPickTargets, type PickTarget } from './pick';
import { buildSignSources, type SignSource } from './signs';
import { computeStats, type Stats } from './stats';
import { ghostVisual, plotFloorShade, stoneVisual, type GhostVisual, type StoneVisual } from './visual-params';

/**
 * Everything the scene needs from a data file, worked out once when the file loads. The rendering code reads this
 * object and never recomputes layout, visuals, statistics or signs while it draws a frame.
 */

export interface StoneModel {
  file: FileEntry;
  layout: StoneLayout;
  visual: StoneVisual;
}

export interface GhostModel {
  ghost: Ghost;
  layout: GhostLayout;
  visual: GhostVisual;
}

export interface FloorModel {
  plot: PlotLayout;
  /** How bright this plot's floor is, as a multiple of the root's: darker for a deeper folder. */
  shade: number;
}

export interface SceneModel {
  graveyard: Graveyard;
  layout: Layout;
  /** In the order of `layout.stones`, which is by path. */
  stones: StoneModel[];
  /** In the order of `layout.ghosts`, which is by path. */
  ghosts: GhostModel[];
  /** In the order of `layout.plots`. */
  floors: FloorModel[];
  /** Where each file and ghost is in `stones` or `ghosts`. */
  lookup: Map<string, { kind: 'file' | 'ghost'; index: number }>;
  stats: Stats;
  legend: Legend;
  signSources: SignSource[];
  pickTargets: PickTarget[];
  flyTargets: Map<string, FlyTarget>;
  /** The camera's starting pose. */
  start: CameraPose;
}

/** @param fovY the camera's vertical field of view in degrees, which the starting view is fitted to. */
export function buildSceneModel(graveyard: Graveyard, fovY: number = DEFAULT_FOV_Y): SceneModel {
  const l = layout(graveyard);

  // The layout was built from this data file, so every path it holds is in these maps.
  const fileByPath = new Map(graveyard.files.map((f) => [f.path, f] as const));
  const ghostByPath = new Map(graveyard.ghosts.map((g) => [g.path, g] as const));

  const stones: StoneModel[] = l.stones.map((s) => {
    const file = fileByPath.get(s.path)!;
    return { file, layout: s, visual: stoneVisual(file, graveyard.meta) };
  });
  const ghosts: GhostModel[] = l.ghosts.map((q) => {
    const ghost = ghostByPath.get(q.path)!;
    return { ghost, layout: q, visual: ghostVisual(ghost) };
  });
  const floors: FloorModel[] = l.plots.map((plot) => ({ plot, shade: plotFloorShade(plot.depth) }));

  const lookup = new Map<string, { kind: 'file' | 'ghost'; index: number }>();
  stones.forEach((s, index) => lookup.set(s.file.path, { kind: 'file', index }));
  ghosts.forEach((q, index) => lookup.set(q.ghost.path, { kind: 'ghost', index }));

  return {
    graveyard,
    layout: l,
    stones,
    ghosts,
    floors,
    lookup,
    stats: computeStats(graveyard),
    legend: buildLegend(graveyard.meta),
    signSources: buildSignSources(l, graveyard.meta.name),
    pickTargets: buildPickTargets(
      stones.map((s) => ({ path: s.layout.path, x: s.layout.x, z: s.layout.z, height: s.layout.height, leanDegrees: s.visual.leanDegrees })),
      ghosts.map((q) => ({ path: q.layout.path, x: q.layout.x, z: q.layout.z })),
    ),
    flyTargets: buildFlyTargets(l),
    start: startPose(l.bounds, fovY),
  };
}
