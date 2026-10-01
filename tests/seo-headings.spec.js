/**
 * What Google reads under the title: the heading outline of the two service pages, the first
 * paragraph, the description, and the back-rent page's own FAQ.
 *
 * Both service pages used to run 1,700 to 2,700 words under one H2 (the shared contact band),
 * with every section label a <p class="eyebrow"> and every section title an h3 sitting straight
 * under the H1. The labels are now the H2s, named for the questions landlords search, so the
 * outline says what the page answers. The look did not change: h2.eyebrow keeps the eyebrow's
 * class rules.
 *
 * The back-rent FAQ carries FAQPage schema, and Google only accepts that when the schema says
 * what the visitor can read, so the two are compared here word for word.
 *
 * The City's Eviction Diversion pages (eviction-diversion.phila.gov and its /FAQ) put the $3,500
 * limit on the arrears a TFA application claims, call the no-filing window the two-month TFA
 * Protection Period, and pay the two future months only while the tenant stays; the law is cited
 * as "Phila. Code § 9-811, as amended by Bill No. 240245, approved June 12, 2024", not as
 * Ordinance #220655. The older copy said otherwise; the last test keeps it from coming back.
 *
 * Read with JavaScript off: this is the page as a crawler first gets it, and the landlord-check
 * popup and the role gate cannot add headings of their own.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const PAGES = {
  '/services/back-rent/': {
    primary: ['recover back rent', 'philadelphia'],
    h2: ['Who qualifies', 'How the filing works', 'How long it takes', 'How much the City pays',
      'What it costs you', 'Questions landlords ask about back rent', 'Request your free case review.'],
  },
  '/services/licensing/': {
    primary: ['philadelphia rental license'],
    h2: ['Why you need a Philadelphia rental license', 'Certificate of Rental Suitability',
      'Why you need a Commercial Activity License', 'The four documents in order', 'What we do for you',
      'Request your free case review.'],
  },
};
// The section names the brief asks for. Licensing keeps its existing labels where they already
// name the document (and carry the primary term), so these are matched as contained text.
const BRIEF_H2 = {
  '/services/back-rent/': ['Who qualifies', 'How much the City pays', 'How the filing works',
    'What it costs you', 'How long it takes'],
  '/services/licensing/': ['The four documents in order', 'Rental License', 'Commercial Activity License',
    'Certificate of Rental Suitability', 'What we do for you'],
};

const norm = (s) => s.replace(/\s+/g, ' ').trim();

test.describe('service page headings and copy', () => {
  test.use({ javaScriptEnabled: false });

  for (const [url, spec] of Object.entries(PAGES)) {
    test(`${url}: one H1, the named H2 sections, no skipped heading level`, async ({ page }) => {
      await page.goto(url);
      const heads = await page.$$eval('body h1, body h2, body h3, body h4, body h5, body h6',
        (els) => els.map((h) => ({ level: Number(h.tagName[1]), text: h.textContent.replace(/\s+/g, ' ').trim() })));

      expect(heads.filter((h) => h.level === 1)).toHaveLength(1);
      expect(heads[0].level, 'the H1 comes first').toBe(1);

      const h2 = heads.filter((h) => h.level === 2).map((h) => h.text);
      expect(h2).toEqual(spec.h2);
      expect(heads.map((h) => h.text).join(' | ')).not.toMatch(/[–—]/);
      for (const name of BRIEF_H2[url]) {
        expect(h2.some((t) => t.toLowerCase().includes(name.toLowerCase())), `an H2 names "${name}"`).toBe(true);
      }

      const skips = [];
      heads.forEach((h, i) => {
        if (i && h.level > heads[i - 1].level + 1) skips.push(`h${heads[i - 1].level} "${heads[i - 1].text}" -> h${h.level} "${h.text}"`);
      });
      expect(skips).toEqual([]);
    });

    test(`${url}: the first paragraph names the audience and the primary term`, async ({ page }) => {
      await page.goto(url);
      const first = (await page.locator('main p').first().textContent()).toLowerCase();
      expect(first).toContain('landlord');
      for (const term of spec.primary) expect(first).toContain(term);
      expect(first).not.toContain('help with rent');
    });
  }

  for (const url of ['/services/back-rent/', '/services/licensing/', '/faq/']) {
    test(`${url}: the H1 says who it is for and the description fits the result`, async ({ page }) => {
      await page.goto(url);
      expect((await page.locator('h1').textContent()).toLowerCase()).toMatch(/landlord|tenant's/);
      const meta = (sel) => page.locator(sel).getAttribute('content');
      const desc = await meta('meta[name="description"]');
      expect(desc.length, desc).toBeGreaterThanOrEqual(140);
      expect(desc.length, desc).toBeLessThanOrEqual(160);
      expect(desc.split(/[:,.]/)[0].toLowerCase(), 'audience in the first clause').toContain('landlords');
      expect(await meta('meta[property="og:description"]')).toBe(desc);
      expect(await meta('meta[name="twitter:description"]')).toBe(desc);
    });
  }

  test('/services/back-rent/: the FAQPage schema says what the visible FAQ says', async ({ page }) => {
    await page.goto('/services/back-rent/');
    const { visible, schema, inHead, beforeContact } = await page.evaluate(() => {
      const n = (s) => s.replace(/\s+/g, ' ').trim();
      const items = [...document.querySelectorAll('main .faq-item')];
      const blocks = [...document.querySelectorAll('script[type="application/ld+json"]')];
      const faq = blocks.find((b) => JSON.parse(b.textContent)['@type'] === 'FAQPage');
      const contact = document.getElementById('contact');
      return {
        visible: items.map((d) => {
          const ans = d.querySelector('.ans');
          return { q: n(d.querySelector('summary').textContent), a: n(ans.textContent),
            shown: getComputedStyle(ans).display !== 'none' };
        }),
        schema: faq ? JSON.parse(faq.textContent).mainEntity.map((e) => ({ q: n(e.name), a: n(e.acceptedAnswer.text) })) : [],
        inHead: !!(faq && faq.closest('head')),
        beforeContact: items.every((d) => d.compareDocumentPosition(contact) & Node.DOCUMENT_POSITION_FOLLOWING),
      };
    });
    expect(visible.length).toBeGreaterThanOrEqual(3);
    expect(visible.length).toBeLessThanOrEqual(5);
    expect(schema).toEqual(visible.map(({ q, a }) => ({ q, a })));
    expect(visible.filter((v) => !v.shown), 'no answer is hidden by CSS').toEqual([]);
    expect(inHead, 'the FAQ schema sits next to the FAQ, not in <head>').toBe(false);
    expect(beforeContact).toBe(true);
    for (const { q } of visible) expect(q.toLowerCase()).not.toMatch(/help with rent|rental assistance/);
    // The site reads without long dashes (PR #9); the FAQ and its schema follow suit.
    expect(JSON.stringify([visible, schema])).not.toMatch(/[–—]/);
  });

  test('/faq/: the corrected questions say the same thing in the schema and on the page', async ({ page }) => {
    await page.goto('/faq/');
    const pairs = await page.evaluate(() => {
      const n = (s) => s.replace(/\s+/g, ' ').trim();
      const faq = [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map((b) => JSON.parse(b.textContent)).find((j) => j['@type'] === 'FAQPage');
      const shown = new Map([...document.querySelectorAll('.faq-item')].map((d) =>
        [n(d.querySelector('summary').textContent), n(d.querySelector('.ans').textContent)]));
      return faq.mainEntity.map((e) => ({ q: n(e.name), schema: n(e.acceptedAnswer.text), page: shown.get(n(e.name)) }));
    });
    for (const q of ['Is the $3,500 a limit on whether my tenant qualifies?',
      'How is the money paid, and how long does it take?', 'What is the two-month TFA Protection Period?']) {
      const p = pairs.find((x) => x.q === q);
      expect(p, q).toBeTruthy();
      expect(p.page, q).toBe(p.schema);
    }
  });
});

// Served as files, so a JS string or a meta tag counts as much as the visible text.
const OWNED = ['index.html', 'services/back-rent/index.html', 'services/licensing/index.html',
  'faq/index.html', 'portal/index.html', 'back-rent/index.html'];
for (const file of OWNED) {
  test(`/${file}: no claim the City's pages contradict`, () => {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const re of [/eligibility ceiling/i, /you still qualify/i, /still qualifies/i, /60-day/i, /moratorium/i,
      /within 30 days/i, /not a limit on who qualifies/i, /220655/]) {
      expect(html, `${file} still says ${re}`).not.toMatch(re);
    }
  });
}
