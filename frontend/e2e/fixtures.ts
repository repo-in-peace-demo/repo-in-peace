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
  page: async ({ page }, use, testInfo) => {
    // What went wrong in the page itself: uncaught errors (which, with no error boundary, unmount the app and its dev API) and
    // console errors. Attached to a failing test, so a failure under load says why.
    const pageProblems: string[] = [];
    page.on('pageerror', (error) => pageProblems.push(`pageerror: ${error.message}\n${error.stack ?? ''}`));
    page.on('console', (message) => {
      if (message.type() === 'error') pageProblems.push(`console.error: ${message.text()}`);
    });
    page.on('crash', () => pageProblems.push('the page crashed'));
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) pageProblems.push(`navigated to ${frame.url()}`);
    });
    await page.route(OPEN_PRS, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ open: [] }) }));
    await page.addInitScript(() => {
      window.__repoInPeaceNoOpening = true;
      window.__repoInPeaceNoDigHold = true; // no 1.8 s beat on every load; boot.spec.ts turns it back on where it looks at it
    });
    await use(page);
    if (testInfo.status !== testInfo.expectedStatus && pageProblems.length > 0) {
      await testInfo.attach('page-problems', { body: pageProblems.join('\n'), contentType: 'text/plain' });
      console.log(`page problems in "${testInfo.title}":\n${pageProblems.slice(-12).join('\n')}`);
    }
  },
});

export { expect } from '@playwright/test';
export type { Page } from '@playwright/test';
