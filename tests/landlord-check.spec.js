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
    const msg = page.locator('.field:has(#owner-email) .errmsg');
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
    // a letter: wrong at once
    await phone.pressSequentially('215555012a');
    await expect(msg).toHaveText('Phone numbers can only use digits, spaces, ( ) and -.');
    // too many digits: wrong at once
    await phone.fill('');
    await phone.pressSequentially('215555012345');
    await expect(msg).toContainText('too many digits');
    // too few: fine while typing, an error on leaving
    await phone.fill('');
    await phone.pressSequentially('215555');
    await expect(msg).toBeHidden();
    await page.keyboard.press('Tab');
    await expect(msg).toContainText('Enter a 10-digit US phone number');
    // a complete number with an impossible area code
    await phone.fill('');
    await phone.pressSequentially('1235550123');
    await expect(msg).toContainText('area code');
    // a real one: formatted and checked
    await phone.fill('');
    await phone.pressSequentially('2155550123');
    await page.keyboard.press('Tab');
    await expect(phone).toHaveValue('(215) 555-0123');
    await expect(msg).toBeHidden();
    await expect(field).toHaveClass(/lc-ok/);
    // a leading 1 is allowed
    await phone.fill('');
    await phone.pressSequentially('1 215 555 0123');
    await page.keyboard.press('Tab');
    await expect(phone).toHaveValue('(215) 555-0123');
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
