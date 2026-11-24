import { useEffect } from 'react';
import { ownsKeys } from '../model/fly-controls';
import { shortcutFor } from '../model/shortcuts';
import { toggleSoundOn, useSound } from '../store/sound-store';

/**
 * The speaker button (sound request): muted by default; a click or M turns sound on or off. Its label says what it will do
 * ("Sound on" while muted, "Sound off" while playing), and the icon shows the state now. One is mounted at a time (the landing page
 * or the scene's controls), and it owns the M key while mounted.
 */
export function SoundToggle({ className }: { className?: string }) {
  const { on } = useSound();
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const press = { code: event.code, key: event.key, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey, repeat: event.repeat, typing: ownsKeys(target) };
      if (shortcutFor(press) !== 'sound') return;
      event.preventDefault();
      toggleSoundOn();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <button
      type="button"
      className={['sound-toggle', className].filter(Boolean).join(' ')}
      aria-label={on ? 'Sound off' : 'Sound on'}
      title={on ? 'Sound off (M)' : 'Sound on (M)'}
      data-sound={on ? 'on' : 'off'}
      onClick={(event) => {
        toggleSoundOn();
        event.currentTarget.blur(); // give the keyboard back to the scene
      }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path d="M4 9 H8 L13 4.5 V19.5 L8 15 H4 Z" fill="currentColor" />
        {on ? (
          <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M16 9 C17.4 10.4 17.4 13.6 16 15" />
            <path d="M18.6 6.5 C21.4 9.3 21.4 14.7 18.6 17.5" />
          </g>
        ) : (
          <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M16.5 9.5 L21 14" />
            <path d="M21 9.5 L16.5 14" />
          </g>
        )}
      </svg>
    </button>
  );
}
