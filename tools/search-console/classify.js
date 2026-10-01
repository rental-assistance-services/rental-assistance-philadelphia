#!/usr/bin/env node
/**
 * Splits a Search Console Performance export into landlord, tenant and ambiguous queries
 * (Task 7 of the landlord SEO brief). Node only, no dependencies.
 *
 *   node tools/search-console/classify.js <Queries.csv> [--pages <Pages.csv>] [--pages-tenant-filtered]
 *                                         [--out <dir>] [--rules <rules.json>]
 *   node tools/search-console/classify.js --tenant-regex
 *
 * The rules are in rules.json beside this file; edit them there. Everything this writes is
 * real query data, so it writes only outside the repo or into tools/data/, which is gitignored.
 * This is a GitHub Pages site with no build step: a committed file is a public URL.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(REPO, 'tools', 'data');
const RULES_FILE = path.join(__dirname, 'rules.json');
const TEMPLATE_FILE = path.join(__dirname, 'REPORT-TEMPLATE.md');
const CLASSES = ['landlord', 'tenant', 'ambiguous'];
const USAGE = `usage:
  node tools/search-console/classify.js <Queries.csv> [--pages <Pages.csv>] [--pages-tenant-filtered]
                                        [--out <dir>] [--rules <rules.json>]
  node tools/search-console/classify.js --tenant-regex
See tools/search-console/README.md.`;

// ---------------------------------------------------------------------------------- rules

/** Lower-case; curly quotes to '; anything that is not a letter, digit or apostrophe to a space. */
function normalize(text) {
  return String(text).toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .trim();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole words; the last word may take s, 's or s'. Apostrophes count as part of a word. */
function phraseRegex(phrase) {
  return new RegExp(`(?<![a-z0-9'])${escapeRe(normalize(phrase))}(?:s|'s|s')?(?![a-z0-9'])`, 'g');
}

/** rules.json -> [{ cls, list, phrase, re, unless: [re] }]. Lists whose key starts with _ are notes. */
function loadRules(file = RULES_FILE) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rules = [];
  const add = (cls, list, entries) => {
    for (const entry of entries) {
      const phrase = typeof entry === 'string' ? entry : entry.phrase;
      const unless = (typeof entry === 'string' ? [] : entry.unless || []).map(phraseRegex);
      rules.push({ cls, list, phrase, re: phraseRegex(phrase), unless });
    }
  };
  for (const cls of ['landlord', 'tenant']) {
    for (const [list, body] of Object.entries(raw[cls] || {})) {
      if (!list.startsWith('_')) add(cls, list, body.phrases || []);
    }
  }
  add('generic', 'generic', (raw.generic || {}).phrases || []);
  add('flag', 'flags', (raw.flags || {}).phrases || []);
  rules.pagesForTenants = (raw.pagesForTenants || {}).paths || [];
  return rules;
}

/** Every rule that matches, with where it matched. */
function matchesIn(q, rules) {
  const found = [];
  for (const rule of rules) {
    if (rule.unless.some((re) => { re.lastIndex = 0; return re.test(q); })) continue;
    rule.re.lastIndex = 0;
    for (let m; (m = rule.re.exec(q));) found.push({ rule, start: m.index, end: m.index + m[0].length });
  }
  // A match wholly inside a longer one is not its own signal: "my landlord" is a tenant
  // talking, not the word "landlord"; "tenant's rights" is not "tenant's". Flags stand apart:
  // "free lawyer" is a tenant phrase and still flags "free".
  const signal = (m) => m.rule.cls !== 'flag';
  return found.filter((a) => !signal(a) || !found.some((b) => b !== a && signal(b)
    && b.start <= a.start && b.end >= a.end && (b.end - b.start) > (a.end - a.start)));
}

const label = (m) => `${m.rule.cls === m.rule.list ? m.rule.cls : `${m.rule.cls}/${m.rule.list}`}: "${m.rule.phrase}"`;
const uniq = (xs) => [...new Set(xs)];

/** -> { cls: landlord|tenant|ambiguous, rule: why, flags: [phrase] } */
function classify(query, rules) {
  const found = matchesIn(normalize(query), rules);
  const of = (cls) => uniq(found.filter((m) => m.rule.cls === cls).map(label));
  const landlord = of('landlord');
  const tenant = of('tenant');
  const generic = of('generic');
  const flags = uniq(found.filter((m) => m.rule.cls === 'flag').map((m) => m.rule.phrase));
  if (landlord.length && tenant.length) {
    return { cls: 'ambiguous', rule: `conflict: ${[...landlord, ...tenant].join(' + ')}`, flags };
  }
  if (landlord.length) return { cls: 'landlord', rule: landlord.join(' + '), flags };
  if (tenant.length) return { cls: 'tenant', rule: tenant.join(' + '), flags };
  return { cls: 'ambiguous', rule: generic.length ? generic.join(' + ') : 'no rule matched', flags };
}

/**
 * One regex for Search Console's Performance > Query > Custom (regex) filter, so the Pages tab
 * shows the pages tenant queries land on. Search Console uses RE2: no lookbehind, so \b stands
 * in for the word edges, and an "unless" rule cannot be written; those are left out and named.
 */
function tenantRegex(file = RULES_FILE) {
  const rules = loadRules(file).filter((r) => r.cls === 'tenant');
  const usable = rules.filter((r) => !r.unless.length);
  const body = usable.map((r) => escapeRe(normalize(r.phrase)).replace(/ /g, '[ -]+')).join('|');
  return {
    regex: `(?i)\\b(${body})(s|'s|s')?\\b`,
    leftOut: rules.filter((r) => r.unless.length).map((r) => r.phrase),
  };
}

// ------------------------------------------------------------------------------------ csv

/** RFC 4180 with the delimiter guessed from the header row (Excel in some locales writes ;). */
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const head = text.slice(0, text.search(/\r?\n|$/));
  const outside = head.replace(/"[^"]*"/g, '');
  const delim = [',', ';', '\t'].sort((a, b) => outside.split(b).length - outside.split(a).length)[0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return { delim, rows: rows.filter((r) => r.some((v) => v.trim() !== '')) };
}

const HEADERS = {
  query: ['top queries', 'queries', 'query', 'search query', 'search queries'],
  page: ['top pages', 'pages', 'page', 'landing page', 'url', 'address'],
  clicks: ['clicks', 'url clicks'],
  impressions: ['impressions'],
  ctr: ['ctr', 'url ctr'],
  position: ['position', 'average position', 'avg position', 'avg. position'],
};

/** "1,234" -> 1234, "3.5%" -> 3.5. A ;-delimited file uses the comma as its decimal point. */
function toNumber(value, decimalComma) {
  let s = String(value || '').replace(/[%\s ]/g, '');
  s = decimalComma ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** A Search Console (or Sheets / Excel re-save) CSV -> [{ query?, page?, clicks, impressions, position }]. */
function readTable(file) {
  const { delim, rows } = parseCsv(fs.readFileSync(file, 'utf8'));
  if (!rows.length) throw new Error(`${file} is empty`);
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = {};
  for (const [key, names] of Object.entries(HEADERS)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) col[key] = i;
  }
  if (col.query === undefined && col.page === undefined) {
    throw new Error(`${file}: no "Top queries" or "Top pages" column (found: ${rows[0].join(', ')})`);
  }
  if (col.clicks === undefined || col.impressions === undefined) {
    throw new Error(`${file}: needs "Clicks" and "Impressions" columns (found: ${rows[0].join(', ')})`);
  }
  const dc = delim === ';';
  return rows.slice(1).map((r) => ({
    query: col.query === undefined ? undefined : (r[col.query] || '').trim(),
    page: col.page === undefined ? undefined : (r[col.page] || '').trim(),
    clicks: toNumber(r[col.clicks], dc),
    impressions: toNumber(r[col.impressions], dc),
    position: col.position === undefined ? null : toNumber(r[col.position], dc),
  }));
}

const csvCell = (v) => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
// The BOM is so Excel reads the file as UTF-8 (curly apostrophes in queries).
const toCsv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';

// -------------------------------------------------------------------------------- summary

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '0.0%');
const ctr = (c, i) => (i ? `${((100 * c) / i).toFixed(2)}%` : '');

/** Queries.csv rows -> classified rows and per-class totals. */
function summarize(rows, rules) {
  const classified = rows.filter((r) => r.query).map((r) => ({ ...r, ...classify(r.query, rules) }));
  const totals = { all: { queries: 0, clicks: 0, impressions: 0 } };
  for (const cls of CLASSES) totals[cls] = { queries: 0, clicks: 0, impressions: 0 };
  for (const r of classified) {
    for (const t of [totals[r.cls], totals.all]) { t.queries++; t.clicks += r.clicks; t.impressions += r.impressions; }
  }
  return { classified, totals };
}

/**
 * Pages tenant queries reach. A query x page table (both columns) is split exactly. A plain
 * Pages.csv has no queries in it, so it says something about tenants only when it was exported
 * with the tenant regex filter applied; the caller has to say so (--pages-tenant-filtered).
 */
function tenantPages(pageRows, rules, { tenantFiltered = false } = {}) {
  const hasQuery = pageRows.some((r) => r.query !== undefined);
  if (!hasQuery && !tenantFiltered) return { mode: 'unattributed', pages: [], welcome: [] };
  const byPage = new Map();
  for (const r of pageRows) {
    if (!r.page) continue;
    const p = byPage.get(r.page) || { page: r.page, tenantClicks: 0, tenantImpressions: 0, clicks: 0, queries: [] };
    p.clicks += r.clicks;
    const isTenant = hasQuery ? classify(r.query || '', rules).cls === 'tenant' : true;
    if (isTenant) {
      p.tenantClicks += r.clicks;
      p.tenantImpressions += r.impressions;
      if (hasQuery && r.clicks) p.queries.push(r.query);
    }
    byPage.set(r.page, p);
  }
  // /tenants/ getting tenant clicks is the point, not a page to change.
  const forTenants = (page) => (rules.pagesForTenants || []).includes(pathOf(page));
  const hit = [...byPage.values()].filter((p) => p.tenantClicks > 0)
    .sort((a, b) => b.tenantClicks - a.tenantClicks || a.page.localeCompare(b.page));
  return {
    mode: hasQuery ? 'query-by-page' : 'tenant-filtered',
    pages: hit.filter((p) => !forTenants(p.page)),
    welcome: hit.filter((p) => forTenants(p.page)),
  };
}

/** "https://host/tenants/?x" or "/tenants/" -> "/tenants/". */
function pathOf(page) {
  try { return new URL(page, 'https://example.invalid').pathname; } catch { return page; }
}

function splitTable(totals) {
  const a = totals.all;
  const lines = [
    '| Class | Queries | % of queries | Clicks | % of clicks | Impressions | % of impressions |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const cls of CLASSES) {
    const t = totals[cls];
    lines.push(`| ${cls} | ${t.queries} | ${pct(t.queries, a.queries)} | ${t.clicks} | ${pct(t.clicks, a.clicks)} | ${t.impressions} | ${pct(t.impressions, a.impressions)} |`);
  }
  lines.push(`| **total** | ${a.queries} | 100% | ${a.clicks} | 100% | ${a.impressions} | 100% |`);
  return lines.join('\n');
}

function queryTable(rows, max) {
  if (!rows.length) return '_None._';
  return ['| Query | Clicks | Impressions | Rule |', '|---|---:|---:|---|',
    ...rows.slice(0, max).map((r) => `| ${r.query.replace(/\|/g, '\\|')} | ${r.clicks} | ${r.impressions} | ${r.rule.replace(/\|/g, '\\|')} |`),
  ].join('\n');
}

function pagesSection(tp) {
  if (!tp) return '_No Pages.csv given._';
  if (tp.mode === 'unattributed') {
    return '_The Pages.csv given has no query column, so its clicks cannot be split by audience. '
      + 'Export Pages.csv again with the tenant query filter applied (`--tenant-regex` prints it) '
      + 'and rerun with `--pages-tenant-filtered`._';
  }
  const welcome = tp.welcome.length
    ? `\n\nTenant clicks on the page built for them (not candidates): ${tp.welcome.map((p) => `${p.page} (${p.tenantClicks})`).join(', ')}.`
    : '';
  if (!tp.pages.length) return `_No page other than the tenant page received a tenant click._${welcome}`;
  const how = tp.mode === 'tenant-filtered'
    ? 'Clicks on queries matching the tenant regex filter (Pages.csv exported with that filter on).'
    : 'Clicks on queries this script classes as tenant, from the query x page table.';
  return [how, 'Each is a candidate for a copy change, never for a form.', '',
    '| Page | Tenant clicks | Tenant impressions | Share of page clicks | Tenant queries with clicks |',
    '|---|---:|---:|---:|---|',
    ...tp.pages.map((p) => `| ${p.page} | ${p.tenantClicks} | ${p.tenantImpressions} | ${tp.mode === 'tenant-filtered' ? 'n/a' : pct(p.tenantClicks, p.clicks)} | ${p.queries.slice(0, 5).join('; ')} |`),
  ].join('\n') + welcome;
}

function summaryMarkdown({ totals, classified }, tp, source) {
  const byClicks = (a, b) => b.clicks - a.clicks || b.impressions - a.impressions;
  const tenant = classified.filter((r) => r.cls === 'tenant').sort(byClicks);
  const conflicts = classified.filter((r) => r.rule.startsWith('conflict:')).sort(byClicks);
  const ambiguous = classified.filter((r) => r.cls === 'ambiguous' && !r.rule.startsWith('conflict:'))
    .sort((a, b) => b.impressions - a.impressions);
  const flagged = classified.filter((r) => r.flags.length);
  return [
    `# Query split: ${path.basename(source)}`, '',
    splitTable(totals), '',
    `Conflicts (a landlord and a tenant rule both matched, left ambiguous): ${conflicts.length}. `
      + `Flagged as another audience we do not want (job, lawyer, free, apply myself): ${flagged.length}.`, '',
    '## Tenant queries by clicks (top 15)', '', queryTable(tenant, 15), '',
    '## Conflicts', '', queryTable(conflicts, 15), '',
    '## Ambiguous queries by impressions (top 15), for the reviewer to place', '', queryTable(ambiguous, 15), '',
    '## Pages getting tenant clicks', '', pagesSection(tp), '',
  ].join('\n');
}

/** REPORT-TEMPLATE.md with the [[AUTO: ...]] slots filled; the [[FILL: ...]] slots stay for a person. */
function fillTemplate(summary, tp) {
  const tpl = fs.readFileSync(TEMPLATE_FILE, 'utf8');
  return tpl
    .replace('[[AUTO: query-split]]', splitTable(summary.totals))
    .replace('[[AUTO: tenant-queries]]', queryTable(summary.classified.filter((r) => r.cls === 'tenant')
      .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions), 15))
    .replace('[[AUTO: tenant-pages]]', pagesSection(tp));
}

// ------------------------------------------------------------------------------------ cli

/**
 * One spelling per folder, so the check below cannot be stepped round: symlinks and Windows
 * short names (KYLEAS~1) resolved on the part that exists, and case folded on Windows.
 */
function canonical(p) {
  let head = path.resolve(p);
  const rest = [];
  while (!fs.existsSync(head) && path.dirname(head) !== head) { rest.unshift(path.basename(head)); head = path.dirname(head); }
  const full = path.join(fs.existsSync(head) ? fs.realpathSync.native(head) : head, ...rest);
  return process.platform === 'win32' ? full.toLowerCase() : full;
}

/** Real query data may land outside the repo, or in tools/data/ (gitignored), nowhere else. */
function assertSafeOut(dir) {
  const abs = path.resolve(dir);
  const key = canonical(abs);
  const inside = (root) => { const r = canonical(root); return key === r || key.startsWith(r + path.sep); };
  if (inside(REPO) && !inside(DATA_DIR)) {
    throw new Error(`refusing to write query data to ${abs}: inside the repo it may only go in tools/data/ `
      + '(gitignored). Anything committed here is published on GitHub Pages.');
  }
  return abs;
}

function parseArgs(argv) {
  const opts = { out: DATA_DIR, rules: RULES_FILE, pagesTenantFiltered: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pages') opts.pages = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--rules') opts.rules = argv[++i];
    else if (a === '--pages-tenant-filtered') opts.pagesTenantFiltered = true;
    else if (a === '--tenant-regex') opts.tenantRegex = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else opts.queries = a;
  }
  return opts;
}

function run(argv, log = console.log) {
  const opts = parseArgs(argv);
  if (opts.help || (!opts.queries && !opts.tenantRegex)) {
    log(USAGE);
    return { code: opts.help ? 0 : 1 };
  }
  if (opts.tenantRegex) {
    const { regex, leftOut } = tenantRegex(opts.rules);
    log(regex);
    log(`\n(${regex.length} characters. Left out, because RE2 cannot say "unless": ${leftOut.join('; ') || 'none'}.)`);
    return { code: 0, regex };
  }
  const out = assertSafeOut(opts.out);
  const rules = loadRules(opts.rules);
  const summary = summarize(readTable(opts.queries), rules);
  const tp = opts.pages ? tenantPages(readTable(opts.pages), rules, { tenantFiltered: opts.pagesTenantFiltered }) : null;
  fs.mkdirSync(out, { recursive: true });
  const files = {
    classified: path.join(out, 'queries-classified.csv'),
    summary: path.join(out, 'summary.md'),
    report: path.join(out, 'report-draft.md'),
  };
  fs.writeFileSync(files.classified, toCsv([
    ['query', 'clicks', 'impressions', 'ctr', 'position', 'class', 'rule', 'flags'],
    ...summary.classified.map((r) => [r.query, r.clicks, r.impressions, ctr(r.clicks, r.impressions),
      r.position ?? '', r.cls, r.rule, r.flags.join('; ')]),
  ]));
  if (tp && tp.pages.length) {
    files.tenantPages = path.join(out, 'tenant-pages.csv');
    fs.writeFileSync(files.tenantPages, toCsv([
      ['page', 'tenant_clicks', 'tenant_impressions', 'page_clicks', 'tenant_queries_with_clicks'],
      ...tp.pages.map((p) => [p.page, p.tenantClicks, p.tenantImpressions, p.clicks, p.queries.join('; ')]),
    ]));
  }
  const md = summaryMarkdown(summary, tp, opts.queries);
  fs.writeFileSync(files.summary, md);
  fs.writeFileSync(files.report, fillTemplate(summary, tp));
  log(md);
  log(`Wrote:\n${Object.values(files).map((f) => `  ${f}`).join('\n')}`);
  return { code: 0, summary, tenantPages: tp, files };
}

module.exports = { normalize, loadRules, classify, tenantRegex, parseCsv, readTable, summarize, tenantPages, assertSafeOut, run };

if (require.main === module) {
  try { process.exitCode = run(process.argv.slice(2)).code; }
  catch (e) { console.error(`classify: ${e.message}`); process.exitCode = 2; }
}
