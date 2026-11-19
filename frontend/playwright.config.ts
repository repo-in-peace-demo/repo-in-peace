import { defineConfig, devices } from '@playwright/test';

const PORT = 5199;

/**
 * One small end-to-end smoke test (`e2e/camera.spec.ts`) that drives the real app in headless Chromium. It starts
 * the Vite dev server itself (or reuses one already running on this port). See `e2e/README.md`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Headless Chromium has no GPU: draw WebGL with the software renderer (SwiftShader).
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
