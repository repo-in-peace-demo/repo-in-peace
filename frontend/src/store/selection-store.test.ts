import fc from 'fast-check';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSelection, getSelection, select, subscribeSelection, useSelection, type Selection } from './selection-store';

// The store is one shared value for the whole page, so every test starts from a clear selection and ends with
// no listeners left behind: a listener that outlived its test would be told about the next test's changes.
const unsubscribers: Array<() => void> = [];
const listen = (listener: () => void): (() => void) => {
  const unsubscribe = subscribeSelection(listener);
  unsubscribers.push(unsubscribe);
  return unsubscribe;
};

beforeEach(() => clearSelection());
afterEach(() => {
  for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
  vi.restoreAllMocks();
});

const file = (path: string): Selection => ({ kind: 'file', path });
const ghost = (path: string): Selection => ({ kind: 'ghost', path });

describe('the selection store', () => {
  it('starts with nothing selected', () => {
    expect(getSelection()).toBeNull();
  });

  it('holds a file or a ghost once it is selected', () => {
    select(file('src/a.ts'));
    expect(getSelection()).toEqual({ kind: 'file', path: 'src/a.ts' });
    select(ghost('src/gone.ts'));
    expect(getSelection()).toEqual({ kind: 'ghost', path: 'src/gone.ts' });
  });

  it('clears with null and with clearSelection', () => {
    select(file('a.ts'));
    select(null);
    expect(getSelection()).toBeNull();
    select(file('a.ts'));
    clearSelection();
    expect(getSelection()).toBeNull();
  });

  it('treats a file and a ghost with the same path as different selections', () => {
    select(file('x.ts'));
    const spy = vi.fn();
    listen(spy);
    select(ghost('x.ts'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(getSelection()).toEqual({ kind: 'ghost', path: 'x.ts' });
  });
});

describe('telling listeners', () => {
  it('tells a listener once for each change', () => {
    const spy = vi.fn();
    listen(spy);
    select(file('a.ts'));
    expect(spy).toHaveBeenCalledTimes(1);
    select(file('b.ts'));
    expect(spy).toHaveBeenCalledTimes(2);
    clearSelection();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('says nothing when the same stone is selected again, even through a different object', () => {
    select(file('a.ts'));
    const spy = vi.fn();
    listen(spy);
    select(file('a.ts'));
    select({ kind: 'file', path: 'a.ts' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('says nothing when clearing an empty selection', () => {
    const spy = vi.fn();
    listen(spy);
    clearSelection();
    select(null);
    expect(spy).not.toHaveBeenCalled();
  });

  it('tells a listener the new selection is already in place', () => {
    const seen: Selection[] = [];
    listen(() => seen.push(getSelection()));
    select(file('a.ts'));
    clearSelection();
    expect(seen).toEqual([{ kind: 'file', path: 'a.ts' }, null]);
  });

  it('tells every listener', () => {
    const [a, b, c] = [vi.fn(), vi.fn(), vi.fn()];
    for (const listener of [a, b, c]) listen(listener);
    select(ghost('g.ts'));
    for (const listener of [a, b, c]) expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops telling a listener after it unsubscribes, and the others go on hearing', () => {
    const gone = vi.fn();
    const stays = vi.fn();
    const unsubscribe = listen(gone);
    listen(stays);
    select(file('a.ts'));
    unsubscribe();
    select(file('b.ts'));
    expect(gone).toHaveBeenCalledTimes(1);
    expect(stays).toHaveBeenCalledTimes(2);
  });

  it('can be unsubscribed twice without harm', () => {
    const spy = vi.fn();
    const unsubscribe = listen(spy);
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
  });

  it('counts the same function subscribed twice as two subscriptions', () => {
    const spy = vi.fn();
    const first = listen(spy);
    listen(spy);
    select(file('a.ts'));
    expect(spy).toHaveBeenCalledTimes(2);
    first();
    select(file('b.ts'));
    expect(spy).toHaveBeenCalledTimes(3); // one subscription is left
  });

  it('keeps telling the others when one listener throws, and reports the error', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const after = vi.fn();
    const unsubscribeBroken = listen(() => {
      throw new Error('broken listener');
    });
    listen(after);
    select(file('a.ts'));
    expect(after).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    unsubscribeBroken();
  });

  it('lets a listener change the selection while it is being told, and ends in a consistent state', () => {
    // Whenever a ghost is selected, this listener clears the selection.
    listen(() => {
      if (getSelection()?.kind === 'ghost') clearSelection();
    });
    const last = vi.fn(() => getSelection());
    listen(last);
    select(ghost('g.ts'));
    expect(getSelection()).toBeNull();
    expect(last.mock.results.at(-1)!.value).toBeNull(); // the last thing anyone heard is the final state
  });

  it('lets a listener unsubscribe itself while it is being told', () => {
    const spy = vi.fn();
    const unsubscribe = listen(() => {
      spy();
      unsubscribe();
    });
    select(file('a.ts'));
    select(file('b.ts'));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('what the store keeps', () => {
  it('returns the same object until the selection changes, which React relies on', () => {
    select(file('a.ts'));
    const first = getSelection();
    expect(getSelection()).toBe(first);
    select(file('a.ts'));
    expect(getSelection()).toBe(first); // selecting the same stone again changes nothing
    select(file('b.ts'));
    expect(getSelection()).not.toBe(first);
  });

  it('keeps its own copy, so changing the object passed in does not change the selection', () => {
    const mine = { kind: 'file' as const, path: 'a.ts' };
    select(mine);
    mine.path = 'changed.ts';
    expect(getSelection()).toEqual({ kind: 'file', path: 'a.ts' });
  });

  it('gives out a selection that cannot be changed', () => {
    select(file('a.ts'));
    expect(Object.isFrozen(getSelection())).toBe(true);
  });
});

describe('useSelection', () => {
  function Reader() {
    const selection = useSelection();
    return createElement('p', null, selection === null ? 'nothing' : `${selection.kind}:${selection.path}`);
  }

  it('gives a component the current selection when it renders', () => {
    expect(renderToString(createElement(Reader))).toContain('nothing');
    select(file('src/a.ts'));
    expect(renderToString(createElement(Reader))).toContain('file:src/a.ts');
    select(ghost('src/gone.ts'));
    expect(renderToString(createElement(Reader))).toContain('ghost:src/gone.ts');
    clearSelection();
    expect(renderToString(createElement(Reader))).toContain('nothing');
  });

  it('is built from the same subscription as other code uses, so it is told of every change', () => {
    // useSyncExternalStore subscribes through subscribeSelection and reads getSelection; the store hands React the
    // same object until it changes, so React does not render again for a change that did not happen.
    const seen = vi.fn();
    const unsubscribe = listen(seen);
    select(file('a.ts'));
    select(file('a.ts'));
    expect(seen).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

describe('any sequence of selecting and clearing', () => {
  const action = fc.oneof(
    fc.record({ do: fc.constant('select' as const), kind: fc.constantFrom('file' as const, 'ghost' as const), path: fc.constantFrom('a.ts', 'b.ts', 'src/c.ts') }),
    fc.record({ do: fc.constant('clear' as const) }),
  );

  it('ends with the last thing done, and tells listeners exactly once for each real change', () => {
    fc.assert(
      fc.property(fc.array(action, { maxLength: 40 }), (actions) => {
        clearSelection();
        let told = 0;
        const unsubscribe = listen(() => told++);

        let model: { kind: string; path: string } | null = null;
        let expectedTold = 0;
        for (const a of actions) {
          const next = a.do === 'select' ? { kind: a.kind, path: a.path } : null;
          const changed = JSON.stringify(next) !== JSON.stringify(model);
          if (changed) expectedTold++;
          model = next;
          if (a.do === 'select') select({ kind: a.kind, path: a.path });
          else clearSelection();
        }
        unsubscribe();
        return JSON.stringify(getSelection()) === JSON.stringify(model) && told === expectedTold;
      }),
    );
  });
});
