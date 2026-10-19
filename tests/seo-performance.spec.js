/**
 * Images that cannot shift the page or slow the first screen, and a share image that stays in
 * the meta tags.
 *
 * Every <img> needs alt, width and height: alt for screen readers and image search, width and
 * height so the browser reserves the box before the file arrives (an image without them pushes
 * the text down when it lands, which is the layout shift Core Web Vitals counts as CLS).
 * An image below the first screen loads lazily so it does not compete with the text a visitor
 * sees first; an image on the first screen stays eager, because lazy-loading the hero delays
 * the largest paint (LCP).
 *
 * og-image.png is 279 KB. It is for link previews (og:image, twitter:image) and must never be
 * downloaded by a visitor's browser: no <img>, no CSS background.
 *
 * The site has no <img> today (the logo and icons are inline SVG), so the image checks guard
 * the next one somebody adds. The page list is read off disk, like tests/seo.spec.js, so a new
 * page is covered without anyone editing this file. No page is excluded.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Every page of the site, as the path it is served at. */
function sitePages(dir = ROOT, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'tests') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sitePages(full, out);
    // googleXXXX.html are Search Console verification stubs, not pages.
    else if (entry.name.endsWith('.html') && !/^google[a-z0-9]+\.html$/.test(entry.name)) {
      out.push('/' + path.relative(ROOT, full).split(path.sep).join('/'));
    }
  }
  return out;
}

// Phone and desktop first screens. An image is "above the fold" if it starts inside either.
const VIEWPORTS = [{ width: 390, height: 844 }, { width: 1280, height: 900 }];

/** The page's images as loaded at this viewport, with whether each starts on the first screen. */
async function images(page, url, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(url, { waitUntil: 'load' });
  return page.evaluate((fold) => [...document.images].map((img) => ({
    html: img.outerHTML.slice(0, 120),
    alt: img.hasAttribute('alt'),
    width: /^\d+$/.test(img.getAttribute('width') || ''),
    height: /^\d+$/.test(img.getAttribute('height') || ''),
    loading: img.getAttribute('loading'),
    aboveFold: img.getBoundingClientRect().top + window.scrollY < fold,
  })), viewport.height);
}

for (const url of sitePages()) {
  test(`${url}: images reserve their space, load lazily below the fold, and og-image.png stays in the meta`, async ({ page }) => {
    // A returning landlord (no role popup), with nothing third-party fetched; every request
    // the page makes is still recorded, aborted or not.
    const requested = [];
    page.on('request', (req) => requested.push(req.url()));
    await page.addInitScript(() => localStorage.setItem('ras_role_check',
      JSON.stringify({ v: 'dismissed', t: Date.now() })));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const runs = [];
    for (const viewport of VIEWPORTS) runs.push(await images(page, url, viewport));

    for (const img of runs[0]) {
      expect.soft(img.alt, `${url}: <img> without alt: ${img.html}`).toBe(true);
      expect.soft(img.width && img.height, `${url}: <img> without numeric width and height: ${img.html}`).toBe(true);
    }
    runs[0].forEach((img, i) => {
      const aboveFold = img.aboveFold || runs[1][i].aboveFold;
      if (aboveFold) {
        expect.soft(img.loading, `${url}: first-screen <img> must load eagerly: ${img.html}`).not.toBe('lazy');
      } else {
        expect.soft(img.loading, `${url}: below-the-fold <img> must be loading="lazy": ${img.html}`).toBe('lazy');
      }
    });

    expect.soft(requested.filter((u) => /og-image\.png/.test(u)),
      `${url} downloads og-image.png; it belongs only in og:image / twitter:image`).toEqual([]);
  });
}

test('site.css never paints og-image.png as a background', () => {
  expect(fs.readFileSync(path.join(ROOT, 'site.css'), 'utf8')).not.toMatch(/og-image/);
});
