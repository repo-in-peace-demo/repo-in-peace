import { useLayoutEffect, type RefObject } from 'react';
import * as THREE from 'three';
import type { SceneModel } from '../model/scene-model';
import { getSelection, subscribeSelection } from '../store/selection-store';
import { getHover, subscribeHover } from '../store/hover-store';
import { highlightValue } from '../model/stone-attributes';
import { HOVER_COLOR } from './colors';

/**
 * The plain hover highlight: every instance of the mesh gets its own colour, `baseColor` normally and `HOVER_COLOR`
 * while the pointer is over it. A selected instance is never tinted, not even while the pointer is over it: its
 * selection is the ring at its base (SelectionRing), because a lightened stone looks like a ghost. Only the instances
 * that changed are repainted, and nothing is rendered by React: the stores tell this directly, so a selection made
 * from outside the scene is followed too. The mesh's own material colour must be white, because instance colours
 * multiply it.
 */
export function useHighlight(ref: RefObject<THREE.InstancedMesh | null>, model: SceneModel, kind: 'file' | 'ghost', baseColor: string): void {
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;

    const base = new THREE.Color(baseColor);
    const hover = new THREE.Color(HOVER_COLOR);
    for (let i = 0; i < mesh.count; i++) mesh.setColorAt(i, base);

    const indexOf = (target: { kind: 'file' | 'ghost'; path: string } | null): number => {
      if (target === null || target.kind !== kind) return -1;
      const entry = model.lookup.get(target.path);
      return entry !== undefined && entry.kind === kind ? entry.index : -1;
    };

    let hoverIndex = -1;
    let selectedIndex = -1;
    const sync = (): void => {
      const nextHover = indexOf(getHover());
      const nextSelected = indexOf(getSelection());
      for (const index of new Set([hoverIndex, selectedIndex, nextHover, nextSelected])) {
        if (index < 0) continue;
        mesh.setColorAt(index, index !== nextSelected && index === nextHover ? hover : base);
      }
      hoverIndex = nextHover;
      selectedIndex = nextSelected;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };

    sync();
    const offHover = subscribeHover(sync);
    const offSelection = subscribeSelection(sync);
    return () => {
      offHover();
      offSelection();
    };
  }, [ref, model, kind, baseColor]);
}

/**
 * The stones' highlight: writes one element of the per-instance attribute `aHighlight` when the hover or the selection
 * changes (0 nothing, 0.5 hover, 1 selected). The stone shader turns it into a rim of light at the edge, not a tint of
 * the surface. Nothing is rendered by React; the stores tell this directly, so a selection made from outside the scene
 * is followed too.
 */
export function useRimHighlight(attribute: THREE.InstancedBufferAttribute, model: SceneModel, kind: 'file' | 'ghost'): void {
  useLayoutEffect(() => {
    const values = attribute.array as Float32Array;
    values.fill(0);
    const indexOf = (target: { kind: 'file' | 'ghost'; path: string } | null): number => {
      if (target === null || target.kind !== kind) return -1;
      const entry = model.lookup.get(target.path);
      return entry !== undefined && entry.kind === kind ? entry.index : -1;
    };

    let hoverIndex = -1;
    let selectedIndex = -1;
    const sync = (): void => {
      const nextHover = indexOf(getHover());
      const nextSelected = indexOf(getSelection());
      for (const index of new Set([hoverIndex, selectedIndex, nextHover, nextSelected])) {
        if (index >= 0) values[index] = highlightValue(index === nextHover, index === nextSelected);
      }
      hoverIndex = nextHover;
      selectedIndex = nextSelected;
      attribute.needsUpdate = true;
    };

    sync();
    const offHover = subscribeHover(sync);
    const offSelection = subscribeSelection(sync);
    return () => {
      offHover();
      offSelection();
    };
  }, [attribute, model, kind]);
}
