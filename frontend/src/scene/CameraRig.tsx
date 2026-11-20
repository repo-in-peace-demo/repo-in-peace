import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, type ComponentRef } from 'react';
import * as THREE from 'three';
import type { CameraPose } from '../model/camera-pose';
import { openingShot, safeEstablishingShot, type Shot } from '../model/framing';
import { handoverShare, openingAt, playsOpening, settleShare } from '../model/opening-move';
import { sceneCameraLimits } from '../model/camera-bounds';
import { MIN_TILT_DEG, boundsRadius, clampPose, flySpeed, isFast, moveCamera, movementFromKeys } from '../model/fly-controls';
import type { SceneModel } from '../model/scene-model';
import { lerp, vec3 } from '../model/vec3';
import { registerScene } from './api';
import { IDLE, cancelFlight, startFlight, stepFlight, type FlightState } from './flight';
import { applyLensShift } from './lens-shift';
import { prefersReducedMotion } from './reduced-motion';
import { useFlyKeys } from './useFlyKeys';

type Controls = ComponentRef<typeof OrbitControls>;

const heading = new THREE.Vector3();

/** OrbitControls' own tilt limit: MIN_TILT_DEG above the horizontal (clampPose says the same). Relaxed during the opening move, which starts lower. */
const MAX_POLAR = Math.PI / 2 - (MIN_TILT_DEG * Math.PI) / 180;
const OPENING_MAX_POLAR = Math.PI / 2 - 1e-3;

/**
 * The camera: drag to orbit, right-drag to pan, the wheel to zoom toward the pointer (drei's OrbitControls), the keyboard to fly,
 * and smooth flights for `flyTo`. On first load it plays the opening move, rising from a low shot into the establishing shot (any input
 * ends it; reduced motion skips it). It ends at the establishing shot for the window's own shape (`safeEstablishingShot`), and
 * Reset view flies back to that shot for the shape the window has then. The shot's lens shift is applied to the camera, again
 * whenever the window changes size, and stays on whatever the camera does (it is part of the lens). Any mouse or keyboard input ends a flight
 * and gives control back. Whatever moved the camera, `clampPose` puts it back inside the limits at the end of every
 * frame, and a flight's end pose is clamped before the flight starts.
 */
export function CameraRig({ model }: { model: SceneModel }) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const element = useThree((state) => state.gl.domElement);
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const controls = useRef<Controls>(null);
  const flight = useRef<FlightState>(IDLE);
  const lastTarget = useRef<{ x: number; z: number } | null>(null);
  // The opening move on first load (model/opening-move.ts), the hand-over after it is interrupted, and the lens shift on the camera now.
  const opening = useRef<{ from: Shot; to: Shot; start: number } | null>(null);
  const handover = useRef<{ start: number; fromShift: number } | null>(null);
  const lensShift = useRef(0);

  const radius = boundsRadius(model.layout.bounds);
  // The establishing shot for this graveyard, this lens and the window's shape now.
  const aspect = size.height > 0 ? size.width / size.height : undefined;
  // The limits, inside the trees around the graveyard; the zoom-out is measured from the establishing shot for this window.
  const limits = useMemo(() => sceneCameraLimits(model.layout.bounds, aspect), [model, aspect]);
  const shot = useMemo(() => safeEstablishingShot(model.layout.bounds, camera.fov, aspect), [model, camera.fov, aspect]);
  const latestShot = useRef(shot);
  latestShot.current = shot;

  // The lens shift, for the canvas's size now. react-three-fiber sets the aspect and the projection on a resize first; this
  // runs after it and sets both again with the shift. Taken off when the scene goes away.
  useLayoutEffect(() => {
    // During the opening move and its hand-over the frame callback sets the shift; this only puts it back after a resize.
    const shift = opening.current || handover.current ? lensShift.current : shot.viewShift;
    lensShift.current = shift;
    applyLensShift(camera, shift, size.width, size.height);
  }, [camera, shot.viewShift, size.width, size.height]);
  const setShift = (shift: number): void => {
    if (shift === lensShift.current) return;
    lensShift.current = shift;
    applyLensShift(camera, shift, size.width, size.height);
  };
  const setShiftRef = useRef(setShift);
  setShiftRef.current = setShift;

  /** Ends the opening move where the camera is, and starts the hand-over (the limits and the lens shift ease in). */
  const endOpening = useRef(() => {});
  endOpening.current = () => {
    if (!opening.current) return;
    opening.current = null;
    handover.current = { start: performance.now(), fromShift: lensShift.current };
  };
  useEffect(
    () => () => {
      camera.clearViewOffset();
    },
    [camera],
  );

  const keys = useFlyKeys(() => {
    flight.current = cancelFlight();
    endOpening.current();
  });

  // Any key, click or scroll ends the opening move (a drag starts with a pointerdown; OrbitControls' onStart also ends it).
  useEffect(() => {
    const end = (): void => endOpening.current();
    window.addEventListener('keydown', end);
    element.addEventListener('pointerdown', end);
    element.addEventListener('wheel', end, { passive: true });
    return () => {
      window.removeEventListener('keydown', end);
      element.removeEventListener('pointerdown', end);
      element.removeEventListener('wheel', end);
    };
  }, [element]);

  // Start at the establishing shot, again for each graveyard that is loaded (not when the window is resized: the camera is not
  // taken away from where the user has moved it).
  useLayoutEffect(() => {
    // The opening move, unless the system asks for reduced motion (then the scene opens on the establishing shot) or a browser test
    // turned it off (development builds only, `window.__repoInPeaceNoOpening`).
    const turnedOff = import.meta.env.DEV && window.__repoInPeaceNoOpening === true;
    const to = latestShot.current;
    const from = openingShot(model.layout.bounds, camera.fov, aspect);
    const plays = playsOpening(prefersReducedMotion(), turnedOff);
    opening.current = plays ? { from, to, start: performance.now() } : null;
    handover.current = null;
    const first = plays ? from : to;
    setShiftRef.current(first.viewShift);
    const { position, target } = first.pose;
    camera.position.set(position.x, position.y, position.z);
    camera.lookAt(target.x, target.y, target.z);
    flight.current = IDLE;
    const orbit = controls.current;
    if (orbit) {
      orbit.maxPolarAngle = plays ? OPENING_MAX_POLAR : MAX_POLAR;
      orbit.target.set(target.x, target.y, target.z);
      orbit.update();
    }
  }, [camera, model]);

  // Development builds only: `window.repoInPeace`, for the console and the end-to-end test. The dynamic import keeps
  // the module out of a production build.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let remove: (() => void) | undefined;
    let gone = false;
    void import('./dev-api').then(({ installDevApi }) => {
      if (gone) return;
      remove = installDevApi(
        () => {
          const orbit = controls.current;
          if (!orbit) throw new Error('The camera controls are not ready yet');
          return {
            position: vec3(camera.position.x, camera.position.y, camera.position.z),
            target: vec3(orbit.target.x, orbit.target.y, orbit.target.z),
          };
        },
        (x, y, z) => {
          const point = new THREE.Vector3(x, y, z).project(camera);
          if (point.z > 1) return null; // behind the camera
          const rect = element.getBoundingClientRect();
          return { x: rect.left + ((point.x + 1) / 2) * rect.width, y: rect.top + ((1 - point.y) / 2) * rect.height };
        },
        (path) => {
          const box = model.pickTargets.find((t) => t.path === path);
          return box ? { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2, z: (box.min.z + box.max.z) / 2 } : null;
        },
        () => ({ calls: gl.info.render.calls, triangles: gl.info.render.triangles, fogDensity: scene.fog instanceof THREE.FogExp2 ? scene.fog.density : 0 }),
        () => lensShift.current,
        (to) => {
          const orbit = controls.current;
          if (!orbit) return;
          flight.current = cancelFlight();
          opening.current = null;
          handover.current = null;
          setShiftRef.current(latestShot.current.viewShift);
          camera.position.set(to.position.x, to.position.y, to.position.z);
          orbit.target.set(to.target.x, to.target.y, to.target.z);
          orbit.update();
        },
      );
    });
    return () => {
      gone = true;
      remove?.();
    };
  }, [camera, element, gl, scene, model]);

  // Let `flyTo` start flights.
  useEffect(
    () =>
      registerScene({
        targets: model.flyTargets,
        start: shot.pose,
        fly: (to: CameraPose) => {
          const orbit = controls.current;
          if (!orbit) return;
          const from: CameraPose = {
            position: vec3(camera.position.x, camera.position.y, camera.position.z),
            target: vec3(orbit.target.x, orbit.target.y, orbit.target.z),
          };
          endOpening.current(); // a flight (flyTo, Reset view, a double-click) ends the opening move and goes straight where it was asked
          flight.current = startFlight(from, clampPose(to, limits), performance.now());
        },
      }),
    [camera, model, limits, shot],
  );

  useFrame((_state, delta) => {
    const orbit = controls.current;
    if (!orbit) return;

    // OrbitControls keeps its own tilt limit; during the opening move and the hand-over it is relaxed, and clampPose eases the camera in.
    orbit.maxPolarAngle = opening.current || handover.current ? OPENING_MAX_POLAR : MAX_POLAR;

    // The opening move: nothing else moves the camera, and the limits do not apply to it (its low start is below the tilt limit).
    const move = opening.current;
    if (move) {
      const at = openingAt(move.from, move.to, performance.now() - move.start);
      const { position, target } = at.shot.pose;
      camera.position.set(position.x, position.y, position.z);
      orbit.target.set(target.x, target.y, target.z);
      orbit.update();
      setShiftRef.current(at.shot.viewShift);
      if (at.done) opening.current = null;
      lastTarget.current = { x: target.x, z: target.z };
      return;
    }

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
    // A pan or a flight moves the look-at point; a zoom or an orbit does not. The first slides to a stop at the limits, the
    // second brings the camera in.
    const moved = lastTarget.current !== null && (lastTarget.current.x !== now.target.x || lastTarget.current.z !== now.target.z);
    let clamped = clampPose(now, limits, moved ? 'slide' : 'pull');
    // After an interrupted opening move: ease into the limits and into the establishing shot's lens shift instead of jumping.
    const easing = handover.current;
    if (easing) {
      const k = handoverShare(performance.now() - easing.start);
      setShiftRef.current(easing.fromShift + (latestShot.current.viewShift - easing.fromShift) * k);
      if (k < 1) {
        const share = settleShare(delta);
        clamped = { position: lerp(now.position, clamped.position, share), target: lerp(now.target, clamped.target, share) };
      } else handover.current = null;
    }
    lastTarget.current = clamped.target;
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
      // The camera stays at least MIN_TILT_DEG above the horizontal, seen from the point it looks at (clampPose says the same).
      maxPolarAngle={MAX_POLAR}
      // The wheel zooms toward the point under the pointer, so the front rows can be reached; `clampPose` still keeps the result
      // inside every limit (floor, tilt, sideways bounds, zoom range). The look-at point moves with it, which is why a zoom
      // is clamped like a pan ('slide').
      zoomToCursor
      minDistance={3}
      maxDistance={limits.maxDistance}
      onStart={() => {
        flight.current = cancelFlight();
        endOpening.current();
      }}
    />
  );
}
