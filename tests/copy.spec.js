/**
 * No long dashes anywhere a visitor or a search result reads.
 *
 * #9 took all 325 of them out, and nothing stopped the next one coming back in with a pasted
 * sentence, so this does. A long dash is reworded with a comma, full stop, colon or brackets,
 * never swapped for a hyphen. Hyphens inside words are fine.
 *
 * Checked: the rendered visible text, <title>, the meta, og: and twitter: descriptions, and every
 * string value in every JSON-LD block (Google shows those too). Exempt: HTML comments, scripts
 * other than JSON-LD, and CSS, which no visitor reads.
 *
 * The page list is read off disk, so a page added later is covered without anyone having to
 * remember this file.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// U+2013 en dash, U+2014 em dash, and the entities that render as them.
const LONG_DASH = /[–—]|&(?:ndash|mdash);|&#(?:8211|8212|x2013|x2014);/i;

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

/** Every string in a JSON-LD value, with the key path it sits at. */
function ldStrings(value, at, out = []) {
  if (typeof value === 'string') out.push([at, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => ldStrings(v, `${at}[${i}]`, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) ldStrings(v, `${at}.${k}`, out);
  }
  return out;
}

/** The long dash and a little of the text around it, so the failure says where to look. */
function around(text) {
  const i = text.search(LONG_DASH);
  return '"' + text.slice(Math.max(0, i - 50), i + 50).replace(/\s+/g, ' ') + '"';
}

for (const url of sitePages()) {
  test(`${url}: no long dashes in anything a visitor or a search result reads`, async ({ page }) => {
    await page.goto(url);
    const seen = await page.evaluate(() => {
      const meta = (sel) => document.querySelector(sel)?.getAttribute('content') ?? '';
      return {
        'visible text': document.body.innerText,
        '<title>': document.title,
        'meta description': meta('meta[name="description"]'),
        'og:description': meta('meta[property="og:description"]'),
        'twitter:description': meta('meta[name="twitter:description"]'),
        jsonld: [...document.querySelectorAll('script[type="application/ld+json"]')]
          .map((s) => s.textContent),
      };
    });

    const found = [];
    for (const [where, text] of Object.entries(seen)) {
      if (where === 'jsonld') continue;
      if (LONG_DASH.test(text)) found.push(`${where}: ${around(text)}`);
    }
    seen.jsonld.forEach((text, i) => {
      for (const [at, value] of ldStrings(JSON.parse(text), `JSON-LD block ${i + 1}`)) {
        if (LONG_DASH.test(value)) found.push(`${at}: ${around(value)}`);
      }
    });
    expect(found, `${url} has long dashes; reword with a comma, full stop, colon or brackets`)
      .toEqual([]);
  });
}
