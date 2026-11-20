import { test as base } from '@playwright/test';

/**
 * The test every browser check uses, except `opening.spec.ts`: the page opens on the establishing shot without the opening move
 * (`window.__repoInPeaceNoOpening`, read by the dev build only), so a check can look at the default view as soon as the app is up.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      window.__repoInPeaceNoOpening = true;
    });
    await use(page);
  },
});

export { expect } from '@playwright/test';
export type { Page } from '@playwright/test';
