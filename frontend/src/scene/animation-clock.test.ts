import { afterEach, describe, expect, it } from 'vitest';
import { animationTime, freezeAnimation, freezeAnimationAt, isAnimationFrozen, isReducedMotion, resumeAnimation, setReducedMotion } from './animation-clock';

afterEach(() => {
  resumeAnimation();
  setReducedMotion(false);
});

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

  it('can be held at a chosen moment, and runs again after it is resumed', () => {
    animationTime(5);
    freezeAnimationAt(1.25);
    expect(animationTime(8)).toBe(1.25);
    resumeAnimation();
    expect(animationTime(9)).toBe(9);
  });

  it('stands still at time 0 when reduced motion is asked for, and runs again when it is not', () => {
    expect(animationTime(4)).toBe(4);
    setReducedMotion(true);
    expect(isReducedMotion()).toBe(true);
    expect(animationTime(5)).toBe(0);
    expect(animationTime(500)).toBe(0);
    setReducedMotion(false);
    expect(animationTime(6)).toBe(6);
  });

  it('lets a freeze held by a test win over reduced motion', () => {
    setReducedMotion(true);
    freezeAnimationAt(2.5);
    expect(animationTime(9)).toBe(2.5);
  });

  it('can be frozen twice without moving, and freezing keeps the latest time it was told', () => {
    animationTime(5);
    freezeAnimation();
    animationTime(6); // while frozen it still notes the clock
    freezeAnimation(); // freezing again moves the hold to the latest time
    expect(animationTime(9)).toBe(6);
  });
});
