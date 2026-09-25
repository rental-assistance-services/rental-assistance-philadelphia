# Rental Assistance Philadelphia — site

Static marketing site. Served by GitHub Pages today (a merge to `main` publishes it) and moving
to Cloudflare Pages: see **Hosting and deploys** at the end.

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
| Served by | GitHub Pages from `main` today (the `CNAME` file). Moving to Cloudflare Pages, project `rental-assistance-services`, connected to this repository |
| Build | Cloudflare runs `bash deploy/build.sh` (output `dist/`). It publishes only what a browser needs, by file type: never this README, `tests/`, `package.json`, `deploy/` or `.github/` (GitHub Pages serves all of them today). It stamps every page (`<meta name="ras-build">`, `/build.json`), keeps unknown URLs real 404s, copies the Google verification files byte for byte, and ends by running `deploy/verify-bundle.py`, so a bad bundle fails the Cloudflare build and the previous deployment stays live |
| Pull requests | Cloudflare builds every branch as a preview (`https://<branch>.rental-assistance-services.pages.dev`, `noindex`) and links it on the pull request. Forms cannot submit from a preview: the intake API only accepts this site's own addresses |
| Production | A merge to `main`. `.github/workflows/site-checks.yml` then waits for production to serve that commit, checks it, and checks that every commit that went live with it was merged by an approver (RK or Abe). Both good: the step "Mark <commit> verified" gives the commit the status `site-checks/verified`, linked to that run; the gate trusts a marker only if that run's step really succeeded, so a status posted by hand counts for nothing. A deployment that fails its check, or that nobody approved, is rolled back to the last **verified** commit (not merely the last approved one, which can carry an unapproved push under it) through `deploy/pages_switch.py`, which never switches back to the deployment it removed and leaves anything newer alone; Slack is told. It only alerts when the approval cannot be checked, when the site cannot be reached, and when only the public address is wrong (pages.dev right: that is DNS or the domain, not the deployment). GitHub's free plan cannot protect `main` on a private repository, so this is the approval; it stops mistakes, not someone with write access who edits the workflow |
| Daily | 11:40 UTC: the full live check, "is production still `main`?", and "is anything live that nobody approved?" (this also catches a push that skipped CI). Silent when healthy; the Slack message names each problem it found |
| Rollback | Actions > Site checks > Run workflow > `rollback` (empty = the deployment before the live one, or a deployment id). It checks the target on its own address first, confirms, verifies, and puts the original back if the target is wrong in public. Or Cloudflare > Workers & Pages > rental-assistance-services > Deployments > the deployment > Rollback to this deployment. Then fix `main` with a revert pull request |
| Accept | Actions > Site checks > Run workflow > `accept` (approvers only). After one unapproved commit, every later approval check walks past it and fails, even for approved merges. An approver who has looked at it runs `accept`: the commit is checked, marked verified, and the checks start from it. Empty `commit` = the one production serves. With a Cloudflare token, any commit whose own deployment passes its check, e.g. the revert that was itself rolled back because the unapproved commit sat under it (accept the revert, then roll production to it or merge anything). Accepting takes responsibility for everything up to that commit. An accept lasts as long as its run exists (the marker points at it): if runs are deleted, accept again. A rollback or accept waiting for a check to finish is cancelled if a new push queues behind it: start it again |
| Which version is live | `curl -s https://rental-assistance-services.pages.dev/build.json` (or the public address once it has moved) |

**Rollbacks need a Cloudflare token** in this repository (`CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`, Account > Cloudflare Pages > Edit). Before adding one, know
what it means: a Pages token cannot be limited to one project, so it can change every
Pages project in its account; both writers of this repository can read any of its
secrets through a workflow of their own; and a workflow change that reaches `main` runs
with the token at the next automatic rollback. So a token here is, in effect, handed to
everyone with write access, for every Pages project in that account. Which account
holds this project, and so whether a token belongs here, is RK's call. Until there is
one, every place that would roll back alerts instead, with what to click.

Two things not to do: **do not put Cloudflare Access in front of the preview
addresses** (`*.rental-assistance-services.pages.dev`). A rollback checks its target
on exactly such an address first, so every rollback would be refused. And treat a
Slack alert as a prompt to look, not proof: everyone with write access here can read
the webhook and post to the channel.

The public address moves to `www.rentalassistanceservices.com`: Cloudflare Pages can
serve a bare domain only when its DNS is at Cloudflare, and this DNS stays at GoDaddy,
which forwards the bare domain to `www` (path and query string kept, so Google Ads
`?gclid` survives). `deploy/config.env` holds every switch:

| Setting | What it does |
|---|---|
| `CHECKS` | `off` until the Cloudflare project is connected and has published `main` once. `deploy/config-check.sh` (run before the file is ever sourced) allows only the settings in this table, checks each value, and refuses `CHECKS=on` without a full `VERIFIED_SINCE` |
| `PAGES_URL` | the project's own address (always answers) |
| `PUBLIC_URL` | the public address the checks hold to account; empty until the domain points at Pages |
| `VERIFIED_SINCE` | the full id of the commit production serves when the checks go on (the approval checks start from it), set in the same pull request as `CHECKS=on` |
| `BARE_DOMAIN_FORWARDED` | `yes` once GoDaddy forwards the bare domain; the daily check then tests the forward |
| `CANONICAL_ORIGIN` | the origin canonical links, sitemap and structured data name (the build rewrites the source's `https://rentalassistanceservices.com` to it; only the two real origins are accepted) |

GitHub Pages is switched off, and this repository made private, only after Cloudflare
Pages has served the domain for a full day.

Checks by hand, all read-only: `bash deploy/selftest.sh` (the build and config guards
fire), `python3 -m unittest discover -s deploy -p 'test_*.py'` and
`python3 -m unittest discover -s .github/scripts -p 'test_*.py'` (the rollback switch
and the approval gate against a simulated Cloudflare and GitHub),
`BUILD_COMMIT=$(git rev-parse HEAD) bash deploy/build.sh` (builds and verifies),
`bash deploy/check-live.sh --url <address>`.
