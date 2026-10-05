/**
 * Every page, scanned by axe (the engine behind Chrome's Lighthouse accessibility audit) against
 * WCAG 2.1 A and AA: colour contrast, labels on every field and button, headings in order,
 * images with alt text, links that say where they go. A page added later is scanned too.
 *
 * Scanned settled (tests/site-pages.js openSettled): the scroll-reveal sections shown, because a
 * section still at opacity 0 would be measured as invisible text, and the first-visit popup
 * closed, because the popup has its own checks in tests/landlord-check.spec.js.
 */
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { sitePages, openSettled } = require('./site-pages');

// Problems that were already on the site when this check arrived (2026-09-26). They are listed
// so the check passes today and still fails on anything new. Fix one, then delete its entry:
// the check says so when an entry no longer matches anything.
const KNOWN = [
  {
    pages: ['/index.html', '/faq/index.html', '/portal/index.html',
      '/services/back-rent/index.html', '/services/licensing/index.html'],
    rule: 'link-in-text-block',
    where: 'tenants/',
    why: 'the /tenants/ link in the legal footer is told apart from the words around it by colour alone',
  },
  {
    pages: ['/portal/index.html'],
    rule: 'color-contrast',
    why: 'the sample case table (headings, badges, tags), its legend and the demo note are below 4.5:1',
  },
];
const knownFor = (url) => KNOWN.filter((k) => k.pages.includes(url));
const matches = (k, violation, node) => violation.id === k.rule
  && (!k.where || node.target.join(' ').includes(k.where));

for (const url of sitePages()) {
  test(`${url}: no WCAG 2.1 A/AA problems`, async ({ page }) => {
    await openSettled(page, url);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const known = knownFor(url);
    const seen = new Set();
    // One line per problem, naming the element, so the failure says what to fix.
    const problems = violations.flatMap((v) => v.nodes.flatMap((n) => {
      const k = known.find((entry) => matches(entry, v, n));
      if (k) { seen.add(k); return []; }
      return [`${v.impact} · ${v.id}: ${v.help} · ${n.target.join(' ')}`];
    }));
    expect(problems, `${url} has accessibility problems`).toEqual([]);
    for (const k of known) {
      test.info().annotations.push({ type: 'known problem', description: `${url}: ${k.why}` });
      expect(seen.has(k), `${url}: fixed, so delete its KNOWN entry (${k.rule}: ${k.why})`).toBe(true);
    }
  });
}
