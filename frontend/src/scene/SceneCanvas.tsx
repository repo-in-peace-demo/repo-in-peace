import { Canvas, useThree } from '@react-three/fiber';
import { useLayoutEffect } from 'react';
import { DEFAULT_FOV_Y, type CameraPose } from '../model/camera-pose';
import type { SceneModel } from '../model/scene-model';
import { BACKGROUND_COLOR } from './colors';
import { Fences } from './Fences';
import { Ground, PlotFloors } from './Ground';
import { Plaques } from './Plaques';
import { Ghosts, Stones } from './Stones';

/** Puts the camera at the starting pose, looking at the middle of the graveyard. (The camera rig of the next task takes this over.) */
function StartView({ pose }: { pose: CameraPose }) {
  const camera = useThree((state) => state.camera);
  useLayoutEffect(() => {
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    camera.updateProjectionMatrix();
  }, [camera, pose]);
  return null;
}

/**
 * The plain scene: flat colours and boxes, to check the layout on real data. Everything is drawn with instanced
 * meshes, so the number of draw calls stays the same however many files there are.
 */
export function SceneCanvas({ model }: { model: SceneModel }) {
  const { w, d } = model.layout.bounds;
  const radius = Math.hypot(w, d) / 2;
  const { position } = model.start;

  return (
    <div className="scene">
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: DEFAULT_FOV_Y, near: 0.1, far: Math.max(1000, radius * 12), position: [position.x, position.y, position.z] }}
      >
        <color attach="background" args={[BACKGROUND_COLOR]} />
        <hemisphereLight args={['#8aa4d6', '#10151c', 0.9]} />
        <directionalLight position={[-60, 90, 40]} intensity={1.4} color="#c8d8ff" />

        <StartView pose={model.start} />
        <Ground model={model} />
        <PlotFloors model={model} />
        <Fences model={model} />
        <Plaques model={model} />
        <Stones model={model} />
        <Ghosts model={model} />
      </Canvas>
    </div>
  );
}
