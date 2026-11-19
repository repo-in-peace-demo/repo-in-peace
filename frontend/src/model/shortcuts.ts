/**
 * Keyboard shortcuts that are not for flying: Home or R resets the view, ? shows or hides the controls help.
 * Pure: which shortcut, if any, a key press means. The page feeds it the key events.
 */

export type Shortcut = 'reset' | 'help';

export interface KeyPress {
  /** `KeyboardEvent.code`: the place of the key, whatever the keyboard layout. Used for Home and R, as for W A S D. */
  code: string;
  /** `KeyboardEvent.key`: the character typed. Used for ?, which needs Shift on most layouts and sits elsewhere on others. */
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  /** The key is held down and repeating. */
  repeat: boolean;
  /** The user is typing in an input, a textarea, a select or an editable element. */
  typing: boolean;
}

/**
 * The shortcut for a key press, or `undefined`. Nothing happens while the user types, with Ctrl, Alt or Meta held
 * (so the browser's own shortcuts keep working), or for a key that is only repeating.
 */
export function shortcutFor(press: KeyPress): Shortcut | undefined {
  if (press.typing || press.ctrlKey || press.altKey || press.metaKey || press.repeat) return undefined;
  if (press.code === 'Home' || press.code === 'KeyR') return 'reset';
  if (press.key === '?') return 'help';
  return undefined;
}

/** Codes that start a shortcut by their place on the keyboard. None of them is a flying key. */
export const SHORTCUT_CODES: readonly string[] = ['Home', 'KeyR'];
