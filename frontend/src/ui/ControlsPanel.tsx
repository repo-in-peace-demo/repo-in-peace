import { useEffect, useRef } from 'react';
import { useScrollFade } from './useScrollFade';
import { registerPanel, setPanelOpen, togglePanel, usePanelOpen, useSettleOnOpen } from '../store/panels-store';
import { CONTROL_GROUPS } from '../model/controls-help';
import { ownsKeys } from '../model/fly-controls';
import { shortcutFor } from '../model/shortcuts';
import { resetView } from '../scene/api';

/**
 * Two small buttons at the bottom left, "Reset view" and "?", and the controls help they open. Home and R reset the
 * view, ? shows or hides the help, and Escape closes it. The camera keys themselves are handled by the scene.
 */
export function ControlsPanel({ onBack }: { onBack?: () => void } = {}) {
  // Collapsed on launch; opening it closes any open panel it overlaps (the stats panel, the list) (store/panels-store.ts).
  const helpOpen = usePanelOpen('controls');
  const help = useRef<HTMLElement>(null);
  useEffect(() => registerPanel('controls', () => help.current), []);
  useSettleOnOpen('controls', helpOpen);
  useScrollFade(help, helpOpen);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setPanelOpen('controls', false); // not swallowed: Escape also clears the selection
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      const shortcut = shortcutFor({
        code: event.code,
        key: event.key,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        repeat: event.repeat,
        typing: ownsKeys(target),
      });
      if (shortcut === undefined || shortcut === 'search') return; // the search box handles its own shortcut
      event.preventDefault();
      if (shortcut === 'reset') resetView();
      else togglePanel('controls');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="controls">
      {helpOpen && (
        <section ref={help} id="controls-help" className="controls-help scroll-fade" aria-label="Controls">
          <h2>Controls</h2>
          {CONTROL_GROUPS.map((group) => (
            <div key={group.title}>
              <h3>{group.title}</h3>
              <dl>
                {group.entries.map((entry) => (
                  <div key={entry.keys} className="controls-row">
                    <dt>{entry.keys}</dt>
                    <dd>{entry.action}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </section>
      )}
      <div className="controls-buttons">
        {onBack && (
          <button type="button" title="Back to the list of graveyards" onClick={onBack}>
            ← Graveyards
          </button>
        )}
        <button
          type="button"
          title="Fly back to the overview (Home or R)"
          onClick={(event) => {
            resetView();
            event.currentTarget.blur(); // give the keyboard back to the scene
          }}
        >
          Reset view
        </button>
        <button
          type="button"
          title="Controls (?)"
          aria-label="Show or hide the controls"
          aria-expanded={helpOpen}
          aria-controls="controls-help"
          onClick={(event) => {
            togglePanel('controls');
            event.currentTarget.blur();
          }}
        >
          ?
        </button>
      </div>
    </div>
  );
}
