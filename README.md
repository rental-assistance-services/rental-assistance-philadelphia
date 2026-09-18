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
- **Either answer on the landlord/tenant question** in front of each form, instead of
  revealing the form on the page.

It is one shared file, loaded with `<script src="/landlord-check.js" defer>` on every landing
page — the homepage, `/back-rent/` and every `/blog/` page. **Add that line to any new landing
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
