import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, type ComponentRef } from 'react';
import * as THREE from 'three';
import type { CameraPose } from '../model/camera-pose';
import { boundsRadius, cameraLimits, clampPose, flySpeed, isFast, maxCameraDistance, moveCamera, movementFromKeys } from '../model/fly-controls';
import type { SceneModel } from '../model/scene-model';
import { vec3 } from '../model/vec3';
import { registerScene } from './api';
import { IDLE, cancelFlight, startFlight, stepFlight, type FlightState } from './flight';
import { useFlyKeys } from './useFlyKeys';

type Controls = ComponentRef<typeof OrbitControls>;

const heading = new THREE.Vector3();

/**
 * The camera: drag to orbit, right-drag to pan, the wheel to zoom (drei's OrbitControls), the keyboard to fly,
 * and smooth flights for `flyTo`. It starts at the model's starting pose. Any mouse or keyboard input ends a flight
 * and gives control back. Whatever moved the camera, `clampPose` puts it back inside the limits at the end of every
 * frame, and a flight's end pose is clamped before the flight starts.
 */
export function CameraRig({ model }: { model: SceneModel }) {
  const camera = useThree((state) => state.camera);
  const controls = useRef<Controls>(null);
  const flight = useRef<FlightState>(IDLE);

  const radius = boundsRadius(model.layout.bounds);
  const limits = useMemo(() => cameraLimits(model.layout.bounds), [model]);

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
        start: model.start,
        fly: (to: CameraPose) => {
          const orbit = controls.current;
          if (!orbit) return;
          const from: CameraPose = {
            position: vec3(camera.position.x, camera.position.y, camera.position.z),
            target: vec3(orbit.target.x, orbit.target.y, orbit.target.z),
          };
          flight.current = startFlight(from, clampPose(to, limits), performance.now());
        },
      }),
    [camera, model, limits],
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
    } else {
      const input = movementFromKeys(keys.current);
      if (input.forward !== 0 || input.right !== 0 || input.up !== 0) {
        camera.getWorldDirection(heading);
        const next = moveCamera(
          { position: vec3(camera.position.x, camera.position.y, camera.position.z), target: vec3(orbit.target.x, orbit.target.y, orbit.target.z) },
          vec3(heading.x, heading.y, heading.z),
          input,
          flySpeed(radius, isFast(keys.current)),
          delta,
        );
        camera.position.set(next.position.x, next.position.y, next.position.z);
        orbit.target.set(next.target.x, next.target.y, next.target.z);
        orbit.update();
      }
    }

    // The one rule for every input: keys, orbit, pan, zoom and flights. (drei's OrbitControls has already applied
    // the mouse and its damping this frame, before this callback.) Not `orbit.update()` again, which would apply
    // the damping twice.
    const now: CameraPose = {
      position: vec3(camera.position.x, camera.position.y, camera.position.z),
      target: vec3(orbit.target.x, orbit.target.y, orbit.target.z),
    };
    const clamped = clampPose(now, limits);
    if (clamped !== now) {
      camera.position.set(clamped.position.x, clamped.position.y, clamped.position.z);
      orbit.target.set(clamped.target.x, clamped.target.y, clamped.target.z);
      camera.lookAt(clamped.target.x, clamped.target.y, clamped.target.z);
    }
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
      maxDistance={maxCameraDistance(radius)}
      onStart={() => {
        flight.current = cancelFlight();
      }}
    />
  );
}
