/**
 * The five pages the old one-page homepage was split into (2026-09).
 *
 * Splitting it turned each section's <h2> into its page's <h1>, and the rules that colour
 * headings white on the dark bands only named h2–h4. The licensing page's title went navy on
 * navy, and nobody could read it. The same rules also turned the licensing and tax forms'
 * step titles white on their cream cards. So: every heading must be readable against the
 * background it actually sits on.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Every real page of the site, off disk. The two google-verification files are a single line
 *  of text with no markup, so requiring a <head> leaves them out and keeps the count honest. */
function sitePages(dir = ROOT, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) sitePages(f, out);
    else if (e.name.endsWith('.html') && fs.readFileSync(f, 'utf8').includes('<head>')) out.push(f);
  }
  return out;
}

// /motion.js sat in <head> with no defer, so it blocked the parser on all fifteen pages for
// nothing: everything in it already waits for DOMContentLoaded (motion.js:77-78, 152-153), so
// with defer it runs at the same moment against the same DOM, only without holding the page up.
// Read off disk, not through the browser, so a page nobody thought to test is still counted.
test('every page loads /motion.js, and defers it', () => {
  const found = sitePages().map((f) => ({
    page: '/' + path.relative(ROOT, f),
    tag: (fs.readFileSync(f, 'utf8').match(/<script[^>]*\/motion\.js[^>]*><\/script>/) || [])[0] || null,
  }));
  expect(found.length).toBe(15);                                    // a new page must be counted
  expect(found.filter((f) => !f.tag).map((f) => f.page)).toEqual([]);            // none missing it
  expect(found.filter((f) => !/\sdefer(\s|>|=)/.test(f.tag)).map((f) => f.page)).toEqual([]);
});

// The blanket "stop everything" rule for prefers-reduced-motion lived in /site.css, which only
// five of the fifteen pages link. /tenants/ had its own inline copy; /terms.html, /back-rent/
// and the seven blog pages had nothing, so the .tenant-panel and .rg-chosen-line entrances and
// the 350ms .rg-btn / .role-gate transitions kept moving for a visitor who asked them not to.
// It now lives in /theme.css, which every page links — so the check is that /theme.css itself
// serves it, not merely that the page has it from somewhere.
for (const url of ['/tenants/index.html', '/terms.html']) {
  test(`${url}: /theme.css stops everything under reduced motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(url);
    // 1. the rule is in the theme.css this page loaded
    const inTheme = await page.evaluate(() => [...document.styleSheets]
      .filter((sh) => (sh.href || '').endsWith('/theme.css'))
      .some((sh) => [...sh.cssRules].some((r) => r.media && r.conditionText.includes('prefers-reduced-motion')
        && [...r.cssRules].some((k) => /^\*/.test(k.selectorText || '')
          && k.style.getPropertyValue('animation-duration')))));
    expect(inTheme, '/theme.css does not carry the blanket rule').toBe(true);
    // 2. and it really wins: an element asking for two seconds gets none. Read as seconds,
    // because Chromium serialises the rule's .001ms as "1e-06s" and that spelling is not
    // the point — nothing perceptible is left is the point.
    const secs = (v) => (v.endsWith('ms') ? parseFloat(v) / 1000 : parseFloat(v));
    const stopped = await page.evaluate(() => {
      const el = document.createElement('div');
      el.style.cssText = 'transition-duration:2s;animation:none 2s;animation-delay:2s';
      document.body.appendChild(el);
      const c = getComputedStyle(el);
      const out = { t: c.transitionDuration, a: c.animationDuration, d: c.animationDelay };
      el.remove();
      return out;
    });
    expect(secs(stopped.t), `transition ${stopped.t}`).toBeLessThan(0.01);
    expect(secs(stopped.a), `animation ${stopped.a}`).toBeLessThan(0.01);
    expect(secs(stopped.d), `delay ${stopped.d}`).toBe(0);
  });
}

// The "landlord or tenant?" choice cards answered focus with `outline:none` plus a glow and a
// border colour. The glow is rgba(42,91,215,.24) over the paper — 1.41:1, under the 3:1 a focus
// indicator needs — and forced-colors mode throws away both the glow and the border colour, so
// a keyboard visitor there had no indicator at all. There is a real outline now.
test('the choice cards keep a real focus outline', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ras_role_check',
    JSON.stringify({ v: 'dismissed', t: Date.now() })));
  await page.goto('/index.html');
  const cards = page.locator('[data-gate-for="intake-form"] .rg-btn');
  await cards.first().focus();
  await page.keyboard.press('Tab');          // reached by keyboard, so :focus-visible really matches
  const card = cards.nth(1);
  await expect(card).toBeFocused();
  const ring = await card.evaluate((el) => {
    const s = getComputedStyle(el);
    return { visible: el.matches(':focus-visible'), style: s.outlineStyle,
      width: parseFloat(s.outlineWidth), color: s.outlineColor };
  });
  expect(ring.visible, 'the card is not :focus-visible, so this proves nothing').toBe(true);
  expect(ring.style).not.toBe('none');
  expect(ring.width).toBeGreaterThanOrEqual(2);
  expect(ring.color).not.toBe('rgba(0, 0, 0, 0)');
});

const PAGES = ['/index.html', '/services/back-rent/index.html', '/services/licensing/index.html',
  '/portal/index.html', '/faq/index.html'];

for (const url of PAGES) {
  test(`${url}: every heading is readable against its background`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('ras_role_check',
      JSON.stringify({ v: 'dismissed', t: Date.now() })));
    await page.goto(url);
    const unreadable = await page.evaluate(() => {
      const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, b]) => [r, g, b].map((c) => {
        c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
      // The first solid background behind the element: a faint rgba() tint over the band
      // does not change what the eye compares the text against.
      const bg = (el) => {
        for (let n = el; n; n = n.parentElement) {
          const c = rgb(getComputedStyle(n).backgroundColor);
          if (c.length === 3 || (c.length === 4 && c[3] === 1)) return c.slice(0, 3);
        }
        return [255, 255, 255];
      };
      const out = [];
      document.querySelectorAll('h1, h2, h3, h4').forEach((h) => {
        if (!h.getClientRects().length || !h.textContent.trim()) return;
        const a = lum(rgb(getComputedStyle(h).color).slice(0, 3)), b = lum(bg(h));
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        if (ratio < 3) out.push(`${h.textContent.trim().slice(0, 50)} — ${ratio.toFixed(2)}:1`);
      });
      return out;
    });
    expect(unreadable).toEqual([]);
  });
}

// The stat rows' cells had padding on one side only, so every number after the first sat right
// on the divider before it. Room on both sides now, and a big number that no longer fits its
// cell would wrap — so each must stay on one line too.
for (const url of ['/index.html', '/services/back-rent/index.html']) {
  for (const width of [1920, 1280, 1001, 800]) {
    test(`${url} at ${width}px: stat numbers keep clear of the dividers, on one line`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      const cells = await page.evaluate(() => {
        const row = document.querySelector('.stat-row').getBoundingClientRect();
        return [...document.querySelectorAll('.stat-row .stat-c')].map((c) => {
          const sv = c.querySelector('.sv'), rg = document.createRange();
          rg.selectNodeContents(sv);
          const cr = c.getBoundingClientRect(), tr = rg.getBoundingClientRect();
          // Lines, not rects: a number that counts up is its own <span>, so one line of text is
          // several rects. Rects whose tops sit within 10px of each other share a line.
          const tops = [...rg.getClientRects()].map((r) => r.top).sort((a, b) => a - b);
          const lines = tops.filter((t, i) => i === 0 || t - tops[i - 1] > 10).length;
          return { text: sv.textContent, startsRow: Math.abs(cr.left - row.left) < 2,
            gap: Math.round(tr.left - cr.left), lines };
        });
      });
      for (const c of cells) {
        expect(c.lines, `${c.text} wraps`).toBe(1);
        if (!c.startsRow) expect(c.gap, `${c.text} sits on the divider`).toBeGreaterThanOrEqual(20);
      }
    });
  }
}
