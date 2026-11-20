import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import {
  NAME_FAR,
  NAME_MAX_CHARS,
  NAME_NEAR,
  RIP_TEXT,
  engravingBoxes,
  engravingCells,
  engravingFor,
  extensionOf,
  fileNameOf,
  nameOpacity,
  onFace,
  shortenName,
} from './engraving';
import { MAX_STONE_H, MIN_STONE_H } from './layout-constants';
import { buildSceneModel } from './scene-model';

const length = (s: string) => Array.from(s).length;
const nameArb = fc.oneof(
  fc.string({ minLength: 0, maxLength: 60 }),
  fc.tuple(fc.string({ minLength: 1, maxLength: 50 }), fc.constantFrom('.ts', '.tsx', '.test.ts', '.d.ts', '.json', '.mjs', '.verylongextension')).map(([a, b]) => a.replaceAll('/', '') + b),
  fc.string({ unit: 'grapheme', minLength: 1, maxLength: 40 }).map((s) => s + '.ts'),
);

describe('shortenName', () => {
  it('shortens in the middle and keeps the extension: the example', () => {
    expect(shortenName('useRealtimeVoiceChat.ts')).toBe('useRealtimeVoi….ts');
    expect(shortenName('index.ts')).toBe('index.ts');
    expect(shortenName('a'.repeat(NAME_MAX_CHARS) + '.ts').endsWith('….ts')).toBe(true);
  });

  it('always ends in the original extension, is never longer than the limit unless the extension itself is, and leaves a name that fits alone', () => {
    fc.assert(
      fc.property(nameArb, fc.integer({ min: 3, max: 40 }), (name, max) => {
        const out = shortenName(name, max);
        const ext = extensionOf(name);
        if (!out.endsWith(ext)) return false;
        if (length(name) <= max) return out === name;
        // Shortened: the start of the name, the ellipsis, the extension; at most `max` long unless the extension alone is.
        const fits = length(ext) + 1 <= max;
        return out.includes('…') && (fits ? length(out) <= max : out === '…' + ext) && name.startsWith(out.slice(0, out.length - ext.length - 1));
      }),
      { numRuns: 1000 },
    );
  });
});

describe('nameOpacity', () => {
  it('is 1 up close, 0 far away, and never rises as the camera moves away', () => {
    expect(nameOpacity(0)).toBe(1);
    expect(nameOpacity(NAME_NEAR)).toBe(1);
    expect(nameOpacity(NAME_FAR)).toBe(0);
    fc.assert(
      fc.property(fc.double({ min: 0, max: 200, noNaN: true }), fc.double({ min: 0, max: 200, noNaN: true }), (a, b) => {
        const [near, far] = a <= b ? [a, b] : [b, a];
        const o = nameOpacity(near);
        return o >= 0 && o <= 1 && nameOpacity(far) <= o;
      }),
    );
  });

  it.each(REAL_GRAVEYARDS)('%s: no name shows from the opening view (the overview is not cluttered)', (name) => {
    const m = buildSceneModel(loadRealGraveyard(name));
    for (const s of m.stones) {
      const d = Math.hypot(m.start.position.x - s.layout.x, m.start.position.y - s.layout.height / 2, m.start.position.z - s.layout.z);
      expect(nameOpacity(d)).toBe(0);
    }
  });
});

describe('the engraving on each stone', () => {
  it('says RIP exactly on the unused stones, and carries the file\'s own name', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 80 }), fc.boolean(), (path, unused) => {
        const e = engravingFor(path, unused);
        const own = fileNameOf(path);
        return e.rip === unused && (own.length === 0 ? e.name === null : e.name === shortenName(own));
      }),
    );
  });

  it('fits on the face of a stone of any height: RIP in the arch, the name below it, the two apart', () => {
    fc.assert(
      fc.property(fc.double({ min: MIN_STONE_H, max: MAX_STONE_H, noNaN: true }), (h) => {
        const { rip, name } = engravingBoxes(h);
        const corners = (b: { x: number; y: number; w: number; h: number }) => [
          [b.x - b.w / 2, b.y - b.h / 2],
          [b.x + b.w / 2, b.y - b.h / 2],
          [b.x - b.w / 2, b.y + b.h / 2],
          [b.x + b.w / 2, b.y + b.h / 2],
        ];
        const inside = [...corners(rip), ...corners(name)].every(([x, y]) => onFace(h, x!, y!));
        const apart = name.y + name.h / 2 <= rip.y - rip.h / 2 + 1e-9;
        return inside && apart;
      }),
      { numRuns: 500 },
    );
  });

  it('puts RIP in the first cell and each distinct name once, and never more cells than the atlas holds', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ rip: fc.boolean(), name: fc.option(fc.constantFrom('a.ts', 'b.ts', 'index.ts', 'x.tsx', 'y.json'), { nil: null }) }), { maxLength: 60 }), fc.integer({ min: 1, max: 6 }), (es, capacity) => {
        const { texts, nameCell } = engravingCells(es, capacity);
        if (texts[0] !== RIP_TEXT || texts.length > Math.max(1, capacity) || new Set(texts).size !== texts.length) return false;
        return es.every((e, i) => (nameCell[i] === -1 ? e.name === null || !texts.includes(e.name) : texts[nameCell[i]!] === e.name));
      }),
    );
  });

  it.each(REAL_GRAVEYARDS)('%s: every stone has its name in the atlas, and RIP is on exactly the unused ones', (name) => {
    const m = buildSceneModel(loadRealGraveyard(name));
    const es = m.stones.map((s) => engravingFor(s.file.path, s.file.unused));
    const { nameCell } = engravingCells(es, 500);
    expect([...nameCell].every((c) => c >= 1)).toBe(true);
    expect(es.filter((e) => e.rip).length).toBe(m.stones.filter((s) => s.file.unused).length);
  });
});
