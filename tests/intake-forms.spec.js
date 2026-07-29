/**
 * Real-browser regression suite for the intake forms.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The #apply form was dead from the day it launched: it passed `headers: null` into
 * fetch(), argument conversion rejected that, and the browser never issued a request.
 * Zero applications arrived in 41 days.
 *
 * Three separate investigations tested the endpoint with curl, saw a CORS error, and
 * shipped "it's just CORS". curl does not execute this page's JavaScript, so it sails
 * straight past the bug that was actually killing the reported form. Every assertion
 * below therefore runs in a REAL browser, driving the REAL page, by clicking the REAL
 * submit button. An HTTP-client test of the endpoint proves nothing about any of it.
 *
 * SCOPE NOTE — CORS is deliberately NOT asserted here. These tests fulfil the endpoint
 * with page.route(), and request interception does not reproduce the browser's real
 * preflight gating (an intercepted POST is delivered even when the server would have
 * rejected the preflight). The CORS allowlist is covered server-side, where it lives, by
 * Rio/Engine/api/test_rental_assist_public_site.py, which sends a genuine preflight.
 * What this file owns is the half that only a browser can see: that a request is issued
 * at all, and what the page does with the answer.
 */
const { test, expect } = require('@playwright/test');

const ENDPOINT = 'https://rio.tworiverdevelopment.tech/rental-assist/intake';
const CONTACT_ID = '8e13f70d-b1e4-474e-a0b0-c12df3ec01d5';

const PDF = Buffer.from('%PDF-1.4\n% test fixture\n%%EOF\n');

/** Record every request the page makes to the intake endpoint, and answer it. */
async function stubEndpoint(page, body, { status = 200 } = {}) {
  const seen = [];
  await page.route(ENDPOINT, async (route) => {
    const req = route.request();
    seen.push({ method: req.method(), contentType: req.headers()['content-type'] || null });
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  });
  return seen;
}

/** Fill everything the intake form validates, without touching the honeypot. */
async function fillApplyForm(page) {
  await page.evaluate(() => {
    const f = document.querySelector('#intake-form');
    const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    f.querySelectorAll('input,select,textarea').forEach((el) => {
      if (el.type === 'file' || el.type === 'hidden' || el.name === 'hp_x7f2') return;
      if (el.type === 'checkbox') { if (el.required) el.checked = true; return; }
      if (el.type === 'radio' || el.tagName === 'SELECT') return;
      if (el.type === 'email') return set(el, 'landlord@example.com');
      if (el.type === 'tel') return set(el, '2155550123');
      if (el.type === 'number') return set(el, '1');
      if (el.type === 'date') return set(el, '2026-01-01');
      if (el.required) set(el, 'Test Value');
    });
  });
}

const dataLayerLeads = (page) =>
  page.evaluate(() => (window.dataLayer || []).filter((d) => d.event === 'lead_submit'));

test.describe('#apply form (the one that was dead)', () => {
  test('actually issues a request when submitted', async ({ page }) => {
    // THE regression test for the null-headers bug. With `headers: null` the browser
    // rejects the fetch during argument conversion and never opens a connection, so
    // `seen` stays empty and this fails — which is exactly what production did.
    const seen = await stubEndpoint(page, { ok: true, contact_id: CONTACT_ID, files_uploaded: 0,
      documents: { stored: [], rejected: [] } });
    await page.goto('/index.html');
    await fillApplyForm(page);
    await page.click('#intake-form button[type=submit]');
    await expect.poll(() => seen.length, { timeout: 10000 }).toBe(1);
    expect(seen[0].method).toBe('POST');
    // The browser must set the multipart boundary itself — which is only possible when
    // the headers key is omitted rather than supplied.
    expect(seen[0].contentType).toMatch(/^multipart\/form-data; boundary=/);
  });

  test('shows the reference number the server returned, not an invented one', async ({ page }) => {
    await stubEndpoint(page, { ok: true, contact_id: CONTACT_ID, files_uploaded: 0,
      documents: { stored: [], rejected: [] } });
    await page.goto('/index.html');
    await fillApplyForm(page);
    await page.click('#intake-form button[type=submit]');
    const panel = page.locator('.callout[role=status]');
    await expect(panel).toContainText(`reference ${CONTACT_ID}`, { timeout: 10000 });
    // The old code minted 'RAS-<date>-<random>', which existed in no system we own, so
    // an applicant quoting it could not be found by anybody.
    await expect(panel).not.toContainText('RAS-');
  });

  test('"Still needed" reflects what the SERVER stored, not what the browser attached',
    async ({ page }) => {
      // The applicant attaches two documents; the server keeps one and drops the other
      // (oversize). The page must not claim we have the dropped one.
      await stubEndpoint(page, {
        ok: true, contact_id: CONTACT_ID, files_uploaded: 1,
        documents: {
          stored: ['doc_lease'],
          rejected: [{ field: 'doc_ledger', filename: 'ledger.pdf', reason: 'too_large' }],
        },
      });
      await page.goto('/index.html');
      await fillApplyForm(page);
      await page.setInputFiles('#doc-lease', { name: 'lease.pdf', mimeType: 'application/pdf', buffer: PDF });
      await page.setInputFiles('#doc-ledger', { name: 'ledger.pdf', mimeType: 'application/pdf', buffer: PDF });
      await page.click('#intake-form button[type=submit]');

      const panel = page.locator('.callout[role=status]');
      await expect(panel).toBeVisible({ timeout: 10000 });
      const text = await panel.innerText();
      // the kept document is not requested again
      expect(text).not.toMatch(/Still needed:[^\n]*Signed lease/);
      // the dropped one is surfaced explicitly, even though the browser did attach it
      expect(text).toMatch(/Please re-send:[^\n]*Rent ledger/);
    });

  test('a technical failure shows human copy and logs the detail to the console',
    async ({ page }) => {
      const logged = [];
      page.on('console', (m) => { if (m.type() === 'error') logged.push(m.text()); });
      await page.route(ENDPOINT, (route) => route.abort('failed'));
      await page.goto('/index.html');
      await fillApplyForm(page);
      await page.click('#intake-form button[type=submit]');

      const status = page.locator('#form-status');
      await expect(status).toContainText('(215) 402-6882', { timeout: 10000 });
      // Never the raw browser string a landlord was being shown.
      await expect(status).not.toContainText('Failed to fetch');
      await expect(status).not.toContainText('ByteString');
      expect(logged.join(' ')).toContain('[RAS] submit failed');
    });

  test('a server-authored message IS shown, because it is written for the applicant',
    async ({ page }) => {
      await stubEndpoint(page, { error: 'missing_required', reply: 'Please give your name and a phone or email.' },
        { status: 400 });
      await page.goto('/index.html');
      await fillApplyForm(page);
      await page.click('#intake-form button[type=submit]');
      await expect(page.locator('#form-status'))
        .toContainText('Please give your name and a phone or email.', { timeout: 10000 });
    });
});

test.describe('conversion tracking fires only on a confirmed save', () => {
  test('a successful submit books exactly one conversion, keyed to the contact id',
    async ({ page }) => {
      await stubEndpoint(page, { ok: true, contact_id: CONTACT_ID, files_uploaded: 0,
        documents: { stored: [], rejected: [] } });
      await page.goto('/index.html');
      await fillApplyForm(page);
      await page.click('#intake-form button[type=submit]');
      await expect(page.locator('.callout[role=status]')).toBeVisible({ timeout: 10000 });

      const leads = await dataLayerLeads(page);
      expect(leads).toHaveLength(1);
      expect(leads[0].form_id).toBe('intake-form');
      expect(leads[0].lead_value).toBe(600);
      // the CRM id doubles as the Ads dedup key
      expect(leads[0].transaction_id).toBe(CONTACT_ID);
    });

  test('a submit that fails validation books NOTHING', async ({ page }) => {
    // This is the $600 bug. The tracking used to run from a document-level listener in
    // the CAPTURE phase, so it fired before validation and before the network call —
    // an empty form booked a conversion.
    const seen = await stubEndpoint(page, { ok: true, contact_id: CONTACT_ID });
    await page.goto('/index.html');
    await page.click('#intake-form button[type=submit]');   // nothing filled in
    await expect(page.locator('#form-status')).toContainText('Please fix', { timeout: 10000 });
    expect(await dataLayerLeads(page)).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  test('a network failure books NOTHING', async ({ page }) => {
    await page.route(ENDPOINT, (route) => route.abort('failed'));
    await page.goto('/index.html');
    await fillApplyForm(page);
    await page.click('#intake-form button[type=submit]');
    await expect(page.locator('#form-status')).toContainText('(215) 402-6882', { timeout: 10000 });
    expect(await dataLayerLeads(page)).toHaveLength(0);
  });

  test('a 200 with no contact id books NOTHING', async ({ page }) => {
    // A tripped honeypot is answered with a bare {"ok":true} and saves nothing. Bots
    // trip it constantly, so counting a 200 alone would book a conversion per bot.
    await stubEndpoint(page, { ok: true });
    await page.goto('/index.html');
    await fillApplyForm(page);
    await page.click('#intake-form button[type=submit]');
    await expect(page.locator('.callout[role=status]')).toBeVisible({ timeout: 10000 });
    expect(await dataLayerLeads(page)).toHaveLength(0);
  });
});

test.describe('honeypot', () => {
  const PAGES = [
    { url: '/index.html', form: '#intake-form' },
    { url: '/index.html', form: '#license-form' },
    { url: '/index.html', form: '#tax-form' },
    { url: '/index.html', form: '#contact-form' },
    { url: '/back-rent/index.html', form: '#backrent-form' },
  ];

  for (const { url, form } of PAGES) {
    test(`${form} carries no field named "company"`, async ({ page }) => {
      // `company` is the exact token Chrome/Safari autofill target for the organization
      // field, and autocomplete="off" is widely ignored for saved address profiles. A
      // filled honeypot makes the server 200-OK and DISCARD the application while the
      // page says "Application received", so a false positive is silent data loss.
      await page.goto(url);
      await expect(page.locator(`${form} input[name="company"]`)).toHaveCount(0);
      await expect(page.locator(`${form} input[name="hp_x7f2"]`)).toHaveCount(1);
    });
  }

  test('the decoy is still wired up and still suppresses a bot submit', async ({ page }) => {
    const seen = await stubEndpoint(page, { ok: true, contact_id: CONTACT_ID });
    await page.goto('/index.html');
    await page.fill('#c-hp-x7f2', 'Acme Corp');
    await page.fill('#c-name', 'Spam Bot');
    await page.fill('#c-phone', '2155550123');
    await page.click('#contact-form button[type=submit]');
    await page.waitForTimeout(1000);
    expect(seen).toHaveLength(0);       // the contact form drops it client-side
  });
});
