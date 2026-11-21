import { afterEach, describe, expect, it } from 'vitest';
import { getDetailSide, setDetailSide, subscribeDetailSide } from './detail-side-store';

afterEach(() => setDetailSide(null));

describe('the detail panel\'s side', () => {
  it('starts closed, tells its listeners only of a change, and stops telling a listener that left', () => {
    expect(getDetailSide()).toBeNull();
    const heard: Array<string | null> = [];
    const stop = subscribeDetailSide(() => heard.push(getDetailSide()));
    setDetailSide('right');
    setDetailSide('right');
    setDetailSide('left');
    setDetailSide(null);
    stop();
    setDetailSide('right');
    expect(heard).toEqual(['right', 'left', null]);
  });
});
