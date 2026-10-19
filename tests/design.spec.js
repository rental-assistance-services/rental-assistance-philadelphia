/**
 * What every page looks like, on a phone (390px wide) and a desktop (1280px), compared with the
 * approved picture of it. A change anywhere on a page fails here, and the report shows the
 * approved picture, the new one and the difference (npm run test:report). So a design edit
 * can't quietly change a page nobody looked at. When a change is meant: npm run test:update.
 *
 * On this computer only, never on CI: fonts and anti-aliasing differ between Windows and
 * GitHub's Linux machines, so the pictures belong to the computer that took them and are not
 * committed (.gitignore). A fresh checkout has none; npm run test:update records them.
 *
 * Pages are shown settled (tests/site-pages.js openSettled): the first-visit popup already
 * answered, motion finished and every scroll-reveal section shown. A page added later is covered.
 */
const { test, expect } = require('@playwright/test');
const { sitePages, openSettled } = require('./site-pages');

test.skip(!!process.env.CI, 'the pictures are compared on the computer that took them, not on CI');

const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
];

// "/services/back-rent/index.html" -> "services-back-rent"; "/index.html" -> "home".
const slug = (url) => url.replace(/(^\/|\/?index\.html$|\.html$)/g, '').replace(/\//g, '-') || 'home';

for (const url of sitePages()) {
  for (const size of SIZES) {
    test(`${url} on a ${size.name} looks as approved`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openSettled(page, url);
      await expect(page).toHaveScreenshot(`${slug(url)}-${size.name}.png`, { fullPage: true });
    });
  }
}
