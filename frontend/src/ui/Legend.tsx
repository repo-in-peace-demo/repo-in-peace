import { useState } from 'react';
import { currentWindowWidth, panelsStartOpen } from '../model/panel-layout';
import { useYieldsTo } from '../store/detail-side-store';
import { clearSelection } from '../store/selection-store';
import type { Legend as LegendModel } from '../model/legend';
import { overridesOf, prLegendLines } from '../model/pr-scene';
import type { SceneModel } from '../model/scene-model';
import { usePrSession } from '../store/pr-store';

/**
 * What each look means, grouped by dimension in the same groups as the stats panel, with the real thresholds of this data file, and
 * the snapshot the ages are measured from.
 * Top right. The swatches are small stand-ins for the effects. The heading button collapses the legend.
 */
export function Legend({ legend, lookup }: { legend: LegendModel; lookup: SceneModel['lookup'] }) {
  // What this session's pull requests show in the scene, while any is shown (bury-and-resurrect Req 10.6).
  const { prs } = usePrSession();
  const prLines = prLegendLines(overridesOf({ lookup }, prs));
  const [open, setOpen] = useState(() => panelsStartOpen(currentWindowWidth())); // collapsed on a narrow window, so the opening shot is clear
  // While the detail panel is on the right, the legend shows only its header bar; its own open state is kept for when it closes.
  const yielded = useYieldsTo('right');
  const shown = open && !yielded;
  return (
    <section className="legend" aria-label="Legend">
      <button type="button" className="panel-toggle" aria-expanded={shown} aria-controls="legend-body" title={yielded ? 'Close the details and show the legend' : undefined} onClick={(event) => {
        // With the details open on this side, the header brings the legend back: it closes the details (one panel per side).
        if (yielded) {
          clearSelection();
          setOpen(true);
        } else setOpen((o) => !o);
        event.currentTarget.blur(); // give the keyboard back to the scene
      }}>
        <span>Legend</span>
        <span aria-hidden="true">{shown ? '–' : '+'}</span>
      </button>
      {shown && (
        <div id="legend-body">
          <p className="legend-snapshot">{legend.snapshotLine}</p>
          {legend.groups.map((group) => (
            <section key={group.id} className="legend-group" aria-label={group.title}>
              <h3 className="legend-group-title">{group.title}</h3>
              {group.note !== undefined && <p className="legend-note">{group.note}</p>}
              <ul>
                {group.entries.map((entry) => (
                  <li key={entry.id}>
                    <span className={`swatch swatch-${entry.id}`} aria-hidden="true" />
                    <div>
                      <strong>{entry.title}</strong>
                      <span className="legend-text">{entry.text}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {prLines.length > 0 && (
            <section className="legend-group" aria-label="Pull requests (this session)">
              <h3 className="legend-group-title">Pull requests (this session)</h3>
              <ul>
                {prLines.map((line) => (
                  <li key={line.id}>
                    <span className={`swatch swatch-${line.id}`} aria-hidden="true" />
                    <div>
                      <strong>{line.title}</strong>
                      <span className="legend-text">{line.text}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </section>
  );
}
