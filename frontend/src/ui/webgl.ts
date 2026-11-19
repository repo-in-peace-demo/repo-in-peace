/**
 * Can this browser draw WebGL? Asked once, before the canvas is made, so a browser without it gets a message and not a blank page.
 * The canvas is created by `createCanvas` so that the answer can be tested without a browser.
 */
export function hasWebGL(
  createCanvas: () => Pick<HTMLCanvasElement, 'getContext'> = () => document.createElement('canvas'),
): boolean {
  try {
    const canvas = createCanvas();
    return canvas.getContext('webgl2') !== null || canvas.getContext('webgl') !== null;
  } catch {
    return false;
  }
}
