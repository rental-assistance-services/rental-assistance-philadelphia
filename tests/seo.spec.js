/**
 * What the search result says: who the page is for, and which page owns the query.
 *
 * #5 put "Philadelphia Landlords:" in front of the back-rent titles so that a tenant searching
 * for rent help can see from the search result itself that the page is not for them. Tenants
 * were arriving, filling the forms, and being counted as paid landlord conversions.
 *
 * When the homepage was split into per-section pages, /services/back-rent/ was written from a
 * copy that predated #5, so it lost the prefix on all three: the title, the og:title and the
 * twitter:title. Nothing failed, because nothing checked.
 *
 * The other half is which page owns a query. /back-rent/ and /services/back-rent/ sell the same
 * thing, and both sat in the sitemap at priority 0.9 pointing their canonical at themselves, so
 * they competed with each other for the exact query the ads pay for. /services/back-rent/ is the
 * canonical page; /back-rent/ points at it and is out of the sitemap.
 *
 * Handing the query over only works if everything else follows it. The Service and
 * BreadcrumbList structured data from #1 stayed on /back-rent/, where search engines no longer
 * read it, and eleven links in the blog still sent readers and link equity to the old address.
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

test('no two pages in the sitemap point at one canonical page', async ({ request }) => {
  const xml = await (await request.get('/sitemap.xml')).text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(locs.length, 'the sitemap lists no pages').toBeGreaterThan(5);

  const listedBy = new Map();
  for (const loc of locs) {
    const servedAt = new URL(loc).pathname;
    const res = await request.get(servedAt);
    expect(res.status(), `${loc} is in the sitemap but is not served`).toBe(200);
    const canonical = (await res.text()).match(/<link rel="canonical" href="([^"]+)"/);
    expect(canonical, `${loc} is in the sitemap with no canonical`).not.toBeNull();
    listedBy.set(canonical[1], [...(listedBy.get(canonical[1]) || []), loc]);
  }

  // Asking Google to index two addresses for one page is asking it to choose, and the choice
  // splits the ranking. A second address stays served and points its canonical at the winner.
  const competing = [...listedBy].filter(([, urls]) => urls.length > 1)
    .map(([target, urls]) => `${urls.join(' and ')} both point at ${target}`);
  expect(competing, 'two sitemap entries are competing for one page').toEqual([]);
});

const CANONICAL = 'https://rentalassistanceservices.com/services/back-rent/';

/** The page's canonical link and its JSON-LD blocks, parsed. A block that is not JSON throws. */
async function readHead(page, url) {
  await page.goto(url);
  const head = await page.evaluate(() => ({
    canonical: document.querySelector('link[rel="canonical"]')?.href ?? null,
    blocks: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent),
  }));
  return { canonical: head.canonical, schema: head.blocks.map((text) => JSON.parse(text)) };
}

test('the structured data is on the canonical back-rent page, and only there', async ({ page }) => {
  const canonicalPage = await readHead(page, '/services/back-rent/index.html');
  expect(canonicalPage.canonical, '/services/back-rent/ no longer canonicalises to itself').toBe(CANONICAL);

  const services = canonicalPage.schema.filter((s) => s['@type'] === 'Service');
  expect(services.length, '/services/back-rent/ must carry exactly one Service block').toBe(1);
  expect(services[0]['@id']).toBe(`${CANONICAL}#service`);
  expect(services[0].url).toBe(CANONICAL);

  const crumbs = canonicalPage.schema.filter((s) => s['@type'] === 'BreadcrumbList');
  expect(crumbs.length, '/services/back-rent/ must carry exactly one BreadcrumbList block').toBe(1);
  expect(crumbs[0].itemListElement.at(-1).item, 'the last breadcrumb must be the page itself').toBe(CANONICAL);

  // Moved, not copied: the old page canonicalises away, so a copy there would be a second
  // Service entity that search engines are told not to read.
  const oldPage = await readHead(page, '/back-rent/index.html');
  expect(oldPage.canonical).toBe(CANONICAL);
  expect(oldPage.schema, '/back-rent/ still carries structured data').toEqual([]);
});

const blogPages = sitePages().filter((url) => url.startsWith('/blog/'));

test('the blog is still read off disk', () => {
  expect(blogPages.length, 'no blog pages found').toBeGreaterThan(1);
});

for (const url of blogPages) {
  test(`${url}: links to the canonical back-rent page, not the old one`, async ({ page }) => {
    await page.goto(url);
    // Resolved by the browser, so a relative, absolute or #fragment link to the old page counts.
    const old = await page.$$eval('a[href]', (links) => links
      .map((a) => new URL(a.href))
      .filter((u) => u.pathname === '/back-rent' || u.pathname.startsWith('/back-rent/'))
      .map((u) => u.href));
    expect(old, `${url} links to /back-rent/; point it at /services/back-rent/`).toEqual([]);
  });
}
