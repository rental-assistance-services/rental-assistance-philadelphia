/**
 * The two guides written for the "tenant behind on rent" search (2026-10).
 *
 * The paid campaign's broadest ad group, tenant-behind, took 96% of the spend and had no
 * organic page to catch the same search. These two guides are that page. They only earn their
 * place if Google can find them (sitemap, the guide list), reads them as a full answer (enough
 * copy, headings phrased as the questions people type), and if they hand the landlord on to
 * the service page that sells the filing. They are landing pages, so the landlord check loads
 * on them like every other page that leads to a form.
 */
const { test, expect } = require('@playwright/test');

const GUIDES = ['/blog/tenant-not-paying-rent-philadelphia/',
  '/blog/landlord-guide-targeted-financial-assistance/'];
const SITE = 'https://rentalassistanceservices.com';

for (const url of GUIDES) {
  test(`${url}: a full guide that answers questions and loads the landlord check`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('ras_role_check',
      JSON.stringify({ v: 'dismissed', t: Date.now() })));
    const res = await page.goto(url);
    expect(res.status(), `${url} is not served`).toBe(200);

    const facts = await page.evaluate(() => ({
      words: document.querySelector('article').innerText.split(/\s+/).filter(Boolean).length,
      h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()),
      h2: [...document.querySelectorAll('h2')].map((h) => h.textContent.trim()),
      check: [...document.querySelectorAll('script[src="/landlord-check.js"]')].map((s) => s.defer),
    }));

    // Long enough to answer the search, short enough that a worried landlord reads it.
    expect(facts.words, `${url} body copy is ${facts.words} words`).toBeGreaterThanOrEqual(1200);
    expect(facts.words, `${url} body copy is ${facts.words} words`).toBeLessThanOrEqual(1600);

    expect(facts.h1.length, `${url} needs exactly one h1`).toBe(1);
    expect(facts.h1[0], `${url} h1 must say who it is for`).toMatch(/landlord|tenant's/i);
    const notQuestions = facts.h2.filter((h) => !h.endsWith('?'));
    expect(notQuestions, `${url} has h2s that are not questions`).toEqual([]);

    expect(facts.check, `${url} must load /landlord-check.js once, with defer`).toEqual([true]);
  });

  test(`${url}: listed in the sitemap and in the guide list`, async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text();
    expect(xml, `${url} is missing from sitemap.xml`).toContain(`<loc>${SITE}${url}</loc>`);
    const blog = await (await request.get('/blog/index.html')).text();
    expect(blog, `${url} is missing from /blog/`).toContain(`href="${url}"`);
  });
}

test('the tenant-not-paying guide sends the landlord to the back-rent service twice', async ({ page }) => {
  await page.goto('/blog/tenant-not-paying-rent-philadelphia/');
  const links = await page.locator('article a[href="/services/back-rent/"]').count();
  expect(links, 'links to /services/back-rent/ inside the article').toBeGreaterThanOrEqual(2);
});
