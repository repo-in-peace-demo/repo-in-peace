import * as THREE from 'three';

/**
 * The texture that holds the text of the ghosts' toe tags: one cell for each distinct text (`.ts`, `.tsx`), drawn once with
 * the browser's own monospace font on a canvas. No file is downloaded and nothing is stored; it is drawn when the scene starts.
 */

export const ATLAS_CELL_W = 128;
export const ATLAS_CELL_H = 64;

/** For the browser tests only: how many pixels of each text's cell are lit in the atlas that was drawn last. */
export const atlasDebug: { litPixels: Record<string, number> } = { litPixels: {} };

export interface TagAtlas {
  texture: THREE.CanvasTexture;
  columns: number;
  rows: number;
  /** For each text, how many pixels of its cell are lit (not empty), so a test can tell that the text was drawn. */
  litPixels: Record<string, number>;
  dispose: () => void;
}

export function makeTagAtlas(texts: readonly string[]): TagAtlas {
  const columns = Math.max(1, Math.min(4, texts.length));
  const rows = Math.max(1, Math.ceil(texts.length / columns));
  const canvas = document.createElement('canvas');
  canvas.width = columns * ATLAS_CELL_W;
  canvas.height = rows * ATLAS_CELL_H;
  const context = canvas.getContext('2d')!;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `700 40px ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace`;
  texts.forEach((text, i) => {
    const x = (i % columns) * ATLAS_CELL_W;
    const y = Math.floor(i / columns) * ATLAS_CELL_H;
    context.fillText(text, x + ATLAS_CELL_W / 2, y + ATLAS_CELL_H / 2 + 2, ATLAS_CELL_W - 12);
  });

  const litPixels: Record<string, number> = {};
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  texts.forEach((text, i) => {
    const x0 = (i % columns) * ATLAS_CELL_W;
    const y0 = Math.floor(i / columns) * ATLAS_CELL_H;
    let lit = 0;
    for (let y = y0; y < y0 + ATLAS_CELL_H; y++) for (let x = x0; x < x0 + ATLAS_CELL_W; x++) if (data[(y * canvas.width + x) * 4 + 3]! > 100) lit++;
    litPixels[text] = lit;
  });

  atlasDebug.litPixels = litPixels;
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return { texture, columns, rows, litPixels, dispose: () => texture.dispose() };
}
