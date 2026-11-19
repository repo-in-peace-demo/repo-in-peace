import { FAST_KEY_CODES, FLY_FAST_FACTOR, FLY_KEY_CODES } from './fly-controls';

/**
 * What the controls panel lists: every key and mouse action of the scene. Plain data, so a test can check that
 * every key the camera listens to is on the list.
 */

export interface ControlEntry {
  /** What the user presses or does, as shown. */
  keys: string;
  /** What it does. */
  action: string;
  /** The `KeyboardEvent.code` values this entry documents, for the check that nothing is missing. */
  codes?: readonly string[];
}

export interface ControlGroup {
  title: string;
  entries: readonly ControlEntry[];
}

export const CONTROL_GROUPS: readonly ControlGroup[] = [
  {
    title: 'Fly',
    entries: [
      { keys: 'W or ↑', action: 'Move forward', codes: ['KeyW', 'ArrowUp'] },
      { keys: 'S or ↓', action: 'Move back', codes: ['KeyS', 'ArrowDown'] },
      { keys: 'A or ←', action: 'Move left', codes: ['KeyA', 'ArrowLeft'] },
      { keys: 'D or →', action: 'Move right', codes: ['KeyD', 'ArrowRight'] },
      { keys: 'E', action: 'Fly up', codes: ['KeyE'] },
      { keys: 'Q', action: 'Fly down', codes: ['KeyQ'] },
      { keys: 'Shift', action: `Hold to go ${FLY_FAST_FACTOR} times faster`, codes: FAST_KEY_CODES },
    ],
  },
  {
    title: 'Mouse',
    entries: [
      { keys: 'Drag', action: 'Orbit around the point you are looking at' },
      { keys: 'Right-drag', action: 'Pan along the ground' },
      { keys: 'Scroll', action: 'Zoom in and out' },
      { keys: 'Hover', action: 'Show the path of a stone or ghost' },
      { keys: 'Click a stone or ghost', action: 'Select it' },
      { keys: 'Click empty ground', action: 'Clear the selection' },
    ],
  },
  {
    title: 'View',
    entries: [
      { keys: 'Home or R', action: 'Reset the view and clear the selection', codes: ['Home', 'KeyR'] },
      { keys: 'Esc', action: 'Clear the selection and close this panel', codes: ['Escape'] },
      { keys: '?', action: 'Show or hide this panel' },
    ],
  },
];

/** Every key code the entries document. */
export const DOCUMENTED_CODES: ReadonlySet<string> = new Set(CONTROL_GROUPS.flatMap((g) => g.entries.flatMap((e) => e.codes ?? [])));

/** The key codes the scene listens to for flying, which must all be documented. */
export const FLYING_CODES: readonly string[] = [...FLY_KEY_CODES, ...FAST_KEY_CODES];
