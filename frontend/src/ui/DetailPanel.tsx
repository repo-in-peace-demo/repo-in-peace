import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FileEntry, Ghost, RepoMeta } from '@shared/graveyard-schema';
import { buryOffered, calendarDay, fileType, hotDetail, linesText, shortenPath, stateSentence, usageDetail } from '../model/grave-facts';
import { nudgeNeeded, panelSide, type Side } from '../model/panel-placement';
import type { SceneModel } from '../model/scene-model';
import { isFlying, nudge, screenBoxOf } from '../scene/api';
import { setDetailSide } from '../store/detail-side-store';
import { clearSelection, useSelection } from '../store/selection-store';

/** How many characters of a path the heading keeps (the file name always whole). */
const PATH_CHARS = 44;

/**
 * The selected stone or ghost, in words (interface spec, Req 4): what it is, why it looks as it does, its eulogy, and the actions that
 * will come with the PR function. Opens on any selection (scene, list, search) and closes when the selection is cleared (×, Escape,
 * an empty-ground click). It sits on the side of the window away from the selected item, and moves the picture sideways only if it
 * would still cover it. One panel per side: while it is open, the other panels on its side fold to their header bar (the legend on
 * the right; the stats panel and the list on the left), and they come back as they were when it closes. Everything from the data
 * file is put on the page as text.
 */
export function DetailPanel({ model }: { model: SceneModel }) {
  const selection = useSelection();
  const [side, setSide] = useState<Side>('right');
  // Set once the side has been worked out for the current selection: the nudge waits for it (it must measure the panel on its side).
  const [placed, setPlaced] = useState(0);
  const panel = useRef<HTMLElement>(null);

  const found = selection ? model.lookup.get(selection.path) : undefined;
  const item = found && selection && found.kind === selection.kind ? found : undefined;

  // The side, worked out when the selection changes and when the window is resized, never while the user only moves the camera
  // (the panel would jump about). After a flight (from the list or search), wait until it has landed.
  const path = item ? selection!.path : null;
  useEffect(() => {
    if (path === null) return;
    let frame = 0;
    let settled = false;
    const place = (): void => {
      if (isFlying()) {
        frame = requestAnimationFrame(place);
        return;
      }
      const box = screenBoxOf(path);
      const nextSide = box ? panelSide((box.x0 + box.x1) / 2, window.innerWidth) : 'right';
      setSide(nextSide);
      settled = true;
      setPlaced((n) => n + 1);
    };
    frame = requestAnimationFrame(place);
    const onResize = (): void => {
      if (settled) place();
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, [path]);

  // Once the panel is drawn on its side: if it still covers the item (a narrow window), move the picture sideways just enough.
  useLayoutEffect(() => {
    if (path === null || !panel.current || placed === 0) return;
    const frame = requestAnimationFrame(() => {
      const box = screenBoxOf(path);
      const rect = panel.current?.getBoundingClientRect();
      if (!box || !rect || isFlying()) return;
      nudge(nudgeNeeded(box, { x0: rect.left, x1: rect.right, y0: rect.top, y1: rect.bottom }), path);
    });
    return () => cancelAnimationFrame(frame);
  }, [placed]); // after each placement, with the panel already on its side

  // One panel per side: the panels on this side fold to their header bar while this one is open, and come back when it closes.
  const shownOn = item ? side : null;
  useEffect(() => {
    setDetailSide(shownOn);
  }, [shownOn]);
  useEffect(() => () => setDetailSide(null), []);

  if (!item || !selection) return null;
  const meta = model.graveyard.meta;
  const content = item.kind === 'file' ? <StoneDetail file={model.stones[item.index]!.file} meta={meta} /> : <GhostDetail ghost={model.ghosts[item.index]!.ghost} meta={meta} />;
  return (
    <aside ref={panel} className={`detail detail-${side}`} aria-label="Selected grave">
      <button type="button" className="detail-close" aria-label="Close" title="Close (Esc)" onClick={() => clearSelection()}>
        ×
      </button>
      {content}
    </aside>
  );
}

function Heading({ path, ghost }: { path: string; ghost: boolean }) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return (
    <header className="detail-heading">
      <h2>
        {ghost && <span className="hover-ghost">ghost </span>}
        {name}
      </h2>
      <p className="detail-path" title={path}>
        {shortenPath(path, PATH_CHARS)} <CopyButton text={path} label="Copy the path" />
      </p>
    </header>
  );
}

function StoneDetail({ file, meta }: { file: FileEntry; meta: RepoMeta }) {
  const noteId = 'detail-bury-note';
  return (
    <>
      <Heading path={file.path} ghost={false} />
      <dl className="detail-facts">
        <dt>Age</dt>
        <dd>{stateSentence(file, meta)}</dd>
        <dt>Last changed</dt>
        <dd>
          {calendarDay(file.lastCommitDate, meta.snapshotDate)} by {file.lastCommitAuthor}
        </dd>
        <dt>Usage</dt>
        <dd>{usageDetail(file, meta)}</dd>
        <dt>Activity</dt>
        <dd>{hotDetail(file, meta)}</dd>
        <dt>Size</dt>
        <dd>{linesText(file.linesOfCode)}</dd>
        <dt>Decay score</dt>
        <dd>{file.decayScore.toFixed(2)}</dd>
      </dl>
      <Eulogy text={file.eulogy} model={meta.eulogyModel} />
      {buryOffered(file) && (
        <div className="detail-actions">
          <button type="button" aria-disabled="true" aria-describedby={noteId} onClick={(e) => e.preventDefault()}>
            Bury
          </button>
          <p id={noteId} className="detail-note">
            Arrives with the PR function.
          </p>
        </div>
      )}
    </>
  );
}

function GhostDetail({ ghost, meta }: { ghost: Ghost; meta: RepoMeta }) {
  const noteId = 'detail-resurrect-note';
  return (
    <>
      <Heading path={ghost.path} ghost />
      <dl className="detail-facts">
        <dt>Deleted</dt>
        <dd>
          {calendarDay(ghost.deletedDate, meta.snapshotDate)} by {ghost.deletedBy}
        </dd>
        <dt>In commit</dt>
        <dd>
          <code title={ghost.deletedInSha}>{ghost.deletedInSha.slice(0, 7)}</code> <CopyButton text={ghost.deletedInSha} label="Copy the full commit SHA" />
        </dd>
        <dt>Type</dt>
        <dd>{fileType(ghost.path)}</dd>
      </dl>
      <Eulogy text={ghost.eulogy ?? ''} model={meta.eulogyModel} />
      <div className="detail-actions">
        <button type="button" aria-disabled="true" aria-describedby={noteId} onClick={(e) => e.preventDefault()}>
          Resurrect
        </button>
        <p id={noteId} className="detail-note">
          Arrives with the PR function.
        </p>
      </div>
    </>
  );
}

/** The grave's epitaph (eulogies spec, Req 8), with the model that wrote it. It came from a model, so it goes on the page as text only. */
function Eulogy({ text, model }: { text: string; model: string | undefined }) {
  if (text.trim() === '') return <p className="detail-eulogy-empty">[No eulogy yet. They will be written in a later version.]</p>;
  return (
    <figure className="detail-epitaph">
      <blockquote>{text}</blockquote>
      {model !== undefined && <figcaption>written by {model}</figcaption>}
    </figure>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className="detail-copy"
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
      }}
    >
      {copied ? 'copied' : 'copy'}
    </button>
  );
}
