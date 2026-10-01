/**
 * Every guide hands the landlord to the service page that owns its search.
 *
 * The guides are where a worried landlord lands from search, and until 2026-10-02 the six of
 * them linked nowhere a landlord could act: no link to /services/ in the copy, only buttons at
 * the bottom. Each guide now carries one link to its service page early in the copy (within the
 * first 300 words, where a reader still is) and a closing "Landlord? Here is what to do next"
 * box. The anchors name the service, never "click here", and every internal link is
 * root-relative so the page works the same on a preview host.
 *
 * The guide list is read off disk (every blog/<slug>/index.html), so a guide added later is
 * covered without anyone having to remember this file.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EARLY_WORDS = 300;
const VAGUE = /^(click here|here|read more|learn more|this)$/i;

// Which service page owns each guide's search (the brief's keyword table). A guide not listed
// here must still link to a service page; add it here once its owner is decided.
const OWNER = new Map([
  ['tfa-back-rent-recovery', '/services/back-rent/'],
  ['eviction-diversion-program', '/services/back-rent/'],
  ['tenant-not-paying-rent-philadelphia', '/services/back-rent/'],
  ['landlord-guide-targeted-financial-assistance', '/services/back-rent/'],
  ['philadelphia-rental-license-requirements', '/services/licensing/'],
  ['certificate-of-rental-suitability', '/services/licensing/'],
  ['commercial-activity-license', '/services/licensing/'],
  ['lead-safe-certification', '/services/licensing/'],
]);

/** Every guide on disk, as its slug. */
function guides() {
  const dir = path.join(ROOT, 'blog');
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'index.html')))
    .map((e) => e.name)
    .sort();
}

for (const slug of guides()) {
  const url = `/blog/${slug}/`;
  const owner = OWNER.get(slug);
  const ownsIt = (href) => (owner ? href === owner : /^\/services\/[a-z-]+\/$/.test(href));
  const wanted = owner || 'a /services/ page';

  test(`${url}: links to ${wanted} in the first ${EARLY_WORDS} words`, async ({ page }) => {
    await page.goto(url);
    // Walk the article's text in reading order, counting words, and note every service link
    // that starts before the cut-off.
    const early = await page.evaluate((limit) => {
      const article = document.querySelector('article');
      if (!article) return null;
      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.parentElement.closest('script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      const found = [];
      let words = 0;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const link = n.parentElement.closest('a[href^="/services/"]');
        if (link && words < limit && n.textContent.trim()) found.push(link.getAttribute('href'));
        words += n.textContent.split(/\s+/).filter(Boolean).length;
      }
      return found;
    }, EARLY_WORDS);

    expect(early, `${url} has no <article>`).not.toBeNull();
    expect(early.filter(ownsIt), `${url} must link to ${wanted} within the first ${EARLY_WORDS} words`)
      .not.toEqual([]);
  });

  test(`${url}: ends with a "what to do next" box that links to ${wanted}`, async ({ page }) => {
    await page.goto(url);
    const box = await page.evaluate(() => {
      const el = document.querySelector('article [data-next-step]');
      if (!el) return null;
      return {
        last: el.parentElement.lastElementChild === el,
        text: el.textContent.replace(/\s+/g, ' '),
        hrefs: [...el.querySelectorAll('a[href^="/services/"]')].map((a) => a.getAttribute('href')),
      };
    });

    expect(box, `${url} has no [data-next-step] box in its article`).not.toBeNull();
    expect(box.last, `${url} "what to do next" box must be the last thing in the article`).toBe(true);
    expect(box.text).toContain('Landlord? Here is what to do next');
    expect(box.hrefs.filter(ownsIt), `${url} closing box must link to ${wanted}`).not.toEqual([]);
  });

  test(`${url}: service links name the service, and internal links are root-relative`, async ({ page }) => {
    await page.goto(url);
    const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => ({
      href: a.getAttribute('href'),
      text: a.textContent.replace(/\s+/g, ' ').trim(),
      inArticle: !!a.closest('article'),
    })));

    // An absolute link to our own site leaves a preview host for production; the canonical,
    // og:url and JSON-LD stay absolute, but those are not <a> links.
    const absolute = links.filter((l) => /^https?:\/\/(www\.)?rentalassistanceservices\.com/i.test(l.href));
    expect(absolute.map((l) => l.href), `${url} internal links must be root-relative`).toEqual([]);

    for (const l of links.filter((x) => x.inArticle && x.href.startsWith('/services/'))) {
      expect(l.href, `${url} service link must be /services/<page>/ with a trailing slash`).toMatch(/^\/services\/[a-z-]+\/$/);
      expect(l.text, `${url} service link text must name the service`).not.toMatch(VAGUE);
    }
  });
}
