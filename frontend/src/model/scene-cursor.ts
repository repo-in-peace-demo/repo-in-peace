/**
 * Which cursor the 3D scene shows (scene only: panels, buttons and inputs keep the standard cursors). Pure. The pictures are the
 * skeleton hand in public/cursors/ (scripts/make-cursors.mjs), in index.css with fallbacks to the standard cursors.
 */
export type SceneCursor = 'point' | 'over' | 'grab';

export const sceneCursor = (dragging: boolean, overGrave: boolean): SceneCursor => (dragging ? 'grab' : overGrave ? 'over' : 'point');
