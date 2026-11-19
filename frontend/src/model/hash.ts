/**
 * Deterministic variety. Everything that makes one stone look a little different from
 * another (lean direction, float phase, flicker phase) comes from a hash of its path, so the
 * same data file always gives the same scene. Nothing in `model/` uses a random source.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const TWO_POW_32 = 4_294_967_296;

const encoder = new TextEncoder();

/** 32-bit FNV-1a over the UTF-8 bytes of `text`, as an unsigned integer. */
export function fnv1a32(text: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of encoder.encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * The finalizer of MurmurHash3. FNV-1a spreads a change in the last characters of a string mostly into
 * the low bits, so paths like `file-1.ts` and `file-2.ts` would get similar high bits, and `hash01` reads the
 * high bits. This step spreads every input bit over all the output bits.
 */
export function mix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * A number in [0, 1) from `text` and an optional `salt`. Different salts give unrelated
 * numbers for the same text, so one path can have several independent properties.
 */
export function hash01(text: string, salt = ''): number {
  return mix32(fnv1a32(`${text}\u0000${salt}`)) / TWO_POW_32;
}
