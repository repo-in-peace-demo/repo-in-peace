import { useState } from 'react';
import { currentWindowWidth, panelsStartOpen } from '../model/panel-layout';
import type { Legend as LegendModel } from '../model/legend';

/**
 * What each look means, with the real thresholds of this data file, and the snapshot the ages are measured from.
 * Top right. The swatches are small stand-ins for the effects. The heading button collapses the legend.
 */
export function Legend({ legend }: { legend: LegendModel }) {
  const [open, setOpen] = useState(() => panelsStartOpen(currentWindowWidth())); // collapsed on a narrow window, so the opening shot is clear
  return (
    <section className="legend" aria-label="Legend">
      <button type="button" className="panel-toggle" aria-expanded={open} aria-controls="legend-body" onClick={(event) => {
        setOpen((o) => !o);
        event.currentTarget.blur(); // give the keyboard back to the scene
      }}>
        <span>Legend</span>
        <span aria-hidden="true">{open ? '–' : '+'}</span>
      </button>
      {open && (
        <div id="legend-body">
          <p className="legend-snapshot">{legend.snapshotLine}</p>
          <ul>
            {legend.entries.map((entry) => (
              <li key={entry.id}>
                <span className={`swatch swatch-${entry.id}`} aria-hidden="true" />
                <div>
                  <strong>{entry.title}</strong>
                  <span className="legend-text">{entry.text}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
