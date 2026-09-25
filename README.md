# Rental Assistance Philadelphia — site

Static marketing site. Moving from GitHub Pages to Cloudflare Pages (see **Hosting and deploys**
at the end); a merge to `main` by an approver publishes it.

**This repo is the source of truth for the published site.** An older copy lives at
`Rio/_lanes/tfa-landlord-gtm/artifacts/site-v2.html` in the private 2RD-Automation repo;
that file is a historical draft and is now **stale** (it predates the GTM container, the
`hp_x7f2` honeypot rename, the server-authored confirmation copy and the landlord/tenant
gate). Do not copy it over `index.html`.

## Pages

| Path | What it is |
|---|---|
| `/` | Home: the hero, an overview of both services, the back-rent application (`#apply`) and the case review (`#contact`) |
| `/services/back-rent/` | How getting the City to pay back rent works, and what you collect (`#rentassist`) |
| `/services/licensing/` | Rental License and city-tax compliance, with their two intake forms (`#rentclear`) |
| `/portal/` | The client portal preview (`#portal`) |
| `/faq/` | Questions and answers, with the FAQPage structured data (`#faq`) |
| `/back-rent/` | The paid-ads landing page (single form, `#backrent-form`) |
| `/tenants/` | Where tenants get help. No form, no conversion — deliberately indexed |
| `/terms.html` | Fee & service terms, linked from the consent checkbox |
| `/blog/…` | Six landlord guides |

The first five used to be one long homepage. They share `/site.css` and `/site.js`, each page
carries its own markup (there is no build step), and every one ends with the `#contact` case
review. An old link to a section that moved (`/#faq`, `/#portal`, `/#rentassist`, …) is sent
to its page by a small script at the top of `index.html`'s `<head>`, query string kept.

## The landlord/tenant gate

Every lead form is answered by a service sold to **property owners**, but the brand and the
search terms the site ranks for read as tenant-side. Each lead form therefore starts
`hidden` behind a two-button gate; the form only appears once the visitor says they are a
landlord, and choosing "tenant" shows the resource panel instead. The tenant path issues
**no network request**, so it creates no CRM row and no Google Ads conversion. See
`initRoleGate()` in `site.js` and `back-rent/index.html`.

Every form also carries a hidden `visitor_role` field, which the intake API records on the
CRM row so landlord leads can be filtered.

### The popup every lead form lives in (`landlord-check.js`)

Forms are filled in a popup, never on the page. It asks "own or rent?" first, with a progress
bar across the top, and then shows the page's **own** form — moved into the popup, not copied,
so validation, uploads, the submit handler, the confirmation and conversion tracking are the
code above, unchanged. The homepage application's seven sections become seven steps
(Who you are → About you → The property → The tenant → The money owed → Your documents →
Eviction-diversion status → Fee & finish); each step is checked with the form's own validation
before Next. The case-review forms (`#contact-form`, `/back-rent/`'s `#backrent-form`) are one
step. Closing the popup puts the form back where it was, hidden, keeping what was typed.

Fields are checked live once someone types in them (never for a field merely tabbed past);
a field that passes turns its asterisk into a green check. A wrong value (a digit in a name, a
letter in a phone) shows at once; an unfinished one (first name only, too few digits) only
when the visitor leaves the field or presses Next.
- **Names:** first and last, letters / spaces / hyphens / apostrophes / periods only, under 150
  characters (150 is an error), no keyboard-mash repeats, no Caps Lock ("MARCUS REED" — mixed
  case like "McDonald" and suffixes like "III" are fine).
- **Phones:** formatted as typed — the visitor types digits and `(215) 555-0123` builds itself;
  other characters never land, digits past ten are ignored. Must be a real 10-digit US number
  (a leading 1 is fine, valid area code and exchange).
- **Email:** typed twice. A "Retype email to confirm" card opens beneath it; the retype box
  refuses paste, drop and browser / password-manager autofill, so it is a genuine second
  typing. Next / submit stay held until the two match and the email shows "Verified".
Inside the popup, inputs use the site's control style (white, 1.5px border, 10px corners,
brass focus, red error) and error messages fade up over 350ms while opening their own space.

**Address suggestions.** The property-address box suggests real addresses as the visitor
types (3+ characters), from **Photon** (`photon.komoot.io`, free, no key, OpenStreetMap data —
the attribution line in the list is required by its licence). Results are biased towards
Philadelphia but not limited to it. Arrow keys / Enter / click pick one; Escape closes the list.
Anything typed that names a block, lot, unit, apartment, suite or `#…` is kept: it moves to the
"Unit / Apt / Block & Lot" box (homepage) or stays at the front of the address (`/back-rent/`,
which has no unit box). Photon is a shared public server with no uptime promise, so the list
always tells the visitor typing it by hand is fine: "Don't see your address? You can still type
it in yourself." under the suggestions, and "We couldn't find a match — you can still type your
full address yourself." on its own when nothing matches, Photon is down, or it hasn't answered
within 2.5s. What the visitor types is sent to Photon as they type.

**Uploads and the date, in the site's style.** Each document upload is a drop box (white card,
gold dashed border, "Drag a file here or browse", the accepted types and the 15MB limit); a chosen
file shows its name, size and Remove, and a wrong type or oversize file is refused on the spot.
The real `<input type="file">` is stretched invisibly over the box, so clicking and dropping are
native and the form submits exactly as before. The move-in date is a text box that formats as
typed (`03152024` → `03/15/2024`) with a site-styled calendar (month / year dropdowns, Today,
Clear, keyboard, no future dates). The original `<input type="date">` stays in the form, hidden,
and is what is submitted — the CRM still receives `YYYY-MM-DD`.

**Answers kept for an hour.** What the visitor types is kept on their device (localStorage,
`ras_lc_draft:<form id>`) for one hour after their last edit — reopening or moving between
steps doesn't restart the hour. Coming back within it, the popup refills the form, returns to
the step they reached, and brings a verified email back verified. A "Welcome back … Start over"
line says so and lets them wipe it. Not kept: the two consent boxes (ticked fresh every time),
uploaded files (browsers can't refill a file picker), the honeypot and the role. Submitting
deletes the draft.

A tenant gets the free help lines and a link to `/tenants/`; as with the gates, nothing is
sent. A landlord on a page with no form (the blog) is taken to the homepage application,
which opens straight into the popup.

What opens it:
- **A first visit** to any landing page — once; the answer or a dismissal is remembered in
  `localStorage` (`ras_role_check`).
- **Any link to a lead form** (`#apply`, `#contact`, `#form-card`, `#backrent-form` — the header
  and footer Apply, "Apply to recover back rent", "Start my free case review", …), at any time,
  instead of scrolling down. A visitor who already said landlord skips straight to the form.
  From a page without the application, Apply links to `/#apply` and the popup hands a landlord
  over to it.
- **Either answer on the landlord/tenant question** in front of each form, instead of
  revealing the form on the page.

It is one shared file, loaded with `<script src="/landlord-check.js" defer>` on every landing
page — the five main pages, `/back-rent/` and every `/blog/` page. **Add that line to any new landing
page.** It is deliberately *not* on `/tenants/` or `/terms.html`. On phones it is a bottom
sheet rather than a full-screen takeover, because Google penalises interstitials that hide
the page a searcher just landed on.

## Run it locally

```
npm run dev
```

Then open http://127.0.0.1:4173/. There is no build step: this serves the files as they are
(`tests/static-server.js`, no dependencies), so edit and refresh. Note that the forms POST to
the **live** CRM endpoint — submit only obviously fake details. The popup shows once per
browser; to see it again use a private window, or run
`localStorage.removeItem('ras_role_check')` in the console and refresh.

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

## Hosting and deploys

| | |
|---|---|
| Domain | `rentalassistanceservices.com`, registered at GoDaddy (2026-06-17); DNS at GoDaddy |
| Served by | Cloudflare Pages, project `rental-assistance-services` (Abe's Cloudflare account), connected to this repository. Until the switch: GitHub Pages from `main` (the `CNAME` file) |
| Build | Cloudflare runs `bash deploy/build.sh` (output `dist/`). It publishes only what a browser needs, by file type: never this README, `tests/`, `package.json`, `deploy/` or `.github/` (GitHub Pages served all of them). It stamps every page with the commit (`<meta name="ras-build">`, `/build.json`) and keeps unknown URLs real 404s |
| Pull requests | Cloudflare builds every branch as a preview (`https://<branch>.rental-assistance-services.pages.dev`, `noindex`) and links it on the pull request. Forms cannot submit from a preview: the intake API only accepts this site's own addresses |
| Production | A merge to `main`. `.github/workflows/site-checks.yml` then waits for production to serve that commit, checks it (`deploy/check-live.sh`), and checks the merge was made by an approver (RK or Abe). A deployment that fails its check, or that nobody approved, is rolled back through the Pages API in seconds and Slack is told. GitHub's free plan cannot protect `main` on a private repository, so this is the approval |
| Daily | 11:40 UTC: the full live check and "is production still `main`?". Silent when healthy |
| Rollback | Actions > Site checks > Run workflow > `rollback` (empty = the deployment before the live one). Or Cloudflare > Workers & Pages > rental-assistance-services > Deployments > the deployment > Rollback |
| Which version is live | `curl -s https://rental-assistance-services.pages.dev/build.json` (or the public address once it has moved) |

The public address moves to `www.rentalassistanceservices.com`: Cloudflare Pages can serve a bare
domain only when its DNS is at Cloudflare, and this DNS stays at GoDaddy, which forwards the bare
domain to `www` (path and query string kept, so Google Ads `?gclid` survives). `deploy/config.env`
holds the switch: `CHECKS`, `PAGES_URL`, `PUBLIC_URL`, `CANONICAL_ORIGIN` (the build rewrites the
source's `https://rentalassistanceservices.com` links to it). GitHub Pages is switched off, and this
repository made private, only after Cloudflare Pages has served the domain for a full day.

Checks by hand, all read-only: `bash deploy/selftest.sh` (the build guards fire),
`BUILD_COMMIT=$(git rev-parse HEAD) bash deploy/build.sh && python3 deploy/verify-bundle.py dist`,
`bash deploy/check-live.sh --url <address>`.
