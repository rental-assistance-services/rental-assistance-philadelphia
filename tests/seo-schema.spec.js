/**
 * The structured data. A JSON-LD block that does not parse is dropped by Google without a word,
 * and a Service with no areaServed says nothing about where it is sold, which for a business
 * that only works in Philadelphia is the one thing it has to say. Both fail quietly, so this
 * checks every block on every page.
 *
 * The page list is read off disk, the same way tests/seo.spec.js reads it, so a page added later
 * is covered without anyone having to remember this file.
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
