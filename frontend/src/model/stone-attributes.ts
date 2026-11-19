import { hash01 } from './hash';
import type { StoneModel } from './scene-model';

/**
 * What the stone shader needs for each stone, as plain numbers, and how a stone leans. Pure, so the mapping from a
 * file's facts to what is drawn can be tested without a renderer. Each attribute has one source:
 *   height  the stone's height from its lines of code (the layout)
 *   moss    the moss amount, from the file's age and state
 *   crack   1 when the file is unused
 * A hot file's candle is not here (it is a separate mesh), and hover and selection are written when they change.
 */

export interface StoneAttributes {
  height: Float32Array;
  moss: Float32Array;
  crack: Float32Array;
  /** A number from 0 to 1 from the path, to vary the noise from stone to stone. */
  seed: Float32Array;
}

export function stoneAttributes(stones: readonly StoneModel[]): StoneAttributes {
  const n = stones.length;
  const out: StoneAttributes = { height: new Float32Array(n), moss: new Float32Array(n), crack: new Float32Array(n), seed: new Float32Array(n) };
  stones.forEach(({ file, layout, visual }, i) => {
    out.height[i] = layout.height;
    out.moss[i] = visual.mossAmount;
    out.crack[i] = visual.cracked ? 1 : 0;
    out.seed[i] = hash01(file.path, 'stone-seed');
  });
  return out;
}

/** The value written for a stone's `aHighlight`: 0 nothing, 0.5 the pointer is over it, 1 it is selected (which wins). */
export const highlightValue = (hovered: boolean, selected: boolean): number => (selected ? 1 : hovered ? 0.5 : 0);

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * The rotation of a leaning stone, about its base: it tips by `leanDegrees` toward the direction `leanDirection`
 * (radians, measured on the ground from the +x axis toward +z). 0 degrees gives no rotation.
 */
export function leanQuaternion(leanDegrees: number, leanDirection: number): Quaternion {
  const half = (leanDegrees * Math.PI) / 360;
  const s = Math.sin(half);
  // The axis is `up × direction`, at right angles to the direction of the lean.
  return { x: Math.sin(leanDirection) * s, y: 0, z: -Math.cos(leanDirection) * s, w: Math.cos(half) };
}
