/**
 * Every page of the site as the path it is served at, read off disk, so a page added later is
 * covered by the design and accessibility checks without anyone remembering to list it.
 * (tests/seo.spec.js keeps its own copy of this walk.)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

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

/**
 * Open a page the way a returning visitor sees it, settled: the first-visit popup already
 * answered, no analytics, motion finished, every scroll-reveal section shown, fonts loaded.
 */
async function openSettled(page, url) {
  await page.addInitScript(() => {
    try { localStorage.setItem('ras_role_check', JSON.stringify({ v: 'dismissed', t: Date.now() })); } catch (e) {}
  });
  await page.route(/googletagmanager\.com|google-analytics\.com/, (route) => route.abort());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(async () => {
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
    await document.fonts.ready;
  });
}

module.exports = { sitePages, openSettled };
