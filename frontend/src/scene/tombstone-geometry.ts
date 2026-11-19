import * as THREE from 'three';
import { STONE_D, STONE_W } from '../model/layout-constants';

/**
 * The shape of every tombstone: a slab with a rounded top, built once from a `Shape` and extruded to the stone's depth
 * with a small bevel. The body is 1 high and the arch (radius half the width) sits on top of it, from 1 to 1.5.
 *
 * Each vertex has `aTop`: 1 for the arch (from the seam at height 1 up) and 0 for the body. The stone shader scales the
 * body to the stone's height and moves the arch up with it, so a tall stone does not get a stretched arch.
 * The base is at y = 0 and the stone is centred on x and z, so an instance can rotate about its foot to lean.
 */

/** The height of the body of the unit shape; the arch's radius is added to it. */
export const BODY_REFERENCE = 1;
const BEVEL = 0.025;

export function makeTombstoneGeometry(): THREE.BufferGeometry {
  const r = STONE_W / 2 - BEVEL; // the bevel adds its size on every side
  const shape = new THREE.Shape();
  shape.moveTo(-r, BEVEL);
  shape.lineTo(r, BEVEL);
  shape.lineTo(r, BODY_REFERENCE);
  shape.absarc(0, BODY_REFERENCE, r, 0, Math.PI, false);
  shape.lineTo(-r, BEVEL);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: STONE_D - 2 * BEVEL,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelSegments: 1,
    curveSegments: 12,
  });
  geometry.translate(0, 0, -(STONE_D / 2 - BEVEL)); // centre the depth on z = 0

  const position = geometry.getAttribute('position');
  const top = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) top[i] = position.getY(i) >= BODY_REFERENCE - 1e-6 ? 1 : 0;
  geometry.setAttribute('aTop', new THREE.BufferAttribute(top, 1));
  return geometry;
}
