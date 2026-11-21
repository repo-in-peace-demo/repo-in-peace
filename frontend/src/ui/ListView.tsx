import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { OWNS_KEYS_ATTRIBUTE } from '../model/fly-controls';
import { FLAGS, KINDS, buildRows, filterRows, highlightedIndex, sortRows, type Flag, type Kind, type Row, type SortKey } from '../model/list-rows';
import { currentWindowWidth, panelsStartOpen } from '../model/panel-layout';
import type { SceneModel } from '../model/scene-model';
import { scrollToShow, visibleRange } from '../model/virtual-window';
import { flyTo } from '../scene/api';
import { select, useSelection } from '../store/selection-store';

/** Every row is this tall, so the list can draw only the rows in view. */
export const ROW_HEIGHT = 30;

const SORTS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'decay', label: 'decay' },
  { key: 'age', label: 'age' },
  { key: 'name', label: 'name' },
  { key: 'size', label: 'size' },
];
const KIND_LABELS: Record<Kind, string> = { fresh: 'fresh', stale: 'stale', ancient: 'ancient', ghost: 'ghosts' };
const STATE_WORDS: Record<Kind, string> = { fresh: 'Fresh', stale: 'Stale', ancient: 'Ancient', ghost: 'Ghost' };
const SWATCH: Record<Kind, string> = { fresh: 'swatch-fresh', stale: 'swatch-moss', ancient: 'swatch-ancient', ghost: 'swatch-ghost' };

const rowId = (row: Row): string => `row-${row.kind}-${encodeURIComponent(row.path)}`;
const kindOfRow = (row: Row): Kind => (row.kind === 'ghost' ? 'ghost' : row.state!);

/**
 * The list of every file and ghost (interface spec, Req 5), docked on the left: most dead first, with sorts, filters and a count. It
 * draws only the rows in view, so 2,000 rows stay smooth. A row click or Enter selects the grave and flies to it; a selection made
 * anywhere else is highlighted here and scrolled into view. Arrow keys inside it move through the rows and never fly the camera.
 */
export function ListView({ model }: { model: SceneModel }) {
  const [open, setOpen] = useState(() => panelsStartOpen(currentWindowWidth()));
  const [sort, setSort] = useState<{ key: SortKey; reversed: boolean }>({ key: 'decay', reversed: false });
  const [kinds, setKinds] = useState<ReadonlySet<Kind>>(new Set());
  const [flags, setFlags] = useState<ReadonlySet<Flag>>(new Set());
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(400);
  const [active, setActive] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const selection = useSelection();

  const all = useMemo(() => buildRows(model.graveyard), [model]);
  const rows = useMemo(() => sortRows(filterRows(all, kinds, flags), sort.key, sort.reversed), [all, kinds, flags, sort]);
  const highlighted = highlightedIndex(rows, selection);

  // The viewport's height, kept up to date.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setViewport(el.clientHeight);
    const observer = new ResizeObserver(() => setViewport(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);

  // A selection from elsewhere (or a new order): its row becomes the active one and is scrolled into view.
  useEffect(() => {
    if (highlighted < 0) return;
    setActive(highlighted);
    const el = scroller.current;
    if (el) el.scrollTop = scrollToShow(highlighted, el.scrollTop, el.clientHeight, ROW_HEIGHT);
  }, [highlighted, open]);

  const choose = (row: Row): void => {
    select({ kind: row.kind, path: row.path });
    flyTo(row.path);
  };

  const moveTo = (index: number): void => {
    if (rows.length === 0) return;
    const next = Math.max(0, Math.min(rows.length - 1, index));
    setActive(next);
    const el = scroller.current;
    if (el) el.scrollTop = scrollToShow(next, el.scrollTop, el.clientHeight, ROW_HEIGHT);
  };

  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const page = Math.max(1, Math.floor(viewport / ROW_HEIGHT) - 1);
    const moves: Record<string, number> = { ArrowDown: active + 1, ArrowUp: active - 1, PageDown: active + page, PageUp: active - page, Home: 0, End: rows.length - 1 };
    if (event.key in moves) {
      moveTo(moves[event.key]!);
      event.preventDefault();
    } else if (event.key === 'Enter' && rows[active]) {
      choose(rows[active]!);
      event.preventDefault();
    }
  };

  const toggle = <T,>(set: ReadonlySet<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const { first, last } = visibleRange(scrollTop, viewport, ROW_HEIGHT, rows.length);
  const shown = rows.slice(first, last + 1);
  const selectionHidden = selection !== null && highlighted < 0 && model.lookup.has(selection.path);
  const activeRow = rows[Math.min(active, rows.length - 1)];

  return (
    <aside className={`list${open ? ' list-open' : ''}`} aria-label="Graves">
      <button type="button" className="panel-toggle" aria-expanded={open} aria-controls="list-body" onClick={() => setOpen((o) => !o)}>
        <span>
          List · {all.length.toLocaleString('en-US')}
        </span>
        <span aria-hidden="true">{open ? '–' : '+'}</span>
      </button>
      {open && (
        <div id="list-body" className="list-body">
          <div className="list-tools" role="group" aria-labelledby="list-sort-label">
            <span id="list-sort-label" className="list-tools-label">
              Sort
            </span>
            <span className="list-tools-buttons">
            {SORTS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                aria-pressed={sort.key === key}
                title={sort.key === key ? 'Press again to reverse' : `Sort by ${label}`}
                onClick={() => setSort((s) => (s.key === key ? { key, reversed: !s.reversed } : { key, reversed: false }))}
              >
                {label}
                {sort.key === key ? (sort.reversed ? ' ↑' : ' ↓') : ''}
              </button>
            ))}
            </span>
          </div>
          <div className="list-tools" role="group" aria-labelledby="list-show-label">
            <span id="list-show-label" className="list-tools-label">
              Show
            </span>
            <span className="list-tools-buttons">
            {KINDS.map((k) => (
              <button key={k} type="button" aria-pressed={kinds.has(k)} onClick={() => setKinds((s) => toggle(s, k))}>
                {KIND_LABELS[k]}
              </button>
            ))}
            {FLAGS.map((f) => (
              <button key={f} type="button" aria-pressed={flags.has(f)} onClick={() => setFlags((s) => toggle(s, f))}>
                {f}
              </button>
            ))}
            </span>
          </div>
          <p className="list-count" aria-live="polite">
            {rows.length.toLocaleString('en-US')} of {all.length.toLocaleString('en-US')}
            {selectionHidden && <span className="list-hidden"> · The selected grave is hidden by the filters</span>}
          </p>
          <div
            ref={scroller}
            className="list-rows"
            role="listbox"
            aria-label="Files and ghosts"
            tabIndex={0}
            aria-activedescendant={activeRow ? rowId(activeRow) : undefined}
            {...{ [OWNS_KEYS_ATTRIBUTE]: '' }}
            onKeyDown={onKey}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          >
            <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
              {shown.map((row, i) => {
                const index = first + i;
                const kind = kindOfRow(row);
                return (
                  <div
                    key={`${row.kind}:${row.path}`}
                    id={rowId(row)}
                    role="option"
                    aria-selected={index === highlighted}
                    className={`list-row${index === highlighted ? ' list-row-selected' : ''}${index === active ? ' list-row-active' : ''}`}
                    style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
                    onClick={() => {
                      setActive(index);
                      choose(row);
                    }}
                  >
                    <span className={`swatch ${SWATCH[kind]}`} aria-hidden="true" />
                    <span className="list-name">{row.name}</span>
                    <span className="list-folder">{row.folder === '' ? '/' : row.folder}</span>
                    <span className="list-marks">
                      <span className="list-state">{STATE_WORDS[kind]}</span>
                      {row.unused && <span className="list-mark-unused" title="Unused (cracked)">unused</span>}
                      {row.hot && <span className="list-mark-hot" title="Hot (a candle)">hot</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
