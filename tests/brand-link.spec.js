const { test, expect } = require('@playwright/test');
const { openSettled } = require('./site-pages');

for (const url of ['/index.html', '/faq/index.html', '/portal/index.html',
  '/services/back-rent/index.html', '/services/licensing/index.html']) {
  test(`${url}: voice controls can find the brand link by its visible words`, async ({ page }) => {
    await openSettled(page, url);
    const brand = page.locator('a.brand');
    const visibleWords = (await brand.innerText()).replace(/\s+/g, ' ').trim();
    await expect(brand).toHaveAccessibleName(new RegExp(visibleWords, 'i'));
  });
}
