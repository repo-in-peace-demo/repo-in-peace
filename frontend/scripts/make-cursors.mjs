// Writes the scene's cursors (public/cursors/*.svg): an original skeleton hand in three states, at 32 and 64 px, from one design.
// Run: node scripts/make-cursors.mjs. The shapes are drawn on a 32-unit grid; the 64 px files are the same drawing at twice the size.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../public/cursors/', import.meta.url));
const BONE = '#ddd4bd';
const LINE = '#16120d'; // a dark edge round each bone
const HALO = '#f7f3e8'; // the light outline outside it, for contrast on the dark sky and on the moon alike
const GLOW = '#bfe8ff';

/** Bones as round-ended lines [x1, y1, x2, y2, width], and knuckles as circles [cx, cy, r]. */
const pointing = {
  bones: [
    // the index finger, pointing up and a little left: three phalanges, the tip at (8, 2)
    [8.2, 2.6, 9.1, 6.4, 2.4], [9.3, 7.4, 10.2, 10.8, 2.6], [10.4, 11.8, 11.4, 15.2, 2.8],
    // the other fingers, curled: short bones from the knuckles
    [14.2, 15.4, 14.6, 18.2, 2.5], [17.2, 16.2, 17.4, 18.9, 2.4], [19.8, 17.6, 19.8, 20.0, 2.2],
    // the thumb, across the front
    [9.2, 19.6, 11.6, 21.4, 2.4], [12.6, 21.9, 14.8, 22.6, 2.4],
    // the palm's metacarpals, to the wrist
    [11.6, 16.2, 14.6, 24.6, 2.0], [14.4, 19.2, 16.0, 24.8, 1.9], [17.4, 19.9, 17.6, 25.0, 1.9], [19.6, 21.0, 18.8, 25.2, 1.8],
    // radius and ulna, leaving the frame
    [14.6, 27.8, 13.8, 31.5, 2.6], [18.2, 27.8, 18.9, 31.5, 2.6],
  ],
  joints: [[11.0, 15.8, 1.7], [14.3, 15.0, 1.6], [17.2, 15.9, 1.5], [19.8, 17.2, 1.4], [16.4, 26.4, 2.6]],
  hotspot: [8, 2],
};
const grabbing = {
  bones: [
    // four curled fingers: knuckle rows bending down over the palm
    [9.6, 9.6, 10.4, 13.6, 2.6], [13.2, 8.8, 13.6, 13.0, 2.6], [16.8, 9.0, 16.8, 13.2, 2.5], [20.0, 10.2, 19.6, 13.8, 2.3],
    [10.4, 13.8, 12.4, 15.6, 2.3], [13.6, 13.2, 15.0, 15.2, 2.3], [16.8, 13.4, 17.6, 15.4, 2.2], [19.6, 14.0, 20.0, 15.8, 2.0],
    // the thumb, tucked across
    [7.4, 15.8, 10.4, 17.8, 2.4], [11.2, 18.2, 14.2, 18.4, 2.3],
    // metacarpals and the wrist
    [10.2, 13.8, 13.8, 23.4, 2.0], [13.4, 13.4, 15.2, 23.6, 1.9], [16.8, 13.6, 16.8, 23.8, 1.9], [19.8, 14.2, 18.4, 24.0, 1.8],
    [14.4, 27.0, 13.8, 31.5, 2.6], [18.0, 27.0, 18.6, 31.5, 2.6],
  ],
  joints: [[10.0, 9.4, 1.7], [13.3, 8.6, 1.7], [16.8, 8.8, 1.6], [20.0, 10.0, 1.5], [16.2, 25.4, 2.6]],
  hotspot: [14, 14],
};

function layer(hand, extra, colour) {
  const lines = hand.bones.map(([x1, y1, x2, y2, w]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${colour}" stroke-width="${w + extra}" stroke-linecap="round"/>`);
  const dots = hand.joints.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r + extra / 2}" fill="${colour}"/>`);
  return lines.join('') + dots.join('');
}

function svg(hand, size, glow) {
  const halo = glow
    ? `<defs><filter id="g" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.6"/></filter></defs><g filter="url(#g)" opacity="0.85">${layer(hand, 4.5, GLOW)}</g>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">${halo}${layer(hand, 2.6, HALO)}${layer(hand, 1.2, LINE)}${layer(hand, 0, BONE)}</svg>\n`;
}

mkdirSync(OUT, { recursive: true });
for (const [name, hand, glow] of [['hand', pointing, false], ['hand-over', pointing, true], ['hand-grab', grabbing, false]]) {
  for (const size of [32, 64]) writeFileSync(`${OUT}${name}-${size}.svg`, svg(hand, size, glow));
}
console.log(`hotspots (in 32 px): pointing ${pointing.hotspot.join(' ')}, grabbing ${grabbing.hotspot.join(' ')}`);
