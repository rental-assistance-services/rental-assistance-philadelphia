# TEMPLATE: Task 7 Search Console report

This is a template, not a report. The filled-in report is pasted into the Task 7 section of the
"RAS Landlord SEO Task Brief" doc, never committed: this repo is published as-is by GitHub Pages,
so a committed report would be a public page of the site's search data.

`classify.js` writes a copy of this file to `tools/data/report-draft.md` (gitignored) with the
`[[AUTO: ...]]` slots already filled. Every `[[FILL: ...]]` slot is for the person holding
Search Console access. Delete these three paragraphs before pasting.

| | |
|---|---|
| Property | [[FILL: exact property name as Search Console shows it, and its type: Domain, or URL-prefix https://rentalassistanceservices.com/]] |
| Read by | [[FILL: who, on which Google account (the shared development identity named in the brief)]] |
| Read on | [[FILL: date]] |
| Performance date range | [[FILL: e.g. "Last 3 months", with the start and end dates shown]] |
| Search type | [[FILL: Web]] |

## 1. Verification

The two HTML-file stubs in the repo root are the verification files. No new verification file
is to be added.

| File | Live URL returns 200 with its token line | Listed under Settings > Ownership verification for this identity |
|---|---|---|
| `google9d1d722c7ac2f4d2.html` | [[FILL: yes / no]] | [[FILL: verified owner / not listed / other owner]] |
| `googleeed2c6ea94980975.html` | [[FILL: yes / no]] | [[FILL: verified owner / not listed / other owner]] |

Verification status: [[FILL: Verified owner / Verified (full or restricted user, via another owner) / Not verified, and what was done about it]]

Other verified owners or users on the property: [[FILL: list, or "none"]]

## 2. Sitemap

| Sitemap | Submitted | Status | Discovered pages |
|---|---|---|---|
| `https://rentalassistanceservices.com/sitemap.xml` | [[FILL: date]] | [[FILL: Success / Couldn't fetch / Has errors]] | [[FILL: number; the sitemap lists 13 today, 15 after Task 5]] |

Errors or warnings: [[FILL: text from the sitemap's detail page, or "none"]]

## 3. Coverage: pages not indexed

From Indexing > Pages > "Why pages aren't indexed". One row per reason. The first two rows are
exclusions the site causes on purpose; confirm them or note that they are missing.

| Reason | Pages | Example URLs | Expected? | Action |
|---|---:|---|---|---|
| Alternate page with proper canonical tag | [[FILL]] | `/back-rent/` (canonical is /services/back-rent/) | Yes, deliberate | None |
| Excluded by 'noindex' tag | [[FILL]] | `/terms.html` | Yes, deliberate | None |
| Crawled - currently not indexed | [[FILL]] | [[FILL: e.g. the google*.html stubs]] | [[FILL]] | [[FILL]] |
| [[FILL: any other reason]] | [[FILL]] | [[FILL]] | [[FILL]] | [[FILL]] |

Indexed pages: [[FILL: number]] of 13 in the sitemap. Any sitemap page not indexed: [[FILL: URL and reason, or "none"]]

## 4. Query split, last 90 days

From Performance > Search results > Export > Queries.csv, split by
`tools/search-console/classify.js` with the rules in `tools/search-console/rules.json`.

[[AUTO: query-split]]

Read with:
- Queries.csv holds at most 1,000 rows and leaves out anonymized queries, so its totals are below
  the property's totals. Property totals for the same range: [[FILL: clicks, impressions]].
- "ambiguous" covers both conflicts (a landlord and a tenant rule both matched) and queries no
  rule decides (the brand name, "back rent", "eviction diversion" on their own).
- This is the baseline for the brief's "Search Console clicks on landlord-phrased queries" measure.

Top tenant queries:

[[AUTO: tenant-queries]]

## 5. Pages getting tenant clicks

[[AUTO: tenant-pages]]

## 6. Recommended copy changes

A page getting tenant clicks is a candidate for a copy change, never for a form. The fix for a
tenant query is to make the result say who the page is for and to send that query to /tenants/,
not to optimise for it. Nothing here touches /tenants/, /terms.html, /back-rent/, landlord-check.js,
form markup, the four disclosures, or the "paid by the City" framing.

| Page | Tenant query it gets | Change proposed | Owner task / PR |
|---|---|---|---|
| [[FILL]] | [[FILL]] | [[FILL: e.g. "landlord" or "tenant's" into the H1 or first paragraph; a link to /tenants/ for renters]] | [[FILL]] |

## 7. New tenant phrasing for the negative lists

Queries found in this read that should join the brief's organic "do not rank" list and the ads
negative list (the brief asks for both to be fed from each read):

| Query | Clicks | Impressions | Add to rules.json list |
|---|---:|---:|---|
| [[FILL]] | [[FILL]] | [[FILL]] | [[FILL: tenant/negativeList or tenant/firstPerson]] |

## 8. Open items

[[FILL: anything that needs Kean, or "none"]]
