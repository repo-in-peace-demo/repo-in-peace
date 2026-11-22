import { Canvas } from '@react-three/fiber';
import { Suspense, lazy, useEffect, useRef } from 'react';
import { DEFAULT_FOV_Y } from '../model/camera-pose';
import type { SceneModel } from '../model/scene-model';
import { Atmosphere } from './Atmosphere';
import { CameraRig } from './CameraRig';
import { Candles } from './Candles';
import { BACKGROUND_COLOR } from './colors';
import { Fences } from './Fences';
import { watchReducedMotion } from './reduced-motion';
import { Ground, PlotFloors } from './Ground';
import { Horizon } from './Horizon';
import { Mist } from './Mist';
import { Obstructions } from './Obstructions';
import { Picker } from './Picker';
import { Plaques } from './Plaques';
import { SelectionRing } from './SelectionRing';
import { SignDriver } from './SignDriver';
import { SignLayer } from '../ui/SignLayer';
import { Ghosts } from './Ghosts';
import { PrMarkers } from './PrMarkers';
import { RisenStones } from './RisenStones';
import { Stones } from './Stones';

/** Development builds only: measures each frame for the performance overlay. Null, and not in the bundle, in production. */
const PerfProbe = import.meta.env.DEV ? lazy(() => import('./PerfProbe')) : null;

/**
 * The plain scene: flat colours and boxes, to check the layout on real data. Everything is drawn with instanced
 * meshes, so the number of draw calls stays the same however many files there are.
 */
export function SceneCanvas({ model }: { model: SceneModel }) {
  const { w, d } = model.layout.bounds;
  const radius = Math.hypot(w, d) / 2;
  const { position } = model.start;
  const signs = useRef<HTMLDivElement>(null);
  useEffect(() => watchReducedMotion(), []); // reduced motion stops the animation

  return (
    <div className="scene">
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: DEFAULT_FOV_Y, near: 0.1, far: Math.max(1000, radius * 12), position: [position.x, position.y, position.z] }}
      >
        <color attach="background" args={[BACKGROUND_COLOR]} />
        <Atmosphere model={model} />

        <CameraRig model={model} />
        <Obstructions model={model} />
        <Ground model={model} />
        <Horizon model={model} />
        <PlotFloors model={model} />
        <Fences model={model} />
        <Plaques model={model} />
        <Stones model={model} />
        <Candles model={model} />
        <Ghosts model={model} />
        <RisenStones model={model} />
        <PrMarkers model={model} />
        <Mist model={model} />
        <SelectionRing model={model} />
        <Picker model={model} />
        <SignDriver model={model} container={signs} />
        {PerfProbe && (
          <Suspense fallback={null}>
            <PerfProbe />
          </Suspense>
        )}
      </Canvas>
      <SignLayer containerRef={signs} />
    </div>
  );
}
