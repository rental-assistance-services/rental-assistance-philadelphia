/**
 * global.css is the site's style standard (AGENTS.md section 4). Until every page loads it, each
 * page carries its own copy of the brand variables; this keeps those copies from drifting.
 * No browser: it reads the files.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function pages(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return ['node_modules', 'tests', '.git', '.github', '.claude', 'test-results', 'playwright-report']
        .includes(entry.name) ? [] : pages(full);
    }
    return entry.name.endsWith('.html') && !entry.name.startsWith('google') ? [full] : [];
  });
}

/** The variables in the first :root { } block, as { name: value } with whitespace collapsed. */
function rootVariables(css) {
  const block = /:root\s*\{([^}]*)\}/.exec(css);
  const vars = {};
  if (!block) return vars;
  block[1].split(';').forEach((decl) => {
    const m = /^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(decl);
    if (m) vars[m[1]] = m[2].replace(/\s+/g, ' ');
  });
  return vars;
}

const GLOBAL = rootVariables(fs.readFileSync(path.join(ROOT, 'global.css'), 'utf8'));

test('global.css defines the brand variables', () => {
  for (const name of ['--navy', '--paper', '--brass', '--green', '--rad', '--maxw', '--serif', '--sans']) {
    expect(GLOBAL[name], name).toBeTruthy();
  }
});

for (const file of pages(ROOT)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  test(`${rel} uses the same brand variables as global.css`, () => {
    const html = fs.readFileSync(file, 'utf8');
    const own = rootVariables(html);
    if (!Object.keys(own).length) {
      // a page without its own copy must load the standard instead
      expect(html).toMatch(/<link[^>]+href="[^"]*global\.css"/);
      return;
    }
    for (const [name, value] of Object.entries(own)) {
      expect(GLOBAL[name], `${rel} defines ${name}, which global.css does not`).toBeDefined();
      expect(value, `${rel}: ${name} differs from global.css`).toBe(GLOBAL[name]);
    }
  });
}