import { useEffect, useId, useState, type ReactElement, type ReactNode } from 'react';
import { prefersReducedMotion } from '../scene/reduced-motion';
import { graveKey, recordPr, setPrRequest, usePrSession, type GraveKind } from '../store/pr-store';
import { PR_NOTES, openPr, type Action, type PrAvailability } from './pr-client';
import { DEFAULT_TIMEOUTS, DOT_STEP_MS, progressAnnouncement, progressDots, progressWords, type PrTimeouts } from './pr-progress';

/** What the detail panel needs to offer pull requests: whether they work here, and the demo name the function knows. */
export interface PrContext {
  availability: PrAvailability;
  /** The demo name, when the graveyard was loaded by one. */
  graveyard: string | null;
}

const VERB: Record<Action, string> = { bury: 'Bury', resurrect: 'Resurrect' };

/** The waiting times; the browser tests shorten them in development builds. */
const timeouts = (): PrTimeouts => (import.meta.env.DEV && window.__repoInPeacePrTimeouts) || DEFAULT_TIMEOUTS;

/** The elapsed time of a running request, ticking every dot step while it runs. */
function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (startedAt === null) return;
    setNow(performance.now());
    const timer = window.setInterval(() => setNow(performance.now()), DOT_STEP_MS);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return startedAt === null ? 0 : Math.max(0, now - startedAt);
}

/**
 * Bury or Resurrect in the detail panel (bury-and-resurrect Req 9): disabled with its note where pull requests don't work; otherwise
 * an inline confirmation naming the fork, the action and the path, progress, then the pull request link for the rest of the session,
 * or the error with Try again. Escape cancels the confirmation before it clears the selection. Everything is text.
 *
 * While a request runs (revised): the button is disabled; "Opening pull request" with cycling dots (a fixed "…" under reduced
 * motion), "Still working" after about 10 s, and after about 30 s the page stops waiting and offers Try again (which returns the
 * pull request if the server opened it meanwhile). Progress and results go to screen readers through one polite live region that
 * stays mounted, so each change is announced once, and never the dots.
 */
export function PrAction({ kind, path, action, question, pr }: { kind: GraveKind; path: string; action: Action; question: (repo: string) => string; pr: PrContext }) {
  const session = usePrSession();
  const key = graveKey(kind, path);
  const record = session.prs.get(key);
  const request = session.requests.get(key);
  const noteId = useId();
  const confirming = request?.state === 'confirming';
  const startedAt = request?.state === 'opening' ? request.startedAt : null;
  const elapsed = useElapsed(startedAt);

  // While the confirmation is open, Escape cancels it, and goes no further (the scene would clear the selection).
  useEffect(() => {
    if (!confirming) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setPrRequest(kind, path, null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [confirming, kind, path]);

  const live = (content: ReactNode, said: string): ReactElement => (
    <>
      {content}
      <p className="visually-hidden" aria-live="polite">
        {said}
      </p>
    </>
  );

  if (record !== undefined) {
    const label = `Pull request #${record.number} ${record.existing ? 'was already open' : 'opened'}`;
    return live(
      <div className="detail-actions">
        <p className="detail-pr">
          {record.url !== null ? (
            <a href={record.url} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          ) : (
            label
          )}
          {record.fake && <span className="detail-note"> (fake, local development)</span>}
        </p>
      </div>,
      `${label}.`,
    );
  }

  const { availability, graveyard } = pr;
  if (availability.kind !== 'available' || graveyard === null) {
    const note = availability.kind === 'available' ? PR_NOTES['local-file'] : PR_NOTES[availability.kind];
    return live(
      <div className="detail-actions">
        <button type="button" aria-disabled="true" aria-describedby={noteId} onClick={(e) => e.preventDefault()}>
          {VERB[action]}
        </button>
        <p id={noteId} className="detail-note">
          {note}
        </p>
      </div>,
      '',
    );
  }

  const open = async (): Promise<void> => {
    setPrRequest(kind, path, { state: 'opening', startedAt: performance.now() });
    const controller = new AbortController();
    const giveUp = window.setTimeout(() => controller.abort(), timeouts().giveUpMs);
    const outcome = await openPr(graveyard, action, path, { repo: availability.repo, fake: availability.fake }, fetch, controller.signal);
    window.clearTimeout(giveUp);
    if (outcome.kind === 'opened') recordPr(kind, path, { action, number: outcome.number, url: outcome.url, existing: outcome.existing, fake: outcome.fake, openedAt: performance.now() });
    else setPrRequest(kind, path, { state: 'error', message: outcome.message });
  };

  if (confirming) {
    return live(
      <div className="detail-confirm" role="group" aria-label={`${VERB[action]}: confirm`}>
        <p className="detail-confirm-question">{question(availability.repo)}</p>
        <div className="detail-actions">
          <button type="button" className="detail-primary" autoFocus onClick={() => void open()}>
            Open pull request
          </button>
          <button type="button" onClick={() => setPrRequest(kind, path, null)}>
            Cancel
          </button>
        </div>
      </div>,
      '',
    );
  }

  if (request?.state === 'opening') {
    const t = timeouts();
    return live(
      <div className="detail-actions detail-actions-wrap">
        <button type="button" disabled aria-busy="true">
          {VERB[action]}
        </button>
        {/* Seen only: the dots would make a screen reader repeat it. The live region says it once. */}
        <p className="detail-progress" aria-hidden="true">
          {progressWords(elapsed, t)}
          <span className="detail-dots">{progressDots(elapsed, prefersReducedMotion())}</span>
        </p>
      </div>,
      progressAnnouncement(elapsed, availability.repo, t),
    );
  }

  return live(
    <div className="detail-actions detail-actions-wrap">
      <button type="button" onClick={() => setPrRequest(kind, path, { state: 'confirming' })}>
        {VERB[action]}
      </button>
      {request?.state === 'error' && (
        <>
          <p className="detail-error">
            {request.message}
          </p>
          <button type="button" onClick={() => void open()}>
            Try again
          </button>
        </>
      )}
    </div>,
    request?.state === 'error' ? request.message : '',
  );
}
