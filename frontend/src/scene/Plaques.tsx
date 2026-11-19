import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SceneModel } from '../model/scene-model';
import { SIGN_HEIGHT } from '../model/signs';
import { PLAQUE_COLOR } from './colors';
import { noRaycast, placement } from './instances';

/** A post with a board on it, as one shape, so all the plaques are one draw call. */
function makePlaqueGeometry(): THREE.BufferGeometry {
  const post = new THREE.BoxGeometry(0.1, 1.4, 0.1);
  post.translate(0, 0.7, 0);
  const board = new THREE.BoxGeometry(1.4, 0.6, 0.08);
  board.translate(0, SIGN_HEIGHT, 0);
  const merged = mergeGeometries([post, board]);
  post.dispose();
  board.dispose();
  if (merged === null) throw new Error('the plaque shapes could not be joined');
  return merged;
}

/** A plaque at the gate of every plot. Its text is a page element (ui/SignLayer.tsx), shown only when the camera is near. */
export function Plaques({ model }: { model: SceneModel }) {
  const geometry = useMemo(makePlaqueGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const ref = useRef<THREE.InstancedMesh>(null);
  const plots = model.layout.plots;

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    plots.forEach((plot, i) => mesh.setMatrixAt(i, placement(plot.sign.x, 0, plot.sign.z, 1, 1, 1)));
    mesh.instanceMatrix.needsUpdate = true;
  }, [plots]);

  if (plots.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, plots.length]} frustumCulled={false} raycast={noRaycast}>
      <meshStandardMaterial color={PLAQUE_COLOR} roughness={0.9} />
    </instancedMesh>
  );
}
