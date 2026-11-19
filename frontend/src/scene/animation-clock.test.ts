import { afterEach, describe, expect, it } from 'vitest';
import { animationTime, freezeAnimation, isAnimationFrozen, resumeAnimation } from './animation-clock';

afterEach(() => resumeAnimation());

describe('the animation clock', () => {
  it('follows the clock it is given', () => {
    expect(animationTime(1.5)).toBe(1.5);
    expect(animationTime(2.5)).toBe(2.5);
    expect(isAnimationFrozen()).toBe(false);
  });

  it('holds still, at the moment of freezing, however the clock moves on', () => {
    animationTime(10);
    freezeAnimation();
    expect(isAnimationFrozen()).toBe(true);
    expect(animationTime(11)).toBe(10);
    expect(animationTime(50)).toBe(10);
  });

  it('runs again from the clock\'s own time after it is resumed', () => {
    animationTime(3);
    freezeAnimation();
    animationTime(4);
    resumeAnimation();
    expect(animationTime(7)).toBe(7);
    expect(isAnimationFrozen()).toBe(false);
  });

  it('can be frozen twice without moving, and freezing keeps the latest time it was told', () => {
    animationTime(5);
    freezeAnimation();
    animationTime(6); // while frozen it still notes the clock
    freezeAnimation(); // freezing again moves the hold to the latest time
    expect(animationTime(9)).toBe(6);
  });
});
