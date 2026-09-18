/**
 * The first-visit landlord-check popup (landlord-check.js).
 *
 * Most visitors to this site are tenants, because the brand is a tenant's search term. The
 * popup asks "own or rent?" on the first page a visitor lands on, sends tenants to
 * /tenants/ without sending anything, and walks a landlord through the same questions as
 * the homepage's "Request your free case review" form.
 *
 * Every assertion runs in a real browser against the real page, for the same reason as
 * intake-forms.spec.js: the failures that matter here are client-side.
 */
const { test, expect } = require('@playwright/test');

const ENDPOINT = 'https://rio.tworiverdevelopment.tech/rental-assist/intake';
const CONTACT_ID = '5b0c2f4e-3a51-4f0e-9d8c-7c1e0a2d4b61';

/** Every page a visitor can land on from search or an ad — the popup belongs on all of them. */
const LANDING = [
  '/index.html',
  '/back-rent/index.html',
  '/blog/index.html',
  '/blog/certificate-of-rental-suitability/index.html',
  '/blog/commercial-activity-license/index.html',
  '/blog/eviction-diversion-program/index.html',
  '/blog/lead-safe-certification/index.html',
  '/blog/philadelphia-rental-license-requirements/index.html',
  '/blog/tfa-back-rent-recovery/index.html',
];
/** Pages that must never carry it: the tenant help page, and the terms a form links to. */
const NOT_LANDING = ['/tenants/index.html', '/terms.html'];

const popup = (page) => page.locator('[data-landlord-check]');
const dialog = (page) => page.getByRole('dialog');

async function stubEndpoint(page, body, { status = 200 } = {}) {
  const seen = [];
  await page.route(ENDPOINT, async (route) => {
    seen.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  return seen;
}

const leads = (page) =>
  page.evaluate(() => (window.dataLayer || []).filter((d) => d.event === 'lead_submit'));
const lcEvents = (page) =>
  page.evaluate(() => (window.dataLayer || []).filter((d) => d.event === 'landlord_check'));
const stored = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('ras_role_check') || 'null'));

/** The step the progress bar currently marks, e.g. "Your rental". */
const currentStep = (page) => page.locator('[data-lc-dot][aria-current="step"] .lc-lbl').textContent();

/** Landlord path up to the final step. */
async function walkToLastStep(page) {
  await page.getByRole('button', { name: /I own or manage rental property/ }).click();
  await page.fill('#lc-units', '3');
  await page.fill('#lc-balance', '$4,200');
  await page.getByRole('button', { name: 'Next →' }).click();
  await page.fill('#lc-name', 'Marcus Reed');
  await page.fill('#lc-phone', '(215) 555-0123');
  await page.fill('#lc-email', 'landlord@example.com');
  await page.getByRole('button', { name: 'Next →' }).click();
  await page.fill('#lc-message', 'Tenant is four months behind.');
}

test.describe('where it appears', () => {
  for (const url of LANDING) {
    test(`${url}: opens on a first visit, asking own or rent`, async ({ page }) => {
      await page.goto(url);
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page)).toContainText('do you own or rent?');
      expect(await currentStep(page)).toBe('Who you are');
    });
  }

  for (const url of NOT_LANDING) {
    test(`${url}: never shows the popup`, async ({ page }) => {
      await page.goto(url);
      await page.waitForTimeout(1200);
      await expect(popup(page)).toHaveCount(0);
    });
  }

  test('closing it is remembered — the next page does not ask again', async ({ page }) => {
    await page.goto('/index.html');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(popup(page)).toHaveCount(0);
    expect((await stored(page)).v).toBe('dismissed');
    await page.goto('/blog/index.html');
    await page.waitForTimeout(1200);
    await expect(popup(page)).toHaveCount(0);
  });

  test('Escape closes it and returns the page to scrolling', async ({ page }) => {
    await page.goto('/index.html');
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popup(page)).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/lc-lock/);
  });

  test('keyboard focus stays inside the dialog, both directions', async ({ page }) => {
    for (const key of ['Tab', 'Shift+Tab']) {
      await page.goto('/index.html');
      await expect(dialog(page)).toBeVisible();
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press(key);
        expect(await page.evaluate(() => !!document.activeElement.closest('[data-landlord-check]'))).toBe(true);
      }
    }
  });

  test('neither answer looks pre-selected when it opens', async ({ page }) => {
    await page.goto('/index.html');
    await expect(dialog(page)).toBeFocused();
  });
});

test.describe('tenant', () => {
  test('gets pointed to free help, POSTs nothing and books nothing', async ({ page }) => {
    const seen = await stubEndpoint(page, { ok: true, contact_id: CONTACT_ID });
    await page.goto('/index.html');
    await page.getByRole('button', { name: /I rent my home/ }).click();
    await expect(dialog(page)).toContainText('the landlord has to apply');
    await expect(page.getByRole('link', { name: /See free help for tenants/ })).toHaveAttribute('href', '/tenants/');
    expect(seen).toHaveLength(0);
    expect(await leads(page)).toHaveLength(0);
    expect((await stored(page)).v).toBe('tenant');
    // and is not asked again on the next page
    await page.goto('/back-rent/index.html');
    await page.waitForTimeout(1200);
    await expect(popup(page)).toHaveCount(0);
  });
});

test.describe('landlord', () => {
  test('the progress bar walks through all four steps', async ({ page }) => {
    await page.goto('/index.html');
    expect(await currentStep(page)).toBe('Who you are');
    await page.getByRole('button', { name: /I own or manage rental property/ }).click();
    expect(await currentStep(page)).toBe('Your rental');
    await page.getByRole('button', { name: 'Next →' }).click();
    expect(await currentStep(page)).toBe('Your contact');
    await page.fill('#lc-name', 'Marcus Reed');
    await page.fill('#lc-phone', '2155550123');
    await page.fill('#lc-email', 'landlord@example.com');
    await page.getByRole('button', { name: 'Next →' }).click();
    expect(await currentStep(page)).toBe('Anything else');
    await expect(page.locator('[data-lc-dot].is-done')).toHaveCount(3);
    await page.getByRole('button', { name: '← Back' }).click();
    expect(await currentStep(page)).toBe('Your contact');
  });

  test('cannot pass the contact step without a name, a real phone and a real email', async ({ page }) => {
    await page.goto('/index.html');
    await page.getByRole('button', { name: /I own or manage rental property/ }).click();
    await page.getByRole('button', { name: 'Next →' }).click();
    await page.fill('#lc-name', 'Marcus Reed');
    await page.fill('#lc-phone', '555');
    await page.fill('#lc-email', 'not-an-email');
    await page.getByRole('button', { name: 'Next →' }).click();
    expect(await currentStep(page)).toBe('Your contact');
    await expect(page.locator('.lc-field.lc-bad')).toHaveCount(2);
  });

  test('submits the case-review form\'s exact fields, stamped landlord, and books one conversion', async ({ page }) => {
    const seen = await stubEndpoint(page, { ok: true, contact_id: CONTACT_ID });
    await page.goto('/index.html?utm_source=google&utm_campaign=ras');
    await walkToLastStep(page);
    await dialog(page).getByRole('button', { name: /Request my free case review/ }).click();
    await expect(dialog(page)).toContainText('we’ve got it');

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      form_type: 'contact', visitor_role: 'landlord',
      name: 'Marcus Reed', phone: '(215) 555-0123', email: 'landlord@example.com',
      units: '3', tenant_balance: '$4,200', message: 'Tenant is four months behind.',
      utm_source: 'google', utm_campaign: 'ras',
    });
    const booked = await leads(page);
    expect(booked).toHaveLength(1);
    expect(booked[0]).toMatchObject({ form_id: 'landlord-check-form', transaction_id: CONTACT_ID });
    await expect(page.locator('[data-lc-dot][aria-current]')).toHaveCount(0);
    await expect(page.locator('[data-lc-dot].is-done')).toHaveCount(4);
  });

  test('a 200 with no contact id books NOTHING', async ({ page }) => {
    await stubEndpoint(page, { ok: true });
    await page.goto('/index.html');
    await walkToLastStep(page);
    await dialog(page).getByRole('button', { name: /Request my free case review/ }).click();
    await expect(dialog(page)).toContainText('we’ve got it');
    expect(await leads(page)).toHaveLength(0);
  });

  test('a server failure shows human copy, re-enables the button, and books NOTHING', async ({ page }) => {
    await stubEndpoint(page, { ok: false }, { status: 500 });
    await page.goto('/index.html');
    await walkToLastStep(page);
    const submit = dialog(page).getByRole('button', { name: /Request my free case review/ });
    await submit.click();
    await expect(page.locator('.lc-status')).toContainText('call (215) 402-6882');
    await expect(submit).toBeEnabled();
    expect(await leads(page)).toHaveLength(0);
  });

  test('a filled honeypot sends nothing', async ({ page }) => {
    const seen = await stubEndpoint(page, { ok: true, contact_id: CONTACT_ID });
    await page.goto('/index.html');
    await walkToLastStep(page);
    await page.evaluate(() => { document.querySelector('#lc-hp-x7f2').value = 'bot'; });
    await dialog(page).getByRole('button', { name: /Request my free case review/ }).click();
    await page.waitForTimeout(300);
    expect(seen).toHaveLength(0);
    expect(await leads(page)).toHaveLength(0);
  });

  test('answering landlord also answers the inline gates on the page', async ({ page }) => {
    await page.goto('/index.html');
    await page.getByRole('button', { name: /I own or manage rental property/ }).click();
    await expect(page.locator('#contact-form input[name="visitor_role"]')).toHaveValue('landlord');
    await expect(page.locator('#intake-form input[name="visitor_role"]')).toHaveValue('landlord');
    await expect(page.locator('#contact-form')).not.toHaveAttribute('hidden', '');
  });

  test('a returning landlord is not asked again and finds the forms already open', async ({ page }) => {
    await page.goto('/index.html');
    await page.getByRole('button', { name: /I own or manage rental property/ }).click();
    await page.goto('/back-rent/index.html');
    await page.waitForTimeout(1200);
    await expect(popup(page)).toHaveCount(0);
    await expect(page.locator('#backrent-form input[name="visitor_role"]')).toHaveValue('landlord');
    await expect(page.locator('#backrent-form')).toBeVisible();
  });

  test('"Continue to the full application" pre-fills the long form', async ({ page }) => {
    await stubEndpoint(page, { ok: true, contact_id: CONTACT_ID });
    await page.goto('/index.html');
    await walkToLastStep(page);
    await dialog(page).getByRole('button', { name: /Request my free case review/ }).click();
    await page.getByRole('button', { name: /Continue to the full application/ }).click();
    await expect(popup(page)).toHaveCount(0);
    await expect(page.locator('#owner-name')).toHaveValue('Marcus Reed');
    await expect(page.locator('#owner-email')).toHaveValue('landlord@example.com');
    await expect(page.locator('#owner-phone')).toHaveValue('(215) 555-0123');
    await expect(page.locator('#owner-units')).toHaveValue('3');
    await expect(page.locator('#back-rent')).toHaveValue('4200');
  });

  test('from a blog page, "Continue" carries the answers to the homepage application', async ({ page }) => {
    await stubEndpoint(page, { ok: true, contact_id: CONTACT_ID });
    await page.goto('/blog/eviction-diversion-program/index.html');
    await walkToLastStep(page);
    await dialog(page).getByRole('button', { name: /Request my free case review/ }).click();
    await page.getByRole('button', { name: /Continue to the full application/ }).click();
    await page.waitForURL(/\/#apply$/);
    await expect(page.locator('#owner-name')).toHaveValue('Marcus Reed');
    await expect(page.locator('#intake-form')).toBeVisible();
  });

  test('every step is reported to the dataLayer, so drop-off can be measured', async ({ page }) => {
    await stubEndpoint(page, { ok: true, contact_id: CONTACT_ID });
    await page.goto('/index.html');
    await walkToLastStep(page);
    await dialog(page).getByRole('button', { name: /Request my free case review/ }).click();
    await expect(dialog(page)).toContainText('we’ve got it');
    const actions = (await lcEvents(page)).map((e) => e.lc_action + (e.lc_step ? ':' + e.lc_step : ''));
    expect(actions).toEqual(['open', 'role', 'step:2', 'step:3', 'step:4', 'submit']);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('it is a bottom sheet that leaves the top of the page visible, with no sideways scroll', async ({ page }) => {
    await page.goto('/index.html');
    await expect(dialog(page)).toBeVisible();
    const box = await dialog(page).boundingBox();
    expect(Math.round(box.y + box.height)).toBe(844);  // sits on the bottom edge
    expect(box.y).toBeGreaterThan(844 * 0.3);           // the top of the page stays in view
    expect(box.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await expect(page.locator('.lc-count')).toHaveText('Step 1 of 4 · Who you are');
  });
});
