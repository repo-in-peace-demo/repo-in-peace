import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { OWNS_KEYS_ATTRIBUTE } from '../model/fly-controls';
import { FACT_NAMES, factNameOne } from '../model/grave-facts';
import { FLAGS, KINDS, buildRows, filterRows, highlightedIndex, sortRows, type Flag, type Kind, type Row, type SortKey } from '../model/list-rows';
import { currentWindowWidth, panelsStartOpen } from '../model/panel-layout';
import { useYieldsTo } from '../store/detail-side-store';
import type { SceneModel } from '../model/scene-model';
import { scrollToShow, visibleRange } from '../model/virtual-window';
import { flyTo } from '../scene/api';
import { requestStatsCollapse } from '../store/panel-events';
import { clearSelection, select, useSelection } from '../store/selection-store';

/** Every row is this tall, so the list can draw only the rows in view. */
export const ROW_HEIGHT = 30;

/** Fewer rows than this below the open stats panel, and the stats panel folds as the list opens. */
export const LIST_MIN_ROWS = 8;

const SORTS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'decay', label: 'decay' },
  { key: 'age', label: 'age' },
  { key: 'name', label: 'name' },
  { key: 'size', label: 'size' },
];
// The filter buttons and the row tags use the one vocabulary (grave-facts.ts): Fresh, Stale, Ancient, Ghosts, Unused, Hot.
const KIND_LABELS: Record<Kind, string> = { fresh: FACT_NAMES.fresh, stale: FACT_NAMES.stale, ancient: FACT_NAMES.ancient, ghost: FACT_NAMES.ghost };
const STATE_WORDS: Record<Kind, string> = { fresh: FACT_NAMES.fresh, stale: FACT_NAMES.stale, ancient: FACT_NAMES.ancient, ghost: factNameOne('ghost') };
const SWATCH: Record<Kind, string> = { fresh: 'swatch-fresh', stale: 'swatch-moss', ancient: 'swatch-ancient', ghost: 'swatch-ghost' };

const rowId = (row: Row): string => `row-${row.kind}-${encodeURIComponent(row.path)}`;
const kindOfRow = (row: Row): Kind => (row.kind === 'ghost' ? 'ghost' : row.state!);

/**
 * The list of every file and ghost (interface spec, Req 5), docked on the left: most dead first, with sorts, filters and a count. It
 * draws only the rows in view, so 2,000 rows stay smooth. A row click or Enter selects the grave and flies to it; a selection made
 * anywhere else is highlighted here and scrolled into view. Arrow keys inside it move through the rows and never fly the camera.
 */
export function ListView({ model }: { model: SceneModel }) {
  const [userOpen, setOpen] = useState(() => panelsStartOpen(currentWindowWidth()));
  // While the detail panel is on the left, only the tab shows; the open state is kept for when it closes.
  const yielded = useYieldsTo('left');
  const open = userOpen && !yielded;
  const [sort, setSort] = useState<{ key: SortKey; reversed: boolean }>({ key: 'decay', reversed: false });
  const [kinds, setKinds] = useState<ReadonlySet<Kind>>(new Set());
  const [flags, setFlags] = useState<ReadonlySet<Flag>>(new Set());
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(400);
  const [active, setActive] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const aside = useRef<HTMLElement>(null);
  const toggleButton = useRef<HTMLButtonElement>(null);
  /** Set when the user opens the list with its header (not when it comes back after the details closed). */
  const openedByUser = useRef(false);
  // The rows' height when the list must stay below the open stats panel (a large window); null leaves it to the CSS.
  const [bodyHeight, setBodyHeight] = useState<number | null>(null);
  const selection = useSelection();

  const all = useMemo(() => buildRows(model.graveyard), [model]);
  const rows = useMemo(() => sortRows(filterRows(all, kinds, flags), sort.key, sort.reversed), [all, kinds, flags, sort]);
  const highlighted = highlightedIndex(rows, selection);

  // Whenever the rows become visible (the list opening, or coming back after the details folded it): the scroll box is new, so the
  // viewport is measured again and the scroll position taken from the box itself. A position kept from before would draw rows far
  // below the top of a box that starts at the top, and the list would look empty.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setViewport(el.clientHeight);
    setScrollTop(el.scrollTop);
    const observer = new ResizeObserver(() => setViewport(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);

  // Never scrolled past the content: fewer rows (a filter) bring the position back within them.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const max = Math.max(0, rows.length * ROW_HEIGHT - el.clientHeight);
    if (el.scrollTop > max) el.scrollTop = max;
    setScrollTop(Math.min(el.scrollTop, max));
  }, [rows.length]);

  // Keep below the stats panel when there is room: measured on opening, on a resize, and when the stats panel opens or closes.
  useLayoutEffect(() => {
    if (!open) return;
    const fit = (): number => {
      const el = aside.current;
      const stats = document.querySelector<HTMLElement>('.stats');
      if (!el) return Number.POSITIVE_INFINITY;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const cssDefault = Math.max(12 * rem, window.innerHeight - 18 * rem); // as in index.css; the measured room keeps it below the stats
      const limit = (stats ? stats.getBoundingClientRect().bottom : 0) + 8;
      const room = el.getBoundingClientRect().bottom - limit - (toggleButton.current?.offsetHeight ?? 0);
      // Never below 8rem: on a short window with the stats open, the list overlays it rather than vanish.
      setBodyHeight(Math.max(8 * rem, Math.min(cssDefault, room)));
      return room;
    };
    // Opening below the open stats panel with room for fewer than LIST_MIN_ROWS rows (a 1280 × 720 window): the stats panel folds to
    // its header, once, as the list opens; the list then fits again in the room it leaves.
    const room = fit();
    const askedFor = openedByUser.current;
    openedByUser.current = false;
    const statsOpen = document.querySelector('.stats .panel-toggle')?.getAttribute('aria-expanded') === 'true';
    const tools = (scroller.current?.offsetTop ?? 0) - (scroller.current?.parentElement?.offsetTop ?? 0);
    // Only when the user opened it: coming back after the details closed restores both panels as they were.
    if (askedFor && statsOpen && room - tools < LIST_MIN_ROWS * ROW_HEIGHT) requestStatsCollapse();
    const observer = new ResizeObserver(() => {
      fit();
    });
    const stats = document.querySelector<HTMLElement>('.stats');
    if (stats) observer.observe(stats);
    window.addEventListener('resize', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
    };
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
    <aside ref={aside} className={`list${open ? ' list-open' : ''}`} aria-label="Graves">
      <button
        ref={toggleButton}
        type="button"
        className="panel-toggle"
        aria-expanded={open}
        aria-controls="list-body"
        title={yielded ? 'Close the details and show the list' : undefined}
        onClick={() => {
          openedByUser.current = yielded || !userOpen;
          if (yielded) {
            clearSelection();
            setOpen(true);
          } else setOpen((o) => !o);
        }}
      >
        <span>
          List · {all.length.toLocaleString('en-US')}
        </span>
        <span aria-hidden="true">{open ? '–' : '+'}</span>
      </button>
      {open && (
        <div id="list-body" className="list-body" style={bodyHeight === null ? undefined : { height: bodyHeight }}>
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
                {FACT_NAMES[f]}
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
                      {row.unused && (
                        <>
                          <span className="list-sep" aria-hidden="true">·</span>
                          <span className="list-mark-unused">{FACT_NAMES.unused}</span>
                        </>
                      )}
                      {row.hot && (
                        <>
                          <span className="list-sep" aria-hidden="true">·</span>
                          <span className="list-mark-hot">{FACT_NAMES.hot}</span>
                        </>
                      )}
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
