/**
 * What the plaques' fade (scene/Plaques.tsx) shares with the signs' labels (scene/SignDriver.tsx) and the development API: each
 * sign's opacity now (1 when not listed), and a version that changes whenever any of them does, so the labels follow the boards.
 */
export const signFade: { alpha: Map<string, number>; version: number } = { alpha: new Map(), version: 0 };

export const fadeOf = (path: string): number => signFade.alpha.get(path) ?? 1;
