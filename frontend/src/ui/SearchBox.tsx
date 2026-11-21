import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { OWNS_KEYS_ATTRIBUTE, ownsKeys } from '../model/fly-controls';
import { hoverSummary } from '../model/hover-label';
import { buildRows, type Row } from '../model/list-rows';
import type { SceneModel } from '../model/scene-model';
import { searchRows } from '../model/search';
import { shortcutFor } from '../model/shortcuts';
import { flyTo } from '../scene/api';
import { select } from '../store/selection-store';

/** At most this many results are kept; about 8 show at a time and the rest scroll. */
const RESULT_LIMIT = 50;

const optionId = (row: Row): string => `search-${row.kind}-${encodeURIComponent(row.path)}`;

/**
 * The search box at the top centre (interface spec, Req 6): file names and paths of files and ghosts, ranked exact name, name prefix,
 * name contains, path only. Results update as you type. Up and Down move, Enter selects the active result (the top one at first) and
 * flies to it. Escape clears the text, and a second Escape leaves the box; neither clears the selection. `/` and Cmd+K (Ctrl+K)
 * focus it. Typing in it never moves the camera.
 */
export function SearchBox({ model }: { model: SceneModel }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const rows = useMemo(() => buildRows(model.graveyard), [model]);
  const results = useMemo(() => searchRows(rows, query, RESULT_LIMIT), [rows, query]);
  const shown = open && results.length > 0;

  // `/` (not while typing) and Cmd+K or Ctrl+K (from anywhere) focus the box.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const shortcut = shortcutFor({ code: event.code, key: event.key, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey, repeat: event.repeat, typing: ownsKeys(target) });
      if (shortcut !== 'search') return;
      event.preventDefault();
      input.current?.focus();
      input.current?.select();
      setOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // The active result stays in view.
  useEffect(() => {
    if (!shown) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, shown]);

  const choose = (row: Row): void => {
    select({ kind: row.kind, path: row.path });
    flyTo(row.path);
    setOpen(false);
  };

  const onKey = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (results.length === 0) return;
      setOpen(true);
      setActive((a) => (event.key === 'ArrowDown' ? Math.min(results.length - 1, a + 1) : Math.max(0, a - 1)));
      event.preventDefault();
    } else if (event.key === 'Enter') {
      const row = results[Math.min(active, results.length - 1)];
      if (row) choose(row);
      event.preventDefault();
    } else if (event.key === 'Escape') {
      // Not passed on: the scene's Escape (clear the selection) ignores keys from a text field anyway.
      if (query !== '') {
        setQuery('');
        setActive(0);
      } else {
        input.current?.blur();
        setOpen(false);
      }
      event.preventDefault();
    }
  };

  const activeRow = shown ? results[Math.min(active, results.length - 1)] : undefined;
  return (
    <div className="search" role="search" {...{ [OWNS_KEYS_ATTRIBUTE]: '' }}>
      <input
        ref={input}
        type="search"
        className="search-input"
        placeholder="Search graves (/)"
        aria-label="Search graves by file name or path"
        role="combobox"
        aria-expanded={shown}
        aria-controls="search-results"
        aria-autocomplete="list"
        aria-activedescendant={activeRow ? optionId(activeRow) : undefined}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)} // after a click on a result has landed
        onKeyDown={onKey}
      />
      {shown && (
        <ul ref={list} id="search-results" className="search-results" role="listbox" aria-label="Results">
          {results.map((row, index) => (
            <li
              key={`${row.kind}:${row.path}`}
              id={optionId(row)}
              data-index={index}
              role="option"
              aria-selected={index === active}
              className={`search-result${index === active ? ' search-result-active' : ''}`}
              onMouseDown={(event) => event.preventDefault()} // keep the focus in the box
              onClick={() => choose(row)}
            >
              <span className="search-name">
                {row.kind === 'ghost' && <span className="hover-ghost">ghost </span>}
                {row.name}
              </span>
              <span className="search-folder">{row.folder === '' ? '/' : row.folder}</span>
              <span className="search-summary">{hoverSummary(model, { kind: row.kind, path: row.path })}</span>
            </li>
          ))}
        </ul>
      )}
      {open && query.trim() !== '' && results.length === 0 && <p className="search-none">No grave matches “{query.trim()}”.</p>}
    </div>
  );
}
