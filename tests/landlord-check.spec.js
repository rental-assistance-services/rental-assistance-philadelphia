/**
 * The landlord-check popup (landlord-check.js) — the popup every lead form lives in.
 *
 * Most visitors to this site are tenants, because the brand is a tenant's search term. The
 * popup asks "own or rent?" before any form is shown, sends tenants to free help without
 * sending anything, and then IS the form: the page's own application is moved into it and
 * shown one section per step, with a progress bar across the top.
 *
 * Every assertion runs in a real browser against the real page, for the same reason as
 * intake-forms.spec.js: the failures that matter here are client-side.
 */
const { test, expect } = require('@playwright/test');

const ENDPOINT = 'https://rio.tworiverdevelopment.tech/rental-assist/intake';
const CONTACT_ID = '5b0c2f4e-3a51-4f0e-9d8c-7c1e0a2d4b61';
const OK = { ok: true, contact_id: CONTACT_ID, files_uploaded: 0, documents: { stored: [], rejected: [] } };

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

/** The homepage application's seven sections, as the progress bar names them. */
const APPLY_STEPS = ['About you (the owner)', 'The property', 'The tenant', 'The money owed',
  'Your documents', 'Eviction-diversion status', 'Fee, authorization & finish'];

const popup = (page) => page.locator('[data-landlord-check]');
const dialog = (page) => page.getByRole('dialog');
const next = (page) => page.locator('[data-landlord-check] [data-lc-next]');
const back = (page) => page.locator('[data-landlord-check] [data-lc-back]');

async function stubEndpoint(page, body = OK, { status = 200 } = {}) {
  const seen = [];
  await page.route(ENDPOINT, async (route) => {
    seen.push({ contentType: route.request().headers()['content-type'] || '',
      postData: route.request().postData() || '' });
    await route.fulfill({ status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  return seen;
}
/** A visitor who already closed the first-visit popup, so only a click can open it. */
async function as(page, v) {
  await page.addInitScript((val) => {
    localStorage.setItem('ras_role_check', JSON.stringify({ v: val, t: Date.now() }));
  }, v);
}

const leads = (page) =>
  page.evaluate(() => (window.dataLayer || []).filter((d) => d.event === 'lead_submit'));
const lcEvents = (page) =>
  page.evaluate(() => (window.dataLayer || []).filter((d) => d.event === 'landlord_check'));
const stored = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('ras_role_check') || 'null'));

/** The step the progress bar currently marks, e.g. "The property". */
const currentStep = (page) => page.locator('[data-lc-dot][aria-current="step"] .lc-lbl').textContent();

const landlord = (page) => page.getByRole('button', { name: /I own or manage rental property/ });

/** Fill the current homepage application section like a person would. */
const SECTION_FILL = {
  'About you (the owner)': async (p) => {
    await p.fill('#owner-name', 'Marcus Reed'); await p.fill('#owner-email', 'landlord@example.com');
    await p.fill('#owner-email-confirm', 'landlord@example.com');
    await p.fill('#owner-phone', '(215) 555-0123'); await p.fill('#owner-units', '3');
  },
  'The property': async (p) => { await p.fill('#prop-address', '1932 N 5th St'); await p.fill('#prop-rent', '1150'); },
  'The tenant': async (p) => { await p.fill('#tenant-name', 'Dwayne Carter'); },
  'The money owed': async (p) => { await p.fill('#back-rent', '4200'); await p.fill('#months-behind', '4'); },
  'Your documents': async () => {},
  'Eviction-diversion status': async () => {},
  'Fee, authorization & finish': async (p) => { await p.check('#consent'); await p.check('#agree-terms'); },
};
async function fillApplication(page) {
  for (const name of APPLY_STEPS) {
    expect(await currentStep(page)).toBe(name);
    await SECTION_FILL[name](page);
    if (name !== APPLY_STEPS[APPLY_STEPS.length - 1]) await next(page).click();
  }
}

// The address box asks Photon for suggestions; tests never reach the real service. Tests
// about suggestions register their own answer (a later route wins).
test.beforeEach(async ({ page }) => {
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ type: 'FeatureCollection', features: [] }) }));
});

/** Shaped like a real Photon answer for "1932 N 5th St" (checked against the live service 2026-09-18). */
const PHOTON_FEATURES = [
  { properties: { housenumber: '1932', street: 'North 5th Street', city: 'Philadelphia', state: 'Pennsylvania',
    postcode: '19122', country: 'United States', countrycode: 'US', type: 'house' } },
  { properties: { housenumber: '1932', street: 'East 5th Street', city: 'New York', state: 'New York',
    postcode: '11223', country: 'United States', countrycode: 'US', type: 'house' } },
  { properties: { housenumber: '12', street: 'Rizal Street', city: 'Quezon City', state: 'Metro Manila',
    postcode: '1100', country: 'Philippines', countrycode: 'PH', type: 'house' } },
];
async function photonAnswers(page, features = PHOTON_FEATURES, { fail = false } = {}) {
  const asked = [];
  await page.route('https://photon.komoot.io/**', (route) => {
    asked.push(route.request().url());
    return fail ? route.abort() : route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ type: 'FeatureCollection', features }) });
  });
  return asked;
}
/** Landlord, at the homepage application's property step. */
async function toPropertyStep(page) {
  await page.goto('/index.html');
  await landlord(page).click();
  await SECTION_FILL['About you (the owner)'](page);
  await next(page).click();
  expect(await currentStep(page)).toBe('The property');
}

test.describe('address suggestions', () => {
  const list = (page) => page.locator('#prop-address-suggest');
  const options = (page) => page.locator('#prop-address-suggest [role=option]');

  test('typing an address offers real addresses, Philadelphia first, with the OpenStreetMap credit', async ({ page }) => {
    const asked = await photonAnswers(page);
    await toPropertyStep(page);
    await page.locator('#prop-address').pressSequentially('1932 N 5th');
    await expect(options(page)).toHaveCount(3);
    await expect(options(page).nth(0)).toContainText('1932 North 5th Street');
    await expect(options(page).nth(0)).toContainText('Philadelphia, PA 19122');
    await expect(options(page).nth(2)).toContainText('Quezon City, Metro Manila 1100, Philippines');   // not only the US
    await expect(list(page)).toContainText('© OpenStreetMap contributors');
    const url = new URL(asked[asked.length - 1]);
    expect(url.searchParams.get('q')).toBe('1932 N 5th');
    expect(url.searchParams.get('lat')).toBe('39.9526');                        // biased to Philadelphia
    await expect(page.locator('#prop-address')).toHaveAttribute('aria-expanded', 'true');
  });

  test('arrow keys + Enter pick one and fill the whole address — Enter does not skip the step', async ({ page }) => {
    await photonAnswers(page);
    await toPropertyStep(page);
    await page.locator('#prop-address').pressSequentially('1932 N 5th');
    await expect(options(page)).toHaveCount(3);
    await page.keyboard.press('ArrowDown');
    await expect(options(page).nth(0)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(page.locator('#prop-address')).toHaveValue('1932 North 5th Street, Philadelphia, PA 19122');
    await expect(list(page)).toBeHidden();
    expect(await currentStep(page)).toBe('The property');
    await expect(page.locator('.field:has(#prop-address)')).toHaveClass(/lc-ok/);
  });

  test('clicking a suggestion picks it', async ({ page }) => {
    await photonAnswers(page);
    await toPropertyStep(page);
    await page.locator('#prop-address').pressSequentially('1932 N 5th');
    await options(page).nth(1).click();
    await expect(page.locator('#prop-address')).toHaveValue('1932 East 5th Street, New York, NY 11223');
    await expect(page.locator('#prop-address')).toBeFocused();
  });

  test('a typed block and lot (or unit) is never lost — it moves to the Unit / Block & Lot box', async ({ page }) => {
    await photonAnswers(page);
    await toPropertyStep(page);
    await expect(page.locator('label[for="prop-unit"]')).toHaveText('Unit / Apt / Block & Lot');
    await page.locator('#prop-address').pressSequentially('Blk 5 Lot 12 1932 N 5th');
    await options(page).nth(0).click();
    await expect(page.locator('#prop-address')).toHaveValue('1932 North 5th Street, Philadelphia, PA 19122');
    await expect(page.locator('#prop-unit')).toHaveValue('Blk 5, Lot 12');
    // and it adds to what is already there, without repeating it
    await page.locator('#prop-address').fill('');
    await page.locator('#prop-address').pressSequentially('Apt 3 Lot 12 1932 N 5th');
    await options(page).nth(0).click();
    await expect(page.locator('#prop-unit')).toHaveValue('Blk 5, Lot 12, Apt 3');
  });

  test('/back-rent/ has no unit box, so a block and lot stays at the front of the address', async ({ page }) => {
    await photonAnswers(page);
    await page.goto('/back-rent/index.html');
    await landlord(page).click();
    await page.locator('#prop-address').pressSequentially('Block 5 Lot 12 1932 N 5th');
    await options(page).nth(0).click();
    await expect(page.locator('#prop-address')).toHaveValue('Block 5 Lot 12, 1932 North 5th Street, Philadelphia, PA 19122');
  });

  test('Escape closes the list, not the popup; fewer than 3 letters asks nothing', async ({ page }) => {
    const asked = await photonAnswers(page);
    await toPropertyStep(page);
    await page.locator('#prop-address').pressSequentially('19');
    await page.waitForTimeout(500);
    expect(asked).toHaveLength(0);
    await page.locator('#prop-address').pressSequentially('32 N');
    await expect(options(page)).toHaveCount(3);
    await page.keyboard.press('Escape');
    await expect(list(page)).toBeHidden();
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('#prop-address')).toHaveValue('1932 N');   // what they typed is untouched
  });

  const manual = (page) => page.locator('#prop-address-suggest .lc-suggest-manual');

  test('under the suggestions it says typing the address yourself is fine — and that line is not an option', async ({ page }) => {
    await photonAnswers(page);
    await toPropertyStep(page);
    await page.locator('#prop-address').pressSequentially('1932 N 5th');
    await expect(options(page)).toHaveCount(3);
    await expect(manual(page)).toHaveText('Don’t see your address? You can still type it in yourself.');
    // it sits after the last suggestion, above the credit line
    const order = await list(page).evaluate((el) => Array.from(el.children).map((li) => li.className || li.getAttribute('role')));
    expect(order).toEqual(['option', 'option', 'option', 'lc-suggest-manual', 'lc-suggest-note']);
    // arrows wrap from the last suggestion to the first, never landing on the line
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
    await expect(options(page).nth(0)).toHaveAttribute('aria-selected', 'true');
    // clicking it changes nothing
    await manual(page).click();
    await expect(page.locator('#prop-address')).toHaveValue('1932 N 5th');
  });

  test('no match: the list says so, and that they can type it themselves', async ({ page }) => {
    await photonAnswers(page, []);
    await toPropertyStep(page);
    await page.locator('#prop-address').pressSequentially('Block 5 Lot 12 Sampaguita');
    await expect(manual(page)).toHaveText('We couldn’t find a match — you can still type your full address yourself.');
    await expect(options(page)).toHaveCount(0);
    await expect(list(page)).not.toContainText('OpenStreetMap');       // nothing of theirs is shown
    // Escape closes the list, not the popup
    await page.keyboard.press('Escape');
    await expect(list(page)).toBeHidden();
    await expect(dialog(page)).toBeVisible();
  });

  test('Photon too slow: after 2.5s the list says to type it; real suggestions still replace it', async ({ page }) => {
    let release;
    const gate = new Promise((r) => { release = r; });
    await page.route('https://photon.komoot.io/**', async (route) => {
      await gate;
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ type: 'FeatureCollection', features: PHOTON_FEATURES }) });
    });
    await toPropertyStep(page);
    await page.locator('#prop-address').pressSequentially('1932 N 5th');
    await page.waitForTimeout(1500);
    await expect(list(page)).toBeHidden();                           // not straight away
    await expect(manual(page)).toContainText('you can still type your full address yourself', { timeout: 3000 });
    release();
    await expect(options(page)).toHaveCount(3);
    await expect(manual(page)).toHaveText('Don’t see your address? You can still type it in yourself.');
  });

  test('if Photon is down, the list says to type it, and the box still works as a text box', async ({ page }) => {
    await photonAnswers(page, [], { fail: true });
    await toPropertyStep(page);
    await page.locator('#prop-address').pressSequentially('1932 N 5th St');
    await expect(manual(page)).toHaveText('We couldn’t find a match — you can still type your full address yourself.');
    await expect(options(page)).toHaveCount(0);
    await expect(page.locator('#prop-address')).toHaveValue('1932 N 5th St');
    await page.fill('#prop-rent', '1150');
    await next(page).click();
    expect(await currentStep(page)).toBe('The tenant');
  });

  test('on a phone the list is in the flow, so nothing is cut off at the bottom of the screen', async ({ page }) => {
    await photonAnswers(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await toPropertyStep(page);
    await page.locator('#prop-address').pressSequentially('1932 N 5th');
    await expect(options(page)).toHaveCount(3);
    expect(await list(page).evaluate((el) => getComputedStyle(el).position)).toBe('static');
    const note = page.locator('.lc-suggest-note');
    await note.scrollIntoViewIfNeeded();
    await expect(note).toBeInViewport();
  });

  test('the list fades down over 350ms, ease-in', async ({ page }) => {
    await photonAnswers(page);
    await toPropertyStep(page);
    await page.locator('#prop-address').pressSequentially('1932 N 5th');
    await expect(options(page)).toHaveCount(3);
    const a = await list(page).evaluate((el) => {
      const s = getComputedStyle(el); return [s.animationName, s.animationDuration, s.animationTimingFunction];
    });
    expect(a).toEqual(['lc-down', '0.35s', 'ease-in']);
  });
});

/** Walk the homepage application to a named step, filling each section on the way. */
async function toStep(page, name) {
  await page.goto('/index.html');
  await landlord(page).click();
  for (const s of APPLY_STEPS) {
    if (s === name) break;
    await SECTION_FILL[s](page);
    await next(page).click();
  }
  expect(await currentStep(page)).toBe(name);
}

test.describe('file uploads look like the site', () => {
  const zone = (page, id) => page.locator(`.lc-drop:has(#${id})`);
  const pdf = (name, bytes = 2048) => ({ name, mimeType: 'application/pdf', buffer: Buffer.alloc(bytes, 1) });

  test('each upload is a drop box with the accepted types and the size limit', async ({ page }) => {
    await toStep(page, 'Your documents');
    await expect(page.locator('#intake-form .lc-drop')).toHaveCount(5);
    await expect(zone(page, 'doc-lease')).toContainText('Drag a file here or browse');
    await expect(zone(page, 'doc-lease')).toContainText('PDF, JPG, PNG or HEIC · up to 15MB');
    await expect(zone(page, 'doc-ledger')).toContainText('PDF, JPG, PNG, HEIC, XLSX or CSV · up to 15MB');
    // the real input is still there, covering the box, so a click anywhere opens the picker
    const cover = await page.locator('#doc-lease').evaluate((el) => {
      const a = el.getBoundingClientRect(), b = el.parentElement.getBoundingClientRect();
      // inside the box's 1.5px border on each side, so up to ~3px smaller
      return a.width > 0 && Math.abs(a.width - b.width) <= 4 && Math.abs(a.height - b.height) <= 4
        && getComputedStyle(el).opacity === '0';
    });
    expect(cover).toBe(true);
  });

  test('a chosen file shows its name and size, a check, and Remove', async ({ page }) => {
    await toStep(page, 'Your documents');
    await page.setInputFiles('#doc-lease', pdf('signed-lease.pdf', 250 * 1024));
    await expect(zone(page, 'doc-lease')).toHaveClass(/lc-has/);
    await expect(zone(page, 'doc-lease')).toContainText('signed-lease.pdf');
    await expect(zone(page, 'doc-lease')).toContainText('250 KB');
    await expect(page.locator('.field:has(#doc-lease)')).toHaveClass(/lc-ok/);
    await zone(page, 'doc-lease').getByRole('button', { name: 'Remove' }).click();
    await expect(zone(page, 'doc-lease')).not.toHaveClass(/lc-has/);
    await expect(zone(page, 'doc-lease')).toContainText('Drag a file here or browse');
    expect(await page.locator('#doc-lease').evaluate((el) => el.files.length)).toBe(0);
  });

  test('a wrong type or a file over 15MB is refused on the spot, with the reason', async ({ page }) => {
    await toStep(page, 'Your documents');
    const msg = page.locator('.field:has(#doc-lease) > .errmsg');
    await page.setInputFiles('#doc-lease', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
    await expect(msg).toContainText('“notes.txt” isn’t a file we can take — please use PDF, JPG, PNG or HEIC.');
    expect(await page.locator('#doc-lease').evaluate((el) => el.files.length)).toBe(0);
    await page.setInputFiles('#doc-lease', pdf('huge-scan.pdf', 16 * 1024 * 1024));
    await expect(msg).toContainText('“huge-scan.pdf” is 16.0 MB — files must be under 15MB.');
    expect(await page.locator('#doc-lease').evaluate((el) => el.files.length)).toBe(0);
    await page.setInputFiles('#doc-lease', pdf('lease.pdf'));
    await expect(msg).toBeHidden();
  });

  test('an attached file is still what the form sends', async ({ page }) => {
    await toStep(page, 'Your documents');
    await page.setInputFiles('#doc-w9', pdf('w9.pdf'));
    const sent = await page.locator('#intake-form').evaluate((f) => { const v = new FormData(f).get('doc_w9'); return v && v.name; });
    expect(sent).toBe('w9.pdf');
  });
});

test.describe('the move-in date and its calendar look like the site', () => {
  const shown = (page) => page.locator('#tenant-movein-shown');
  const native = (page) => page.locator('#tenant-movein');
  const cal = (page) => page.locator('#tenant-movein-cal');
  const msg = (page) => page.locator('.field:has(#tenant-movein) > .errmsg');
  const sentDate = (page) => page.locator('#intake-form').evaluate((f) => new FormData(f).get('tenant_movein'));

  test('typing digits builds MM/DD/YYYY, and the form still sends YYYY-MM-DD', async ({ page }) => {
    await toStep(page, 'The tenant');
    await expect(native(page)).toBeHidden();
    await expect(page.locator('label[for="tenant-movein-shown"]')).toHaveText('Move-in date');
    await shown(page).pressSequentially('03152024');
    await expect(shown(page)).toHaveValue('03/15/2024');
    expect(await sentDate(page)).toBe('2024-03-15');
    await expect(page.locator('.field:has(#tenant-movein)')).toHaveClass(/lc-ok/);
  });

  test('not a real date, a future date, or half a date — each says why, and nothing is sent', async ({ page }) => {
    await toStep(page, 'The tenant');
    await shown(page).pressSequentially('02302024');
    await expect(msg(page)).toContainText('That isn’t a real date');
    expect(await sentDate(page)).toBe('');
    await shown(page).fill('');
    await shown(page).pressSequentially('01012999');
    await expect(msg(page)).toHaveText('The move-in date can’t be in the future.');
    expect(await sentDate(page)).toBe('');
    await shown(page).fill('');
    await shown(page).pressSequentially('0315');
    await expect(msg(page)).toBeHidden();                      // still typing
    await page.keyboard.press('Tab');
    await expect(msg(page)).toHaveText('Enter the full date, e.g. 03/15/2024.');
  });

  test('the calendar: month and year dropdowns, pick a day, it fills the box and closes', async ({ page }) => {
    await toStep(page, 'The tenant');
    await page.getByRole('button', { name: 'Open calendar' }).click();
    await expect(cal(page)).toBeVisible();
    const anim = await cal(page).evaluate((el) => { const s = getComputedStyle(el); return [s.animationName, s.animationDuration, s.animationTimingFunction]; });
    expect(anim).toEqual(['lc-down', '0.35s', 'ease-in']);
    await cal(page).locator('[data-cal-year]').selectOption('2023');
    await cal(page).locator('[data-cal-month]').selectOption('2');       // March
    await cal(page).getByRole('button', { name: 'March 15, 2023' }).click();
    await expect(cal(page)).toBeHidden();
    await expect(shown(page)).toHaveValue('03/15/2023');
    expect(await sentDate(page)).toBe('2023-03-15');
    await expect(shown(page)).toBeFocused();
    // reopening shows the chosen day selected
    await page.getByRole('button', { name: 'Open calendar' }).click();
    await expect(cal(page).getByRole('button', { name: 'March 15, 2023' })).toHaveAttribute('aria-selected', 'true');
  });

  test('open calendar: the icon stays on the input, and "September" and the year fit their dropdowns', async ({ page }) => {
    await toStep(page, 'The tenant');
    await page.getByRole('button', { name: 'Open calendar' }).click();
    await expect(cal(page)).toBeVisible();
    await cal(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const [b, i] = await Promise.all([page.getByRole('button', { name: 'Open calendar' }).boundingBox(), shown(page).boundingBox()]);
    expect(Math.abs((b.y + b.height / 2) - (i.y + i.height / 2))).toBeLessThan(2);    // centred on the input
    await cal(page).locator('[data-cal-month]').selectOption('8');                   // September, the longest
    const fits = await cal(page).locator('.lc-cal-sel').evaluateAll((els) => els.map((el) => {
      const probe = document.createElement('span');
      const s = getComputedStyle(el);
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:' + s.font;
      probe.textContent = el.options[el.selectedIndex].text;
      document.body.appendChild(probe);
      const need = probe.getBoundingClientRect().width + parseFloat(s.paddingLeft) + parseFloat(s.paddingRight);
      probe.remove();
      return need <= el.clientWidth + 0.5;
    }));
    expect(fits).toEqual([true, true]);
    // and they still read as dropdowns: the brass chevron is showing
    const chevrons = await cal(page).locator('.lc-cal-sel').evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundImage));
    chevrons.forEach((bg) => expect(bg).toContain('svg'));
  });

  test('the calendar works by keyboard, and Escape closes it — not the popup', async ({ page }) => {
    await toStep(page, 'The tenant');
    await shown(page).pressSequentially('03152023');
    await page.getByRole('button', { name: 'Open calendar' }).click();
    await expect(cal(page).getByRole('button', { name: 'March 15, 2023' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await expect(cal(page).getByRole('button', { name: 'March 23, 2023' })).toBeFocused();
    await page.keyboard.press('PageUp');
    await expect(cal(page).getByRole('button', { name: 'February 23, 2023' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(shown(page)).toHaveValue('02/23/2023');
    expect(await currentStep(page)).toBe('The tenant');         // Enter picked, it didn't move on
    await page.getByRole('button', { name: 'Open calendar' }).click();
    await page.keyboard.press('Escape');
    await expect(cal(page)).toBeHidden();
    await expect(dialog(page)).toBeVisible();
  });

  test('future days can\'t be picked, and Today / Clear work', async ({ page }) => {
    await toStep(page, 'The tenant');
    await page.getByRole('button', { name: 'Open calendar' }).click();
    await expect(cal(page).getByRole('button', { name: 'Next month' })).toBeDisabled();
    const t = new Date(); const tomorrow = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
    if (tomorrow.getMonth() === t.getMonth()) {
      const label = tomorrow.toLocaleString('en-US', { month: 'long' }) + ' ' + tomorrow.getDate() + ', ' + tomorrow.getFullYear();
      await expect(cal(page).getByRole('button', { name: label })).toBeDisabled();
    }
    await cal(page).getByRole('button', { name: 'Today' }).click();
    const pad = (n) => String(n).padStart(2, '0');
    await expect(shown(page)).toHaveValue(`${pad(t.getMonth() + 1)}/${pad(t.getDate())}/${t.getFullYear()}`);
    await page.getByRole('button', { name: 'Open calendar' }).click();
    await cal(page).getByRole('button', { name: 'Clear' }).click();
    await expect(shown(page)).toHaveValue('');
    expect(await sentDate(page)).toBe('');
  });

  test('a saved move-in date comes back in the box', async ({ page }) => {
    await toStep(page, 'The tenant');
    await shown(page).pressSequentially('03152024');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ras_lc_draft:intake-form') || '{}').values?.tenant_movein)).toBe('2024-03-15');
    await page.reload();
    await page.locator('#nav-links a.cta').evaluate((a) => a.click());
    await expect(shown(page)).toHaveValue('03/15/2024');
  });
});

test.describe('answers are kept for an hour', () => {
  const draft = (page, id = 'intake-form') =>
    page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), 'ras_lc_draft:' + id);
  const openApply = (page) => page.locator('#nav-links a.cta').evaluate((a) => a.click());
  const note = (page) => page.locator('.lc-restored');

  test('after a reload the answers — and the verified email — come back, on the step they reached', async ({ page }) => {
    await page.goto('/index.html');
    await landlord(page).click();
    await SECTION_FILL['About you (the owner)'](page);
    await page.fill('#owner-entity', 'Reed Property Group LLC');
    await next(page).click();
    await page.fill('#prop-address', '1932 N 5th St');
    await expect.poll(async () => (await draft(page))?.values?.property_address).toBe('1932 N 5th St');
    await page.reload();
    await openApply(page);
    // picks up where they were
    expect(await currentStep(page)).toBe('The property');
    await expect(page.locator('#prop-address')).toHaveValue('1932 N 5th St');
    await expect(note(page)).toContainText('we kept what you typed on this device for an hour');
    await back(page).click();
    await expect(page.locator('#owner-name')).toHaveValue('Marcus Reed');
    await expect(page.locator('#owner-entity')).toHaveValue('Reed Property Group LLC');
    await expect(page.locator('#owner-phone')).toHaveValue('(215) 555-0123');
    await expect(page.locator('#owner-units')).toHaveValue('3');
    // the email comes back verified, retype and all, with its check
    await expect(page.locator('#owner-email')).toHaveValue('landlord@example.com');
    await expect(page.locator('.field:has(#owner-email)')).toHaveClass(/lc-verified/);
    await expect(page.locator('#owner-email-confirm')).toHaveValue('landlord@example.com');
    await expect(page.locator('.field:has(#owner-name)')).toHaveClass(/lc-ok/);
    // and Next goes straight through — nothing has to be retyped
    await next(page).click();
    expect(await currentStep(page)).toBe('The property');
  });

  test('the consent boxes are never kept — a legal authorisation is ticked fresh each time', async ({ page }) => {
    await page.goto('/index.html');
    await landlord(page).click();
    await fillApplication(page);                               // ends on the last step with both ticked
    await expect(page.locator('#consent')).toBeChecked();
    await expect.poll(async () => (await draft(page))?.step).toBe(6);
    await page.waitForTimeout(600);                            // let the save after the ticks land
    const saved = await draft(page);
    expect(saved.values.consent).toBeUndefined();
    expect(saved.values.agree_terms).toBeUndefined();
    await page.reload();
    await openApply(page);
    expect(await currentStep(page)).toBe('Fee, authorization & finish');
    await expect(page.locator('#consent')).not.toBeChecked();
    await expect(page.locator('#agree-terms')).not.toBeChecked();
  });

  test('after an hour they are gone', async ({ page }) => {
    await page.goto('/index.html');
    await landlord(page).click();
    await page.fill('#owner-name', 'Marcus Reed');
    await expect.poll(async () => (await draft(page))?.values?.owner_name).toBe('Marcus Reed');
    await page.evaluate(() => {                                // pretend it was saved 61 minutes ago
      const k = 'ras_lc_draft:intake-form', o = JSON.parse(localStorage.getItem(k));
      o.t = Date.now() - 61 * 60 * 1000; localStorage.setItem(k, JSON.stringify(o));
    });
    await page.reload();
    await openApply(page);
    await expect(page.locator('#owner-name')).toHaveValue('');
    await expect(note(page)).toBeHidden();
    expect(await draft(page)).toBeNull();
  });

  test('reopening does not restart the hour — only an edit does', async ({ page }) => {
    await page.goto('/index.html');
    await landlord(page).click();
    await page.fill('#owner-name', 'Marcus Reed');
    await expect.poll(async () => (await draft(page))?.values?.owner_name).toBe('Marcus Reed');
    await page.evaluate(() => {
      const k = 'ras_lc_draft:intake-form', o = JSON.parse(localStorage.getItem(k));
      o.t = Date.now() - 50 * 60 * 1000; localStorage.setItem(k, JSON.stringify(o));
    });
    const before = (await draft(page)).t;
    await page.reload();
    await openApply(page);
    await page.waitForTimeout(500);
    expect((await draft(page)).t).toBe(before);                // looked at, not edited
    await page.locator('#owner-name').pressSequentially('s');
    await expect.poll(async () => (await draft(page)).t).toBeGreaterThan(before);
  });

  test('submitting deletes the saved answers', async ({ page }) => {
    await stubEndpoint(page);
    await page.goto('/index.html');
    await landlord(page).click();
    await fillApplication(page);
    await expect.poll(async () => await draft(page)).not.toBeNull();
    await page.click('#intake-form button[type=submit]');
    await expect(page.locator('[data-landlord-check] .callout[role=status]')).toBeVisible();
    await expect.poll(async () => await draft(page)).toBeNull();
  });

  test('"Start over" empties the form and forgets the saved answers', async ({ page }) => {
    await page.goto('/index.html');
    await landlord(page).click();
    await SECTION_FILL['About you (the owner)'](page);
    await next(page).click();
    await expect.poll(async () => (await draft(page))?.step).toBe(1);
    await page.reload();
    await openApply(page);
    await page.getByRole('button', { name: 'Start over' }).click();
    expect(await currentStep(page)).toBe('About you (the owner)');
    await expect(page.locator('#owner-name')).toHaveValue('');
    await expect(page.locator('#owner-email')).toHaveValue('');
    await expect(page.locator('.field:has(#owner-email)')).not.toHaveClass(/lc-verified/);
    await expect(note(page)).toBeHidden();
    expect(await draft(page)).toBeNull();
  });

  test('the case-review form is kept too', async ({ page }) => {
    await as(page, 'dismissed');
    await page.goto('/index.html');
    await page.locator('footer a[href="#contact"]').evaluate((a) => a.click());
    await landlord(page).click();
    await page.fill('#c-name', 'Marcus Reed');
    await page.fill('#c-message', 'Tenant is four months behind.');
    await expect.poll(async () => (await draft(page, 'contact-form'))?.values?.name).toBe('Marcus Reed');
    await page.reload();
    await page.locator('footer a[href="#contact"]').evaluate((a) => a.click());
    await landlord(page).click();
    await expect(page.locator('#c-name')).toHaveValue('Marcus Reed');
    await expect(page.locator('#c-message')).toHaveValue('Tenant is four months behind.');
  });
});

test.describe('where it opens by itself', () => {
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

  test('closing it is remembered — the next page does not open it again', async ({ page }) => {
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
  test('gets the free help lines, POSTs nothing, books nothing, and is not asked again', async ({ page }) => {
    const seen = await stubEndpoint(page);
    await page.goto('/index.html');
    await page.getByRole('button', { name: /I rent my home/ }).click();
    await expect(dialog(page)).toContainText('the landlord has to apply');
    await expect(page.getByRole('link', { name: /free help for tenants/ })).toHaveAttribute('href', '/tenants/');
    await expect(page.locator('#intake-form')).toBeHidden();
    expect(seen).toHaveLength(0);
    expect(await leads(page)).toHaveLength(0);
    expect((await stored(page)).v).toBe('tenant');
    await page.goto('/back-rent/index.html');
    await page.waitForTimeout(1200);
    await expect(popup(page)).toHaveCount(0);
  });
});

test.describe('landlord — the homepage application, inside the popup', () => {
  test('the real application moves into the popup, one section per step', async ({ page }) => {
    await page.goto('/index.html');
    await landlord(page).click();
    await expect(page.locator('[data-landlord-check] #intake-form')).toBeVisible();
    await expect(page.locator('[data-lc-dot]')).toHaveCount(8);          // who you are + 7 sections
    await expect(page.locator('.lc-count')).toHaveText('Step 2 of 8 · About you (the owner)');
    // only the current section is on screen
    await expect(page.locator('#owner-name')).toBeVisible();
    await expect(page.locator('#prop-address')).toBeHidden();
    await expect(page.locator('#intake-form input[name="visitor_role"]')).toHaveValue('landlord');
  });

  test('Next is refused until the section is valid, using the form\'s own checks', async ({ page }) => {
    await page.goto('/index.html');
    await landlord(page).click();
    await next(page).click();
    expect(await currentStep(page)).toBe('About you (the owner)');
    await expect(page.locator('#owner-name')).toHaveClass(/err/);
    await page.fill('#owner-name', 'Marcus Reed');
    await page.fill('#owner-email', 'not-an-email');
    await page.fill('#owner-phone', '2155550123');
    await page.fill('#owner-units', '3');
    await next(page).click();
    expect(await currentStep(page)).toBe('About you (the owner)');
    await page.fill('#owner-email', 'landlord@example.com');
    await page.fill('#owner-email-confirm', 'landlord@example.com');
    await next(page).click();
    expect(await currentStep(page)).toBe('The property');
  });

  test('a field is not marked wrong until the visitor has typed in it', async ({ page }) => {
    await page.goto('/index.html');
    await landlord(page).click();
    await page.focus('#owner-name');
    await page.keyboard.press('Tab');                          // pass over it without typing
    await expect(page.locator('#owner-name')).not.toHaveClass(/err/);
    await expect(page.locator('#owner-name + .errmsg, #owner-name ~ .errmsg').first()).toBeHidden();
  });

  test('errors show live while typing, and clear as soon as the value is right', async ({ page }) => {
    await page.goto('/index.html');
    await landlord(page).click();
    const email = page.locator('#owner-email');
    const msg = page.locator('.field:has(#owner-email) > .errmsg');
    await email.pressSequentially('marcus@exa');               // still typing, still focused
    await expect(email).toBeFocused();
    await expect(msg).toBeVisible();
    await expect(page.locator('.field:has(#owner-email)')).not.toHaveClass(/lc-ok/);
    await email.pressSequentially('mple.com');
    await expect(msg).toBeHidden();
    // a valid email isn't "done" yet — it still has to be confirmed
    await expect(page.locator('#owner-email-confirm')).toBeVisible();
    await expect(page.locator('.field:has(#owner-email)')).not.toHaveClass(/lc-ok/);
  });

  test('a name of 150 characters or more is an error — while typing, no check, and Next held', async ({ page }) => {
    await page.goto('/index.html');
    await landlord(page).click();
    const name = page.locator('#owner-name');
    const field = page.locator('.field:has(#owner-name)');
    const msg = page.locator('.field:has(#owner-name) > .errmsg');
    const long = ('Marcus ' + 'abcdefghij'.repeat(20)).slice(0, 149);   // a real-looking 149
    await name.fill(long);
    await expect(msg).toBeHidden();
    await expect(field).toHaveClass(/lc-ok/);
    await name.pressSequentially('k');                         // 150: an error, not a check
    await expect(msg).toBeVisible();
    await expect(msg).toContainText('under 150 characters (150 now)');
    await expect(field).not.toHaveClass(/lc-ok/);
    // and it holds Next, even with everything else filled in
    await page.fill('#owner-email', 'landlord@example.com');
    await page.fill('#owner-email-confirm', 'landlord@example.com');
    await page.fill('#owner-phone', '2155550123');
    await page.fill('#owner-units', '3');
    await next(page).click();
    expect(await currentStep(page)).toBe('About you (the owner)');
    await name.press('Backspace');                             // back to 149
    await expect(msg).toBeHidden();
    // the page's own message comes back for the page's own rule
    await name.fill('');
    await expect(msg).toHaveText('Please enter your full name.');
  });

  test('a name must be a real first and last name', async ({ page }) => {
    await page.goto('/index.html');
    await landlord(page).click();
    const name = page.locator('#owner-name');
    const field = page.locator('.field:has(#owner-name)');
    const msg = page.locator('.field:has(#owner-name) > .errmsg');
    // a digit or symbol is wrong the moment it's typed
    await name.pressSequentially('Marcus 3');
    await expect(name).toBeFocused();
    await expect(msg).toHaveText('Names can only use letters, spaces, hyphens (-), apostrophes (’) and periods.');
    await name.fill('');
    await name.pressSequentially('Mar$us');
    await expect(msg).toContainText('Names can only use letters');
    // one word is fine WHILE typing (they haven't got to the surname yet) — but no check...
    await name.fill('');
    await name.pressSequentially('Marcus');
    await expect(msg).toBeHidden();
    await expect(field).not.toHaveClass(/lc-ok/);
    // ...and an error once they leave the field
    await page.keyboard.press('Tab');
    await expect(msg).toHaveText('Please enter your first and last name.');
    // keyboard-mash repeats
    await name.fill('Maaarcus Reed');
    await expect(msg).toHaveText('That doesn’t look like a real name.');
    // initials only
    await name.fill('M. R.');
    await page.keyboard.press('Tab');
    await expect(msg).toContainText('not just initials');
    // Caps Lock is refused as it is typed — whole name, one part, or after an apostrophe
    for (const shouty of ['MARCUS REED', 'Marcus REED', 'Keana O’NEIL']) {
      await name.fill('');
      await name.pressSequentially(shouty);
      await expect(msg).toHaveText('Please type your name normally, not in all capitals — e.g. Marcus Reed.');
      await expect(field).not.toHaveClass(/lc-ok/);
    }
    // ...but capitals inside a normal name are fine, and so are suffixes and initials
    for (const fine of ['Ronald McDonald', 'DeShawn Carter III', 'J. Marcus Reed']) {
      await name.fill(fine);
      await page.keyboard.press('Tab');
      await expect(msg, fine).toBeHidden();
      await expect(field, fine).toHaveClass(/lc-ok/);
      await name.focus();
    }
    // real names with accents, apostrophes and hyphens pass
    await name.fill('José O’Neil-Smith');
    await page.keyboard.press('Tab');
    await expect(msg).toBeHidden();
    await expect(field).toHaveClass(/lc-ok/);
  });

  test('a phone must be a real 10-digit US number, and is tidied when you leave it', async ({ page }) => {
    await page.goto('/index.html');
    await landlord(page).click();
    const phone = page.locator('#owner-phone');
    const field = page.locator('.field:has(#owner-phone)');
    const msg = page.locator('.field:has(#owner-phone) > .errmsg');
    // digits only: the brackets, space and dash appear by themselves AS they type
    const steps = { 1: '(2', 3: '(215', 4: '(215) 5', 6: '(215) 555', 7: '(215) 555-0', 10: '(215) 555-0123' };
    const digits = '2155550123';
    for (let i = 1; i <= digits.length; i++) {
      await phone.press(digits[i - 1]);
      if (steps[i]) await expect(phone, `after ${i} digits`).toHaveValue(steps[i]);
    }
    await expect(phone).toBeFocused();
    await expect(msg).toBeHidden();
    await expect(field).toHaveClass(/lc-ok/);
    // Backspace always removes a digit — it never gets stuck on a ")" or "-"
    for (let i = 0; i < 4; i++) await phone.press('Backspace');   // 10 digits -> 6
    await expect(phone).toHaveValue('(215) 555');
    for (let i = 0; i < 2; i++) await phone.press('Backspace');   // -> 4
    await expect(phone).toHaveValue('(215) 5');
    await phone.press('Backspace');                               // -> 3
    await expect(phone).toHaveValue('(215');
    // letters and symbols never land; digits past ten are ignored
    await phone.fill('');
    await phone.pressSequentially('215abc555-!0123999');
    await expect(phone).toHaveValue('(215) 555-0123');
    await expect(msg).toBeHidden();
    // editing in the middle keeps the caret where it was
    await phone.fill('');
    await phone.pressSequentially('2155550123');
    await phone.evaluate((el) => el.setSelectionRange(1, 1));   // after "("
    await phone.press('Delete');                               // remove the "2"
    await phone.pressSequentially('3');
    await expect(phone).toHaveValue('(315) 555-0123');
    // too few: fine while typing, an error on leaving
    await phone.fill('');
    await phone.pressSequentially('215555');
    await expect(msg).toBeHidden();
    await page.keyboard.press('Tab');
    await expect(msg).toContainText('Enter a 10-digit US phone number');
    // a complete number with an impossible area code
    await phone.fill('');
    await phone.pressSequentially('0215550123');
    await expect(msg).toContainText('area code');
    // a leading 1 shows as a country code while typing, and is tidied away on leaving
    await phone.fill('');
    await phone.pressSequentially('12155550123');
    await expect(phone).toHaveValue('1 (215) 555-0123');
    await page.keyboard.press('Tab');
    await expect(phone).toHaveValue('(215) 555-0123');
    await expect(field).toHaveClass(/lc-ok/);
  });

  test('the retype box can only be typed into — no paste, no drop, no autofill', async ({ page }) => {
    await page.goto('/index.html');
    await landlord(page).click();
    await page.locator('#owner-email').pressSequentially('landlord@example.com');
    await page.keyboard.press('Tab');
    const confirm = page.locator('#owner-email-confirm');
    const cmsg = page.locator('.lc-confirm .errmsg');
    const field = page.locator('.field:has(#owner-email)');
    // nothing for a browser or password manager to recognise as an email field
    await expect(confirm).toHaveAttribute('type', 'text');
    await expect(confirm).toHaveAttribute('autocomplete', 'off');
    expect(await confirm.getAttribute('name')).toBeNull();
    // paste
    const pasted = await confirm.evaluate((el) => {
      const e = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertFromPaste', data: 'landlord@example.com' });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(pasted).toBe(true);
    await expect(cmsg).toContainText('pasting and autofill are turned off');
    // drop
    const dropped = await confirm.evaluate((el) => {
      const e = new Event('drop', { bubbles: true, cancelable: true }); el.dispatchEvent(e); return e.defaultPrevented;
    });
    expect(dropped).toBe(true);
    // autofill: the value appears with no typed input event — it is cleared, not accepted
    await confirm.evaluate((el) => { el.value = 'landlord@example.com'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect(confirm).toHaveValue('');
    await expect(field).not.toHaveClass(/lc-verified/);
    // typing it still works
    await confirm.pressSequentially('landlord@example.com');
    await expect(field).toHaveClass(/lc-verified/);
    await expect(cmsg).toBeHidden();
  });

  test('a valid email asks to be typed again; a match marks it Verified', async ({ page }) => {
    await page.goto('/index.html');
    await landlord(page).click();
    const field = page.locator('.field:has(#owner-email)');
    const confirm = page.locator('#owner-email-confirm');
    const cmsg = page.locator('.lc-confirm .errmsg');
    await page.locator('#owner-email').pressSequentially('landlord@example.com');
    await page.keyboard.press('Tab');                          // leaving the field opens it at once
    await expect(confirm).toBeVisible();
    await expect(page.locator('label[for="owner-email-confirm"]')).toHaveText('Retype email to confirm');
    await expect(confirm).toBeFocused();                       // Tab lands in it
    // the card hugs its content: no blank band under the input (an inline input's text-line
    // space and a hidden message's paragraph margin each used to leave one)
    await page.locator('.lc-confirm').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const gap = await page.locator('.lc-confirm').evaluate((box) =>
      box.getBoundingClientRect().bottom - box.querySelector('input').getBoundingClientRect().bottom);
    expect(gap).toBeLessThanOrEqual(12);
    // a typo is flagged as soon as it can no longer match
    await confirm.pressSequentially('landlord@exampel');
    await expect(cmsg).toBeVisible();
    await expect(cmsg).toHaveText('The two emails don’t match.');
    await confirm.fill('');
    await confirm.pressSequentially('landlord@example.com');
    await expect(cmsg).toBeHidden();
    await expect(field).toHaveClass(/lc-verified/);
    await expect(field).toHaveClass(/lc-ok/);
    const badge = await page.locator('label[for="owner-email"]').evaluate((el) => getComputedStyle(el, '::after').content);
    expect(badge).toBe('"Verified"');
    // changing the email afterwards un-verifies it and asks again
    await page.locator('#owner-email').pressSequentially('m');
    await expect(field).not.toHaveClass(/lc-verified/);
    await expect(confirm).toHaveValue('');
  });

  test('the retype card drops DOWN smoothly — height, fade and slide finish together over 350ms', async ({ page }) => {
    await page.goto('/index.html');
    await landlord(page).click();
    await page.locator('#owner-email').pressSequentially('landlord@example.com');
    // record the card every frame from before it opens until well after
    await page.evaluate(() => {
      window.__cardFrames = [];
      const t0 = performance.now();
      const tick = () => {
        const box = document.querySelector('.lc-confirm');
        if (box) {
          const s = getComputedStyle(box);
          window.__cardFrames.push({ t: performance.now() - t0, h: box.getBoundingClientRect().height,
            op: Number(s.opacity), ty: new DOMMatrixReadOnly(s.transform).m42 });
        }
        if (performance.now() - t0 < 900) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.keyboard.press('Tab');                          // opens the card
    await page.waitForTimeout(950);
    const frames = await page.evaluate(() => window.__cardFrames);
    const start = frames.find((f) => f.op > 0);
    const end = frames[frames.length - 1];
    expect(end.op).toBe(1);
    expect(end.ty).toBe(0);
    expect(start.ty, 'it starts ABOVE its place and drops down').toBeLessThan(0);
    // the height grows with the fade instead of popping open and stopping dead early
    const reached = frames.find((f) => f.h >= end.h * 0.95);
    expect(reached.t - start.t, 'height is still opening late in the 350ms').toBeGreaterThan(220);
    expect(frames.some((f) => f.h > end.h * 0.2 && f.h < end.h * 0.8)).toBe(true);
    expect(frames.some((f) => f.op > 0.2 && f.op < 0.8)).toBe(true);
  });

  test('Next is held until the email is verified', async ({ page }) => {
    await page.goto('/index.html');
    await landlord(page).click();
    await page.fill('#owner-name', 'Marcus Reed');
    await page.fill('#owner-email', 'landlord@example.com');
    await page.fill('#owner-phone', '2155550123');
    await page.fill('#owner-units', '3');
    await next(page).click();
    expect(await currentStep(page)).toBe('About you (the owner)');
    await expect(page.locator('.lc-confirm .errmsg')).toHaveText('Please retype your email to confirm it.');
    await expect(page.locator('#owner-email-confirm')).toBeFocused();
    await page.fill('#owner-email-confirm', 'landlord@example.com');
    await next(page).click();
    expect(await currentStep(page)).toBe('The property');
  });

  test('a field that passes turns its asterisk into a green check; an optional field cleared loses its error', async ({ page }) => {
    await page.goto('/index.html');
    await landlord(page).click();
    const req = page.locator('.field:has(#owner-name) .req');
    const label = page.locator('label[for="owner-name"]');
    const look = (loc) => loc.evaluate((el) => {
      const s = getComputedStyle(el); return { color: s.color, bg: s.backgroundImage };
    });
    const labelBox = () => label.evaluate((el) => { const b = el.getBoundingClientRect(); return { h: b.height }; });
    // before typing: the asterisk, as visible text
    expect((await look(req)).color).not.toBe('rgba(0, 0, 0, 0)');
    expect((await look(req)).bg).toBe('none');
    const before = await labelBox();
    await page.locator('#owner-name').pressSequentially('Marcus Reed');
    await expect(page.locator('.field:has(#owner-name)')).toHaveClass(/lc-ok/);
    // after: the "*" is gone and a check icon stands in its place
    expect(await look(req)).toEqual({ color: 'rgba(0, 0, 0, 0)', bg: expect.stringContaining('svg') });
    // ...on the same line as the label text: the label does not grow, so the input below it
    // does not jump (an earlier version dropped the check below the text and grew it ~11px)
    expect((await labelBox()).h).toBeCloseTo(before.h, 1);
    await req.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));   // measure at rest
    const [rq, lb] = await Promise.all([req.boundingBox(), label.boundingBox()]);
    expect(rq.y + rq.height).toBeLessThanOrEqual(lb.y + lb.height + 0.5);
    // an optional field has no asterisk, so its check appears after the label
    await page.locator('#owner-entity').pressSequentially('Reed Property Group LLC');
    const after = await page.locator('label[for="owner-entity"]')
      .evaluate((el) => getComputedStyle(el, '::after').backgroundImage);
    expect(after).toContain('svg');
    // an optional field: a bad value shows an error, emptying it takes the error away again
    await SECTION_FILL['About you (the owner)'](page);
    await next(page).click();
    await SECTION_FILL['The property'](page);
    await next(page).click();
    expect(await currentStep(page)).toBe('The tenant');
    await page.fill('#tenant-name', 'Dwayne Carter');
    const temail = page.locator('#tenant-email');
    await temail.pressSequentially('nope');
    await expect(page.locator('.field:has(#tenant-email) .errmsg')).toBeVisible();
    await temail.fill('');
    await expect(page.locator('.field:has(#tenant-email) .errmsg')).toBeHidden();
    await expect(page.locator('.field:has(#tenant-email)')).not.toHaveClass(/lc-ok/);
  });

  test('an error message fades up AND opens its space over 350ms — nothing below it jumps', async ({ page }) => {
    await page.goto('/index.html');
    await landlord(page).click();
    // Press Next on the empty section and sample, every ~40ms, the phone error's height and
    // opacity and where the field BELOW it sits. The old display:none -> block pushed that
    // field down in a single frame; now it has to travel.
    const samples = await page.evaluate(async () => {
      // Let the step's own fade-up (a 10px slide) finish first, or the "before" reading is
      // taken mid-slide and already looks like "after".
      await Promise.all(document.getAnimations().map((a) => a.finished));
      const msg = document.querySelector('.field:has(#owner-phone) > .errmsg');
      const below = document.querySelector('#owner-units');
      // y is measured inside the dialog: the dialog re-centres itself as it grows, so a
      // viewport position mixes that in and says nothing about the field being pushed down.
      const dlg = document.querySelector('.lc-dialog');
      const read = () => ({ h: msg.getBoundingClientRect().height, op: Number(getComputedStyle(msg).opacity),
        y: below.getBoundingClientRect().top - dlg.getBoundingClientRect().top });
      const out = [read()];
      document.querySelector('[data-landlord-check] [data-lc-next]').click();
      const t0 = performance.now();
      while (performance.now() - t0 < 520) {                   // every frame, so timing can't skip it
        await new Promise((r) => requestAnimationFrame(r));
        out.push(read());
      }
      // A busy machine can run late; the end state is read once the transitions really finish.
      await Promise.all(document.getAnimations().map((a) => a.finished));
      out.push(read());
      const s = getComputedStyle(msg);
      return { out, timing: s.transitionTimingFunction, duration: s.transitionDuration };
    });
    const first = samples.out[0], last = samples.out[samples.out.length - 1];
    expect(last.h, 'the message ends up open').toBeGreaterThan(0);
    expect(last.op, 'and fully visible').toBe(1);
    // some frame caught each of them part-way — none of them happened in a single frame
    expect(samples.out.some((s) => s.h > first.h + 1 && s.h < last.h - 1), 'height opens gradually').toBe(true);
    expect(samples.out.some((s) => s.op > 0.1 && s.op < 0.9), 'opacity fades gradually').toBe(true);
    expect(last.y, 'the field below is pushed down').toBeGreaterThan(first.y + 10);
    expect(samples.out.some((s) => s.y > first.y + 2 && s.y < last.y - 2), 'and travels there, not jumps').toBe(true);
    expect(samples.duration).toContain('0.35s');
    expect(samples.timing).toContain('ease-in');
  });

  test('each new section fades up over 350ms, ease-in', async ({ page }) => {
    await page.goto('/index.html');
    await landlord(page).click();
    await SECTION_FILL['About you (the owner)'](page);
    await next(page).click();
    const stepAnim = await page.locator('#intake-form fieldset:not([data-lc-off])').evaluate((el) => {
      const s = getComputedStyle(el); return [s.animationName, s.animationDuration, s.animationTimingFunction];
    });
    expect(stepAnim).toEqual(['lc-up', '0.35s', 'ease-in']);
  });

  test('inputs use the site\'s control style: white, 1.5px border, 10px corners, brass focus, red error', async ({ page }) => {
    await page.goto('/index.html');
    await landlord(page).click();
    const name = page.locator('#owner-name');
    // Read at rest: border colours ease over 150ms, and a read at the start of that easing
    // still shows the PREVIOUS colour — enough to pass a wrong colour.
    const st = (loc) => loc.evaluate(async (el) => {
      await Promise.all(el.getAnimations().map((a) => a.finished));
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, bw: s.borderTopWidth, r: s.borderTopLeftRadius, bc: s.borderTopColor };
    });
    const idle = await st(name);
    expect(idle).toMatchObject({ bg: 'rgb(255, 255, 255)', r: '10px' });
    // the same border as the popup's own answer buttons (1.5px, which Chrome draws as whole
    // device pixels — so compare against the real control, not a literal)
    const ref = await st(page.locator('.lc-role').first());
    expect(idle.bw).toBe(ref.bw);
    expect(idle.r).toBe(ref.r);
    await name.focus();
    await expect.poll(async () => (await st(name)).bc).toBe('rgb(200, 162, 74)');   // brass
    await page.locator('#owner-email').pressSequentially('nope');
    await expect.poll(async () => (await st(page.locator('#owner-email'))).bc).toBe('rgb(180, 67, 47)'); // red, like its message
    // ...and still red after leaving the field (the page's own rule would paint it gold)
    await page.locator('#owner-units').focus();
    await expect.poll(async () => (await st(page.locator('#owner-email'))).bc).toBe('rgb(180, 67, 47)');
  });

  test('Back walks the sections, and from the first one returns to "own or rent?"', async ({ page }) => {
    await page.goto('/index.html');
    await landlord(page).click();
    await SECTION_FILL['About you (the owner)'](page);
    await next(page).click();
    expect(await currentStep(page)).toBe('The property');
    await back(page).click();
    expect(await currentStep(page)).toBe('About you (the owner)');
    await expect(page.locator('#owner-name')).toHaveValue('Marcus Reed');
    await back(page).click();
    expect(await currentStep(page)).toBe('Who you are');
  });

  test('Enter in a field moves to the next section — it never submits a half-filled application', async ({ page }) => {
    const seen = await stubEndpoint(page);
    await page.goto('/index.html');
    await landlord(page).click();
    await SECTION_FILL['About you (the owner)'](page);
    await page.locator('#owner-units').press('Enter');
    expect(await currentStep(page)).toBe('The property');
    await page.waitForTimeout(300);
    expect(seen).toHaveLength(0);
  });

  test('a full application submits from the popup, stamped landlord, and books one $600 conversion', async ({ page }) => {
    const seen = await stubEndpoint(page);
    await page.goto('/index.html');
    await landlord(page).click();
    await fillApplication(page);
    await page.click('#intake-form button[type=submit]');
    await expect(page.locator('[data-landlord-check] .callout[role=status]')).toContainText('Application received');
    expect(seen).toHaveLength(1);
    expect(seen[0].contentType).toMatch(/^multipart\/form-data/);
    expect(seen[0].postData).toContain('Marcus Reed');
    expect(seen[0].postData).toMatch(/name="visitor_role"\r\n\r\nlandlord/);
    const booked = await leads(page);
    expect(booked).toHaveLength(1);
    expect(booked[0]).toMatchObject({ form_id: 'intake-form', lead_value: 600, transaction_id: CONTACT_ID });
    await expect(page.locator('[data-lc-dot][aria-current]')).toHaveCount(0);
    await expect(page.locator('[data-lc-dot].is-done')).toHaveCount(8);
  });

  test('closing after submitting leaves the confirmation on the page in place of the question', async ({ page }) => {
    await stubEndpoint(page);
    await page.goto('/index.html');
    await landlord(page).click();
    await fillApplication(page);
    await page.click('#intake-form button[type=submit]');
    await expect(page.locator('[data-landlord-check] .callout[role=status]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popup(page)).toHaveCount(0);
    await expect(page.locator('#apply .callout[role=status]')).toContainText('Application received');
    await expect(page.locator('[data-gate-for="intake-form"]')).toBeHidden();
  });

  test('closing half-way keeps what was typed for the next time it opens', async ({ page }) => {
    await page.goto('/index.html');
    await landlord(page).click();
    await page.fill('#owner-name', 'Marcus Reed');
    await page.keyboard.press('Escape');
    await expect(page.locator('#intake-form')).toBeHidden();          // not left open on the page
    await page.locator('#nav-links a.cta').evaluate((a) => a.click());
    await expect(page.locator('[data-landlord-check] #owner-name')).toHaveValue('Marcus Reed');
  });

  test('every step is reported to the dataLayer, so drop-off can be measured', async ({ page }) => {
    await stubEndpoint(page);
    await page.goto('/index.html');
    await landlord(page).click();
    await fillApplication(page);
    await page.click('#intake-form button[type=submit]');
    await expect(page.locator('[data-landlord-check] .callout[role=status]')).toBeVisible();
    const actions = (await lcEvents(page)).map((e) => e.lc_action + (e.lc_step ? ':' + e.lc_step : ''));
    expect(actions).toEqual(['open', 'role', 'step:2', 'email_verified', 'step:3', 'step:4', 'step:5',
      'step:6', 'step:7', 'step:8', 'submit']);
  });
});

test.describe('the question in front of each form opens the popup', () => {
  test('homepage: answering landlord at the bottom opens the application in the popup', async ({ page }) => {
    await as(page, 'dismissed');
    await page.goto('/index.html');
    await page.click('[data-gate-for="intake-form"] .rg-btn[data-role="landlord"]');
    await expect(page.locator('[data-landlord-check] #intake-form')).toBeVisible();
    expect(await currentStep(page)).toBe('About you (the owner)');
  });

  test('homepage: answering tenant at the bottom opens the tenant screen, not the inline panel', async ({ page }) => {
    await as(page, 'dismissed');
    await page.goto('/index.html');
    await page.click('[data-gate-for="intake-form"] .rg-btn[data-role="tenant"]');
    await expect(page.locator('[data-landlord-check] [data-lc-panel="tenant"]')).toBeVisible();
    await expect(page.locator('[data-tenant-panel]')).toHaveCount(0);
  });

  test('the case-review question opens the case-review form in the popup', async ({ page }) => {
    const seen = await stubEndpoint(page);
    await as(page, 'dismissed');
    await page.goto('/index.html');
    await page.click('[data-gate-for="contact-form"] .rg-btn[data-role="landlord"]');
    await expect(page.locator('[data-landlord-check] #contact-form')).toBeVisible();
    await expect(page.locator('[data-lc-dot]')).toHaveCount(2);
    await page.fill('#c-name', 'Marcus Reed');
    await page.fill('#c-phone', '2155550123');
    await page.fill('#c-email', 'landlord@example.com');
    await page.fill('#c-email-confirm', 'landlord@example.com');
    await page.click('#contact-form button[type=submit]');
    await expect(page.locator('[data-landlord-check] .callout[role=status]')).toContainText('we’ve got it');
    expect(JSON.parse(seen[0].postData)).toMatchObject({ form_type: 'contact', visitor_role: 'landlord' });
    // its confirmation is written for a dark band; in the light dialog it must be readable
    const color = await page.locator('[data-landlord-check] .callout[role=status] h3')
      .evaluate((el) => getComputedStyle(el).color);
    expect(color).not.toBe('rgb(255, 255, 255)');
  });

  test('/back-rent/: landlord gets the case-review form in the popup and books one $600 conversion', async ({ page }) => {
    await page.goto('/back-rent/index.html');
    await landlord(page).click();
    await expect(page.locator('[data-landlord-check] #backrent-form')).toBeVisible();
    await expect(page.locator('.lc-count')).toHaveText('Step 2 of 2 · Your case');
    await page.fill('#owner-name', 'Marcus Reed');
    await page.fill('#owner-phone', '2155550123');
    await page.fill('#owner-email', 'landlord@example.com');
    await page.fill('#prop-address', '1932 N 5th St');
    await page.fill('#back-rent', '4200');
    // not confirmed yet: the popup holds the page's own submit, and nothing is sent
    const seen = await stubEndpoint(page);
    await page.click('#backrent-form button[type=submit]');
    await expect(page.locator('.lc-confirm .errmsg')).toHaveText('Please retype your email to confirm it.');
    await page.waitForTimeout(300);
    expect(seen).toHaveLength(0);
    await page.fill('#owner-email-confirm', 'landlord@example.com');
    await page.click('#backrent-form button[type=submit]');
    await expect(page.locator('[data-landlord-check] .confirm')).toBeVisible();
    const booked = await leads(page);
    expect(booked).toHaveLength(1);
    expect(booked[0]).toMatchObject({ form_id: 'backrent-form', lead_value: 600 });
  });

  test('a blog page hands a landlord to the homepage application, already open in the popup', async ({ page }) => {
    await page.goto('/blog/eviction-diversion-program/index.html');
    await landlord(page).click();
    await page.waitForURL(/\/#apply$/);
    await expect(page.locator('[data-landlord-check] #intake-form')).toBeVisible();
    expect(await currentStep(page)).toBe('About you (the owner)');
    await expect(page.locator('#intake-form input[name="visitor_role"]')).toHaveValue('landlord');
  });
});

test.describe('Apply links open the popup instead of scrolling to the form', () => {
  const scrollY = (page) => page.evaluate(() => window.scrollY);

  const LINKS = [
    { url: '/index.html', link: '#nav-links a.cta', name: 'header Apply' },
    { url: '/index.html', link: 'footer a[href="#apply"]', name: 'footer Apply' },
    { url: '/index.html', link: 'footer a[href="#contact"]', name: 'footer Contact' },
    { url: '/index.html', link: 'a.btn[href="#apply"]', name: '"Apply to recover back rent"' },
    { url: '/back-rent/index.html', link: 'a[href="#form-card"]', name: '"Start my free case review"' },
  ];
  for (const { url, link, name } of LINKS) {
    test(`${url} ${name}: opens the popup and stays put`, async ({ page }) => {
      await as(page, 'dismissed');
      await page.goto(url);
      await page.waitForTimeout(800);
      await expect(popup(page)).toHaveCount(0);
      const before = await scrollY(page);
      await page.locator(link).first().evaluate((a) => a.click());
      await expect(dialog(page)).toBeVisible();
      expect(await currentStep(page)).toBe('Who you are');
      expect(new URL(page.url()).hash).toBe('');           // no jump to the form's anchor
      await page.waitForTimeout(400);
      expect(await scrollY(page)).toBe(before);
    });
  }

  test('a link to any other section still scrolls there normally', async ({ page }) => {
    await as(page, 'dismissed');
    await page.goto('/index.html');
    await page.locator('#nav-links a[href="#faq"]').evaluate((a) => a.click());
    await page.waitForTimeout(400);
    await expect(popup(page)).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe('#faq');
  });

  test('a returning landlord skips "own or rent?" and lands on the application', async ({ page }) => {
    await as(page, 'landlord');
    await page.goto('/index.html');
    await page.waitForTimeout(800);
    await expect(popup(page)).toHaveCount(0);             // not opened unprompted
    await page.locator('#nav-links a.cta').evaluate((a) => a.click());
    expect(await currentStep(page)).toBe('About you (the owner)');
    await expect(page.locator('#intake-form input[name="visitor_role"]')).toHaveValue('landlord');
  });

  test('a visitor who said tenant gets asked again when they click Apply', async ({ page }) => {
    await as(page, 'tenant');
    await page.goto('/index.html');
    await page.locator('#nav-links a.cta').evaluate((a) => a.click());
    expect(await currentStep(page)).toBe('Who you are');
  });

  test('on a phone, Apply in the menu opens the popup and closes the menu', async ({ page }) => {
    await as(page, 'dismissed');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/index.html');
    await page.click('#nav-toggle');
    await expect(page.locator('#nav-links')).toHaveClass(/open/);
    await page.click('#nav-links a.cta');
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('#nav-links')).not.toHaveClass(/open/);
    await expect(page.locator('#nav-toggle')).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the question is a bottom sheet that leaves the top of the page visible', async ({ page }) => {
    await page.goto('/index.html');
    await expect(dialog(page)).toBeVisible();
    // The sheet slides up from below over 350ms; measure where it comes to rest, not mid-slide.
    await dialog(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const box = await dialog(page).boundingBox();
    expect(Math.round(box.y + box.height)).toBe(844);  // sits on the bottom edge
    expect(box.y).toBeGreaterThan(844 * 0.3);           // the top of the page stays in view
    expect(box.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await expect(page.locator('.lc-count')).toHaveText('Step 1 of 8 · Who you are');
  });

  test('a long section scrolls the sheet, with no sideways scroll', async ({ page }) => {
    await page.goto('/index.html');
    await landlord(page).click();
    await SECTION_FILL['About you (the owner)'](page);
    for (let i = 0; i < 4; i++) {
      await SECTION_FILL[APPLY_STEPS[i]](page);
      await next(page).click();
    }
    expect(await currentStep(page)).toBe('Your documents');
    const w = await popup(page).evaluate((el) => el.scrollWidth);
    expect(w).toBeLessThanOrEqual(390);
    await page.locator('#doc-bank').scrollIntoViewIfNeeded();
    await expect(page.locator('#doc-bank')).toBeInViewport();
  });
});
