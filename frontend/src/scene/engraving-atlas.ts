import * as THREE from 'three';
import { NAME_BOX, RIP_BOX } from '../model/engraving';
import { STONE_W } from '../model/layout-constants';

/**
 * The atlas of engraved texts: "RIP" and each distinct file name, drawn once with the browser's own monospace font on a canvas
 * (no file is downloaded), white on transparent, one text per cell. The stone shader reads it to carve the texts
 * (`stone-material.ts`). The cells are ENGRAVE_CELL_W by ENGRAVE_CELL_H pixels, ENGRAVE_COLUMNS to a row.
 */
export const ENGRAVE_CELL_W = 384;
export const ENGRAVE_CELL_H = 72;
export const ENGRAVE_COLUMNS = 8;
/** At most this many rows (a canvas of at most 3072 by 4088 pixels). */
const MAX_ROWS = 73;
export const ENGRAVE_CAPACITY = ENGRAVE_COLUMNS * MAX_ROWS;

/** For the development API: how many pixels of each text's cell are lit, which shows the text was drawn. */
export const engravingDebug: { litPixels: Record<string, number> } = { litPixels: {} };

export function makeEngravingAtlas(texts: readonly string[]): { texture: THREE.CanvasTexture; rows: number } {
  const rows = Math.max(1, Math.ceil(texts.length / ENGRAVE_COLUMNS));
  const canvas = document.createElement('canvas');
  canvas.width = ENGRAVE_CELL_W * ENGRAVE_COLUMNS;
  canvas.height = ENGRAVE_CELL_H * rows;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const lit: Record<string, number> = {};
  const FONT = `ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace`;
  texts.forEach((text, i) => {
    const x = (i % ENGRAVE_COLUMNS) * ENGRAVE_CELL_W;
    const y = Math.floor(i / ENGRAVE_COLUMNS) * ENGRAVE_CELL_H;
    // A cell is stretched over its text's box on the stone (`model/engraving.ts`), more in one direction than the other. The
    // text is drawn pre-scaled across (`k`) so that its letters come out in their own proportions on the stone.
    const box = i === 0 ? { w: RIP_BOX.w * STONE_W, h: RIP_BOX.h } : { w: NAME_BOX.w * STONE_W, h: NAME_BOX.h };
    const k = box.h / ENGRAVE_CELL_H / (box.w / ENGRAVE_CELL_W);
    context.save();
    context.beginPath();
    context.rect(x, y, ENGRAVE_CELL_W, ENGRAVE_CELL_H);
    context.clip();
    context.translate(x + ENGRAVE_CELL_W / 2, y + ENGRAVE_CELL_H / 2);
    context.scale(k, 1);
    if (i === 0) {
      // RIP: three tall, bold, well-spaced letters, each drawn alone so the spacing is ours and not the font's.
      context.font = `800 64px ${FONT}`;
      const pitch = 100 / k; // the letters' centres, 100 px apart across the cell
      Array.from(text).forEach((letter, n, all) => {
        const at = (n - (all.length - 1) / 2) * pitch;
        context.lineWidth = 3;
        context.strokeStyle = '#ffffff';
        context.strokeText(letter, at, 2);
        context.fillText(letter, at, 2);
      });
    } else {
      // Names: bold, as tall as the cell allows, squeezed (not shrunk) to fit the cell's width when long.
      context.font = `800 56px ${FONT}`;
      context.lineWidth = 2;
      context.strokeStyle = '#ffffff';
      const maxWidth = (ENGRAVE_CELL_W - 12) / k;
      context.strokeText(text, 0, 2, maxWidth);
      context.fillText(text, 0, 2, maxWidth);
    }
    context.restore();
    const data = context.getImageData(x, y, ENGRAVE_CELL_W, ENGRAVE_CELL_H).data;
    let count = 0;
    for (let n = 3; n < data.length; n += 4) if (data[n]! > 128) count++;
    lit[text] = count;
  });
  engravingDebug.litPixels = lit;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace; // a mask, not a colour
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return { texture, rows };
}
