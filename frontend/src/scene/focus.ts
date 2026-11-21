import { getSelection, subscribeSelection } from '../store/selection-store';

/**
 * The grave in focus, for the signs to keep out of its way: the selected one, or else the last one flown to with `flyTo`. A change
 * of the selection (selecting another, or clearing it) ends a flown-to focus; Reset view ends it too.
 */
let flownTo: string | null = null;
subscribeSelection(() => {
  flownTo = null;
});

export const setFlownTo = (path: string | null): void => {
  flownTo = path;
};

export const focusPath = (): string | null => getSelection()?.path ?? flownTo;
