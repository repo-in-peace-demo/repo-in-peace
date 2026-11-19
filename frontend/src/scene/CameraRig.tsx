import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useRef, type ComponentRef } from 'react';
import * as THREE from 'three';
import type { CameraPose } from '../model/camera-pose';
import { flySpeed, isFast, moveCamera, movementFromKeys } from '../model/fly-controls';
import type { SceneModel } from '../model/scene-model';
import { vec3 } from '../model/vec3';
import { registerScene } from './api';
import { IDLE, cancelFlight, startFlight, stepFlight, type FlightState } from './flight';
import { useFlyKeys } from './useFlyKeys';

type Controls = ComponentRef<typeof OrbitControls>;

/** The look-at point may wander this far, as a share of the graveyard's radius, beyond its edge. */
const WANDER_MARGIN_SHARE = 1;

const heading = new THREE.Vector3();

/**
 * The camera: drag to orbit, right-drag to pan, the wheel to zoom (drei's OrbitControls), the keyboard to fly,
 * and smooth flights for `flyTo`. It starts at the model's starting pose. Any mouse or keyboard input ends a flight
 * and gives control back.
 */
export function CameraRig({ model }: { model: SceneModel }) {
  const camera = useThree((state) => state.camera);
  const controls = useRef<Controls>(null);
  const flight = useRef<FlightState>(IDLE);

  const { x, z, w, d } = model.layout.bounds;
  const radius = Math.hypot(w, d) / 2;
  const limits = { x: x - radius * WANDER_MARGIN_SHARE, z: z - radius * WANDER_MARGIN_SHARE, w: w + 2 * radius * WANDER_MARGIN_SHARE, d: d + 2 * radius * WANDER_MARGIN_SHARE };

  const keys = useFlyKeys(() => {
    flight.current = cancelFlight();
  });

  // Start at the model's starting pose, again for each graveyard that is loaded.
  useLayoutEffect(() => {
    const { position, target } = model.start;
    camera.position.set(position.x, position.y, position.z);
    camera.lookAt(target.x, target.y, target.z);
    flight.current = IDLE;
    const orbit = controls.current;
    if (orbit) {
      orbit.target.set(target.x, target.y, target.z);
      orbit.update();
    }
  }, [camera, model]);

  // Let `flyTo` start flights.
  useEffect(
    () =>
      registerScene({
        targets: model.flyTargets,
        fly: (to: CameraPose) => {
          const orbit = controls.current;
          if (!orbit) return;
          const from: CameraPose = {
            position: vec3(camera.position.x, camera.position.y, camera.position.z),
            target: vec3(orbit.target.x, orbit.target.y, orbit.target.z),
          };
          flight.current = startFlight(from, to, performance.now());
        },
      }),
    [camera, model],
  );

  useFrame((_state, delta) => {
    const orbit = controls.current;
    if (!orbit) return;

    if (flight.current.phase === 'flying') {
      const step = stepFlight(flight.current, performance.now());
      flight.current = step.state;
      if (step.pose) {
        camera.position.set(step.pose.position.x, step.pose.position.y, step.pose.position.z);
        orbit.target.set(step.pose.target.x, step.pose.target.y, step.pose.target.z);
        orbit.update();
      }
      return;
    }

    const input = movementFromKeys(keys.current);
    if (input.forward === 0 && input.right === 0 && input.up === 0) return;

    camera.getWorldDirection(heading);
    const next = moveCamera(
      { position: vec3(camera.position.x, camera.position.y, camera.position.z), target: vec3(orbit.target.x, orbit.target.y, orbit.target.z) },
      vec3(heading.x, heading.y, heading.z),
      input,
      flySpeed(radius, isFast(keys.current)),
      delta,
      limits,
    );
    camera.position.set(next.position.x, next.position.y, next.position.z);
    orbit.target.set(next.target.x, next.target.y, next.target.z);
    orbit.update();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      // Right-drag pans along the ground, so the point the camera looks at cannot be dragged underground.
      screenSpacePanning={false}
      // The camera cannot go below the level of the point it looks at, which is at or above the ground.
      maxPolarAngle={Math.PI / 2 - 0.02}
      minDistance={3}
      maxDistance={Math.max(100, radius * 3)}
      onStart={() => {
        flight.current = cancelFlight();
      }}
    />
  );
}
