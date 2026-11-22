import { afterEach, describe, expect, it } from 'vitest';
import { clearPrSession, getPrSession, graveKey, recordPr, setPrRequest, subscribePrSession } from './pr-store';

afterEach(() => clearPrSession());
const record = { action: 'bury' as const, number: 4, url: null, existing: false, fake: true, openedAt: 10 };

describe('the session store', () => {
  it('records a pull request per grave, ending its request, and tells listeners', () => {
    let calls = 0;
    const stop = subscribePrSession(() => calls++);
    setPrRequest('file', 'a.ts', { state: 'opening' });
    expect(getPrSession().requests.get(graveKey('file', 'a.ts'))).toEqual({ state: 'opening' });
    recordPr('file', 'a.ts', record);
    expect(getPrSession().prs.get('file:a.ts')).toEqual(record);
    expect(getPrSession().requests.has('file:a.ts')).toBe(false);
    expect(calls).toBe(2);
    stop();
  });

  it('gives a new snapshot on every change and the same one otherwise', () => {
    const a = getPrSession();
    expect(getPrSession()).toBe(a);
    setPrRequest('ghost', 'b.ts', { state: 'confirming' });
    const b = getPrSession();
    expect(b).not.toBe(a);
    setPrRequest('ghost', 'b.ts', null);
    setPrRequest('ghost', 'b.ts', null); // nothing to clear: no change
    expect(getPrSession().requests.size).toBe(0);
  });

  it('takes no new request for a grave that has a pull request, and keeps file and ghost apart', () => {
    recordPr('file', 'x.ts', record);
    setPrRequest('file', 'x.ts', { state: 'confirming' });
    expect(getPrSession().requests.has('file:x.ts')).toBe(false);
    setPrRequest('ghost', 'x.ts', { state: 'confirming' });
    expect(getPrSession().requests.has('ghost:x.ts')).toBe(true);
  });

  it('is cleared when the scene is left', () => {
    recordPr('file', 'x.ts', record);
    clearPrSession();
    expect(getPrSession().prs.size).toBe(0);
  });
});
