import type { Layout } from './layout';
import { SIGN_W } from './layout-constants';
import type { Rect } from './rect';

/**
 * The fences of the plots, as lists of posts and rails. Pure: where the posts and rails go is worked out here once,
 * and the scene draws them with two instanced meshes.
 *
 * The fence runs just inside the edge of each plot's rectangle, so the fences of neighbouring plots never touch.
 * The front side has a gap in the middle, the gate, where the plaque with the folder's name stands.
 */

/** The fence line is this far inside the plot's rectangle. */
export const FENCE_INSET = 0.1;

/** Posts are at most this far apart along a side. */
export const FENCE_POST_SPACING = 1.5;

/** The size of a post and of a rail (the scene draws them; `model/clear-view.ts` knows them to see past them). */
export const FENCE_POST = { width: 0.12, height: 1.1 };
export const FENCE_RAIL = { thickness: 0.06, height: 0.08, y: 0.85 };

/** The gate is a little wider than the plaque. */
export const GATE_WIDTH = SIGN_W + 0.8;

export interface FencePost {
  x: number;
  z: number;
}

export interface FenceRail {
  /** Centre of the rail. */
  x: number;
  z: number;
  length: number;
  /** The direction the rail runs in. */
  axis: 'x' | 'z';
}

export interface Fence {
  posts: FencePost[];
  rails: FenceRail[];
}

interface Segment {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** The posts and rails of one plot. */
export function fenceForPlot(rect: Rect): Fence {
  const left = rect.x + FENCE_INSET;
  const right = rect.x + rect.w - FENCE_INSET;
  const back = rect.z + FENCE_INSET;
  const front = rect.z + rect.d - FENCE_INSET;
  const middle = (left + right) / 2;
  // The gate is as wide as it should be, but always leaves a little fence at each corner.
  const halfGate = Math.max(0, Math.min(GATE_WIDTH / 2, (right - left) / 2 - 0.05));

  const sides: Segment[] = [
    { x0: left, z0: back, x1: right, z1: back }, // back
    { x0: left, z0: back, x1: left, z1: front }, // left
    { x0: right, z0: back, x1: right, z1: front }, // right
    { x0: left, z0: front, x1: middle - halfGate, z1: front }, // front, left of the gate
    { x0: middle + halfGate, z0: front, x1: right, z1: front }, // front, right of the gate
  ];

  const posts = new Map<string, FencePost>();
  const rails: FenceRail[] = [];
  for (const side of sides) {
    const length = Math.hypot(side.x1 - side.x0, side.z1 - side.z0);
    if (length < 1e-9) continue;

    const intervals = Math.max(1, Math.ceil(length / FENCE_POST_SPACING - 1e-9));
    for (let i = 0; i <= intervals; i++) {
      const t = i / intervals;
      const post = { x: side.x0 + (side.x1 - side.x0) * t, z: side.z0 + (side.z1 - side.z0) * t };
      // Corners belong to two sides: one post there.
      posts.set(`${post.x.toFixed(6)},${post.z.toFixed(6)}`, post);
    }
    rails.push({
      x: (side.x0 + side.x1) / 2,
      z: (side.z0 + side.z1) / 2,
      length,
      axis: side.z0 === side.z1 ? 'x' : 'z',
    });
  }
  return { posts: [...posts.values()], rails };
}

/** The posts and rails of every plot of the layout. */
export function fenceInstances(layout: Layout): Fence {
  const posts: FencePost[] = [];
  const rails: FenceRail[] = [];
  for (const plot of layout.plots) {
    const fence = fenceForPlot(plot.rect);
    posts.push(...fence.posts);
    rails.push(...fence.rails);
  }
  return { posts, rails };
}
