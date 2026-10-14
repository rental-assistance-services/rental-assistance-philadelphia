/**
 * The tenant application: a PREVIEW, behind ?tenant-preview=1 (TENANT_PREVIEW in landlord-check.js).
 *
 * Adam asked for a tenant path on 2026-10-14: a tenant who has their landlord's details starts an
 * application that is forwarded to the landlord to finish, and a tenant who doesn't can learn more
 * first. Abe sees it before it goes live, so for every real visitor (switch off) nothing changes,
 * and in every state it SENDS NOTHING: no CRM row, no Google Ads conversion, no request to anything
 * but the site itself. The one exception is the same as on the landlord application: the street box
 * asks Photon for address suggestions as it is typed in (stubbed here, as in landlord-check.spec.js).
 *
 * The page's Google Tag Manager is blocked in every test, so any request the page makes to another
 * host is the code under test making it.
 */
const { test, expect } = require('@playwright/test');

const ENDPOINT = 'https://rio.tworiverdevelopment.tech/rental-assist/intake';
const CONTACT_ID = '3f6d2b1a-8c4e-4f7a-9b2d-6e1c0a5f7d93';
const OK = { ok: true, contact_id: CONTACT_ID, files_uploaded: 0, documents: { stored: [], rejected: [] } };

const ON = '/index.html?tenant-preview=1';
const STEPS = ['About me', 'My landlord', 'The home I rent', 'What I owe', 'My documents', 'Send to my landlord'];
const BANNER = 'Preview: nothing was sent. The email to the landlord and the application number are not built yet.';

const popup = (page) => page.locator('[data-landlord-check]');
const next = (page) => page.locator('[data-landlord-check] [data-lc-next]');
const back = (page) => page.locator('[data-landlord-check] [data-lc-back]');
const tenant = (page) => popup(page).getByRole('button', { name: /^I am the tenant/ });
const landlord = (page) => popup(page).getByRole('button', { name: /^I am the landlord/ });
const ready = (page) => popup(page).getByRole('button', { name: /^Yes, I’m ready to apply/ });
const notYet = (page) => popup(page).getByRole('button', { name: /^Not yet, I want to learn more/ });
const startApp = (page) => popup(page).getByRole('button', { name: 'Start my application' });
const askPanel = (page) => popup(page).locator('[data-lc-panel="tenant-ask"]');
const helpPanel = (page) => popup(page).locator('[data-lc-panel="tenant"]');
const currentStep = (page) => page.locator('[data-lc-dot][aria-current="step"] .lc-lbl').textContent();
const msgOf = (page, sel) => page.locator(`.field:has(${sel}) > .errmsg`);
const oneOfMsg = (page) => page.locator('#tenant-form [data-lc-one-of-msg]');
const leads = (page) => page.evaluate(() => (window.dataLayer || []).filter((d) => d.event === 'lead_submit'));
const draft = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('ras_lc_draft:tenant-form') || 'null'));

/** Every request the page makes from now on. */
function watchRequests(page) {
  const urls = [];
  page.on('request', (r) => urls.push(r.url()));
  return urls;
}
/** The requests that went anywhere but this site and the fonts. The homepage serves its fonts from
 *  /fonts/ (the site itself); a page that still loads Google Fonts may ask those two hosts too. */
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
function foreign(page, urls) {
  const origin = new URL(page.url()).origin;
  return urls.filter((u) => !/^(data|blob):/.test(u) && new URL(u).origin !== origin && !FONT_HOSTS.includes(new URL(u).host));
}
async function stubEndpoint(page, body = OK) {
  const seen = [];
  await page.route(ENDPOINT, async (route) => {
    seen.push({ contentType: route.request().headers()['content-type'] || '', postData: route.request().postData() || '' });
    await route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  return seen;
}
/** A visitor who already closed the first-visit popup, so only a click opens it. */
async function as(page, v) {
  await page.addInitScript((val) => {
    if (!sessionStorage.getItem('lc-test-seeded')) {
      localStorage.setItem('ras_role_check', JSON.stringify({ v: val, t: Date.now() }));
      sessionStorage.setItem('lc-test-seeded', '1');
    }
  }, v);
}

test.beforeEach(async ({ page }) => {
  await page.route(/googletagmanager\.com|google-analytics\.com/, (route) => route.abort());
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ type: 'FeatureCollection', features: [] }) }));
});

/** Fill the current tenant step like a person would. */
const FILL = {
  'About me': async (p) => {
    await p.fill('#ta-name', 'Dwayne Carter');
    await p.fill('#ta-email', 'dwayne@example.com');
    await p.fill('#ta-email-confirm', 'dwayne@example.com');
    await p.fill('#ta-phone', '(215) 555-0188');
  },
  'My landlord': async (p) => {
    await p.fill('#ta-landlord-name', 'Marcus Reed');
    await p.fill('#ta-landlord-email', 'landlord@example.com');
  },
  'The home I rent': async (p) => {
    await p.fill('#ta-street', '1932 N 5th St'); await p.fill('#ta-zip', '19122'); await p.fill('#ta-rent', '1150');
  },
  'What I owe': async (p) => { await p.fill('#ta-back-rent', '4200'); },
  'My documents': async () => {},
  'Send to my landlord': async (p) => { await p.check('#ta-forward'); await p.check('#ta-contact'); },
};
/** Fill steps from the current one up to (not including) `until`, pressing Next after each. */
async function fillUntil(page, until) {
  for (const name of STEPS) {
    if (name === until) return;
    expect(await currentStep(page)).toBe(name);
    await FILL[name](page);
    if (name !== STEPS[STEPS.length - 1]) await next(page).click();
  }
}
/** Switch on, "I am the tenant", "Yes, I'm ready to apply": the first step of the application. */
async function toApplication(page, url = ON) {
  await page.goto(url);
  await tenant(page).click();
  await ready(page).click();
  await expect(page.locator('[data-landlord-check] #tenant-form')).toBeVisible();
  expect(await currentStep(page)).toBe('About me');
}

test.describe('switch off: every real visitor sees exactly what they saw before', () => {
  test('"I am the tenant" shows today\'s free-help screen, and no request leaves the page', async ({ page }) => {
    const hits = await stubEndpoint(page);
    await page.goto('/index.html');
    await expect(tenant(page)).toBeVisible();
    const urls = watchRequests(page);
    await tenant(page).click();
    await expect(helpPanel(page)).toBeVisible();
    await expect(helpPanel(page)).toContainText('the landlord has to apply');
    await expect(helpPanel(page).locator('a[href^="tel:"]')).toHaveCount(3);
    // the same two buttons, together, as before
    const stack = helpPanel(page).locator('.lc-stack');
    await expect(stack).toHaveCount(1);
    await expect(stack.getByRole('link', { name: /See all free help for tenants/ })).toHaveAttribute('href', '/tenants/');
    await expect(stack.getByRole('button', { name: 'Close' })).toBeVisible();
    // none of the preview exists
    await expect(popup(page).locator('[data-lc-panel="tenant-ask"], [data-lc-ready], [data-lc-tenant]')).toHaveCount(0);
    await expect(popup(page)).not.toContainText('Ready to apply?');
    await expect(popup(page).locator('#tenant-form')).toHaveCount(0);
    await expect(page.locator('#tenant-form')).toBeHidden();
    await stack.getByRole('button', { name: 'Close' }).click();
    await expect(popup(page)).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(hits).toHaveLength(0);
    expect(foreign(page, urls)).toEqual([]);
    expect(await leads(page)).toHaveLength(0);
    expect(await page.evaluate(() => sessionStorage.getItem('ras_tenant_preview'))).toBeNull();
  });

  test('the homepage gate and a blog page show the same free-help screen as before', async ({ page }) => {
    await as(page, 'dismissed');
    await page.goto('/index.html');
    await page.click('[data-gate-for="intake-form"] .rg-btn[data-role="tenant"]');
    await expect(helpPanel(page)).toBeVisible();
    await expect(askPanel(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    // The blog has no application link: the popup it shows is the first-visit one.
    await page.evaluate(() => localStorage.removeItem('ras_role_check'));
    await page.goto('/blog/index.html');
    await tenant(page).click();
    await expect(helpPanel(page)).toBeVisible();
    await expect(askPanel(page)).toHaveCount(0);
  });

  test('?tenant-preview=0 turns it off again for the rest of the tab', async ({ page }) => {
    await as(page, 'dismissed');
    const gateTenant = '[data-gate-for="intake-form"] .rg-btn[data-role="tenant"]';
    await page.goto(ON);
    await page.click(gateTenant);
    await expect(askPanel(page)).toBeVisible();
    await page.goto('/index.html?tenant-preview=0');
    expect(await page.evaluate(() => sessionStorage.getItem('ras_tenant_preview'))).toBeNull();
    await page.click(gateTenant);
    await expect(helpPanel(page)).toBeVisible();
    await expect(askPanel(page)).toHaveCount(0);
    await page.goto('/index.html');
    await page.click(gateTenant);
    await expect(helpPanel(page)).toBeVisible();
  });

  test('site.js refuses the tenant form while the switch is off, and handles it once it is on', async ({ page }) => {
    await as(page, 'dismissed');
    const hits = await stubEndpoint(page);
    // Reach past the popup on purpose: un-hide the form, fill it completely and submit it.
    const forceSubmit = () => page.evaluate(() => {
      const f = document.getElementById('tenant-form');
      f.hidden = false;
      const set = (sel, v) => { f.querySelector(sel).value = v; };
      set('#ta-name', 'Dwayne Carter'); set('#ta-email', 'dwayne@example.com'); set('#ta-phone', '2155550188');
      set('#ta-landlord-name', 'Marcus Reed'); set('#ta-landlord-phone', '2155550123');
      set('#ta-street', '1932 N 5th St'); set('#ta-zip', '19122'); set('#ta-rent', '1150'); set('#ta-back-rent', '4200');
      f.querySelector('#ta-forward').checked = true; f.querySelector('#ta-contact').checked = true;
      f.requestSubmit();
    });
    await page.goto('/index.html');
    const offUrls = watchRequests(page);
    await forceSubmit();
    await page.waitForTimeout(500);
    await expect(page.locator('.tenant-sent')).toHaveCount(0);
    await expect(page.locator('#tenant-form')).toBeVisible();          // not swapped for a confirmation
    expect(page.url()).toMatch(/\/index\.html$/);                       // and not submitted natively either
    expect(foreign(page, offUrls)).toEqual([]);
    // The same, with the switch on: the fill was valid, so the refusal above was the switch.
    page.removeAllListeners('request');
    await page.goto(ON);
    const urls = watchRequests(page);                                   // from here on: the submit only
    await forceSubmit();
    await expect(page.locator('.tenant-sent')).toContainText('Sent to your landlord');
    await expect(page.locator('#tenant-form')).toBeHidden();
    await expect(page.locator('#tenant-form input[name="property_address"]')).toHaveValue('1932 N 5th St, 19122');
    expect(hits).toHaveLength(0);
    expect(foreign(page, urls)).toEqual([]);
    expect(await leads(page)).toHaveLength(0);
  });
});

test.describe('switch on (?tenant-preview=1): what the tenant sees', () => {
  test('two cards, "Not yet" with its start prompt, and "Start my application" opens the form', async ({ page }) => {
    await page.goto(ON);
    await tenant(page).click();
    await expect(askPanel(page)).toBeVisible();
    await expect(askPanel(page).locator('h2')).toHaveText('Do you have your landlord’s details?');
    await expect(askPanel(page).locator('.lc-sub')).toHaveText('To apply, we need your landlord’s name and an email or phone number '
      + 'for them. The City’s program is applied for by the landlord, so they will need to finish what you start.');
    await expect(askPanel(page).locator('.lc-role')).toHaveCount(2);
    await expect(ready(page)).toHaveText('Yes, I’m ready to apply' + 'I have my landlord’s name and contact details');
    await expect(ready(page).locator('small')).toHaveText('I have my landlord’s name and contact details');
    await expect(notYet(page)).toHaveText('Not yet, I want to learn more' + 'What the program is and what you’ll need');
    await expect(askPanel(page).locator('.lc-note')).toHaveText('Rental Assistance Philadelphia is a private filing service hired '
      + 'by owners. We are not the City and we do not represent tenants.');
    await expect(page.locator('.lc-dialog')).toHaveAttribute('aria-labelledby', 'lc-title-tenant-ask');

    await notYet(page).click();
    await expect(helpPanel(page)).toBeVisible();
    await expect(helpPanel(page)).toContainText('the landlord has to apply');
    await expect(helpPanel(page).locator('a[href^="tel:"]')).toHaveCount(3);
    await expect(helpPanel(page).getByRole('link', { name: /See all free help for tenants/ })).toHaveAttribute('href', '/tenants/');
    const prompt = helpPanel(page).locator('[data-lc-ready]');
    await expect(prompt.locator('h3')).toHaveText('Ready to apply?');
    await expect(prompt.locator('p')).toHaveText('If you have your landlord’s details, you can start now.');
    await expect(prompt.getByRole('button')).toHaveText(['Start my application', 'Close']);
    await expect(helpPanel(page).getByRole('button', { name: 'Close' })).toHaveCount(1);

    await startApp(page).click();
    await expect(page.locator('[data-landlord-check] #tenant-form')).toBeVisible();
    await expect(page.locator('[data-lc-dot] .lc-lbl')).toHaveText(['Who you are', ...STEPS]);
    await expect(page.locator('.lc-count')).toHaveText('Step 2 of 7 · About me');
    await expect(page.locator('#ta-name')).toBeVisible();
    await expect(page.locator('#ta-landlord-name')).toBeHidden();       // one section per step
    await expect(page.locator('#tenant-form input[name="visitor_role"]')).toHaveValue('tenant');
    await expect(page.locator('#tenant-form input[name="form_type"]')).toHaveValue('tenant_application');
    await expect(page.locator('#tenant-form input[name="hp_x7f2"]')).toHaveCount(1);
  });

  test('the switch is kept for the rest of the tab, on any page', async ({ page }) => {
    await as(page, 'dismissed');
    await page.goto(ON);
    await page.goto('/index.html');
    await page.click('[data-gate-for="contact-form"] .rg-btn[data-role="tenant"]');
    await expect(askPanel(page)).toBeVisible();
    await page.goto('/back-rent/index.html');
    await page.locator('a[href="#form-card"]').first().evaluate((a) => a.click());
    await tenant(page).click();
    await expect(askPanel(page)).toBeVisible();
  });

  test('Back from the first step returns to the question; closing puts the form back, hidden, answers kept', async ({ page }) => {
    await toApplication(page);
    await page.fill('#ta-name', 'Dwayne Carter');
    await back(page).click();
    await expect(askPanel(page)).toBeVisible();
    await ready(page).click();
    expect(await currentStep(page)).toBe('About me');
    await page.keyboard.press('Escape');
    await expect(popup(page)).toHaveCount(0);
    await expect(page.locator('#tenant-form')).toBeHidden();
    await expect(page.locator('#apply #tenant-form')).toHaveCount(1);   // back in its place on the page
    await expect(page.locator('#ta-name')).toHaveValue('Dwayne Carter');
  });

  test('a landlord who went back and chose tenant gets the tenant form, and the landlord form goes home', async ({ page }) => {
    await page.goto(ON);
    await landlord(page).click();
    await expect(page.locator('[data-landlord-check] #intake-form')).toBeVisible();
    await back(page).click();
    await tenant(page).click();
    await ready(page).click();
    await expect(page.locator('[data-landlord-check] #tenant-form')).toBeVisible();
    await expect(page.locator('[data-landlord-check] #intake-form')).toHaveCount(0);
    await expect(page.locator('#apply #intake-form')).toBeHidden();
    await expect(page.locator('.lc-count')).toHaveText('Step 2 of 7 · About me');
  });

  test('on a page without the form, "Yes" hands the tenant to the homepage application, already open', async ({ page }) => {
    await page.goto('/blog/index.html?tenant-preview=1');
    await tenant(page).click();
    await expect(askPanel(page)).toBeVisible();
    await ready(page).click();
    await page.waitForURL((u) => u.pathname === '/');
    await expect(page.locator('[data-landlord-check] #tenant-form')).toBeVisible();
    expect(await currentStep(page)).toBe('About me');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('"Start my application" on a page without the form hands over the same way', async ({ page }) => {
    await page.goto('/faq/index.html?tenant-preview=1');
    await tenant(page).click();
    await notYet(page).click();
    await startApp(page).click();
    await page.waitForURL((u) => u.pathname === '/');
    await expect(page.locator('[data-landlord-check] #tenant-form')).toBeVisible();
  });

  test('a browser that refuses to store the hand-off still reaches the preview on the homepage', async ({ page }) => {
    // Safari private mode throws on sessionStorage.setItem: neither the hand-off flag nor the
    // switch can be kept, so the switch has to travel in the address. Without it the homepage
    // showed the old tenant screen behind a button that said "Start my application".
    await page.addInitScript(() => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (this === window.sessionStorage) throw new DOMException('QuotaExceededError');
        return real.call(this, k, v);
      };
    });
    await page.goto('/faq/index.html?tenant-preview=1');
    await tenant(page).click();
    await ready(page).click();
    await page.waitForURL((u) => u.pathname === '/' && u.search === '?tenant-preview=1' && u.hash === '#apply');
    // No flag, so nothing opens by itself: the gate on the form section asks the preview's question.
    await page.click('[data-gate-for="intake-form"] .rg-btn[data-role="tenant"]');
    await expect(askPanel(page)).toBeVisible();
    await ready(page).click();
    await expect(page.locator('[data-landlord-check] #tenant-form')).toBeVisible();
  });
});

test.describe('switch on: each step checks its answers before Next', () => {
  test('About me: a real first and last name, the email typed twice, a real phone; the move-in date is optional', async ({ page }) => {
    await toApplication(page);
    await next(page).click();
    expect(await currentStep(page)).toBe('About me');
    await expect(page.locator('#ta-name')).toHaveClass(/err/);
    await page.fill('#ta-name', 'Dwayne');
    await next(page).click();
    await expect(msgOf(page, '#ta-name')).toHaveText('Please enter your first and last name.');
    await page.fill('#ta-name', 'DWAYNE CARTER');
    await expect(msgOf(page, '#ta-name')).toHaveText('Please type your name normally, not in all capitals, e.g. Marcus Reed.');
    await page.fill('#ta-name', 'Dwayne Carter');
    await expect(page.locator('.field:has(#ta-name)')).toHaveClass(/lc-ok/);
    await page.fill('#ta-phone', '(215) 555-01');
    await page.fill('#ta-email', 'dwayne@example.com');
    await next(page).click();
    expect(await currentStep(page)).toBe('About me');
    await expect(msgOf(page, '#ta-phone')).toHaveText('Enter a 10-digit US phone number, e.g. (215) 555-0123.');
    await page.fill('#ta-phone', '2155550188');
    await expect(page.locator('#ta-phone')).toHaveValue('(215) 555-0188');
    await next(page).click();                                      // email not yet typed twice
    expect(await currentStep(page)).toBe('About me');
    await expect(page.locator('.field:has(#ta-email) .lc-confirm')).toHaveClass(/show/);
    await page.fill('#ta-email-confirm', 'dwayne@example.co');
    await next(page).click();
    expect(await currentStep(page)).toBe('About me');
    await page.fill('#ta-email-confirm', 'dwayne@example.com');
    await expect(page.locator('.field:has(#ta-email)')).toHaveClass(/lc-verified/);
    await page.locator('#ta-movein-shown').pressSequentially('01012999');
    await next(page).click();
    expect(await currentStep(page)).toBe('About me');
    await expect(msgOf(page, '#ta-movein')).toHaveText('The move-in date can’t be in the future.');
    await page.locator('#ta-movein-shown').fill('');
    await next(page).click();
    expect(await currentStep(page)).toBe('My landlord');
  });

  test('My landlord: a name, and an email or a phone for them, at least one', async ({ page }) => {
    await toApplication(page);
    await fillUntil(page, 'My landlord');
    const email = page.locator('#ta-landlord-email'), phone = page.locator('#ta-landlord-phone');
    await expect(page.locator('#ta-landlord-name')).toHaveAttribute('required', '');
    await expect(email).not.toHaveAttribute('required', '');
    await expect(phone).not.toHaveAttribute('required', '');
    await expect(oneOfMsg(page)).toBeHidden();
    await next(page).click();
    expect(await currentStep(page)).toBe('My landlord');
    await expect(page.locator('#ta-landlord-name')).toHaveClass(/err/);
    await expect(oneOfMsg(page)).toBeVisible();
    await expect(oneOfMsg(page)).toHaveText('Enter an email or a phone number for your landlord.');
    // shown under the row, not under one field
    const row = await page.locator('#tenant-form [data-lc-one-of] > .row').boundingBox();
    const msg = await oneOfMsg(page).boundingBox();
    expect(msg.y).toBeGreaterThanOrEqual(row.y + row.height - 14);
    await page.fill('#ta-landlord-name', 'Reed Property Group LLC');   // a company is fine
    await next(page).click();
    expect(await currentStep(page)).toBe('My landlord');
    await expect(oneOfMsg(page)).toBeVisible();
    // a wrong email does not count, and is an error of its own
    await email.fill('reed@');
    await email.blur();
    await next(page).click();
    expect(await currentStep(page)).toBe('My landlord');
    await expect(email).toHaveClass(/err/);
    await expect(oneOfMsg(page)).toBeVisible();
    // the landlord's email is not asked twice
    await expect(page.locator('#ta-landlord-email-confirm')).toHaveCount(0);
    // a phone alone is enough, and the message goes as soon as it is right
    await email.fill('');
    await phone.pressSequentially('2155550123');
    await expect(oneOfMsg(page)).toBeHidden();
    await next(page).click();
    expect(await currentStep(page)).toBe('The home I rent');
    // an email alone is enough too
    await back(page).click();
    await phone.fill('');
    await next(page).click();
    await expect(oneOfMsg(page)).toBeVisible();
    await email.fill('reed@example.com');
    await expect(oneOfMsg(page)).toBeHidden();
    await next(page).click();
    expect(await currentStep(page)).toBe('The home I rent');
  });

  test('The home I rent: the street, a 5-digit ZIP and the rent; Photon fills the street and the ZIP', async ({ page }) => {
    await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ type: 'FeatureCollection', features: [
        { properties: { housenumber: '1932', street: 'North 5th Street', city: 'Philadelphia', state: 'Pennsylvania',
          postcode: '19122', country: 'United States', countrycode: 'US', type: 'house' } }] }) }));
    await toApplication(page);
    await fillUntil(page, 'The home I rent');
    const zip = page.locator('#ta-zip'), msg = msgOf(page, '#ta-zip');
    await expect(page.locator('#ta-street')).toHaveAttribute('name', 'property_street');
    await expect(zip).toHaveAttribute('name', 'property_zip');
    await expect(page.locator('#ta-unit')).toHaveAttribute('name', 'property_unit');
    await expect(page.locator('#ta-rent')).toHaveAttribute('name', 'monthly_rent');
    await expect(page.locator('.field:has(#ta-unit) .help')).toHaveText('If applicable. Leave blank for a single-family rental.');
    await next(page).click();
    expect(await currentStep(page)).toBe('The home I rent');
    await expect(msg).toHaveText('Enter the 5-digit ZIP code.');
    await page.fill('#ta-rent', '1150');
    // suggestions on the street box: the street goes in the street box, the ZIP in the ZIP box
    await page.locator('#ta-street').pressSequentially('1932 N 5th');
    await page.locator('#ta-street-suggest [role=option]').first().click();
    await expect(page.locator('#ta-street')).toHaveValue('1932 North 5th Street');
    await expect(zip).toHaveValue('19122');
    // the ZIP rule, as on the landlord application
    await zip.fill('');
    await zip.pressSequentially('191');
    await expect(msg).toBeHidden();
    await next(page).click();
    expect(await currentStep(page)).toBe('The home I rent');
    await expect(msg).toHaveText('Enter the 5-digit ZIP code.');
    await zip.pressSequentially('2a');
    await expect(msg).toBeVisible();
    await next(page).click();
    expect(await currentStep(page)).toBe('The home I rent');
    await zip.fill('');
    await zip.pressSequentially('19122');
    await expect(page.locator('.field:has(#ta-zip)')).toHaveClass(/lc-ok/);
    await next(page).click();
    expect(await currentStep(page)).toBe('What I owe');
  });

  test('What I owe: the back rent is required, months behind is not, and the help says what the City pays', async ({ page }) => {
    await toApplication(page);
    await fillUntil(page, 'What I owe');
    await expect(page.locator('.field:has(#ta-back-rent) .help')).toHaveText('The City can pay up to $3,500 of back rent. If I owe '
      + 'more, I can still apply; my landlord may agree to waive the amount over $3,500. If approved, the City also pays two '
      + 'months of future rent so I can stay.');
    await expect(page.locator('#ta-back-rent')).toHaveAttribute('name', 'back_rent_owed');
    await expect(page.locator('#ta-months')).toHaveAttribute('name', 'months_behind');
    await next(page).click();
    expect(await currentStep(page)).toBe('What I owe');
    await expect(page.locator('#ta-back-rent')).toHaveClass(/err/);
    await page.fill('#ta-back-rent', '4200');
    await next(page).click();
    expect(await currentStep(page)).toBe('My documents');
  });

  test('documents are optional; both authorizations are required to send', async ({ page }) => {
    await toApplication(page);
    await fillUntil(page, 'My documents');
    await expect(page.locator('#tenant-form input[type=file]')).toHaveCount(2);
    for (const f of await page.locator('#tenant-form input[type=file]').all()) await expect(f).not.toHaveAttribute('required', '');
    await expect(page.locator('[data-landlord-check] .lc-drop')).toHaveCount(2);         // the site's drop boxes
    await expect(page.locator('#tenant-form fieldset:not([data-lc-off]) .note')).toHaveText(
      'Proof of ownership, a W-9 and bank details come from the landlord, not from you.');
    await next(page).click();                                       // nothing uploaded: still fine
    expect(await currentStep(page)).toBe('Send to my landlord');
    await expect(page.locator('#tenant-form button[type=submit]')).toHaveText(/Send to my landlord/);
    await expect(page.locator('label[for="ta-forward"]')).toContainText('By completing this application, I am asking Rental '
      + 'Assistance Services to forward it to my landlord. I understand my landlord must provide more information and agree to '
      + 'take part before the application is complete, and that nothing is approved until they do.');
    await expect(page.locator('label[for="ta-contact"]')).toContainText('I agree to be contacted by email or phone about this application.');
    const send = page.locator('#tenant-form button[type=submit]');
    await send.click();
    await expect(page.locator('.tenant-sent')).toHaveCount(0);
    await expect(msgOf(page, '#ta-forward')).toBeVisible();
    await page.check('#ta-forward');
    await send.click();
    await expect(page.locator('.tenant-sent')).toHaveCount(0);
    await expect(msgOf(page, '#ta-contact')).toBeVisible();
    await page.check('#ta-contact');
    await send.click();
    await expect(page.locator('.tenant-sent')).toBeVisible();
  });
});

test.describe('switch on: sending sends nothing', () => {
  test('"Send to my landlord" makes no request and shows the preview confirmation with its banner', async ({ page }) => {
    const hits = await stubEndpoint(page);
    await toApplication(page);
    await fillUntil(page, null);
    const urls = watchRequests(page);
    await page.click('#tenant-form button[type=submit]');
    const sent = page.locator('[data-landlord-check] .tenant-sent');
    await expect(sent).toBeVisible();
    await expect(sent.locator('.preview-banner')).toHaveText(BANNER);
    await expect(sent.locator('h3')).toHaveText('Sent to your landlord');
    await expect(sent.locator('h3 + p')).toHaveText('We will email you your application number and let you know when your landlord responds.');
    // the banner is above the heading, and plainly visible: white on navy
    const [b, h] = [await sent.locator('.preview-banner').boundingBox(), await sent.locator('h3').boundingBox()];
    expect(b.y + b.height).toBeLessThanOrEqual(h.y);
    const look = await sent.locator('.preview-banner').evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }));
    expect(look).toEqual({ bg: 'rgb(14, 34, 72)', fg: 'rgb(255, 255, 255)' });
    await expect(page.locator('#tenant-form')).toBeHidden();
    await expect(page.locator('.lc-count')).toHaveText('Done');
    await expect(page.locator('#tenant-form input[name="property_address"]')).toHaveValue('1932 N 5th St, 19122');
    await page.waitForTimeout(1000);
    expect(hits).toHaveLength(0);
    expect(foreign(page, urls), 'sending reached another host').toEqual([]);
  });

  test('the whole tenant path talks to nothing but the site, and Photon for the street box', async ({ page }) => {
    const hits = await stubEndpoint(page);
    await page.goto(ON);
    const urls = watchRequests(page);
    await tenant(page).click();
    await notYet(page).click();
    await startApp(page).click();
    await fillUntil(page, null);
    await page.click('#tenant-form button[type=submit]');
    await expect(page.locator('.tenant-sent')).toBeVisible();
    await page.waitForTimeout(1000);
    expect(hits).toHaveLength(0);
    const hosts = [...new Set(foreign(page, urls).map((u) => new URL(u).host))];
    expect(hosts).toEqual(['photon.komoot.io']);
  });

  test('no lead_submit, no conversion call, and the saved answers are cleared on sending', async ({ page }) => {
    await toApplication(page);
    await page.evaluate(() => {
      window.__leadCalls = 0;
      const real = window.rasTrackLead;
      window.rasTrackLead = function () { window.__leadCalls += 1; return real.apply(this, arguments); };
    });
    await fillUntil(page, null);
    await page.waitForTimeout(400);                                  // the draft saves 250ms after an edit
    const kept = await draft(page);
    expect(kept.values.tenant_name).toBe('Dwayne Carter');
    expect(kept.values.authorize_forward).toBeUndefined();          // a consent is ticked fresh every time
    expect(kept.values.agree_contact).toBeUndefined();
    await page.click('#tenant-form button[type=submit]');
    await expect(page.locator('.tenant-sent')).toBeVisible();
    expect(await leads(page)).toHaveLength(0);
    expect(await page.evaluate(() => window.__leadCalls)).toBe(0);
    expect(await draft(page)).toBeNull();
  });

  test('answers come back within the hour, on the step they reached', async ({ page }) => {
    await toApplication(page);
    await fillUntil(page, 'The home I rent');
    await page.waitForTimeout(400);
    await page.reload();
    // The tenant answer is remembered, so the popup no longer opens by itself: the gate opens it.
    await page.click('[data-gate-for="intake-form"] .rg-btn[data-role="tenant"]');
    await ready(page).click();
    expect(await currentStep(page)).toBe('The home I rent');
    await expect(page.locator('.lc-restored')).toBeVisible();
    await back(page).click();
    await expect(page.locator('#ta-landlord-name')).toHaveValue('Marcus Reed');
  });
});

test.describe('switch on: the rest of the popup is as before', () => {
  test('no long dashes and nothing under .9rem on any tenant screen', async ({ page }) => {
    const check = () => page.evaluate(() => {
      const out = [];
      const dialog = document.querySelector('[data-landlord-check] .lc-dialog');
      if (/[–—]/.test(dialog.innerText)) out.push('long dash: ' + dialog.innerText.match(/.{0,40}[–—].{0,40}/)[0]);
      const walk = document.createTreeWalker(dialog, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const el = n.parentElement;
        if (!n.textContent.trim() || !el.getClientRects().length) continue;
        const px = parseFloat(getComputedStyle(el).fontSize);
        const floor = el.closest('.lc-count, .lc-lbl') ? 0.74 * 16 : 0.9 * 16;
        if (px < floor - 0.01) out.push(`${el.className || el.tagName} ${px}px "${n.textContent.trim().slice(0, 40)}"`);
      }
      return out;
    });
    await page.goto(ON);
    await tenant(page).click();
    expect(await check(), 'the question').toEqual([]);
    await notYet(page).click();
    expect(await check(), 'learn more').toEqual([]);
    await startApp(page).click();
    for (const name of STEPS) {
      expect(await currentStep(page)).toBe(name);
      expect(await check(), name).toEqual([]);
      await FILL[name](page);
      if (name !== STEPS[STEPS.length - 1]) await next(page).click();
    }
    await page.click('#tenant-form button[type=submit]');
    await expect(page.locator('.tenant-sent')).toBeVisible();
    expect(await check(), 'the confirmation').toEqual([]);
  });

  test('on a phone the tenant steps fit the sheet, with no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await toApplication(page);
    for (const name of STEPS) {
      const wide = await page.evaluate(() => {
        const r = document.querySelector('[data-landlord-check]');
        return r.scrollWidth - r.clientWidth;
      });
      expect(wide, name).toBeLessThanOrEqual(0);
      await FILL[name](page);
      if (name !== STEPS[STEPS.length - 1]) await next(page).click();
    }
  });

  // The landlord application, its payload and its one conversion, with the switch off and on:
  // the same fields with the same values, so the preview changes nothing a landlord sends.
  test('the landlord application sends the same payload, and books one conversion, with the switch on as off', async ({ browser }) => {
    const parts = (body) => {
      const out = {};
      for (const m of body.matchAll(/name="([^"]+)"(; filename="[^"]*")?\r\n(?:Content-Type: [^\r]*\r\n)?\r\n([^\r]*)/g)) {
        out[m[1]] = m[2] ? '<file>' : m[3];
      }
      return out;
    };
    const run = async (url) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.route(/googletagmanager\.com|google-analytics\.com/, (route) => route.abort());
      await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ status: 200, contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ type: 'FeatureCollection', features: [] }) }));
      const seen = await stubEndpoint(page);
      await page.goto(url);
      await landlord(page).click();
      await expect(page.locator('[data-lc-dot]')).toHaveCount(8);
      await page.fill('#owner-name', 'Marcus Reed'); await page.fill('#owner-email', 'landlord@example.com');
      await page.fill('#owner-email-confirm', 'landlord@example.com'); await page.fill('#owner-phone', '(215) 555-0123');
      await next(page).click();
      await page.fill('#prop-address', '1932 N 5th St'); await page.fill('#prop-zip', '19122'); await page.fill('#prop-rent', '1150');
      await next(page).click();
      await page.fill('#tenant-name', 'Dwayne Carter');
      await next(page).click();
      await page.fill('#back-rent', '4200'); await page.fill('#months-behind', '4');
      for (let i = 0; i < 3; i++) await next(page).click();
      await page.check('#consent'); await page.check('#agree-terms');
      await page.click('#intake-form button[type=submit]');
      await expect(page.locator('[role=status]').filter({ hasText: 'Application received' })).toBeVisible();
      const result = { seen: seen.length, body: parts(seen[0].postData), leads: await leads(page),
        contentType: seen[0].contentType.split(';')[0] };
      await ctx.close();
      return result;
    };
    const off = await run('/index.html');
    const on = await run(ON);
    expect(off.seen).toBe(1);
    expect(on.seen).toBe(1);
    expect(on.contentType).toBe('multipart/form-data');
    expect(on.body).toEqual(off.body);
    expect(on.body).toMatchObject({ form_type: 'intake', visitor_role: 'landlord', owner_name: 'Marcus Reed',
      property_street: '1932 N 5th St', property_zip: '19122', property_address: '1932 N 5th St, 19122' });
    for (const name of ['landlord_name', 'landlord_email', 'authorize_forward', 'agree_contact']) {
      expect(on.body[name], `${name} leaked into the landlord payload`).toBeUndefined();
    }
    expect(off.leads).toHaveLength(1);
    expect(on.leads).toHaveLength(1);
    expect(on.leads[0]).toMatchObject({ form_id: 'intake-form', lead_value: 600, transaction_id: CONTACT_ID });
  });
});
