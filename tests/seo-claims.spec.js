/**
 * What the site says about the City's program matches what the City says, word for word.
 *
 * Re-reading the guides against eviction-diversion.phila.gov on 2026-10-02 turned up a claim
 * the City contradicts: that $3,500 is "a cap on recoverable back rent, not an eligibility
 * ceiling" and a landlord owed more "still qualifies". The City's own pages say the arrears on
 * a TFA application must be $3,500 or less, and that a landlord owed more may agree to waive the
 * amount over $3,500 to be considered (https://eviction-diversion.phila.gov/FAQ, "What are the
 * eligibility requirements for Targeted Financial Assistance?" and "What should be included in
 * the 'Arrears' on the application?").
 *
 * The corrected wording is fixed: one long form for body copy, one short note for the apply and
 * contact sections, one sentence for the legal block, and one citation for the ordinance. Other
 * pages copy them, so this file holds every page to the same bytes: a page may leave a claim
 * out, but where it makes one it uses the canonical text. The old wording must not come back.
 *
 * The page list is read off disk, so a page added later is covered without anyone having to
 * remember this file.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const LEAD = 'Owed more than $3,500?';
const BODY = `${LEAD} You can still be considered. The City's limit is on the arrears you claim: you may agree to waive the amount over $3,500 and show it as forgiven on your ledger. You still receive the two months of future rent, provided the tenant stays in the unit for those two months.`;
const SHORT = `${LEAD} You can still be considered if you agree to waive the amount over $3,500.`;
const LIMIT = "The City's limit is on the arrears you claim: you may agree to waive the amount over $3,500 and show it as forgiven on your ledger.";
const LEGAL = "The $3,500 figure is the City's limit on the arrears a TFA application can claim; a landlord owed more may waive the excess to be considered.";
const ORDINANCE = '(Phila. Code § 9-811, as amended by Bill No. 240245, approved June 12, 2024)';
const OLD = [/not an eligibility ceiling/i, /not an eligibility cutoff/i, /you still qualify/i];

// The tenant page makes no claim for landlords and is reviewed separately.
const EXCLUDED = new Map([
  ['/tenants/index.html', 'the tenant page; not part of the landlord copy'],
]);
// TODO(Task 3): these pages still carry the old $3,500 wording or the old ordinance citation.
// Task 3 brings them into line; delete each entry as it lands so the checks cover it.
const PENDING = new Map([
  ['/index.html', 'Task 3'],
  ['/faq/index.html', 'Task 3'],
  ['/portal/index.html', 'Task 3'],
  ['/services/back-rent/index.html', 'Task 3'],
  ['/services/licensing/index.html', 'Task 3'],
  ['/back-rent/index.html', 'Task 3 (correction approved by Kean)'],
  ['/terms.html', 'needs Kean: terms.html is off-limits to the SEO tasks; cites Ordinance #220655'],
]);

// Every page that talks about back rent, the Eviction Diversion Program or Targeted Financial
// Assistance sells the filing, so its legal block carries the fee and says the City option is free
// to apply for directly. The ads page, the tenant page and the terms are reviewed on their own.
const SELLS = /back rent|eviction diversion|targeted financial assistance/i;
const FEE = '33% of the funds the City pays';
const FREE = /directly with the City yourself/i;
const DISCLOSURE_OUT = new Set(['/back-rent/index.html', '/tenants/index.html', '/terms.html']);
// TODO(Task 2): the guide index gets both lines in 8cf63b7 on seo/task-2-guide-links; delete this
// entry once that lands.
const DISCLOSURE_PENDING = new Map([
  ['/blog/index.html', 'Task 2 (8cf63b7)'],
]);

/** Every page of the site, as the path it is served at (same walk as tests/seo.spec.js). */
function sitePages(dir = ROOT, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'tests') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sitePages(full, out);
    else if (entry.name.endsWith('.html') && !/^google[a-z0-9]+\.html$/.test(entry.name)) {
      out.push('/' + path.relative(ROOT, full).split(path.sep).join('/'));
    }
  }
  return out;
}

/** The page's words as a reader (or a search engine reading the JSON-LD) gets them. */
async function textOf(page, url) {
  await page.goto(url);
  return page.evaluate(() => {
    const squash = (s) => s.replace(/\s+/g, ' ');
    const visible = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest('script, style, noscript') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) visible.push(n.textContent);
    const legal = document.querySelector('.foot-legal') || document.querySelector('footer');
    return {
      all: squash([visible.join(''), ...[...document.querySelectorAll('script[type="application/ld+json"]')]
        .map((s) => s.textContent)].join(' ')),
      legal: legal ? squash(legal.textContent) : '',
    };
  });
}

/** Each place `needle` appears, with the text that follows it. */
function occurrences(text, needle, length) {
  const out = [];
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) out.push(text.slice(i, i + length));
  return out;
}

for (const url of sitePages()) {
  if (EXCLUDED.has(url)) continue;
  const pending = PENDING.get(url);
  const pendingTest = pending ? test.fixme : test;
  const pendingNote = pending ? ` (TODO: ${pending})` : '';

  pendingTest(`${url}: where it makes a $3,500 claim, it uses the canonical wording${pendingNote}`, async ({ page }) => {
    const { all } = await textOf(page, url);

    for (const at of occurrences(all, LEAD, BODY.length)) {
      expect(at.startsWith(BODY) || at.startsWith(SHORT),
        `${url}: "${LEAD}" must be followed by the canonical body text or short note, found: ${at}`).toBe(true);
    }
    for (const at of occurrences(all, "The City's limit is on the arrears you claim", LIMIT.length)) {
      expect(at, `${url}: the arrears-limit sentence has drifted`).toBe(LIMIT);
    }
    if (all.includes('$3,500') && /waive/i.test(all)) {
      expect(all.includes(LEGAL), `${url} mentions waiving over $3,500, so it must carry the legal sentence: ${LEGAL}`).toBe(true);
    }
  });

  pendingTest(`${url}: the old $3,500 wording is gone${pendingNote}`, async ({ page }) => {
    const { all } = await textOf(page, url);
    for (const old of OLD) expect(all, `${url} still says ${old}`).not.toMatch(old);
  });

  pendingTest(`${url}: a legal block that cites § 9-811 uses the canonical citation${pendingNote}`, async ({ page }) => {
    const { legal } = await textOf(page, url);
    if (!legal.includes('9-811')) return;
    expect(legal.includes(ORDINANCE), `${url} legal block must cite ${ORDINANCE}`).toBe(true);
    expect(legal, `${url} legal block still cites the 2022 amendment as the ordinance`).not.toMatch(/Ordinance #220655/);
  });

  if (DISCLOSURE_OUT.has(url)) continue;
  const held = DISCLOSURE_PENDING.get(url) || pending;
  (held ? test.fixme : test)(`${url}: a page about back rent carries the fee and free-to-apply lines${held ? ` (TODO: ${held})` : ''}`, async ({ page }) => {
    const { all, legal } = await textOf(page, url);
    if (!SELLS.test(all)) return;
    expect(legal.includes(FEE), `${url} legal block must state the fee: "${FEE}"`).toBe(true);
    expect(legal, `${url} legal block must say the City option can be applied for directly`).toMatch(FREE);
  });
}
