import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Mesh } from 'three';
import type { SceneModel } from '../model/scene-model';
import { selectionRingHeight } from '../model/selection-ring';
import { useSelection } from '../store/selection-store';
import { animationTime } from './animation-clock';
import { SELECTION_RING_COLOR } from './colors';
import { noRaycast } from './instances';

/** Inside a cell (half its width is 1.2), around the foot of the stone or the base of the ghost. */
const RING_INNER = 0.95;
const RING_OUTER = 1.15;

/**
 * A thin ring around the base of the selected stone or ghost, in a colour no effect uses. It is the only mark of a
 * selection: the stone itself is not tinted. A stone's ring lies on the ground. A ghost floats, so its ring is
 * drawn at the ghost's base height and is moved every frame to follow it (see `selectionRingHeight`); on the
 * ground it would look like a ring in front of the ghost. It follows the selection store, so a selection made
 * from outside the scene shows it too. Nothing is drawn when nothing is selected or the path is not in this scene.
 */
export function SelectionRing({ model }: { model: SceneModel }) {
  const selection = useSelection();
  const ref = useRef<Mesh>(null);
  const entry = selection === null ? undefined : model.lookup.get(selection.path);
  const valid = selection !== null && entry !== undefined && entry.kind === selection.kind;
  const ghost = valid && entry.kind === 'ghost' ? model.ghosts[entry.index] : undefined;
  const at = !valid ? undefined : entry.kind === 'file' ? model.stones[entry.index]!.layout : model.ghosts[entry.index]!.layout;

  useFrame(({ clock }) => {
    if (ref.current && at) ref.current.position.set(at.x, selectionRingHeight(ghost?.visual, animationTime(clock.elapsedTime)), at.z);
  });

  if (!at) return null;
  return (
    <mesh ref={ref} position={[at.x, selectionRingHeight(ghost?.visual, 0), at.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5} raycast={noRaycast}>
      <ringGeometry args={[RING_INNER, RING_OUTER, 48]} />
      {/* Depth-tested: the stone (or ghost) in front of any part of the ring hides it, so the ring never crosses its face. */}
      <meshBasicMaterial color={SELECTION_RING_COLOR} transparent opacity={0.95} depthTest depthWrite={false} />
    </mesh>
  );
}
