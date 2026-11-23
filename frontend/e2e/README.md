# End-to-end smoke test

`camera.spec.ts`, `selection.spec.ts` and `signs.spec.ts` drive the real app in headless Chromium and check that the camera limits hold for every input
(keys, right-drag and Shift + left-drag pan, orbit, zoom, and Reset view) and that hover, click, drag and Escape behave. It is a smoke test, not a full suite.

## Run it

```
cd frontend
npm install -D @playwright/test      # once
npx playwright install chromium      # once: downloads the browser
npm run e2e
```

The test starts the dev server on port 5199 itself. It takes about two minutes, mostly from holding keys for
5 to 15 seconds each.

## Notes

- The app is opened with `?graveyard=demo.spatialql`.
- The camera pose is read from `window.repoInPeace.getPose()`, which exists in development builds only
  (`import.meta.env.DEV`; see `src/scene/dev-api.ts`).
- The limit values come from `src/model/fly-controls.ts` (`cameraLimits`), the module the app uses, computed from the
  same data file.
- Headless Chromium has no GPU, so `playwright.config.ts` passes `--use-angle=swiftshader
  --enable-unsafe-swiftshader --ignore-gpu-blocklist` to draw WebGL in software. If the page shows
  "WebGL is not available", the flags need changing for your Chromium version (try `--use-gl=angle`, or run with
  `--headed`). Software drawing is slow, which is fine here: key movement is measured in seconds, not frames.
- The frontend `README.md` (task 27) must mention this folder and the flags.

## Quick runs

`npm run e2e` runs everything (before a deploy). `npm run e2e:quick` skips the tests tagged `@slow`: the two sweeps in `interface.spec.ts` that fly to every stone and ghost of both demos. For one file: `npx playwright test e2e/interface.spec.ts --grep-invert @slow`.
