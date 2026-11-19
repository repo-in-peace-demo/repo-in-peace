import { useEffect, useRef, type MutableRefObject } from 'react';
import { FLY_KEY_CODES, isTypingElement } from '../model/fly-controls';

/**
 * Which flying keys are down. Keys are read by their code, so the layout of the keyboard does not matter. Keys are
 * ignored while the user types in a field, and with Ctrl, Alt or Meta held, so shortcuts of the browser keep working.
 * Everything is let go when the window loses focus, so a key never stays stuck down.
 *
 * @param onPress called when a key that moves the camera goes down (the camera rig ends a flight on it)
 */
export function useFlyKeys(onPress: () => void): MutableRefObject<Set<string>> {
  const pressed = useRef(new Set<string>());
  const press = useRef(onPress);
  press.current = onPress;

  useEffect(() => {
    const down = pressed.current;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (isTypingElement(target?.tagName, target?.isContentEditable ?? false)) return;

      const isShift = event.code === 'ShiftLeft' || event.code === 'ShiftRight';
      if (!FLY_KEY_CODES.has(event.code) && !isShift) return;
      down.add(event.code);
      if (FLY_KEY_CODES.has(event.code)) {
        event.preventDefault(); // the arrow keys must not scroll the page
        press.current();
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      down.delete(event.code);
    };
    const onBlur = (): void => down.clear();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      down.clear();
    };
  }, []);

  return pressed;
}
