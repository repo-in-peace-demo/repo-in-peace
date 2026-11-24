import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FLY_KEY_CODES } from './fly-controls';
import { SHORTCUT_CODES, shortcutFor, type KeyPress } from './shortcuts';

const press = (over: Partial<KeyPress>): KeyPress => ({
  code: 'KeyX',
  key: 'x',
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  repeat: false,
  typing: false,
  ...over,
});

describe('shortcutFor', () => {
  it('resets the view on Home and on R', () => {
    expect(shortcutFor(press({ code: 'Home', key: 'Home' }))).toBe('reset');
    expect(shortcutFor(press({ code: 'KeyR', key: 'r' }))).toBe('reset');
    expect(shortcutFor(press({ code: 'KeyR', key: 'R' }))).toBe('reset'); // with Shift or Caps Lock
  });

  it('toggles the help on ?, whichever key makes it', () => {
    expect(shortcutFor(press({ code: 'Slash', key: '?' }))).toBe('help');
    expect(shortcutFor(press({ code: 'Digit7', key: '?' }))).toBe('help'); // another layout
  });

  it('does nothing for the flying keys, Escape, or any other key', () => {
    for (const code of [...FLY_KEY_CODES, 'ShiftLeft', 'Escape', 'Space', 'Enter', 'KeyX']) {
      expect(shortcutFor(press({ code, key: code }))).toBeUndefined();
    }
  });

  it.each(['ctrlKey', 'altKey', 'metaKey', 'repeat', 'typing'] as const)('does nothing when %s is set, so browser shortcuts and typing are left alone', (flag) => {
    expect(shortcutFor(press({ code: 'KeyR', key: 'r', [flag]: true }))).toBeUndefined();
    expect(shortcutFor(press({ code: 'Home', key: 'Home', [flag]: true }))).toBeUndefined();
    expect(shortcutFor(press({ code: 'Slash', key: '?', [flag]: true }))).toBeUndefined();
  });

  it('shares no key with flying', () => {
    expect(SHORTCUT_CODES).toEqual(['Home', 'KeyR', 'KeyK', 'KeyM']); // K only with Cmd or Ctrl; M for sound
    expect(SHORTCUT_CODES.some((code) => FLY_KEY_CODES.has(code))).toBe(false);
  });

  it('only ever answers for Home, R, M, ?, / and Ctrl+K', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 12 }), fc.constantFrom('KeyK', 'Home', 'KeyR', 'KeyM')), fc.oneof(fc.string({ maxLength: 12 }), fc.constantFrom('/', '?')), fc.boolean(), fc.boolean(), (code, key, ctrlKey, repeat) => {
        const answer = shortcutFor(press({ code, key, ctrlKey, repeat }));
        if (ctrlKey && code === 'KeyK' && !repeat) return answer === 'search';
        const wanted = code === 'Home' || code === 'KeyR' || code === 'KeyM' || key === '?' || key === '/';
        return answer === undefined || (wanted && !ctrlKey && !repeat);
      }),
      { numRuns: 300 },
    );
  });
});

describe('the sound shortcut', () => {
  it('is M, wherever M is on the keyboard, not while typing, not with Cmd, Ctrl or Alt, not on a repeat', () => {
    expect(shortcutFor(press({ code: 'KeyM', key: 'm' }))).toBe('sound');
    expect(shortcutFor(press({ code: 'KeyM', key: 'm', typing: true }))).toBeUndefined();
    expect(shortcutFor(press({ code: 'KeyM', key: 'm', metaKey: true }))).toBeUndefined();
    expect(shortcutFor(press({ code: 'KeyM', key: 'm', repeat: true }))).toBeUndefined();
  });
});

describe('the search shortcut', () => {
  it('is / when the user is not typing, and Cmd+K or Ctrl+K from anywhere, even a field', () => {
    expect(shortcutFor(press({ code: 'Slash', key: '/' }))).toBe('search');
    expect(shortcutFor(press({ code: 'Slash', key: '/', typing: true }))).toBeUndefined(); // a / typed into a field stays a /
    expect(shortcutFor(press({ code: 'KeyK', key: 'k', metaKey: true }))).toBe('search');
    expect(shortcutFor(press({ code: 'KeyK', key: 'k', ctrlKey: true, typing: true }))).toBe('search');
    expect(shortcutFor(press({ code: 'KeyK', key: 'k' }))).toBeUndefined(); // K alone is nothing
    expect(shortcutFor(press({ code: 'KeyK', key: 'k', metaKey: true, altKey: true }))).toBeUndefined();
    expect(shortcutFor(press({ code: 'KeyK', key: 'k', metaKey: true, repeat: true }))).toBeUndefined();
  });

  it('never fires for a flying key, with or without Cmd or Ctrl', () => {
    for (const code of FLY_KEY_CODES) {
      for (const mod of [{}, { metaKey: true }, { ctrlKey: true }]) expect(shortcutFor(press({ code, key: code.slice(-1).toLowerCase(), ...mod }))).not.toBe('search');
    }
  });
});

