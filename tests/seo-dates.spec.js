/**
 * Every guide says, honestly and in three places that agree, when it was last checked.
 *
 * The six guides went out on 2026-06-24 and were not touched again, yet the sitemap told Google
 * 2026-06-26 and the visible line said only "Updated June 2026". When the guides were re-read
 * against the City's pages (2026-10-02), the date moved in all three places at once: the Article
 * JSON-LD's dateModified, the "Updated <date>" line under the H1, and the sitemap's lastmod.
 * This file keeps them from drifting apart again, and keeps the head of each guide saying who
 * the page is for.
 *
 * The guide list is read off disk (every blog/<slug>/index.html), so a guide added later is
 * covered without anyone having to remember this file.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://rentalassistanceservices.com';
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

/** Every guide on disk, as its slug. */
function guides() {
  const dir = path.join(ROOT, 'blog');
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'index.html')))
    .map((e) => e.name)
    .sort();
}

/** The sitemap's lastmod for each listed URL. */
function sitemapLastmods() {
  const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const out = new Map();
  for (const [, block] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = block.match(/<loc>([^<]+)<\/loc>/);
    const lastmod = block.match(/<lastmod>([^<]+)<\/lastmod>/);
    if (loc) out.set(loc[1].trim(), lastmod ? lastmod[1].trim() : null);
  }
  return out;
}

/** Every JSON-LD node on the page, through arrays and @graph. */
function nodes(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => nodes(v, out));
  else if (value && typeof value === 'object') {
    out.push(value);
    if (value['@graph']) nodes(value['@graph'], out);
  }
  return out;
}

/** "October 2, 2026" -> "2026-10-02"; null if it is not a full date. */
function isoFromWords(words) {
  const m = words.match(/^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/);
  if (!m || !MONTHS.includes(m[1])) return null;
  const mm = String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0');
  return `${m[3]}-${mm}-${m[2].padStart(2, '0')}`;
}

const lastmods = sitemapLastmods();

for (const slug of guides()) {
  const url = `/blog/${slug}/`;

  test(`${url}: the Article, the visible "Updated" line and the sitemap agree on the date`, async ({ page }) => {
    await page.goto(url);

    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const articles = nodes(blocks.map((b) => JSON.parse(b))).filter((n) => n['@type'] === 'Article');
    expect(articles.length, `${url} must carry exactly one Article`).toBe(1);
    const { datePublished, dateModified } = articles[0];
    expect(datePublished, `${url} Article datePublished`).toMatch(ISO);
    expect(dateModified, `${url} Article dateModified`).toMatch(ISO);
    // ISO dates compare correctly as strings.
    expect(dateModified >= datePublished,
      `${url} dateModified ${dateModified} is before datePublished ${datePublished}`).toBe(true);

    const line = page.locator('h1 ~ .artmeta').first();
    await expect(line, `${url} has no visible "Updated" line under the H1`).toBeVisible();
    const text = (await line.textContent()).replace(/\s+/g, ' ');
    const shown = text.match(/Updated ([A-Z][a-z]+ \d{1,2}, \d{4})/);
    expect(shown, `${url} "Updated" line must give a full date: ${text}`).not.toBeNull();
    expect(isoFromWords(shown[1]), `${url} visible date must equal dateModified`).toBe(dateModified);

    const loc = `${SITE}${url}`;
    expect(lastmods.has(loc), `${loc} is not in sitemap.xml`).toBe(true);
    expect(lastmods.get(loc), `${loc} sitemap lastmod must equal dateModified`).toBe(dateModified);
  });

  test(`${url}: the H1 and the meta description say who the guide is for`, async ({ page }) => {
    await page.goto(url);
    const head = await page.evaluate(() => ({
      h1s: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()),
      description: document.querySelector('meta[name="description"]')?.content ?? '',
    }));

    expect(head.h1s.length, `${url} must have one H1`).toBe(1);
    expect(head.h1s[0], `${url} H1 must name the landlord`).toMatch(/landlord|tenant's/i);

    const { description } = head;
    expect(description.length, `${url} description is ${description.length} characters: ${description}`)
      .toBeGreaterThanOrEqual(140);
    expect(description.length, `${url} description is ${description.length} characters: ${description}`)
      .toBeLessThanOrEqual(160);
    const firstClause = description.split(/[:;,.]/)[0];
    expect(firstClause, `${url} description must say who it is for in its first clause`)
      .toMatch(/landlord|property owner|property manager/i);
  });
}
