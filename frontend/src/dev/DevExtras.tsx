import { devFeatures } from '../model/dev-features';
import PerfStats from '../ui/PerfStats';

/** Development builds only (loaded lazily behind `import.meta.env.DEV` in `App`): the extras the page address asks for. */
export default function DevExtras() {
  const features = devFeatures(true, window.location.search);
  return features.perf ? <PerfStats /> : null;
}
