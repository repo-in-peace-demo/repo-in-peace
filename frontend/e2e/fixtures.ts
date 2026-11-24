import { test as base } from '@playwright/test';

/**
 * The test every browser check uses, except `opening.spec.ts`: the page opens on the establishing shot without the opening move
 * (`window.__repoInPeaceNoOpening`, read by the dev build only) and without the digging screen's beat (`__repoInPeaceNoDigHold`), so a
 * check can look at the default view as soon as the app is up.
 */
/**
 * The list of open pull requests the page asks for on load (GET /api/pr?open=…). The dev server's made-up pull requests last as long
 * as it does, so a grave buried by one test would show as buried in every later one: by default this answers "none". A test of the
 * list removes it (`page.unroute(OPEN_PRS)`) to ask the dev server's own list.
 */
export const OPEN_PRS = (url: URL): boolean => url.pathname === '/api/pr' && url.searchParams.has('open');

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route(OPEN_PRS, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ open: [] }) }));
    await page.addInitScript(() => {
      window.__repoInPeaceNoOpening = true;
      window.__repoInPeaceNoDigHold = true; // no 1.8 s beat on every load; boot.spec.ts turns it back on where it looks at it
    });
    await use(page);
  },
});

export { expect } from '@playwright/test';
export type { Page } from '@playwright/test';
