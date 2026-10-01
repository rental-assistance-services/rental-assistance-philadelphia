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

/**
 * The structured data. A JSON-LD block that does not parse is dropped by Google without a word,
 * and a Service with no areaServed says nothing about where it is sold, which for a business
 * that only works in Philadelphia is the one thing it has to say. Both fail quietly, so this
 * checks every block on every page: the same page list as above, read off disk.
 */

/** Every node in a JSON-LD value: @graph arrays, nested objects, lists of either. */
function ldNodes(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => ldNodes(v, out));
  else if (value && typeof value === 'object') {
    out.push(value);
    Object.values(value).forEach((v) => ldNodes(v, out));
  }
  return out;
}
const ldTypes = (node) => [].concat(node['@type'] ?? []);

// The pages that sell something must say so; a block deleted by accident would pass the rest.
const SELLS = ['/services/back-rent/index.html', '/services/licensing/index.html'];

for (const url of sitePages()) {
  test(`${url}: every JSON-LD block parses, and every Service says where it is sold`, async ({ request }) => {
    const res = await request.get(url);
    expect(res.status(), `${url} is not served`).toBe(200);
    const html = await res.text();
    const blocks = [...html.matchAll(
      /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi,
    )].map((m) => m[1]);

    const nodes = [];
    blocks.forEach((text, i) => {
      let data;
      try { data = JSON.parse(text); } catch (err) {
        throw new Error(`${url} JSON-LD block ${i + 1} is not valid JSON: ${err.message}`);
      }
      nodes.push(...ldNodes(data));
    });

    const services = nodes.filter((node) => ldTypes(node).includes('Service'));
    for (const service of services) {
      const area = service.areaServed;
      const empty = area === undefined || area === null || area === ''
        || (Array.isArray(area) && area.length === 0);
      expect(empty, `${url} has a Service with no areaServed: ${service['@id'] || service.name}`)
        .toBe(false);
    }
    if (SELLS.includes(url)) {
      expect(services.length, `${url} sells a service but carries no Service JSON-LD`)
        .toBeGreaterThan(0);
    }
  });
}
