import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { BootNotice, Counts } from '../model/app-flow';
import { bootLines } from '../model/boot-script';
import type { Manifest } from '../model/manifest';
import { fetchManifest } from './fetch-manifest';
import { useTyping } from './useTyping';

interface BootScreenProps {
  baseUrl: string;
  /** A local file that could not be opened, shown under the choices. */
  notice: BootNotice | null;
  onChooseDemo: (name: string, counts: Counts) => void;
  onChooseFile: (file: File) => void;
}

const plural = (n: number, one: string, many: string): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * The first screen at a bare address (interface spec, Req 1): a made-up workstation boot in green on black, then the demo
 * graveyards and "Open a graveyard file". Any key or click while it types shows it all, without choosing anything. The first demo is
 * focused when the choices appear, so Enter opens it; Up and Down move between the choices. A file can also be dropped anywhere.
 */
export function BootScreen({ baseUrl, notice, onChooseDemo, onChooseFile }: BootScreenProps) {
  const [manifest, setManifest] = useState<Manifest | null | undefined>(undefined); // undefined: still loading
  const [skipped, setSkipped] = useState(false);
  const [dragging, setDragging] = useState(false);
  const choices = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchManifest(baseUrl, controller.signal).then((m) => {
      if (!controller.signal.aborted) setManifest(m);
    });
    return () => controller.abort();
  }, [baseUrl]);

  const typing = useTyping(manifest === undefined ? [] : bootLines(manifest), skipped);
  const ready = manifest !== undefined && typing.done;

  // Any key or pointer press while the text types shows it all, and is not passed on (so it chooses nothing).
  useEffect(() => {
    if (ready) return;
    const skip = (event: Event): void => {
      // The browser's own shortcuts (reload, new tab) are left alone.
      if (event instanceof KeyboardEvent && (event.metaKey || event.ctrlKey || event.altKey)) return;
      event.preventDefault();
      event.stopPropagation();
      setSkipped(true);
    };
    window.addEventListener('keydown', skip, true);
    window.addEventListener('pointerdown', skip, true);
    return () => {
      window.removeEventListener('keydown', skip, true);
      window.removeEventListener('pointerdown', skip, true);
    };
  }, [ready]);

  // The first choice takes the focus when the choices appear.
  useEffect(() => {
    if (ready) choices.current?.querySelector<HTMLElement>('[data-choice]')?.focus();
  }, [ready]);

  // A rejected file: its message takes the focus, so it is read out.
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const onChoicesKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const all = Array.from(choices.current?.querySelectorAll<HTMLElement>('[data-choice]') ?? []);
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next = all[(at + (event.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length];
    next?.focus();
    event.preventDefault();
  };

  const onDrop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onChooseFile(file);
  };

  return (
    <main
      className={`terminal boot${dragging ? ' terminal-drop' : ''}`}
      aria-label="Repo In Peace"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <pre className="terminal-text" role="status" aria-live={ready ? 'polite' : 'off'}>
        {typing.lines.join('\n')}
        {!ready && <span className="terminal-cursor" aria-hidden="true" />}
      </pre>

      {ready && (
        <div className="terminal-choices" ref={choices} onKeyDown={onChoicesKey}>
          {manifest === null || manifest.graveyards.length === 0 ? (
            <p className="terminal-dim">No demo list found. You can still open a graveyard file.</p>
          ) : (
            <ul aria-label="Demo graveyards">
              {manifest.graveyards.map((g) => (
                <li key={g.name}>
                  <button type="button" className="terminal-choice" data-choice onClick={() => onChooseDemo(g.name, { repo: g.repo, files: g.files, ghosts: g.ghosts })}>
                    <span className="terminal-choice-name">{g.repo}</span>
                    <span className="terminal-dim">
                      {' '}
                      — {plural(g.files, 'file', 'files')}
                      {g.ghosts > 0 ? `, ${plural(g.ghosts, 'ghost', 'ghosts')}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="terminal-choice terminal-file" data-choice tabIndex={0} onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              (event.currentTarget.querySelector('input') as HTMLInputElement | null)?.click();
            }
          }}>
            Open a graveyard file…
            <input
              type="file"
              accept=".json,application/json"
              className="visually-hidden"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = ''; // the same file can be chosen again
                if (file) onChooseFile(file);
              }}
            />
          </label>
          <p className="terminal-dim terminal-hint">or drop a .graveyard.json anywhere here. It is read in this browser and never uploaded.</p>
          {notice && (
            <div className="terminal-notice" role="alert" tabIndex={-1} ref={noticeRef}>
              <p>{notice.title}</p>
              <p>{notice.message}</p>
              {notice.details.length > 0 && (
                <ul>
                  {notice.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
