/**
 * The tenant application, live for every visitor (TENANT_APPLICATION in landlord-check.js).
 *
 * Adam asked for a tenant path on 2026-10-14: a tenant who has their landlord's details starts an
 * application that we send to the landlord to finish, and a tenant who doesn't can learn more
 * first. It was a preview behind ?tenant-preview=1 (PR #26); Kean and RK approved it going live.
 *
 * What this file holds it to:
 * - Sent like the landlord application: ONE multipart POST to the intake endpoint, with the
 *   tenant's answers, the landlord's details, the two optional files, the honeypot, click ids and
 *   utm_* fields, and form_type=tenant_application, visitor_role=tenant. Rio is built against
 *   these field names, so the payload is checked name by name.
 * - The confirmation only on a 200 that says {"ok": true}. Rio answers this form with 400
 *   "missing_required" until RK's part is live: that, a network failure, or a 200 without ok, is
 *   an error the tenant can see, never a success.
 * - NEVER a Google Ads conversion: no rasTrackLead call, no lead_submit, no popup "submit", and
 *   no request to any Google host.
 * - The landlord application is unchanged, and TENANT_APPLICATION = false gives every visitor
 *   exactly what main gave them before: the free-help screen, no tenant form, no request.
 *
 * The real endpoint is never reached: every test aborts it by default and stubs it where a test
 * sends. The page's Google Tag Manager is blocked in every test, so any request the page makes to
 * another host is the code under test making it.
 */
const { test, expect } = require('@playwright/test');

const ENDPOINT = 'https://rio.tworiverdevelopment.tech/rental-assist/intake';
const CONTACT_ID = '3f6d2b1a-8c4e-4f7a-9b2d-6e1c0a5f7d93';
const OK = { ok: true, contact_id: CONTACT_ID, files_uploaded: 2, documents: { stored: ['doc_lease', 'doc_ledger'], rejected: [] } };
const PDF = Buffer.from('%PDF-1.4\n% test fixture\n%%EOF\n');

const STEPS = ['About me', 'My landlord', 'The home I rent', 'What I owe', 'My documents', 'Send to my landlord'];
const CONFIRM_H = 'Application received';
const CONFIRM_P = 'Thank you. We will email your landlord so they can finish your application, and we will email you your application number.';
const FAILED = 'Something went wrong submitting your application. Please try again, or call (215) 402-6882.';
// The free-help screen's first line: with the switch on it can't say there is nothing for a tenant
// here, because "Start my application" sits under it. Off, it is main's line, word for word.
const HELP_ON = 'We’re a private service hired by property owners, and we don’t represent tenants. The City’s Eviction '
  + 'Diversion Program can pay a tenant’s back rent, but the landlord has to apply. These free lines can explain it so you '
  + 'can raise it with them:';
const HELP_MAIN = 'We’re a private service hired by property owners, so there’s nothing we can file for you. The City’s Eviction '
  + 'Diversion Program can pay a tenant’s back rent, but the landlord has to apply. These free lines can explain it so you '
  + 'can raise it with them:';
/** Every field the tenant application sends, by the name Rio reads it under. */
const FIELDS = ['agree_contact', 'authorize_forward', 'back_rent_owed', 'doc_ledger', 'doc_lease', 'form_type', 'hp_x7f2',
  'landlord_email', 'landlord_name', 'landlord_phone', 'monthly_rent', 'months_behind', 'property_address', 'property_street',
  'property_unit', 'property_zip', 'tenant_email', 'tenant_movein', 'tenant_name', 'tenant_phone', 'visitor_role'];

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
const sent = (page) => page.locator('.tenant-sent');
const status = (page) => page.locator('#tenant-form-status');
const send = (page) => page.locator('#tenant-form button[type=submit]');
const currentStep = (page) => page.locator('[data-lc-dot][aria-current="step"] .lc-lbl').textContent();
const msgOf = (page, sel) => page.locator(`.field:has(${sel}) > .errmsg`);
const oneOfMsg = (page) => page.locator('#tenant-form [data-lc-one-of-msg]');
const leads = (page) => page.evaluate(() => (window.dataLayer || []).filter((d) => d.event === 'lead_submit'));
const lcSubmits = (page) => page.evaluate(() => (window.dataLayer || [])
  .filter((d) => d.event === 'landlord_check' && d.lc_action === 'submit'));
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
/** Google Ads, Google Analytics, Tag Manager, DoubleClick: any of them would be a conversion path. */
const googleHits = (urls) => urls.filter((u) => /^https?:/.test(u) && !FONT_HOSTS.includes(new URL(u).host)
  && /(^|\.)(google|googleadservices|googlesyndication|googletagmanager|google-analytics|doubleclick)\./.test(new URL(u).host));

/**
 * Answer the intake endpoint and record what was sent. `hold`, a promise, keeps the answer back
 * until it settles, so a test can look at the page while the request is still in flight.
 */
async function stubEndpoint(page, { status: code = 200, body = OK, hold = null } = {}) {
  const seen = [];
  await page.route(ENDPOINT, async (route) => {
    const req = route.request();
    seen.push({ method: req.method(), contentType: req.headers()['content-type'] || '', postData: req.postData() || '' });
    if (hold) await hold;
    await route.fulfill({ status: code, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  return seen;
}
/** A multipart body as { name: value }, a file as { file: its name }. */
function parts(body) {
  const out = {};
  for (const m of body.matchAll(/name="([^"]+)"(?:; filename="([^"]*)")?\r\n(?:Content-Type: [^\r]*\r\n)?\r\n([^\r]*)/g)) {
    out[m[1]] = m[2] !== undefined ? { file: m[2] } : m[3];
  }
  return out;
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
/** Serve landlord-check.js with the switch set to false: what every visitor gets if it is turned off. */
async function switchOff(page) {
  await page.route('**/landlord-check.js', async (route) => {
    const res = await route.fetch();
    const js = await res.text();
    await route.fulfill({ response: res, body: js.replace('var TENANT_APPLICATION = true;', 'var TENANT_APPLICATION = false;') });
  });
}
/** After a page load with switchOff(): the switch really is off (a renamed constant fails here). */
async function expectOff(page) {
  expect(await page.evaluate(() => window.rasTenantApplication), 'TENANT_APPLICATION was not switched off').toBe(false);
}

test.beforeEach(async ({ page }) => {
  // Never the real CRM: a test that sends stubs the endpoint itself, which takes precedence.
  await page.route(ENDPOINT, (route) => route.abort('blockedbyclient'));
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
/** "I am the tenant", "Yes, I'm ready to apply": the first step of the application. */
async function toApplication(page, url = '/index.html') {
  await page.goto(url);
  await tenant(page).click();
  await ready(page).click();
  await expect(page.locator('[data-landlord-check] #tenant-form')).toBeVisible();
  expect(await currentStep(page)).toBe('About me');
}
/** The whole application filled in, both documents attached, on its last step. */
async function toFilledApplication(page, url) {
  await toApplication(page, url);
  await fillUntil(page, 'My documents');
  await page.setInputFiles('#ta-doc-lease', { name: 'my-lease.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.setInputFiles('#ta-doc-ledger', { name: 'payment-history.pdf', mimeType: 'application/pdf', buffer: PDF });
  await next(page).click();
  await FILL['Send to my landlord'](page);
}

test.describe('TENANT_APPLICATION = false: every visitor gets exactly what main gave them', () => {
  test('"I am the tenant" shows main\'s free-help screen, word for word, and no request leaves the page', async ({ page }) => {
    await switchOff(page);
    const hits = await stubEndpoint(page);
    await page.goto('/index.html');
    await expectOff(page);
    await expect(tenant(page)).toBeVisible();
    const urls = watchRequests(page);
    await tenant(page).click();
    await expect(helpPanel(page)).toBeVisible();
    await expect(helpPanel(page).locator('.lc-sub')).toHaveText(HELP_MAIN);
    await expect(helpPanel(page).locator('a[href^="tel:"]')).toHaveCount(3);
    // the same two buttons, together, as before
    const stack = helpPanel(page).locator('.lc-stack');
    await expect(stack).toHaveCount(1);
    await expect(stack.getByRole('link', { name: /See all free help for tenants/ })).toHaveAttribute('href', '/tenants/');
    await expect(stack.getByRole('button', { name: 'Close' })).toBeVisible();
    // none of the tenant application exists
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
  });

  test('the homepage gate and a blog page show the same free-help screen', async ({ page }) => {
    await switchOff(page);
    await as(page, 'dismissed');
    await page.goto('/index.html');
    await expectOff(page);
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

  test('site.js refuses the tenant form even when it is forced open and filled; on, the same fill is sent', async ({ page }) => {
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
    await switchOff(page);
    await page.goto('/index.html');
    await expectOff(page);
    const offUrls = watchRequests(page);
    await forceSubmit();
    await page.waitForTimeout(500);
    await expect(sent(page)).toHaveCount(0);
    await expect(page.locator('#tenant-form')).toBeVisible();          // not swapped for a confirmation
    expect(page.url()).toMatch(/\/index\.html$/);                       // and not submitted natively either
    expect(hits).toHaveLength(0);
    expect(foreign(page, offUrls)).toEqual([]);
    // The same fill with the switch on, as shipped: the refusal above was the switch.
    await page.unroute('**/landlord-check.js');
    await page.goto('/index.html');
    expect(await page.evaluate(() => window.rasTenantApplication)).toBe(true);
    await forceSubmit();
    await expect(sent(page)).toContainText(CONFIRM_H);
    expect(hits).toHaveLength(1);
    expect(await leads(page)).toHaveLength(0);
  });

  test('a "start an application" link in the copy is an ordinary Apply link', async ({ page }) => {
    await switchOff(page);
    await as(page, 'dismissed');
    await page.goto('/faq/index.html');
    await expectOff(page);
    const item = page.locator('details.faq-item', { hasText: 'I\'m a tenant. Can you help me?' });
    await item.locator('summary').click();
    await item.locator('a[data-tenant-apply]').click();
    await expect(page.locator('#lc-title-role')).toBeVisible();          // "landlord or tenant?"
    expect(new URL(page.url()).pathname).toBe('/faq/index.html');
  });

  test('a tenant handed over from /tenants/ lands on the homepage with no tenant form and no request', async ({ page }) => {
    // /tenants/ cannot read the switch (it does not load the popup), so its link still hands
    // over. The homepage then ignores the hand-off, as main did.
    await switchOff(page);
    await as(page, 'dismissed');
    const hits = await stubEndpoint(page);
    await page.goto('/tenants/index.html');
    await page.locator('.note a[data-tenant-apply]').click();
    await page.waitForURL((u) => u.pathname === '/');
    await expectOff(page);
    await page.waitForTimeout(800);
    await expect(popup(page)).toHaveCount(0);
    await expect(page.locator('#tenant-form')).toBeHidden();
    expect(hits).toHaveLength(0);
  });
});

test.describe('TENANT_APPLICATION = true (as shipped): what the tenant sees', () => {
  test('it is on for every visitor: no address switch, and the old preview address changes nothing', async ({ page }) => {
    await as(page, 'dismissed');
    const gateTenant = '[data-gate-for="intake-form"] .rg-btn[data-role="tenant"]';
    for (const url of ['/index.html', '/index.html?tenant-preview=0']) {
      await page.goto(url);
      expect(await page.evaluate(() => window.rasTenantApplication)).toBe(true);
      expect(await page.evaluate(() => typeof window.rasTenantPreview)).toBe('undefined');
      await page.click(gateTenant);
      await expect(askPanel(page)).toBeVisible();
      await page.keyboard.press('Escape');
    }
    expect(await page.evaluate(() => sessionStorage.getItem('ras_tenant_preview'))).toBeNull();
  });

  test('two cards, "Not yet" with its start prompt, and "Start my application" opens the form', async ({ page }) => {
    await page.goto('/index.html');
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
    // It says what we are, and no longer that there is nothing for a tenant here.
    await expect(helpPanel(page).locator('.lc-sub')).toHaveText(HELP_ON);
    await expect(helpPanel(page)).not.toContainText('nothing we can file');
    await expect(helpPanel(page).locator('a[href^="tel:"]')).toHaveCount(3);
    await expect(helpPanel(page).getByRole('link', { name: /See all free help for tenants/ })).toHaveAttribute('href', '/tenants/');
    const prompt = helpPanel(page).locator('[data-lc-ready]');
    await expect(prompt.locator('h3')).toHaveText('Ready to apply?');
    await expect(prompt.locator('p')).toHaveText('If you have your landlord’s details, you can start an application here. '
      + 'We send it to your landlord to finish.');
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
    await page.goto('/index.html');
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
    await page.goto('/blog/index.html');
    await tenant(page).click();
    await expect(askPanel(page)).toBeVisible();
    await ready(page).click();
    await page.waitForURL((u) => u.pathname === '/');
    await expect(page.locator('[data-landlord-check] #tenant-form')).toBeVisible();
    expect(await currentStep(page)).toBe('About me');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('"Start my application" on a page without the form hands over the same way', async ({ page }) => {
    await page.goto('/faq/index.html');
    await tenant(page).click();
    await notYet(page).click();
    await startApp(page).click();
    await page.waitForURL((u) => u.pathname === '/');
    await expect(page.locator('[data-landlord-check] #tenant-form')).toBeVisible();
  });

  test('a browser that refuses to store the hand-off lands on the form section, where the gate asks', async ({ page }) => {
    // Safari private mode throws on sessionStorage.setItem, so the hand-off flag can't be kept and
    // the address has to carry the tenant to the form section instead.
    await page.addInitScript(() => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (this === window.sessionStorage) throw new DOMException('QuotaExceededError');
        return real.call(this, k, v);
      };
    });
    await page.goto('/faq/index.html');
    await tenant(page).click();
    await ready(page).click();
    await page.waitForURL((u) => u.pathname === '/' && u.search === '' && u.hash === '#apply');
    await page.click('[data-gate-for="intake-form"] .rg-btn[data-role="tenant"]');
    await expect(askPanel(page)).toBeVisible();
    await ready(page).click();
    await expect(page.locator('[data-landlord-check] #tenant-form')).toBeVisible();
  });

  test('the FAQ answer\'s "start an application" link opens the application', async ({ page }) => {
    await as(page, 'dismissed');
    await page.goto('/faq/index.html');
    const item = page.locator('details.faq-item', { hasText: 'I\'m a tenant. Can you help me?' });
    await item.locator('summary').click();
    await item.locator('a[data-tenant-apply]').click();
    await page.waitForURL((u) => u.pathname === '/');
    await expect(page.locator('[data-landlord-check] #tenant-form')).toBeVisible();
    expect(await currentStep(page)).toBe('About me');
  });

  test('without the popup script, the inline tenant panels say what we are and promise no application', async ({ page }) => {
    // The panels in site.js and on /back-rent/ only show when /landlord-check.js fails to load,
    // and then the tenant application can't open, so they must not offer it.
    await page.route('**/landlord-check.js', (route) => route.abort());
    const firsts = [];
    for (const [url, form] of [['/index.html', 'intake-form'], ['/back-rent/index.html', 'backrent-form']]) {
      await page.goto(url);
      await page.click(`[data-gate-for="${form}"] .rg-btn[data-role="tenant"]`);
      const panel = page.locator('[data-tenant-panel]');
      await expect(panel, url).toBeVisible();
      await expect(panel.locator('h3 + p'), url).toHaveText('Rental Assistance Philadelphia is a private filing service hired by '
        + 'property owners, and we don’t represent tenants.');
      await expect(panel, url).toContainText('the landlord files it, not you');
      await expect(panel, url).not.toContainText(/nothing we can file|rather tell you|start an application|Start my application/);
      firsts.push(await panel.innerText());
    }
    expect(firsts[1], 'the two copies of the panel say the same').toBe(firsts[0]);
  });

  test('the /faq/ schema answer says what the page says, in plain text that stands on its own', async ({ page }) => {
    // The page ends on a link ("Full list: where tenants get help."); the schema has no links, so
    // its last sentence says where the list is instead. Everything before it is the same words.
    await page.goto('/faq/index.html');
    const { schema, shown } = await page.evaluate(() => {
      const n = (s) => s.replace(/\s+/g, ' ').trim();
      const q = 'I\'m a tenant. Can you help me?';
      const faq = [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map((b) => JSON.parse(b.textContent)).find((j) => j['@type'] === 'FAQPage');
      const item = [...document.querySelectorAll('.faq-item')].find((d) => n(d.querySelector('summary').textContent) === q);
      const e = faq.mainEntity.find((x) => x.name === q);
      return { schema: e && n(e.acceptedAnswer.text), shown: item && n(item.querySelector('.ans').textContent) };
    });
    expect(shown).toMatch(/Full list: where tenants get help\.$/);
    expect(schema).toBe(shown.replace(/Full list: where tenants get help\.$/, 'The full list is on our Tenants page.'));
    expect(schema).not.toMatch(/[–—]|where tenants get help/);
  });
});

test.describe('/tenants/: "Have your landlord\'s details? Start your application"', () => {
  test('the page says it, and both of its links open the homepage application', async ({ page }) => {
    await page.goto('/tenants/index.html');
    await expect(page.locator('.hero .lead')).toContainText('we don\'t represent tenants. If you have your landlord\'s details, '
      + 'you can start an application that we send to your landlord to finish.');
    const note = page.locator('.note', { has: page.locator('a[data-tenant-apply]') });
    await expect(note).toHaveText('Have your landlord\'s details? Start your application. If you have your landlord\'s name and an '
      + 'email or phone number for them, you can start an application here. We send it to your landlord to finish. '
      + 'Start my application →');
    await expect(page.locator('#tq-a1')).toHaveText('Not directly. We are hired by property owners to prepare and manage their '
      + 'filings, and we don\'t represent tenants. The Eviction Diversion Program application is filed by the landlord, so we '
      + 'can\'t file it for you. If you have your landlord\'s details, you can start an application that we send to your '
      + 'landlord to finish.');
    await expect(page.locator('a[data-tenant-apply]')).toHaveCount(2);
    // the page itself still has no form and loads no popup
    await expect(page.locator('form')).toHaveCount(0);
    await expect(page.locator('script[src*="landlord-check"]')).toHaveCount(0);

    for (const link of ['.note a[data-tenant-apply]', '#tq-a1 a[data-tenant-apply]']) {
      await page.goto('/tenants/index.html');
      await page.locator(link).click();
      await page.waitForURL((u) => u.pathname === '/');
      await expect(page.locator('[data-landlord-check] #tenant-form'), link).toBeVisible();
      expect(await currentStep(page)).toBe('About me');
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    }
  });

  test('a browser that refuses to store the hand-off follows the link to the form section', async ({ page }) => {
    await page.addInitScript(() => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (this === window.sessionStorage) throw new DOMException('QuotaExceededError');
        return real.call(this, k, v);
      };
    });
    await page.goto('/tenants/index.html');
    await page.locator('.note a[data-tenant-apply]').click();
    await page.waitForURL((u) => u.pathname === '/' && u.hash === '#apply');
  });
});

test.describe('each step checks its answers before Next', () => {
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

  test('documents are optional; both authorizations are required to send, and the first links the terms', async ({ page }) => {
    const hits = await stubEndpoint(page);
    await toApplication(page);
    await fillUntil(page, 'My documents');
    await expect(page.locator('#tenant-form input[type=file]')).toHaveCount(2);
    for (const f of await page.locator('#tenant-form input[type=file]').all()) await expect(f).not.toHaveAttribute('required', '');
    await expect(page.locator('[data-landlord-check] .lc-drop')).toHaveCount(2);         // the site's drop boxes
    await expect(page.locator('#tenant-form fieldset:not([data-lc-off]) .note')).toHaveText(
      'Proof of ownership, a W-9 and bank details come from the landlord, not from you.');
    await next(page).click();                                       // nothing uploaded: still fine
    expect(await currentStep(page)).toBe('Send to my landlord');
    await expect(send(page)).toHaveText(/Send to my landlord/);
    await expect(page.locator('label[for="ta-forward"]')).toHaveText('By completing this application, I am asking Rental '
      + 'Assistance Services to forward it to my landlord. I understand my landlord must provide more information and agree to '
      + 'take part before the application is complete, and that nothing is approved until they do. See the terms for tenants. *');
    // As the landlord application's agreement box links the fee terms, this one links the tenant terms.
    await expect(page.locator('label[for="ta-forward"] a')).toHaveAttribute('href', '/terms.html#tenants');
    await expect(page.locator('label[for="ta-contact"]')).toContainText('I agree to be contacted by email or phone about this application.');
    await send(page).click();
    await expect(sent(page)).toHaveCount(0);
    await expect(msgOf(page, '#ta-forward')).toBeVisible();
    await page.check('#ta-forward');
    await send(page).click();
    await expect(sent(page)).toHaveCount(0);
    await expect(msgOf(page, '#ta-contact')).toBeVisible();
    expect(hits).toHaveLength(0);                                    // nothing sent while a box was missing
    await page.check('#ta-contact');
    await send(page).click();
    await expect(sent(page)).toBeVisible();
    expect(hits).toHaveLength(1);
  });

  test('the terms the box links to have the tenant section', async ({ page }) => {
    const res = await page.goto('/terms.html#tenants');
    expect(res.status()).toBe(200);
    await expect(page.locator('h2#tenants')).toHaveText('8. If you are a tenant');
    const section = page.locator('h2#tenants ~ *').first();
    await expect(section).toContainText('we do not represent tenants');
  });
});

test.describe('sending', () => {
  test('one multipart POST with the tenant\'s answers, the landlord\'s details and both files; the confirmation only after the 200', async ({ page }) => {
    let release;
    const hold = new Promise((r) => { release = r; });
    const hits = await stubEndpoint(page, { hold });
    await toFilledApplication(page);
    await send(page).click();
    await expect.poll(() => hits.length).toBe(1);
    // In flight: not confirmed yet, and the button can't send it twice.
    await expect(status(page)).toHaveText('Submitting…');
    await expect(send(page)).toBeDisabled();
    await page.waitForTimeout(300);
    await expect(sent(page)).toHaveCount(0);
    release();
    await expect(sent(page)).toBeVisible();

    expect(hits[0].method).toBe('POST');
    expect(hits[0].contentType).toMatch(/^multipart\/form-data; boundary=/);
    const body = parts(hits[0].postData);
    expect(Object.keys(body).sort()).toEqual([...FIELDS].sort());
    expect(body).toEqual({
      form_type: 'tenant_application', visitor_role: 'tenant',
      tenant_name: 'Dwayne Carter', tenant_email: 'dwayne@example.com', tenant_phone: '(215) 555-0188', tenant_movein: '',
      landlord_name: 'Marcus Reed', landlord_email: 'landlord@example.com', landlord_phone: '',
      property_street: '1932 N 5th St', property_zip: '19122', property_unit: '', property_address: '1932 N 5th St, 19122',
      monthly_rent: '1150', back_rent_owed: '4200', months_behind: '',
      doc_lease: { file: 'my-lease.pdf' }, doc_ledger: { file: 'payment-history.pdf' },
      authorize_forward: 'on', agree_contact: 'on', hp_x7f2: '',
    });

    await expect(sent(page).locator('h3')).toHaveText(CONFIRM_H);
    await expect(sent(page).locator('h3 + p')).toHaveText(CONFIRM_P);
    await expect(sent(page).locator('.preview-banner')).toHaveCount(0);
    await expect(sent(page)).not.toContainText(/preview|nothing was sent/i);
    await expect(page.locator('#tenant-form')).toBeHidden();
    await expect(page.locator('.lc-count')).toHaveText('Done');
    await page.waitForTimeout(500);
    expect(hits).toHaveLength(1);
  });

  test('the same click ids and utm_* fields go along as on the landlord application', async ({ page }) => {
    const hits = await stubEndpoint(page);
    await toFilledApplication(page, '/index.html?gclid=TEST-GCLID-1&utm_source=google&utm_campaign=landlords');
    await send(page).click();
    await expect(sent(page)).toBeVisible();
    expect(parts(hits[0].postData)).toMatchObject({ gclid: 'TEST-GCLID-1', utm_source: 'google', utm_campaign: 'landlords',
      form_type: 'tenant_application', visitor_role: 'tenant' });
  });

  test('a filled honeypot still goes to the endpoint, as on the landlord application, and its bare ok is no confirmation', async ({ page }) => {
    const hits = await stubEndpoint(page, { body: { ok: true } });   // what the endpoint answers a bot: nothing saved
    await toFilledApplication(page);
    await page.evaluate(() => { document.querySelector('#tenant-hp-x7f2').value = 'Acme Corp'; });
    await send(page).click();
    await expect(status(page)).toHaveText(FAILED);
    await expect(sent(page)).toHaveCount(0);
    expect(parts(hits[0].postData).hp_x7f2).toBe('Acme Corp');
    expect(await leads(page)).toHaveLength(0);
  });

  test('400 missing_required (what Rio answers this form today) is an error, never the confirmation', async ({ page }) => {
    const hits = await stubEndpoint(page, { status: 400, body: { ok: false, error: 'missing_required' } });
    await toFilledApplication(page);
    await page.waitForTimeout(400);                                  // the draft saves 250ms after an edit
    await send(page).click();
    await expect(status(page)).toHaveText(FAILED);
    await expect(status(page)).toHaveClass(/bad/);
    await expect(status(page)).toBeVisible();
    await expect(sent(page)).toHaveCount(0);
    await expect(page.locator('#tenant-form')).toBeVisible();
    await expect(send(page)).toBeEnabled();                          // they can send again
    await expect(page.locator('.lc-count')).toHaveText('Step 7 of 7 · Send to my landlord');
    expect(hits).toHaveLength(1);
    expect(await leads(page)).toHaveLength(0);
    expect((await draft(page)).values.tenant_name).toBe('Dwayne Carter');   // nothing lost
  });

  test('an error the endpoint words for a person is shown as it is, as on the landlord application', async ({ page }) => {
    await stubEndpoint(page, { status: 400, body: { error: 'missing_required', reply: 'Please give your name and a phone or email.' } });
    await toFilledApplication(page);
    await send(page).click();
    await expect(status(page)).toHaveText('Please give your name and a phone or email.');
    await expect(sent(page)).toHaveCount(0);
  });

  // { ok: true } with no contact_id is the endpoint's answer to a tripped honeypot: nothing was saved.
  for (const body of [{ ok: true }, {}, { ok: false }, { contact_id: CONTACT_ID }]) {
    test(`a 200 that answers ${JSON.stringify(body)} is not a success`, async ({ page }) => {
      const hits = await stubEndpoint(page, { body });
      await toFilledApplication(page);
      await send(page).click();
      await expect(status(page)).toHaveText(FAILED);
      await expect(sent(page)).toHaveCount(0);
      expect(hits).toHaveLength(1);
      expect(await leads(page)).toHaveLength(0);
    });
  }

  test('a network failure shows the same error and logs the detail; sending again works', async ({ page }) => {
    const logged = [];
    page.on('console', (m) => { if (m.type() === 'error') logged.push(m.text()); });
    let down = true;
    const hits = [];
    await page.route(ENDPOINT, (route) => {
      hits.push(route.request().method());
      if (down) return route.abort('failed');
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(OK) });
    });
    await toFilledApplication(page);
    await send(page).click();
    await expect(status(page)).toHaveText(FAILED);
    await expect(status(page)).not.toContainText('Failed to fetch');
    await expect(sent(page)).toHaveCount(0);
    expect(logged.join(' ')).toContain('[RAS] submit failed');
    down = false;
    await send(page).click();
    await expect(sent(page)).toBeVisible();
    expect(hits).toHaveLength(2);
    expect(await leads(page)).toHaveLength(0);
  });

  test('never a conversion: no rasTrackLead, no lead_submit, no popup submit, no Google request', async ({ page }) => {
    const hits = await stubEndpoint(page);
    await page.goto('/index.html');
    await page.evaluate(() => {
      window.__leadCalls = 0;
      const real = window.rasTrackLead;
      window.rasTrackLead = function () { window.__leadCalls += 1; return real.apply(this, arguments); };
    });
    const urls = watchRequests(page);
    await tenant(page).click();
    await notYet(page).click();
    await startApp(page).click();
    await fillUntil(page, null);
    await send(page).click();
    await expect(sent(page)).toBeVisible();
    await expect(page.locator('.lc-count')).toHaveText('Done');
    await page.waitForTimeout(1000);
    expect(hits).toHaveLength(1);
    expect(await page.evaluate(() => window.__leadCalls)).toBe(0);
    expect(await leads(page)).toHaveLength(0);
    expect(await lcSubmits(page)).toEqual([]);
    const lc = await page.evaluate(() => (window.dataLayer || []).filter((d) => d.event === 'landlord_check'));
    expect(lc.length).toBeGreaterThan(0);                            // the popup does report, just not this
    expect(googleHits(urls)).toEqual([]);
    // Everything that left the page: Photon (the street box) and the one POST.
    const hosts = [...new Set(foreign(page, urls).map((u) => new URL(u).host))].sort();
    expect(hosts).toEqual([new URL(ENDPOINT).host, 'photon.komoot.io'].sort());
    expect(foreign(page, urls).filter((u) => u === ENDPOINT)).toHaveLength(1);
  });

  test('the saved answers are cleared on sending', async ({ page }) => {
    await stubEndpoint(page);
    await toApplication(page);
    await fillUntil(page, null);
    await page.waitForTimeout(400);                                  // the draft saves 250ms after an edit
    const kept = await draft(page);
    expect(kept.values.tenant_name).toBe('Dwayne Carter');
    expect(kept.values.authorize_forward).toBeUndefined();          // a consent is ticked fresh every time
    expect(kept.values.agree_contact).toBeUndefined();
    await send(page).click();
    await expect(sent(page)).toBeVisible();
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

test.describe('the rest of the popup is as before', () => {
  test('closing a tenant application immediately after Next preserves the draft step', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await toApplication(page);
    await FILL['About me'](page);
    await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
    await next(page).click();
    await page.keyboard.press('Escape');
    await page.clock.runFor(500);
    expect((await draft(page)).step).toBe(1);
  });

  test('closing the landlord application immediately after Next preserves its draft step', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.goto('/index.html');
    await landlord(page).click();
    await page.fill('#owner-name', 'Marcus Reed');
    await page.fill('#owner-email', 'landlord@example.com');
    await page.fill('#owner-email-confirm', 'landlord@example.com');
    await page.fill('#owner-phone', '(215) 555-0123');
    await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
    await next(page).click();
    await page.keyboard.press('Escape');
    await page.clock.runFor(500);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ras_lc_draft:intake-form')));
    expect(saved.step).toBe(1);
  });

  test('no long dashes and nothing under .9rem on any tenant screen, the confirmation and the error', async ({ page }) => {
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
    let down = true;
    await page.route(ENDPOINT, (route) => (down ? route.fulfill({ status: 400, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: false, error: 'missing_required' }) })
      : route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(OK) })));
    await page.goto('/index.html');
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
    await send(page).click();
    await expect(status(page)).toHaveText(FAILED);
    expect(await check(), 'the error').toEqual([]);
    down = false;
    await send(page).click();
    await expect(sent(page)).toBeVisible();
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

  // The landlord application, its payload and its one conversion, with the switch on and off:
  // the same fields with the same values, so the tenant application changes nothing a landlord sends.
  test('the landlord application sends the same payload, and books one conversion, with the switch on as off', async ({ browser }) => {
    const run = async (off) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.route(ENDPOINT, (route) => route.abort('blockedbyclient'));
      await page.route(/googletagmanager\.com|google-analytics\.com/, (route) => route.abort());
      await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ status: 200, contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ type: 'FeatureCollection', features: [] }) }));
      if (off) await switchOff(page);
      const seen = await stubEndpoint(page);
      await page.goto('/index.html');
      expect(await page.evaluate(() => window.rasTenantApplication)).toBe(!off);
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
        contentType: seen[0].contentType.split(';')[0], submits: await lcSubmits(page) };
      await ctx.close();
      return result;
    };
    const off = await run(true);
    const on = await run(false);
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
    expect(on.submits).toHaveLength(1);                              // the popup still reports a landlord's submit
  });
});
