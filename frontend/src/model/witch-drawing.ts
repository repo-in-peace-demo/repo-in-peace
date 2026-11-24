/**
 * The witch on her broom, drawn once (all curves, our own design) and used by both the landing page (ui/Landing.tsx, inline SVG)
 * and the scene's sky (scene/Witch.tsx, rasterised into a texture). On a 200 × 120 grid, x to the right (she flies right), y down.
 * Parts that flutter in the wind are kept apart, each with the point it hangs from.
 */
export const WITCH_VIEWBOX = { w: 200, h: 120 } as const;

/** Filled shapes that stay still relative to her: body, head, hat, arms, legs, the tie of the bristles. */
const BODY = [
  // The broom's tie, and the hands' grip
  'M33 71 C35 69 40 69 41 71 L41 80 C39 82 35 82 33 80 Z',
  // Torso: seated sideways on the broom, leaning forward
  'M90 78 C88 68 94 56 104 48 C109 44 116 44 119 49 C122 54 118 60 113 65 C108 71 104 76 101 80 Z',
  // Head, small, under the brim
  'M113 41 C113 35 118 32 123 33 C127 34 128 39 126 43 C124 47 117 48 114 45 Z',
  // Hat: tall, pointed, the tip bent back
  'M106 34 C105 25 101 16 96 9 C94 6 92 4 89 3 C97 5 106 11 113 19 C118 25 122 29 127 33 Z',
  // Brim: wide and gently curved
  'M96 37 C106 32 124 30 138 33 C132 35 116 37 104 38 C100 38 97 38 96 37 Z',
  // Arms, both reaching forward to the handle
  'M112 52 C121 57 131 63 142 66 C144 67 144 71 141 71 C129 69 118 63 109 57 Z',
  'M115 58 C124 64 135 68 148 67 C151 67 151 71 148 72 C134 73 122 69 112 63 Z',
  // Hands on the handle
  'M140 65 C143 63 147 64 147 67 C147 70 143 72 140 70 Z',
  'M147 65 C150 64 153 65 153 68 C153 71 149 72 147 70 Z',
  // Legs tucked under, a pointed boot curling up at the toe
  'M95 72 L112 73 C118 73 124 74 129 75 C133 76 137 75 141 72 C141 78 137 82 130 83 C119 84 107 84 97 82 C94 80 94 76 95 72 Z',
];

/** The handle: slightly crooked, from the tie to past her hands. */
export const WITCH_HANDLE = { d: 'M38 76 C70 74 92 71 112 72 C134 73 160 68 194 64', width: 3.4 };

/** The bristle bundle, fanning out behind the tie (flutters, from its right end). */
const BRISTLES = [
  'M35 71 C26 66 14 60 2 56 C10 63 12 67 6 72 C14 73 16 75 2 82 C12 82 18 84 8 92 C18 88 26 84 35 81 Z',
];
/** A few loose straws in the bundle, as strokes. */
export const WITCH_STRAWS = ['M34 74 C24 72 14 70 4 66', 'M34 77 C24 78 14 80 5 86'];

/** The cloak, billowing out behind her in three points (flutters, from the shoulders). */
const CLOAK = [
  'M112 49 C100 50 88 54 70 50 C78 56 78 60 64 64 C77 66 84 70 74 79 C87 75 93 76 96 79 C100 70 106 60 114 54 Z',
];

/** Long, wild hair streaming back from under the brim (flutters, from the head). */
const HAIR = [
  'M115 36 C104 31 93 33 80 26 C86 33 90 36 83 40 C94 41 101 40 106 42 C99 45 92 48 85 49 C98 51 107 47 116 43 Z',
];

export const WITCH_PARTS = { body: BODY, bristles: BRISTLES, cloak: CLOAK, hair: HAIR } as const;
/** Where each fluttering part hangs from, on the grid. */
export const WITCH_HINGES = { bristles: { x: 36, y: 76 }, cloak: { x: 112, y: 51 }, hair: { x: 115, y: 39 } } as const;
export const WITCH_COLOUR = '#06080c';

/** The whole witch as one SVG document, for the scene's texture. */
export function witchSvg(width: number, height: number, colour: string = WITCH_COLOUR): string {
  const fill = (ds: readonly string[]) => ds.map((d) => `<path d="${d}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WITCH_VIEWBOX.w} ${WITCH_VIEWBOX.h}" width="${width}" height="${height}">
<g fill="${colour}">${fill(BRISTLES)}${fill(CLOAK)}${fill(HAIR)}${fill(BODY)}</g>
<g fill="none" stroke="${colour}" stroke-linecap="round"><path d="${WITCH_HANDLE.d}" stroke-width="${WITCH_HANDLE.width}"/>${WITCH_STRAWS.map((d) => `<path d="${d}" stroke-width="1.4"/>`).join('')}</g>
</svg>`;
}
