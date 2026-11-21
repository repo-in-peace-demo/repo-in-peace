import { test as base } from '@playwright/test';

/**
 * The test every browser check uses, except `opening.spec.ts`: the page opens on the establishing shot without the opening move
 * (`window.__repoInPeaceNoOpening`, read by the dev build only) and without the digging screen's beat (`__repoInPeaceNoDigHold`), so a
 * check can look at the default view as soon as the app is up.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      window.__repoInPeaceNoOpening = true;
      window.__repoInPeaceNoDigHold = true; // no 1.8 s beat on every load; boot.spec.ts turns it back on where it looks at it
    });
    await use(page);
  },
});

export { expect } from '@playwright/test';
export type { Page } from '@playwright/test';
