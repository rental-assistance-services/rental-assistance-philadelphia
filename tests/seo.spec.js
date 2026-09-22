/**
 * What the search result says: who the page is for.
 *
 * #5 put "Philadelphia Landlords:" in front of the back-rent titles so that a tenant searching
 * for rent help can see from the search result itself that the page is not for them. Tenants
 * were arriving, filling the forms, and being counted as paid landlord conversions.
 *
 * When the homepage was split into per-section pages, /services/back-rent/ was written from a
 * copy that predated #5, so it lost the prefix on all three: the title, the og:title and the
 * twitter:title. Nothing failed, because nothing checked.
 *
 * The page list is read off disk, so a page added later is covered without anyone having to
 * remember this file. There is no build step here: the file on disk is the file that is served.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PREFIX = 'Philadelphia Landlords:';
const BRAND = '| Rental Assistance Philadelphia';

// Pages that deliberately do not lead with the prefix, and why. Everything not listed must
// lead with it, so a new page inherits the rule instead of quietly skipping it.
const NO_PREFIX = new Map([
  ['/tenants/index.html', 'the tenant page: it is here to send tenants somewhere that helps them'],
  ['/terms.html', 'fee and service terms; reached from inside the site, not from a search'],
  ['/portal/index.html', 'the portal is for clients who already signed'],
  ['/faq/index.html', 'names the audience at the end instead: "... for Philadelphia Landlords"'],
  ['/services/licensing/index.html', 'names the audience at the end instead: "... for Landlords"'],
]);
// The guides keep their own question-shaped titles; they answer a search, they do not sell.
const noPrefixReason = (url) => (url.startsWith('/blog/') ? 'a blog guide' : NO_PREFIX.get(url));

/** Every page of the site, as the path it is served at. */
function sitePages(dir = ROOT, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    // node_modules and the test folder are not the site; the dot-folders are tooling.
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'tests') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sitePages(full, out);
    // googleXXXX.html are Search Console verification stubs, not pages: one line, no head.
    else if (entry.name.endsWith('.html') && !/^google[a-z0-9]+\.html$/.test(entry.name)) {
      out.push('/' + path.relative(ROOT, full).split(path.sep).join('/'));
    }
  }
  return out;
}

for (const url of sitePages()) {
  test(`${url}: the search result says who the page is for`, async ({ page }) => {
    await page.goto(url);
    const head = await page.evaluate(() => ({
      title: document.title,
      og: document.querySelector('meta[property="og:title"]')?.content ?? null,
      twitter: document.querySelector('meta[name="twitter:title"]')?.content ?? null,
    }));

    expect(head.title, `${url} has no title`).toBeTruthy();
    expect(head.title.endsWith(BRAND),
      `${url} title does not end "${BRAND}": ${head.title}`).toBe(true);

    const exempt = noPrefixReason(url);
    if (exempt) {
      test.info().annotations.push({ type: 'no prefix', description: `${url}: ${exempt}` });
      return;
    }
    expect(head.title.startsWith(PREFIX),
      `${url} title must lead with "${PREFIX}" (or be listed in NO_PREFIX with a reason): ${head.title}`)
      .toBe(true);
    // The card titles are the same search result in another window; they must not undercut it.
    for (const [what, value] of [['og:title', head.og], ['twitter:title', head.twitter]]) {
      if (value === null) continue;
      expect(value.startsWith(PREFIX), `${url} ${what} must lead with "${PREFIX}": ${value}`).toBe(true);
    }
  });
}
