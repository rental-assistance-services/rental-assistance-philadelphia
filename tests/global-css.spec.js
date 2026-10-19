/**
 * Every page loads the existing shared theme. The terms page's paper and the tenant page's
 * narrower width are deliberate exceptions; an unused compatibility file must not redefine it.
 * No browser: these checks read the site's files.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { sitePages } = require('./site-pages');

const ROOT = path.join(__dirname, '..');

/** The variables in the first :root { } block, as { name: value } with whitespace collapsed. */
function rootVariables(css) {
  const block = /:root\s*\{([^}]*)\}/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  const vars = {};
  if (!block) return vars;
  block[1].split(';').forEach((decl) => {
    const m = /^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(decl);
    if (m) vars[m[1]] = m[2].replace(/\s+/g, ' ');
  });
  return vars;
}

const THEME = rootVariables(fs.readFileSync(path.join(ROOT, 'theme.css'), 'utf8'));
const OVERRIDES = { 'terms.html': ['--paper'], 'tenants/index.html': ['--maxw'] };

test('theme.css defines the shared brand variables', () => {
  for (const name of ['--navy', '--paper', '--blue', '--green', '--rad', '--maxw', '--serif', '--sans']) {
    expect(THEME[name], name).toBeTruthy();
  }
});

test('global.css imports the theme without defining another set of tokens', () => {
  const css = fs.readFileSync(path.join(ROOT, 'global.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  expect(css).toBe('@import url("/theme.css");');
});

for (const url of sitePages()) {
  const rel = url.slice(1);
  test(`${rel} loads theme.css and preserves shared brand variables`, () => {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    expect(/<link[^>]+href="\/theme\.css"/.test(html), `${rel} must load theme.css`).toBe(true);
    const own = rootVariables(html);
    for (const [name, value] of Object.entries(own)) {
      expect(THEME[name], `${rel} defines ${name}, which theme.css does not`).toBeDefined();
      if ((OVERRIDES[rel] || []).includes(name)) continue;
      expect(value, `${rel}: ${name} differs from theme.css`).toBe(THEME[name]);
    }
  });
}
