import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { isTypingElement } from '../model/fly-controls';
import {
  isDragging,
  pointerCancel,
  pointerDown,
  pointerMove,
  pointerUp,
  type GestureState,
  type PointerSample,
} from '../model/pointer-gesture';
import { pickNearest, type PickTarget } from '../model/pick';
import { clickAction, escapeAction, type SelectionAction } from '../model/selection-actions';
import type { SceneModel } from '../model/scene-model';
import { vec3 } from '../model/vec3';
import { clearHover, setHover, setPointer } from '../store/hover-store';
import { clearSelection, select } from '../store/selection-store';
import { flyTo, resetView } from './api';

const apply = (action: SelectionAction): void => {
  if (action.type === 'select') select({ kind: action.kind, path: action.path });
  else clearSelection();
};

const sampleOf = (event: PointerEvent): PointerSample => ({
  pointerId: event.pointerId,
  button: event.button,
  x: event.clientX,
  y: event.clientY,
  time: event.timeStamp,
});

/**
 * Hover, click and Escape. It listens on the canvas element and tests a ray against the boxes of the layout
 * (`pickNearest`); the meshes are never raycast.
 *
 * - The pointer position is stored on every move, but the pick runs at most once a frame, and only if the pointer
 *   moved since the last one, so an idle pointer costs nothing.
 * - The hover label is hidden while a drag (orbit or pan) is going on, and comes back with the next move.
 * - A double-click on a stone or ghost selects it and flies the camera to it. A double-click anywhere else is Reset view.
 * - A click (see `pointer-gesture.ts`) on a stone or ghost selects it; a click on empty ground clears the selection.
 *   Escape does the same as an empty-ground click. None of them moves the camera. A drag never changes the selection.
 */
export function Picker({ model }: { model: SceneModel }) {
  const camera = useThree((state) => state.camera);
  const element = useThree((state) => state.gl.domElement);
  const gesture = useRef<GestureState>(null);
  const pending = useRef<{ x: number; y: number } | null>(null);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const targets = model.pickTargets;

  const pickAt = useRef<(x: number, y: number) => PickTarget | undefined>(() => undefined);
  pickAt.current = (clientX, clientY) => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return undefined;
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
    const { origin, direction } = raycaster.ray;
    return pickNearest(targets, vec3(origin.x, origin.y, origin.z), vec3(direction.x, direction.y, direction.z));
  };

  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      setPointer(event.clientX, event.clientY);
      gesture.current = pointerDown(gesture.current, sampleOf(event));
    };

    const onMove = (event: PointerEvent): void => {
      setPointer(event.clientX, event.clientY);
      gesture.current = pointerMove(gesture.current, sampleOf(event));
      if (isDragging(gesture.current)) {
        pending.current = null;
        clearHover();
      } else {
        pending.current = { x: event.clientX, y: event.clientY };
      }
    };

    const onUp = (event: PointerEvent): void => {
      const result = pointerUp(gesture.current, sampleOf(event));
      gesture.current = result.state;
      if (!result.click) return;
      const hit = pickAt.current(event.clientX, event.clientY);
      apply(clickAction(hit));
      pending.current = null;
      setHover(hit ? { kind: hit.kind, path: hit.path } : null);
    };

    // A double-click (or double-tap) on a stone or ghost flies to it (the same flight as `flyTo`), framed so its engraving or tag
    // can be read. Anywhere else (ground, sky, trees) it does exactly what Reset view does: flies back to the establishing shot and
    // clears the selection.
    const onDoubleClick = (event: MouseEvent): void => {
      if (event.button !== 0) return;
      const hit = pickAt.current(event.clientX, event.clientY);
      if (hit === undefined) {
        resetView();
        return;
      }
      apply(clickAction(hit));
      flyTo(hit.path);
    };

    const onCancel = (): void => {
      gesture.current = pointerCancel();
      pending.current = null;
      clearHover();
    };

    const onLeave = (): void => {
      pending.current = null;
      clearHover();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (isTypingElement(target?.tagName, target?.isContentEditable ?? false)) return;
      apply(escapeAction());
    };

    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('dblclick', onDoubleClick);
    element.addEventListener('pointercancel', onCancel);
    element.addEventListener('pointerleave', onLeave);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('dblclick', onDoubleClick);
      element.removeEventListener('pointercancel', onCancel);
      element.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('keydown', onKeyDown);
      clearHover();
    };
  }, [element]);

  // At most one pick a frame, and none when the pointer has not moved.
  useFrame(() => {
    const at = pending.current;
    if (at === null) return;
    pending.current = null;
    if (isDragging(gesture.current)) return;
    const hit = pickAt.current(at.x, at.y);
    setHover(hit ? { kind: hit.kind, path: hit.path } : null);
  });

  return null;
}
