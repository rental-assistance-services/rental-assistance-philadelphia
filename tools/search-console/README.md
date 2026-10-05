# Search Console query split (Task 7)

Splits a Search Console Performance export into **landlord**, **tenant** and **ambiguous**
queries, and lists the pages tenant queries click through to. Node only, no dependencies, no
network, no Google login: it reads CSV files you exported by hand.

**This folder is public.** The site is GitHub Pages with no build step, so every committed file
is served at a URL (this one is `/tools/search-console/README.md`). Only the script, the rules and
the template live here. Exports and everything the script writes go in `tools/data/`, which is
gitignored, or anywhere outside the repo; the script refuses any other folder inside the repo.
Never commit a CSV of real queries, a filled-in report, an API key or an OAuth token.

| File | What it is |
|---|---|
| `classify.js` | The script |
| `rules.json` | Every phrase that decides a class, with where it came from in the brief. Edit this, not the script |
| `REPORT-TEMPLATE.md` | The Task 7 report, with `[[FILL: ...]]` slots for a person and `[[AUTO: ...]]` slots the script fills |

## Run it

1. Search Console > Performance > Search results. Date: **Last 3 months**. Search type: Web.
   Export > **Download CSV** (a ZIP). Unzip `Queries.csv` (and `Pages.csv`) into `tools/data/`.
   A Google Sheets or Excel re-save of the same columns works too (`,` `;` or tab, `12.5%` or `0.125`).
2. From the repo root:

   ```
   node tools/search-console/classify.js tools/data/Queries.csv
   ```

   It prints the split and writes to `tools/data/`:
   - `queries-classified.csv`: every query with its class, the rule that decided it, and any flag
     (job seeker, lawyer, "free", "apply myself": the other people the brief does not want)
   - `summary.md`: the split table, top tenant queries, conflicts, the ambiguous queries to place
   - `report-draft.md`: `REPORT-TEMPLATE.md` with the query split filled in

3. Pages getting tenant clicks. The plain `Pages.csv` has no queries in it, so it cannot be split
   by itself. Either:
   - Print the tenant filter: `node tools/search-console/classify.js --tenant-regex`. In
     Performance, add a filter: Query > **Custom (regex)** > Matches regex, paste it, export again,
     and run with that export's Pages.csv:

     ```
     node tools/search-console/classify.js tools/data/Queries.csv --pages tools/data/tenant/Pages.csv --pages-tenant-filtered
     ```

     The regex leaves out "rental assistance philadelphia" (tenant only *without* "landlord"),
     because Search Console's regex dialect cannot say "unless". The command says so when it prints.
   - Or give `--pages` a table that has both a query and a page column (a Looker Studio table
     from the Search Console connector, for example). Each row is then classed exactly.

   `/tenants/` is never listed as a candidate: tenant clicks there are the point. A page that is
   listed is a candidate for a copy change, never for a form.

Options: `--out <dir>` writes somewhere other than `tools/data/`; `--rules <file>` tries an edited
copy of the rules. Give one Queries.csv only; a Pages.csv always goes after `--pages` (a second
file on its own is refused, with nothing written).

## Steps once Search Console access is granted

Signed in as the shared development identity named in the brief:

1. **Verification.** Settings > Ownership verification. Which `google*.html` stub belongs to
   which account (`google9d1d722c7ac2f4d2.html`, `googleeed2c6ea94980975.html`) is read there,
   and only there: the repo's history does not say. Note each stub's status and any other owners
   or users. Add no new verification file. If the property is not verified, verify it with the
   existing HTML-file method; https://rentalassistanceservices.com/<stub>.html must return 200.
2. **Sitemap.** Sitemaps: submit `https://rentalassistanceservices.com/sitemap.xml`. Record the
   status and the discovered pages (13 today, 15 after Task 5).
3. **Coverage.** Indexing > Pages > "Why pages aren't indexed": each reason, its count and example
   URLs into section 3 of the template. `/back-rent/` (canonical elsewhere) and `/terms.html`
   (noindex) are excluded on purpose.
4. **Queries.** Performance, Last 3 months, Web: note the property's total clicks and impressions,
   export, unzip into `tools/data/`, and run step 2 of "Run it" above.
5. **Tenant pages.** Step 3 of "Run it": the tenant regex filter, a second export into
   `tools/data/tenant/`, and the `--pages ... --pages-tenant-filtered` run.
6. **Report.** Fill every `[[FILL: ...]]` slot in `tools/data/report-draft.md` and paste it into the
   Task 7 section of the brief doc. Nothing from `tools/data/` is committed.

## How a query is classed

Phrases match whole words after lower-casing; hyphens and punctuation count as spaces, apostrophes
are kept. The last word may take a plural (`landlord` matches `landlords`). Then:

- landlord phrases only: **landlord** (the keyword table's primary and supporting terms, plus
  signals such as "landlord", "my tenant", "tenant's", "property manager", "rental license")
- tenant phrases only: **tenant** (the brief's organic negative list, plus first-person renter
  wording: "my rent", "my landlord", "i can't pay")
- both: **ambiguous**, with both rules recorded as a conflict
- neither: **ambiguous**, with any generic phrase recorded ("back rent", the brand name)

A match lying wholly inside a longer one does not count, so "my landlord" is a tenant, not the word
"landlord". Tests: `tests/search-console-classify.spec.js`, fixtures in `tests/fixtures/` (synthetic).
