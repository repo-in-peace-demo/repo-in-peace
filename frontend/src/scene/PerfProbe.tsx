import { useFrame, useThree } from '@react-three/fiber';
import { recordFrame } from '../dev/perf-store';

/**
 * Development builds only (loaded lazily behind `import.meta.env.DEV` in `SceneCanvas`): each frame, how long the last one took and
 * what the renderer drew in it (`renderer.info`, which holds the last frame's numbers until the next render starts).
 */
export default function PerfProbe() {
  const gl = useThree((state) => state.gl);
  useFrame((_state, delta) => recordFrame(delta * 1000, gl.info.render.calls, gl.info.render.triangles));
  return null;
}
