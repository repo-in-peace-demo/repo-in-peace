import type { RepoMeta } from '@shared/graveyard-schema';
import { useState } from 'react';
import { statsHeading, statsRows } from '../model/overlay-text';
import type { Stats } from '../model/stats';

/**
 * The repository's name, the snapshot it describes, and the counts. Top left. Text only. The name is a button that
 * collapses the panel down to the name; clicks anywhere else go through to the scene.
 */
export function StatsPanel({ meta, stats }: { meta: RepoMeta; stats: Stats }) {
  const [open, setOpen] = useState(true);
  const heading = statsHeading(meta);
  return (
    <section className="stats" aria-label="Statistics">
      <button
        type="button"
        className="panel-toggle"
        aria-expanded={open}
        aria-controls="stats-body"
        title={open ? 'Collapse the statistics' : 'Show the statistics'}
        onClick={(event) => {
          setOpen((o) => !o);
          event.currentTarget.blur(); // give the keyboard back to the scene
        }}
      >
        <span className="stats-name">{heading.name}</span>
        <span aria-hidden="true">{open ? '–' : '+'}</span>
      </button>
      {open && (
        <div id="stats-body">
          <p className="stats-detail">{heading.detail}</p>
          <dl>
            {statsRows(stats).map((row) => (
              <div key={row.id} className="stats-row">
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
                {row.hint !== undefined && <span className="stats-hint">{row.hint}</span>}
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
