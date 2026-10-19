/**
 * The Task 7 query split: who each Search Console query is from.
 *
 * Every lead form is sold to landlords, and the brand name reads tenant-side, so the brief asks
 * for the last 90 days of queries split into landlord, tenant and ambiguous, and for the pages
 * tenant queries reach. tools/search-console/classify.js does the split from an exported CSV;
 * the rules it uses are in tools/search-console/rules.json so the reviewer can edit them.
 *
 * No browser: these call the script directly. The fixtures in tests/fixtures/ are made up. Real
 * query data is never committed, because a committed file here is a public URL.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TOOL = path.join(ROOT, 'tools', 'search-console');
const FIXTURES = path.join(__dirname, 'fixtures');
const sc = require(path.join(TOOL, 'classify.js'));
const rules = sc.loadRules();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sc-classify-'));
const quiet = () => {};

// [query, class, the rule it must record]
const EXPECTED = [
  ['recover back rent philadelphia', 'landlord', 'landlord/keywordTable: "recover back rent philadelphia"'],
  ["my tenant won't pay rent", 'landlord', 'landlord/keywordTable: "my tenant won\'t pay rent"'],
  ['philadelphia rental license', 'landlord', 'landlord/keywordTable: "philadelphia rental license"'],
  ['landlord help with rent', 'ambiguous', 'conflict: landlord/signals: "landlord" + tenant/negativeList: "help with rent"'],
  ['help with rent philadelphia', 'tenant', 'tenant/negativeList: "help with rent"'],
  ['rental assistance philadelphia', 'tenant', 'tenant/negativeList: "rental assistance philadelphia"'],
  ['rental assistance philadelphia landlord', 'landlord', 'landlord/signals: "landlord"'],
  ["my landlord won't fix the heat", 'tenant', 'tenant/firstPerson: "my landlord"'],
  ['eviction diversion program philadelphia', 'ambiguous', 'generic: "eviction diversion"'],
  ['rental assistance services', 'ambiguous', 'generic: "rental assistance services"'],
  ['tenant’s back rent, philadelphia', 'landlord', 'landlord/signals: "tenant\'s"'],
  ['section 8 landlord philadelphia', 'ambiguous', 'conflict: landlord/signals: "landlord" + tenant/negativeList: "section 8"'],
  ['lead-safe certification', 'landlord', 'landlord/signals: "lead safe"'],
  ['rental assistance jobs', 'ambiguous', 'generic: "rental assistance"'],
  ['tenant rights philadelphia', 'tenant', 'tenant/negativeList: "tenant rights"'],
];

test('every fixture query lands in its class, with the rule that put it there', () => {
  const { classified, totals } = sc.summarize(sc.readTable(path.join(FIXTURES, 'search-console-queries.csv')), rules);
  expect(classified.map((r) => [r.query, r.cls, r.rule])).toEqual(EXPECTED);
  expect(totals.landlord).toEqual({ queries: 6, clicks: 16, impressions: 154 });
  expect(totals.tenant).toEqual({ queries: 4, clicks: 17, impressions: 335 });
  expect(totals.ambiguous).toEqual({ queries: 5, clicks: 6, impressions: 111 });
  expect(totals.all).toEqual({ queries: 15, clicks: 39, impressions: 600 });
});

test('a landlord signal and a tenant signal together go to ambiguous, naming both', () => {
  const r = sc.classify('Landlord ERAP application', rules);
  expect(r.cls).toBe('ambiguous');
  expect(r.rule).toBe('conflict: landlord/signals: "landlord" + tenant/negativeList: "erap"');
});

test('a phrase inside a longer one is not its own signal', () => {
  expect(sc.classify('how do i report my landlord', rules).cls).toBe('tenant');
  expect(sc.classify("tenant's rights in philadelphia", rules)).toMatchObject({ cls: 'tenant', rule: 'tenant/negativeList: "tenant\'s rights"' });
  expect(sc.classify('landlords philadelphia', rules).cls).toBe('landlord');
  expect(sc.classify('tenants philadelphia', rules).cls).toBe('ambiguous');
});

test('the flags mark the other people the brief does not want, without changing the class', () => {
  expect(sc.classify('free lawyer for eviction', rules)).toMatchObject({ cls: 'tenant', flags: ['free', 'lawyer'] });
  expect(sc.classify('rental license apply myself', rules)).toMatchObject({ cls: 'landlord', flags: ['apply myself'] });
});

test("rules.json carries the brief's organic negative list and keyword table, word for word", () => {
  const has = (cls, list, phrase) => rules.some((r) => r.cls === cls && r.list === list && r.phrase === phrase);
  for (const p of ['help with rent', 'help paying rent', 'rent help philadelphia', 'behind on my rent',
    'rental assistance philadelphia', 'emergency rental assistance', 'erap', 'phlrentassist', 'eviction help',
    'facing eviction', 'tenant rights', 'legal aid', 'free lawyer', 'section 8', 'housing voucher', 'low income housing']) {
    expect(has('tenant', 'negativeList', p), p).toBe(true);
  }
  for (const p of ['recover back rent philadelphia', 'tenant behind on rent philadelphia',
    'eviction diversion program philadelphia landlord', 'philadelphia rental license',
    'certificate of rental suitability philadelphia', 'commercial activity license philadelphia landlord',
    'philadelphia lead safe certification landlord']) {
    expect(has('landlord', 'keywordTable', p), p).toBe(true);
  }
});

test('every landlord and tenant phrase in rules.json, searched on its own, lands in its own class', () => {
  // Catches an edit to rules.json that makes a listed phrase contradict itself.
  const wrong = rules.filter((r) => r.cls === 'landlord' || r.cls === 'tenant')
    .map((r) => [r.phrase, r.cls, sc.classify(r.phrase, rules)])
    .filter(([, cls, got]) => got.cls !== cls)
    .map(([phrase, cls, got]) => `${phrase}: listed ${cls}, classed ${got.cls} (${got.rule})`);
  expect(wrong).toEqual([]);
});

test('a Sheets or Excel re-save of the export reads the same', () => {
  const dir = tmp();
  const file = path.join(dir, 'Queries.csv');
  fs.writeFileSync(file, '﻿Query;Clicks;Impressions;CTR;Position\r\n'
    + '"help paying rent";3;1.200;0,25%;12,5\r\n"tenant owes back rent";2;40;5%;4\r\n');
  const rows = sc.readTable(file);
  expect(rows).toEqual([
    { query: 'help paying rent', page: undefined, clicks: 3, impressions: 1200, position: 12.5 },
    { query: 'tenant owes back rent', page: undefined, clicks: 2, impressions: 40, position: 4 },
  ]);
  expect(rows.map((r) => sc.classify(r.query, rules).cls)).toEqual(['tenant', 'landlord']);
});

test('a query x page table lists the pages tenant queries reach, and not /tenants/', () => {
  const tp = sc.tenantPages(sc.readTable(path.join(FIXTURES, 'search-console-query-pages.csv')), rules);
  expect(tp.mode).toBe('query-by-page');
  expect(tp.pages.map((p) => [p.page, p.tenantClicks, p.clicks])).toEqual([
    ['https://rentalassistanceservices.com/', 9, 12],
    ['https://rentalassistanceservices.com/blog/eviction-diversion-program/', 2, 2],
  ]);
  expect(tp.welcome.map((p) => p.page)).toEqual(['https://rentalassistanceservices.com/tenants/']);
});

test('a plain Pages.csv is not split by audience unless it was exported with the tenant filter', () => {
  const dir = tmp();
  const file = path.join(dir, 'Pages.csv');
  fs.writeFileSync(file, 'Top pages,Clicks,Impressions,CTR,Position\n'
    + 'https://rentalassistanceservices.com/,7,90,7.78%,4\n'
    + 'https://rentalassistanceservices.com/tenants/,3,20,15%,5\n'
    + 'https://rentalassistanceservices.com/faq/,0,10,0%,20\n');
  expect(sc.tenantPages(sc.readTable(file), rules)).toEqual({ mode: 'unattributed', pages: [], welcome: [] });
  const filtered = sc.tenantPages(sc.readTable(file), rules, { tenantFiltered: true });
  expect(filtered.mode).toBe('tenant-filtered');
  expect(filtered.pages.map((p) => p.page)).toEqual(['https://rentalassistanceservices.com/']);
});

test('the command line writes the split, the CSV and the report draft where it is told', () => {
  const out = tmp();
  const res = sc.run([path.join(FIXTURES, 'search-console-queries.csv'),
    '--pages', path.join(FIXTURES, 'search-console-query-pages.csv'), '--out', out], quiet);
  expect(res.code).toBe(0);
  const csv = sc.parseCsv(fs.readFileSync(path.join(out, 'queries-classified.csv'), 'utf8')).rows;
  expect(csv[0]).toEqual(['query', 'clicks', 'impressions', 'ctr', 'position', 'class', 'rule', 'flags']);
  expect(csv.length).toBe(16);
  expect(csv.find((r) => r[0] === 'section 8 landlord philadelphia')[5]).toBe('ambiguous');
  const report = fs.readFileSync(path.join(out, 'report-draft.md'), 'utf8');
  expect(report).not.toMatch(/\[\[AUTO: [a-z-]+\]\]/); // every slot filled
  expect(report).toContain('| tenant | 4 | 26.7% | 17 | 43.6% | 335 | 55.8% |');
  expect(report).toContain('never for a form');
  expect(report).toContain('[[FILL:');
  expect(fs.readFileSync(path.join(out, 'tenant-pages.csv'), 'utf8')).toContain('/blog/eviction-diversion-program/');
});

test('the command line will not write query data anywhere in the repo but tools/data/', () => {
  const run = (out) => () => sc.run([path.join(FIXTURES, 'search-console-queries.csv'), '--out', out], quiet);
  expect(run(TOOL)).toThrow(/refusing to write query data/);
  expect(run(ROOT)).toThrow(/refusing to write query data/);
  expect(run(path.join(ROOT, 'tests', 'fixtures'))).toThrow(/refusing to write query data/);
  expect(() => sc.assertSafeOut(path.join(ROOT, 'tools', 'data', 'sub'))).not.toThrow();
  expect(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/)).toContain('tools/data/');
});

test('a Pages.csv given without --pages is refused, not read as the queries', () => {
  // It used to be taken as the Queries file, last one winning: a wrong report with no error.
  const dataDir = path.join(ROOT, 'tools', 'data');
  const snapshot = () => (fs.existsSync(dataDir)
    ? fs.readdirSync(dataDir).map((f) => `${f}:${fs.statSync(path.join(dataDir, f)).mtimeMs}`).sort() : null);
  const before = snapshot();
  const res = spawnSync(process.execPath, ['tools/search-console/classify.js',
    'tests/fixtures/search-console-queries.csv', 'tests/fixtures/search-console-query-pages.csv'],
  { cwd: ROOT, encoding: 'utf8' });
  expect(res.status).not.toBe(0);
  expect(res.stderr).toContain('one Queries.csv; pass Pages.csv with --pages');
  expect(res.stdout).toBe('');
  expect(snapshot()).toEqual(before);
  // A flag's value is not a second file.
  const ok = sc.run([path.join(FIXTURES, 'search-console-queries.csv'),
    '--pages', path.join(FIXTURES, 'search-console-query-pages.csv'),
    '--out', tmp(), '--rules', path.join(TOOL, 'rules.json')], quiet);
  expect(ok.summary.totals.all.queries).toBe(15);
});

test('the tenant regex for the Search Console filter matches the tenant phrases and is RE2-safe', () => {
  const { regex, leftOut } = sc.tenantRegex();
  expect(regex.startsWith('(?i)')).toBe(true);
  expect(regex).not.toMatch(/\(\?<?[=!]/); // RE2 has no lookaround
  expect(regex.length).toBeLessThan(4096);
  const re = new RegExp(regex.slice(4), 'i');
  for (const q of ['help with rent philadelphia', 'ERAP status', 'section-8 housing', 'behind on my rent']) expect(re.test(q), q).toBe(true);
  expect(re.test('recover back rent philadelphia')).toBe(false);
  expect(leftOut).toEqual(['rental assistance philadelphia', 'philadelphia rental assistance']);
});

test('nothing under tools/ is an HTML page that could be indexed', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  expect(walk(path.join(ROOT, 'tools')).filter((f) => /\.html?$/i.test(f))).toEqual([]);
});
