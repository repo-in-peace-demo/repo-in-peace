import * as THREE from 'three';

/**
 * The glyphs of the pull request stakes (bury-and-resurrect Decision 9): the digits 0 to 9 and "#", each in one cell of a single
 * texture drawn once on a canvas, like the ghosts' toe-tag atlas. A stake's number is composed from these cells, so no texture is made
 * per number. Cell i holds digit i; cell 10 holds "#" (HASH_GLYPH in model/pr-scene.ts).
 */
export const GLYPHS = '0123456789#';
export const GLYPH_CELL_W = 48;
export const GLYPH_CELL_H = 64;

export function makeMarkerAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = GLYPHS.length * GLYPH_CELL_W;
  canvas.height = GLYPH_CELL_H;
  const context = canvas.getContext('2d')!;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `700 52px ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace`;
  [...GLYPHS].forEach((glyph, i) => context.fillText(glyph, i * GLYPH_CELL_W + GLYPH_CELL_W / 2, GLYPH_CELL_H / 2 + 3, GLYPH_CELL_W - 4));
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}
