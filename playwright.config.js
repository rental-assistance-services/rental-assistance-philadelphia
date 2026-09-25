// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const crypto = require('crypto');

// The tests start their own server, on a port worked out from this folder's path, and never
// reuse one that is already running. They used to take whatever answered on 4173, and that is
// where `npm run dev` runs, often from another worktree: a run then tested that folder's files,
// not these. Every checkout gets a different port (4200-4899), so two can test at once.
// TEST_PORT overrides it.
const PORT = Number(process.env.TEST_PORT)
  || 4200 + parseInt(crypto.createHash('sha1').update(__dirname).digest('hex').slice(0, 6), 16) % 700;
const ORIGIN = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The HTML report is what `npm run test:report` opens: every failure with its trace, and for a
  // design check the approved picture, the new one and the difference. CI uploads it on failure.
  // It lives in .playwright/ (ignored by git) because pages.spec.js and seo.spec.js treat every
  // .html file outside a dot-folder as a page of the site.
  reporter: [[process.env.CI ? 'list' : 'line'], ['html', { open: 'never', outputFolder: '.playwright/report' }]],
  expect: {
    // Design checks (tests/design.spec.js): motion stopped and no blinking caret. A pixel counts
    // as changed at a tenth of the default colour distance, so a pale tint swapped for another
    // is caught, and at most 100 may differ per page. A full phone-length page takes
    // a while to capture twice (the check waits for two identical pictures) while other
    // browsers are busy, so it gets 20s rather than 5.
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css', threshold: 0.02, maxDiffPixels: 100, timeout: 20000 },
  },
  use: {
    baseURL: ORIGIN,
    trace: 'on-first-retry',
    // Escape hatch for running against an already-present Chromium (a dev box that has
    // a different build cached than this Playwright version downloads). CI installs its
    // own via `npx playwright install`, so this stays unset there.
    launchOptions: process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {},
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, grepInvert: /@timing/ },
    // The checks tagged @timing time a 350ms animation frame by frame. On a busy machine a
    // frame lands late and one misses its limit by a few ms: measured 5 misses in 40 runs
    // with 12 at once, 0 in 15 alone, and the same before any recent change. They get one
    // retry, as every test already does on CI. A real regression fails both tries.
    { name: 'timing', use: { ...devices['Desktop Chrome'] }, grep: /@timing/, retries: 1 },
  ],
  webServer: {
    command: 'node tests/static-server.js',
    env: { PORT: String(PORT) },
    url: `${ORIGIN}/index.html`,
    reuseExistingServer: false,
  },
});
