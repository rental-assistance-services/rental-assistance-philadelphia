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

/** Every form on the site, and whether it sits behind the landlord/tenant gate. */
const FORMS = [
  { url: '/index.html', form: '#intake-form', gated: true },
  { url: '/index.html', form: '#contact-form', gated: true },
  { url: '/back-rent/index.html', form: '#backrent-form', gated: true },
  { url: '/services/licensing/index.html', form: '#license-form', gated: false },
  { url: '/services/licensing/index.html', form: '#tax-form', gated: false },
];
const GATED = FORMS.filter((f) => f.gated);

/**
 * The tenant help lines, written out here on purpose.
 *
 * They appear in three places — /tenants/ and the inline panel on each of the two form
 * pages — because this site inlines everything per page and has no build step. Asserting
 * them against an explicit list here means a number can only change by a deliberate edit
 * in four places, instead of silently going stale in one copy while another is updated.
 * Verified against the sources 2026-09-13.
 */
const TENANT_LINES = [
  { tel: 'tel:+12155239501', label: '215-523-9501' },   // City EDP tenant hotline
  { tel: 'tel:+12674432500', label: '(267) 443-2500' }, // Philly Tenant Hotline
  { tel: 'tel:211', label: '211' },                     // PA 211
];

/** Record every request the page makes to the intake endpoint, and answer it. */
async function stubEndpoint(page, body, { status = 200 } = {}) {
  const seen = [];
  await page.route(ENDPOINT, async (route) => {
    const req = route.request();
    seen.push({ method: req.method(), contentType: req.headers()['content-type'] || null,
      postData: req.postData() });
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  });
  return seen;
}

/**
 * Answer the gate in front of `form`. Every gated form is unreachable until you do.
 * Either answer opens the landlord-check popup (landlord-check.js): a landlord gets the
 * form itself, moved into the popup; a tenant gets the help lines.
 */
async function chooseRole(page, form, role) {
  await page.click(`[data-role-gate][data-gate-for="${form.replace('#', '')}"] .rg-btn[data-role="${role}"]`);
}

/**
 * Submit `form` the way a person does. In the popup the homepage application is shown one
 * section per step, so its submit button only exists on screen at the last step: walk
 * "Next" there first (each step validates), then click the real submit button.
 */
async function submitForm(page, form) {
  const next = page.locator('[data-landlord-check] [data-lc-next]');
  for (let i = 0; i < 12 && await next.isVisible(); i++) await next.click();
  await page.click(`${form} button[type=submit]`);
}

/** The tenant screen inside the popup. */
const tenantScreen = (page) => page.locator('[data-landlord-check] [data-lc-panel="tenant"]');

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
    // The popup asks for the owner's email twice before it counts as verified: leave the
    // field so the confirm box opens, then type it again.
    const email = f.querySelector('#owner-email');
    email.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    const confirm = document.querySelector('#owner-email-confirm');
    // Typed, not set: the retype box refuses anything that isn't a typed InputEvent (paste,
    // drop, autofill), so a bare value + plain Event would be refused like autofill.
    if (confirm) {
      confirm.value = email.value;
      confirm.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: email.value }));
    }
  });
}

/** Fill the /back-rent/ case-review form. */
async function fillBackRentForm(page) {
  await page.fill('#owner-name', 'Marcus Reed');
  await page.fill('#owner-phone', '2155550123');
  await page.fill('#owner-email', 'landlord@example.com');
  await page.fill('#owner-email-confirm', 'landlord@example.com');   // the popup's confirm box
  await page.fill('#prop-address', '1932 N 5th St, Philadelphia, PA 19122');
  await page.fill('#back-rent', '4200');
}

// This file drives the forms and their inline gates. The first-visit landlord-check popup
// (landlord-check.js, covered by tests/landlord-check.spec.js) would sit on top of all of
// them, so every test here starts as a visitor who already dismissed it — which leaves the
// inline gates unanswered, exactly the state these tests assert against.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ras_role_check', JSON.stringify({ v: 'dismissed', t: Date.now() }));
  });
  // The address box asks Photon for suggestions; tests never reach the real service.
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ type: 'FeatureCollection', features: [] }) }));
});

const dataLayerLeads = (page) =>
  page.evaluate(() => (window.dataLayer || []).filter((d) => d.event === 'lead_submit'));

const roleValue = (page, form) =>
  page.inputValue(`${form} input[name="visitor_role"]`);

test.describe('#apply form (the one that was dead)', () => {
  test('actually issues a request when submitted', async ({ page }) => {
    // THE regression test for the null-headers bug. With `headers: null` the browser
    // rejects the fetch during argument conversion and never opens a connection, so
    // `seen` stays empty and this fails — which is exactly what production did.
    const seen = await stubEndpoint(page, { ok: true, contact_id: CONTACT_ID, files_uploaded: 0,
      documents: { stored: [], rejected: [] } });
    await page.goto('/index.html');
    await chooseRole(page, '#intake-form', 'landlord');
    await fillApplyForm(page);
    await submitForm(page, '#intake-form');
    await expect.poll(() => seen.length, { timeout: 10000 }).toBe(1);
    expect(seen[0].method).toBe('POST');
    // The browser must set the multipart boundary itself — which is only possible when
    // the headers key is omitted rather than supplied.
    expect(seen[0].contentType).toMatch(/^multipart\/form-data; boundary=/);
    // The role the visitor chose rides along, so the CRM can filter landlord leads.
    expect(seen[0].postData).toContain('landlord');
  });

  test('shows the reference number the server returned, not an invented one', async ({ page }) => {
    await stubEndpoint(page, { ok: true, contact_id: CONTACT_ID, files_uploaded: 0,
      documents: { stored: [], rejected: [] } });
    await page.goto('/index.html');
    await chooseRole(page, '#intake-form', 'landlord');
    await fillApplyForm(page);
    await submitForm(page, '#intake-form');
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
      await chooseRole(page, '#intake-form', 'landlord');
      await fillApplyForm(page);
      await page.setInputFiles('#doc-lease', { name: 'lease.pdf', mimeType: 'application/pdf', buffer: PDF });
      await page.setInputFiles('#doc-ledger', { name: 'ledger.pdf', mimeType: 'application/pdf', buffer: PDF });
      await submitForm(page, '#intake-form');

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
      await chooseRole(page, '#intake-form', 'landlord');
      await fillApplyForm(page);
      await submitForm(page, '#intake-form');

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
      await chooseRole(page, '#intake-form', 'landlord');
      await fillApplyForm(page);
      await submitForm(page, '#intake-form');
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
      await chooseRole(page, '#intake-form', 'landlord');
      await fillApplyForm(page);
      await submitForm(page, '#intake-form');
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
    await chooseRole(page, '#intake-form', 'landlord');
    // nothing filled in — submit the whole form directly, skipping the per-step checks
    await page.locator('#intake-form').evaluate((f) => f.requestSubmit());
    await expect(page.locator('#form-status')).toContainText('Please fix', { timeout: 10000 });
    expect(await dataLayerLeads(page)).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  test('a network failure books NOTHING', async ({ page }) => {
    await page.route(ENDPOINT, (route) => route.abort('failed'));
    await page.goto('/index.html');
    await chooseRole(page, '#intake-form', 'landlord');
    await fillApplyForm(page);
    await submitForm(page, '#intake-form');
    await expect(page.locator('#form-status')).toContainText('(215) 402-6882', { timeout: 10000 });
    expect(await dataLayerLeads(page)).toHaveLength(0);
  });

  test('a 200 with no contact id books NOTHING', async ({ page }) => {
    // A tripped honeypot is answered with a bare {"ok":true} and saves nothing. Bots
    // trip it constantly, so counting a 200 alone would book a conversion per bot.
    await stubEndpoint(page, { ok: true });
    await page.goto('/index.html');
    await chooseRole(page, '#intake-form', 'landlord');
    await fillApplyForm(page);
    await submitForm(page, '#intake-form');
    await expect(page.locator('.callout[role=status]')).toBeVisible({ timeout: 10000 });
    expect(await dataLayerLeads(page)).toHaveLength(0);
  });

  test('a saved lead whose role is NOT landlord books NOTHING — even though it saved',
    async ({ page }) => {
      // The adversarial case, and the one that matters: the gate is client-side, so
      // assume it was bypassed. Here the role is forced to 'tenant', the form is forced
      // open, and the endpoint answers with a real contact id — i.e. the lead genuinely
      // saved. The POST must go through (we do not silently drop a human) and the Google
      // Ads conversion must NOT. Two of the four conversions this account recorded
      // 25–31 Aug 2026 came from tenant-side queries; a tenant can never be a customer,
      // so a tenant conversion is a phantom that Smart Bidding then optimises toward.
      const seen = await stubEndpoint(page, { ok: true, contact_id: CONTACT_ID, files_uploaded: 0,
        documents: { stored: [], rejected: [] } });
      await page.goto('/index.html');
      await chooseRole(page, '#intake-form', 'landlord');   // open the form the normal way
      await page.evaluate(() => {                            // then tamper with the role
        document.querySelector('#intake-form input[name="visitor_role"]').value = 'tenant';
      });
      await fillApplyForm(page);
      await submitForm(page, '#intake-form');
      await expect(page.locator('.callout[role=status]')).toBeVisible({ timeout: 10000 });

      expect(seen).toHaveLength(1);                 // the lead WAS sent and saved
      expect(await dataLayerLeads(page)).toHaveLength(0);   // and booked no conversion
    });

  test('/back-rent/: a landlord books one conversion, a tampered tenant role books none',
    async ({ page }) => {
      await stubEndpoint(page, { ok: true, contact_id: CONTACT_ID });
      await page.goto('/back-rent/index.html');
      await chooseRole(page, '#backrent-form', 'landlord');
      await fillBackRentForm(page);
      await page.click('#backrent-form button[type=submit]');
      await expect(page.locator('.confirm')).toBeVisible({ timeout: 10000 });
      let leads = await dataLayerLeads(page);
      expect(leads).toHaveLength(1);
      expect(leads[0].form_id).toBe('backrent-form');
      expect(leads[0].lead_value).toBe(600);

      // same page, role tampered
      await page.goto('/back-rent/index.html');
      await chooseRole(page, '#backrent-form', 'landlord');
      await page.evaluate(() => {
        document.querySelector('#backrent-form input[name="visitor_role"]').value = 'tenant';
      });
      await fillBackRentForm(page);
      await page.click('#backrent-form button[type=submit]');
      await expect(page.locator('.confirm')).toBeVisible({ timeout: 10000 });
      expect(await dataLayerLeads(page)).toHaveLength(0);
    });
});

test.describe('landlord / tenant gate', () => {
  for (const { url, form } of GATED) {
    test(`${url} ${form}: unreachable until a role is chosen`, async ({ page }) => {
      await page.goto(url);
      await expect(page.locator(form)).toBeHidden();
      await expect(page.locator(`[data-role-gate][data-gate-for="${form.replace('#', '')}"]`))
        .toBeVisible();
      // No role has been claimed on the visitor's behalf.
      expect(await roleValue(page, form)).toBe('');
    });

    test(`${url} ${form}: landlord opens the form in the popup and stamps the role`, async ({ page }) => {
      await page.goto(url);
      await chooseRole(page, form, 'landlord');
      // The form is filled in the popup, never on the page.
      await expect(page.locator(`[data-landlord-check] ${form}`)).toBeVisible();
      expect(await roleValue(page, form)).toBe('landlord');
      // A `.reveal` form that is un-hidden without its `in` class sits at opacity 0
      // forever, because the IntersectionObserver that adds `in` never fires for an
      // element with no layout box.
      const opacity = await page.locator(form).evaluate((el) => getComputedStyle(el).opacity);
      expect(Number(opacity)).toBeGreaterThan(0.9);
      // The submit button must be reachable and clickable, not merely present — for the
      // stepped homepage application that means walking to its last step.
      if (form === '#intake-form') await fillApplyForm(page);
      const next = page.locator('[data-landlord-check] [data-lc-next]');
      for (let i = 0; i < 12 && await next.isVisible(); i++) await next.click();
      await expect(page.locator(`${form} button[type=submit]`)).toBeVisible();
    });

    test(`${url} ${form}: tenant gets the resources, no form, and POSTs nothing`,
      async ({ page }) => {
        const seen = await stubEndpoint(page, { ok: true, contact_id: CONTACT_ID });
        await page.goto(url);
        await chooseRole(page, form, 'tenant');

        await expect(page.locator(form)).toBeHidden();
        const panel = tenantScreen(page);
        await expect(panel).toBeVisible();
        // It says what we are, and points at services that can actually help.
        await expect(panel).toContainText('hired by');
        await expect(panel).toContainText('the landlord has to apply');
        for (const line of TENANT_LINES) {
          await expect(panel.locator(`a[href="${line.tel}"]`)).toHaveText(line.label);
        }
        await expect(panel.locator('a[href="/tenants/"]')).toHaveCount(1);

        // Nothing was sent, so there is no CRM row and no conversion to book.
        await page.waitForTimeout(500);
        expect(seen).toHaveLength(0);
        expect(await dataLayerLeads(page)).toHaveLength(0);
      });

    test(`${url} ${form}: closing the popup puts the form back, hidden, behind an unanswered gate`,
      async ({ page }) => {
        await page.goto(url);
        await chooseRole(page, form, 'landlord');
        await expect(page.locator(`[data-landlord-check] ${form}`)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-landlord-check]')).toHaveCount(0);
        await expect(page.locator(form)).toBeHidden();
        await expect(page.locator(`[data-role-gate][data-gate-for="${form.replace('#', '')}"]`))
          .not.toHaveClass(/chosen/);
      });
  }

  test('the two landlord-by-definition intakes carry the role without a gate',
    async ({ page }) => {
      // A rental license and a city business-tax account are issued to the OWNER, so
      // these two cannot plausibly be filled by a tenant and are not gated. They still
      // have to carry the role, or the CRM cannot filter on it uniformly.
      await page.goto('/services/licensing/index.html');
      for (const { form } of FORMS.filter((f) => !f.gated)) {
        expect(await roleValue(page, form)).toBe('landlord');
        await expect(page.locator(`[data-gate-for="${form.replace('#', '')}"]`)).toHaveCount(0);
      }
    });

  test('every form on the site carries a visitor_role field', async ({ page }) => {
    // If a new form is added without one, its leads land in the CRM unattributed and —
    // because rasTrackLead requires an explicit landlord role — book no conversion at all.
    for (const { url, form } of FORMS) {
      await page.goto(url);
      await expect(page.locator(`${form} input[name="visitor_role"]`)).toHaveCount(1);
    }
  });

  test('tenant help lines are never tracked as a phone_click conversion', async ({ page }) => {
    // phone_click feeds the "Phone Call from Ads" conversion action. These are someone
    // else's phone numbers, dialled by someone we cannot sell to.
    await page.goto('/index.html');
    await chooseRole(page, '#contact-form', 'tenant');
    await expect(tenantScreen(page)).toBeVisible();
    for (const line of TENANT_LINES) {
      await expect(tenantScreen(page).locator(`a[href="${line.tel}"]`))
        .toHaveAttribute('data-no-track', '');
    }
    await page.evaluate(() => {
      document.querySelector('[data-lc-panel="tenant"] a[href^="tel:"]').click();
    });
    await page.keyboard.press('Escape');
    const calls = await page.evaluate(
      () => (window.dataLayer || []).filter((d) => d.event === 'phone_click'));
    expect(calls).toHaveLength(0);

    // ...while our own number still is tracked, so the fix did not break the tag.
    await page.evaluate(() => {
      document.querySelector('a[href="tel:+12154026882"]:not([data-no-track])').click();
    });
    const ours = await page.evaluate(
      () => (window.dataLayer || []).filter((d) => d.event === 'phone_click'));
    expect(ours).toHaveLength(1);
  });
});

test.describe('the tenant page and the panels agree', () => {
  test('/tenants/ lists the same help lines as the inline panels', async ({ page }) => {
    // Three copies of these numbers exist because the site inlines everything per page.
    // This is what stops one of them going stale.
    await page.goto('/tenants/index.html');
    for (const line of TENANT_LINES) {
      await expect(page.locator(`a[href="${line.tel}"]`).first()).toHaveText(line.label);
    }
    await expect(page.locator('body')).toContainText('the landlord files it, not you');
  });

  test('the popup\'s tenant screen lists the same help lines', async ({ page }) => {
    // A fourth copy: landlord-check.js carries them so the tenant screen also works on the
    // blog, which has no inline panel to borrow from.
    await page.goto('/index.html');
    await page.locator('#nav-links a.cta').evaluate((a) => a.click());
    await page.getByRole('button', { name: /I rent my home/ }).click();
    for (const line of TENANT_LINES) {
      await expect(tenantScreen(page).locator(`a[href="${line.tel}"]`)).toHaveText(line.label);
    }
  });

  test('/tenants/ has no form and books no conversion', async ({ page }) => {
    await page.goto('/tenants/index.html');
    await expect(page.locator('form')).toHaveCount(0);
    expect(await dataLayerLeads(page)).toHaveLength(0);
  });

  test('every page offers a tenant a way out', async ({ page }) => {
    const PAGES = ['/index.html', '/services/back-rent/index.html',
      '/services/licensing/index.html', '/portal/index.html', '/faq/index.html',
      '/back-rent/index.html', '/blog/index.html',
      '/blog/eviction-diversion-program/index.html', '/blog/tfa-back-rent-recovery/index.html',
      '/blog/philadelphia-rental-license-requirements/index.html',
      '/blog/commercial-activity-license/index.html',
      '/blog/certificate-of-rental-suitability/index.html',
      '/blog/lead-safe-certification/index.html'];
    for (const url of PAGES) {
      await page.goto(url);
      expect(await page.locator('a[href="/tenants/"]').count(),
        `${url} has no /tenants/ link`).toBeGreaterThan(0);
    }
  });
});

test.describe('the fee terms the consent checkbox points at', () => {
  test('the agree-terms link resolves to a real page that states the fee', async ({ page }) => {
    // This 404'd from launch until 2026-09-13 while the checkbox above it said "I have
    // read and agree to" it — fee consent collected against a document nobody published.
    await page.goto('/index.html');
    const href = await page.locator('#agree-terms ~ label a, label[for=agree-terms] a')
      .first().getAttribute('href');
    expect(href).toBe('/terms.html');
    const res = await page.goto(href);
    expect(res.status()).toBe(200);
    await expect(page.locator('body')).toContainText('33% of the funds the City pays');
    await expect(page.locator('body')).toContainText('If the City does not pay, you owe us nothing');
    // It must not claim to be the signed agreement it summarises.
    await expect(page.locator('body')).toContainText('full Service Agreement');
  });

  test('the live #backrent-form sitelink still lands on the form card', async ({ page }) => {
    // A Google Ads sitelink points at /back-rent/#backrent-form. That element is now
    // `hidden` until the gate is answered, and a browser cannot scroll to an element with
    // no layout box — so a paid click would otherwise land silently at the top of the page.
    //
    // The assertion is `scrollY > 0`, not "the card is near the top". At desktop width the
    // card sits in the hero grid and is near the top whether or not anything scrolled, so
    // a position check passes either way and proves nothing. Landing on a hash and NOT
    // moving is precisely the broken behaviour.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/back-rent/index.html#backrent-form');
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const box = await page.locator('#form-card').boundingBox();
    expect(box.y).toBeLessThan(200);   // and it is what we scrolled TO
    await expect(page.locator('[data-role-gate][data-gate-for="backrent-form"]')).toBeVisible();
  });

  test('/back-rent/ states the fee and now links the terms', async ({ page }) => {
    // The ads land here, and this page stated the 33% fee with no terms link at all.
    await page.goto('/back-rent/index.html');
    await chooseRole(page, '#backrent-form', 'landlord');
    await expect(page.locator('#backrent-form a[href="/terms.html"]')).toHaveCount(1);
  });
});

test.describe('honeypot', () => {
  for (const { url, form } of FORMS) {
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
    await chooseRole(page, '#contact-form', 'landlord');
    await page.fill('#c-hp-x7f2', 'Acme Corp');
    await page.fill('#c-name', 'Spam Bot');
    await page.fill('#c-phone', '2155550123');
    await page.click('#contact-form button[type=submit]');
    await page.waitForTimeout(1000);
    expect(seen).toHaveLength(0);       // the contact form drops it client-side
  });

  test('/back-rent/: the decoy still suppresses a bot submit', async ({ page }) => {
    const seen = await stubEndpoint(page, { ok: true, contact_id: CONTACT_ID });
    await page.goto('/back-rent/index.html');
    await chooseRole(page, '#backrent-form', 'landlord');
    await page.fill('#hp-x7f2', 'Acme Corp');
    await fillBackRentForm(page);
    await page.click('#backrent-form button[type=submit]');
    await page.waitForTimeout(1000);
    expect(seen).toHaveLength(0);
    expect(await dataLayerLeads(page)).toHaveLength(0);
  });
});
