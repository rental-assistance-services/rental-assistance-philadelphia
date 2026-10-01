/**
 * The guide index and the two service pages hand a landlord on to each other.
 *
 * The blog is where a worried landlord lands from search, and /blog/ linked to no service page:
 * the only way on was a button in the closing band. The service pages, for their part, never
 * pointed at the guides that explain the program in depth. So /blog/ now opens with a sentence
 * that names both services and the FAQ, and each service page ends with a "Read the guide" list.
 *
 * Every one of those links is root-relative with a trailing slash (/services/back-rent/, never
 * an absolute URL or index.html), so it works on a preview host and Google sees one address per
 * page. The target is checked on disk: there is no build step, the file is the page.
 *
 * The links inside each guide are asserted by the guides' own spec, not here.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = /^https?:\/\/(www\.)?rentalassistanceservices\.com/i;
const GUIDE = /^\/blog\/[^/#?]+/;

/** The file a root-relative, trailing-slash href is served from, or null if it is not one. */
function fileFor(href) {
  if (!/^\/([a-z0-9-]+\/)*$/.test(href)) return null;
  return path.join(ROOT, ...href.split('/').filter(Boolean), 'index.html');
}

function expectServedLink(from, href) {
  const file = fileFor(href);
  expect(file, `${from} links to "${href}": internal links are root-relative with a trailing slash`)
    .not.toBeNull();
  expect(fs.existsSync(file), `${from} links to ${href}, but ${path.relative(ROOT, file)} does not exist`)
    .toBe(true);
}

test('/blog/: an in-text link to each service page and to the FAQ', async ({ page }) => {
  await page.goto('/blog/');
  // Inside a paragraph, not a nav item or a button: the sentence around it is what tells
  // Google and the reader what the target page is for.
  const inText = await page.$$eval('p a[href]', (links) => links
    .filter((a) => !a.closest('footer')).map((a) => a.getAttribute('href')));
  for (const href of ['/services/back-rent/', '/services/licensing/', '/faq/']) {
    expect(inText, `/blog/ has no in-text link to ${href}`).toContain(href);
    expectServedLink('/blog/', href);
  }
});

test('/blog/: no internal link is an absolute URL', async ({ page }) => {
  await page.goto('/blog/');
  const hrefs = await page.$$eval('a[href]', (links) => links.map((a) => a.getAttribute('href')));
  expect(hrefs.filter((href) => SITE.test(href)),
    '/blog/ links to its own site by absolute URL; use the root-relative path').toEqual([]);
});

for (const url of ['/services/back-rent/', '/services/licensing/']) {
  test(`${url}: links to at least two guides`, async ({ page }) => {
    await page.goto(url);
    const hrefs = await page.$$eval('a[href]', (links) => links.map((a) => a.getAttribute('href')));
    // An absolute guide URL is counted too, so that it fails the root-relative check below.
    const guides = [...new Set(hrefs.filter((href) => GUIDE.test(href.replace(SITE, ''))))];
    expect(guides.length, `${url} links to ${guides.length} guide(s): ${guides.join(', ')}`)
      .toBeGreaterThanOrEqual(2);
    for (const href of guides) expectServedLink(url, href);
  });
}
