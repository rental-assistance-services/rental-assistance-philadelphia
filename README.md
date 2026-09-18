# Rental Assistance Philadelphia — site

Static marketing site. Hosted via GitHub Pages; a merge to `main` publishes it.

**This repo is the source of truth for the published site.** An older copy lives at
`Rio/_lanes/tfa-landlord-gtm/artifacts/site-v2.html` in the private 2RD-Automation repo;
that file is a historical draft and is now **stale** (it predates the GTM container, the
`hp_x7f2` honeypot rename, the server-authored confirmation copy and the landlord/tenant
gate). Do not copy it over `index.html`.

## Pages

| Path | What it is |
|---|---|
| `/` | The main landlord site — back rent, licensing, city-tax compliance, four intake forms |
| `/back-rent/` | The paid-ads landing page (single form, `#backrent-form`) |
| `/tenants/` | Where tenants get help. No form, no conversion — deliberately indexed |
| `/terms.html` | Fee & service terms, linked from the consent checkbox |
| `/blog/…` | Six landlord guides |

## The landlord/tenant gate

Every lead form is answered by a service sold to **property owners**, but the brand and the
search terms the site ranks for read as tenant-side. Each lead form therefore starts
`hidden` behind a two-button gate; the form only appears once the visitor says they are a
landlord, and choosing "tenant" shows the resource panel instead. The tenant path issues
**no network request**, so it creates no CRM row and no Google Ads conversion. See
`initRoleGate()` in `index.html` and `back-rent/index.html`.

Every form also carries a hidden `visitor_role` field, which the intake API records on the
CRM row so landlord leads can be filtered.

### The first-visit popup (`landlord-check.js`)

The inline gates only ask once a visitor scrolls to a form. `landlord-check.js` asks up
front: on the first page a visitor lands on it opens a four-step popup with a progress bar
(Who you are → Your rental → Your contact → Anything else) that uses the same questions as
the homepage's "Request your free case review" form, and POSTs them as that form does
(`form_type: contact`, `visitor_role: landlord`). A tenant gets a pointer to `/tenants/`
and, as with the gates, nothing is sent. The answer (or a dismissal) is remembered in
`localStorage` (`ras_role_check`), a landlord answer also opens the inline gates, and
"Continue to the full application" pre-fills the long form.

It is one shared file, loaded with `<script src="/landlord-check.js" defer>` on every landing
page — the homepage, `/back-rent/` and every `/blog/` page. **Add that line to any new landing
page.** It is deliberately *not* on `/tenants/` or `/terms.html`. On phones it is a bottom
sheet rather than a full-screen takeover, because Google penalises interstitials that hide
the page a searcher just landed on.

## Tests

```
npm install
npx playwright install --with-deps chromium
npm test
```

Real-browser Playwright suite (`tests/intake-forms.spec.js`) covering both the landlord and
the tenant path on all five forms, the honeypot, and the conversion-tracking rules. It also
asserts the tenant hotline numbers are identical in all three places they appear
(`/tenants/`, and the inline panel on each of the two form pages), so one copy cannot go
stale while another is updated. `tests/landlord-check.spec.js` covers the popup: which pages
carry it, both paths, the progress bar, validation, the conversion rules, the hand-off to
the long form, and the phone layout. CI runs both on every push and PR to `main`.
