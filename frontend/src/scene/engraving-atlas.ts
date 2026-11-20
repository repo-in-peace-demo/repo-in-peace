import * as THREE from 'three';

/**
 * The atlas of engraved texts: "RIP" and each distinct file name, drawn once with the browser's own monospace font on a canvas
 * (no file is downloaded), white on transparent, one text per cell. The stone shader reads it to carve the texts
 * (`stone-material.ts`). The cells are ENGRAVE_CELL_W by ENGRAVE_CELL_H pixels, ENGRAVE_COLUMNS to a row.
 */
export const ENGRAVE_CELL_W = 384;
export const ENGRAVE_CELL_H = 56;
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
  texts.forEach((text, i) => {
    const x = (i % ENGRAVE_COLUMNS) * ENGRAVE_CELL_W;
    const y = Math.floor(i / ENGRAVE_COLUMNS) * ENGRAVE_CELL_H;
    // RIP large and spaced like a carving; names in a smaller weight that fits 18 characters across the cell.
    context.font = i === 0 ? `700 46px ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace` : `600 34px ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace`;
    context.fillText(text, x + ENGRAVE_CELL_W / 2, y + ENGRAVE_CELL_H / 2 + 2, ENGRAVE_CELL_W - 16);
    const data = context.getImageData(x, y, ENGRAVE_CELL_W, ENGRAVE_CELL_H).data;
    let count = 0;
    for (let k = 3; k < data.length; k += 4) if (data[k]! > 128) count++;
    lit[text] = count;
  });
  engravingDebug.litPixels = lit;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace; // a mask, not a colour
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return { texture, rows };
}
