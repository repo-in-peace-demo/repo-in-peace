import { STONE_W } from './layout-constants';

/**
 * Engraving on the stones' front faces. Pure: what each stone carries, where on its face, and how clearly from a distance. The
 * scene draws the texts into one atlas and the stone shader carves them (`scene/engraving-atlas.ts`, `scene/stone-material.ts`).
 *
 * Every engraving maps to a fact, like every other effect:
 *   - "RIP" on every unused stone (Knip reports the file unused), cut into the arch. It says what the cracks and glow say.
 *   - The file's name (without its folder) below the arch, on every stone, readable only up close: it fades in between
 *     NAME_FAR and NAME_NEAR from the camera, so the overview is not cluttered with text nobody could read.
 * Ghosts carry nothing: they have their toe tag.
 */

export const RIP_TEXT = 'RIP';

/** The most characters a name keeps on a stone; a longer one is shortened in the middle, keeping its extension. */
export const NAME_MAX_CHARS = 18;

/** Names are fully readable within NAME_NEAR of the camera and gone from NAME_FAR. */
export const NAME_NEAR = 16;
export const NAME_FAR = 26;

const ELLIPSIS = '…';

/** The extension of a file name: from its last dot (".ts", ".test.ts" gives ".ts"), or "" when it has none or starts with the dot. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

/**
 * A file name shortened to at most `max` characters (counted as code points), in the middle: the start, "…", and the extension,
 * which is always kept whole (`useRealtimeVoiceChat.ts` gives `useRealtimeVoi….ts` at 18). A name that fits is unchanged.
 * When the extension alone is too long to fit with a character and the ellipsis, the result is "…" and the extension.
 */
export function shortenName(name: string, max: number = NAME_MAX_CHARS): string {
  const chars = Array.from(name);
  if (chars.length <= max) return name;
  const ext = Array.from(extensionOf(name));
  const keep = Math.max(0, max - ext.length - 1);
  return chars.slice(0, keep).join('') + ELLIPSIS + ext.join('');
}

/** The last segment of a repo path: the file's own name. */
export const fileNameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** How clearly a name shows at this distance from the camera: 1 up to NAME_NEAR, 0 from NAME_FAR, a smooth fall between, never rising with distance. */
export function nameOpacity(distance: number): number {
  if (!(distance > NAME_NEAR)) return 1;
  if (distance >= NAME_FAR) return 0;
  const t = (distance - NAME_NEAR) / (NAME_FAR - NAME_NEAR);
  return 1 - t * t * (3 - 2 * t);
}

// ---- Where on the face ----

/**
 * The face of a stone of height `h`: a body from 0 to `h - r` and an arch of radius `r` = STONE_W / 2 on top (the tombstone shape).
 * "RIP" is centred RIP_ABOVE_SEAM above the seam between body and arch; the name is centred NAME_BELOW_SEAM below it. Both are
 * boxes of the given width (a share of the stone's width) and height. The shapes of every stone height fit (tested).
 */
// Task 25 follow-up: larger. The name uses 93% of the face's width (it is drawn condensed to fit 18 characters) and RIP stands about
// 0.2 tall. The boxes still fit every stone height and stay apart (tested); a text is drawn into its box by the atlas.
export const RIP_ABOVE_SEAM = 0.24;
export const RIP_BOX = { w: 0.7, h: 0.3 };
export const NAME_BELOW_SEAM = 0.0;
export const NAME_BOX = { w: 0.93, h: 0.17 };
/** The clear margin kept round a text's box, in scene units, where moss and the crack glow do not go (`scene/stone-material.ts`). */
export const TEXT_CLEAR_MARGIN = 0.04;
/** The shortest body (MIN_STONE_H minus the arch) is this tall; the name box is kept at least this far above the ground. */
export const NAME_MIN_BOTTOM = 0.02;

export interface FaceBox {
  /** Centre across the face (0 is the middle), and up from the stone's foot, and the size: all in scene units. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The boxes "RIP" and the name are carved in, on a stone of this height. */
export function engravingBoxes(height: number): { rip: FaceBox; name: FaceBox } {
  const r = STONE_W / 2;
  const seam = Math.max(height - r, 0.01);
  const rip = { x: 0, y: seam + RIP_ABOVE_SEAM, w: RIP_BOX.w * STONE_W, h: RIP_BOX.h };
  const nameY = Math.max(seam - NAME_BELOW_SEAM - NAME_BOX.h / 2, NAME_MIN_BOTTOM) + NAME_BOX.h / 2;
  return { rip, name: { x: 0, y: nameY, w: NAME_BOX.w * STONE_W, h: NAME_BOX.h } };
}

/** True when the point (x across from the middle, y up) is on the face of a stone of this height. */
export function onFace(height: number, x: number, y: number): boolean {
  const r = STONE_W / 2;
  const seam = Math.max(height - r, 0.01);
  if (y < 0 || Math.abs(x) > r) return false;
  if (y <= seam) return true;
  return Math.hypot(x, y - seam) <= r;
}

// ---- What each stone carries ----

export interface StoneEngraving {
  rip: boolean;
  /** The name as carved (shortened), or null when there is none. */
  name: string | null;
}

export function engravingFor(path: string, unused: boolean): StoneEngraving {
  const name = shortenName(fileNameOf(path));
  return { rip: unused, name: name.length > 0 ? name : null };
}

/**
 * The texts of the atlas: "RIP" first (cell 0), then each distinct name once, in the order of the stones; and for each stone the
 * cell of its name, or -1 (no name, or the atlas is full: at most `capacity` cells).
 */
export function engravingCells(engravings: readonly StoneEngraving[], capacity: number): { texts: string[]; nameCell: Int32Array } {
  const texts = [RIP_TEXT];
  const cellOf = new Map<string, number>();
  const nameCell = new Int32Array(engravings.length).fill(-1);
  engravings.forEach((e, i) => {
    if (e.name === null) return;
    let cell = cellOf.get(e.name);
    if (cell === undefined) {
      if (texts.length >= capacity) return;
      cell = texts.length;
      texts.push(e.name);
      cellOf.set(e.name, cell);
    }
    nameCell[i] = cell;
  });
  return { texts, nameCell };
}
