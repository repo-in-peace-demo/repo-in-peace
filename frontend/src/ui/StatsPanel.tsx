import type { RepoMeta } from '@shared/graveyard-schema';
import { useState } from 'react';
import { currentWindowWidth, panelsStartOpen } from '../model/panel-layout';
import { useYieldsTo } from '../store/detail-side-store';
import { clearSelection } from '../store/selection-store';
import { statsHeading, statsLayout } from '../model/overlay-text';
import type { Stats } from '../model/stats';

/**
 * The repository's name, the snapshot it describes, and the counts: files and folders, then the same groups as the legend (Age,
 * Usage, Activity, History), each row its name, its rule from the data file and its count. Top left. Text only. The name is a button that
 * collapses the panel down to the name; clicks anywhere else go through to the scene.
 */
export function StatsPanel({ meta, stats }: { meta: RepoMeta; stats: Stats }) {
  const [open, setOpen] = useState(() => panelsStartOpen(currentWindowWidth())); // collapsed on a narrow window, so the opening shot is clear
  // While the detail panel is on the left, only the header bar shows; the open state is kept for when it closes.
  const yielded = useYieldsTo('left');
  const shown = open && !yielded;
  const heading = statsHeading(meta);
  const layout = statsLayout(stats, meta);
  return (
    <section className="stats" aria-label="Statistics">
      <button
        type="button"
        className="panel-toggle"
        aria-expanded={shown}
        aria-controls="stats-body"
        title={yielded ? 'Close the details and show the statistics' : shown ? 'Collapse the statistics' : 'Show the statistics'}
        onClick={(event) => {
          if (yielded) {
            clearSelection();
            setOpen(true);
          } else setOpen((o) => !o);
          event.currentTarget.blur(); // give the keyboard back to the scene
        }}
      >
        <span className="stats-name">{heading.name}</span>
        <span aria-hidden="true">{shown ? '–' : '+'}</span>
      </button>
      {shown && (
        <div id="stats-body">
          <p className="stats-detail">{heading.detail}</p>
          <dl className="stats-top">
            {layout.top.map((row) => (
              <div key={row.id} className="stats-row">
                <dt>{row.label}</dt>
                <dd>{row.value.toLocaleString('en-US')}</dd>
              </div>
            ))}
          </dl>
          {layout.groups.map((group) => (
            <section key={group.id} className="stats-group" aria-label={group.title}>
              <h3 className="stats-group-title" title={group.about}>
                {group.title}
              </h3>
              <dl>
                {group.rows.map((row) => (
                  <div key={row.id} className="stats-row">
                    <dt>{row.label}</dt>
                    <span className="stats-rule">{row.rule}</span>
                    <dd>{row.value.toLocaleString('en-US')}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
