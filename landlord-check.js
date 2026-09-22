/* ============================================================
   Landlord check — the popup every lead form lives in

   WHY: this site sells a filing service to PROPERTY OWNERS, but its brand and the search
   terms it ranks for ("rental assistance philadelphia") read as tenant-side, so most
   visitors are tenants. The popup asks "own or rent?" before any form is shown, and then
   IS the form: a landlord fills in the page's real application inside it, one section per
   step, with a progress bar across the top.

   WHAT OPENS IT
   - A first visit to any landing page (once per browser; the answer or a dismissal is
     remembered in localStorage under STORE).
   - Every Apply / case-review link (FORM_ANCHORS) — at any time, instead of scrolling down.
     That includes a link from another page to the homepage's form (/#apply, as the menus on
     /services/…, /portal/ and /faq/ have), so it works without this script too.
   - Either answer on the landlord/tenant question in front of each form (initRoleGate() on
     the homepage and /back-rent/) — instead of revealing the form on the page.

   WHAT IT SHOWS
   - Tenant: the free tenant help lines and a link to /tenants/. NO network request, so no
     CRM row and no Google Ads conversion — the same rule as the inline gates.
   - Landlord: the page's own form, MOVED into the popup (never copied), so its validation,
     uploads, submit handler, confirmation and conversion tracking are exactly the code the
     page already runs and tests. A form with sections (the homepage application: seven
     <fieldset class="fs">) is shown one section per step. The role is stamped by clicking
     the gate's own landlord button, so visitor_role is set by the page's initRoleGate().
     When the popup closes the form goes back where it came from, still hidden.
   - A page with no application (the blog, /services/…, /portal/, /faq/) hands a landlord to
     the homepage application, which opens straight into the popup (HANDOFF).

   Loaded with <script src="/landlord-check.js" defer> on every landing page EXCEPT
   /tenants/ and /terms.html. Tested by tests/landlord-check.spec.js.
   ============================================================ */
(function () {
  'use strict';

  var STORE = 'ras_role_check';            // {v: 'landlord'|'tenant'|'dismissed', t: ms}
  var HANDOFF = 'ras_lc_open';             // sessionStorage: open the application on arrival
  var TTL_DAYS = { landlord: 90, tenant: 90, dismissed: 30 };

  // Links that jump to a lead form, and which kind of form each one means.
  var FORM_ANCHORS = { '#apply': 'apply', '#form-card': 'apply', '#backrent-form': 'apply', '#contact': 'contact' };
  // Which form on the page answers each kind, best first.
  var HOSTS = { apply: ['intake-form', 'backrent-form'], contact: ['contact-form', 'backrent-form', 'intake-form'] };
  var SINGLE_LABEL = { 'contact-form': 'Your details', 'backrent-form': 'Your case' };

  // The same three lines as the inline tenant panels and /tenants/ — tests/intake-forms.spec.js
  // asserts every copy carries the same numbers. data-no-track keeps them out of phone_click.
  var TENANT_LINES = [
    { name: 'Eviction Diversion Program — tenant hotline', tel: '+12155239501', label: '215-523-9501',
      meta: 'City of Philadelphia · Mon–Fri, 9am–4pm' },
    { name: 'Philly Tenant Hotline', tel: '+12674432500', label: '(267) 443-2500',
      meta: 'Free legal help &amp; tenant advocacy' },
    { name: 'PA 211', tel: '211', label: '211', meta: 'Rent, utilities, food and housing referrals' }
  ];

  var NAME_MAX = 150;                      // the owner's full name, in characters
  var bypass = false;                      // true while WE click a gate button on purpose

  window.dataLayer = window.dataLayer || [];

  /* ---------- storage (every access guarded: private windows throw) ---------- */
  function readChoice() {
    try {
      var o = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (!o || !o.v || !TTL_DAYS[o.v]) return null;
      if (Date.now() - o.t > TTL_DAYS[o.v] * 864e5) { localStorage.removeItem(STORE); return null; }
      return o.v;
    } catch (e) { return null; }
  }
  function saveChoice(v) {
    try { localStorage.setItem(STORE, JSON.stringify({ v: v, t: Date.now() })); } catch (e) {}
  }
  function track(action, extra) {
    var ev = { event: 'landlord_check', lc_action: action };
    if (extra) Object.keys(extra).forEach(function (k) { ev[k] = extra[k]; });
    window.dataLayer.push(ev);
  }

  /* ---------- the page's forms ---------- */
  function findForm(opts) {
    if (opts.formId) return document.getElementById(opts.formId);
    var ids = HOSTS[opts.target] || HOSTS.apply;
    for (var i = 0; i < ids.length; i++) { var f = document.getElementById(ids[i]); if (f) return f; }
    return null;
  }
  function gateFor(form) {
    return form && document.querySelector('[data-role-gate][data-gate-for="' + form.id + '"]');
  }
  function sectionsOf(form) {
    return form ? Array.prototype.filter.call(form.children, function (c) {
      return c.tagName === 'FIELDSET' && c.classList.contains('fs');
    }) : [];
  }
  function stepLabels(form) {
    if (!form) return ['Your application'];
    var fs = sectionsOf(form);
    if (!fs.length) return [SINGLE_LABEL[form.id] || 'Your details'];
    return fs.map(function (f) { var h = f.querySelector('h3'); return h ? h.textContent.trim() : 'Details'; });
  }
  // Answer the page's own gate as a landlord, so initRoleGate() stamps visitor_role and un-hides
  // the form exactly as a real click would. `bypass` lets this one click past our interceptor.
  function stampLandlord(form) {
    var gate = gateFor(form);
    var b = gate && gate.querySelector('.rg-btn[data-role="landlord"]');
    if (b) { bypass = true; try { b.click(); } finally { bypass = false; } }
    var role = form.querySelector('input[name="visitor_role"]');
    if (role && !role.value) role.value = 'landlord';
    form.hidden = false;
    form.classList.add('in');              // `.reveal` forms sit at opacity 0 without it
  }
  function submitted(form) { return form.style.display === 'none'; }   // both pages' success path

  /* ---------- styles ---------- */
  var TICK = 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 20 20\'%3E'
    + '%3Ccircle cx=\'10\' cy=\'10\' r=\'10\' fill=\'%232F9E5E\'/%3E%3Cpath d=\'M5.6 10.4l2.9 2.9 5.9-6.3\' fill=\'none\' '
    + 'stroke=\'%23fff\' stroke-width=\'2.2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")';
  var CSS = ''
    + '.lc-backdrop{--lc-navy:var(--navy,#0E2248);--lc-ink:var(--ink,#11161C);--lc-blue:var(--blue,#2A5BD7);'
    + '--lc-blue-2:var(--blue-2,#1B3FA0);--lc-paper:var(--paper-3,#FBF7EE);--lc-green:var(--green,#2F9E5E);'
    + '--lc-hair:var(--hairline,rgba(14,34,72,.2));--lc-muted:var(--muted,#4C5667);--lc-muted-2:var(--muted-2,#6A7384);'
    + '--lc-serif:var(--serif,"Fraunces",Georgia,serif);--lc-sans:var(--sans,"Public Sans",-apple-system,"Segoe UI",sans-serif);'
    + '--lc-mono:var(--mono,"Spline Sans Mono",ui-monospace,Menlo,monospace);--lc-ease:cubic-bezier(.22,.61,.36,1);'
    // The backdrop scrolls, not the dialog: a long section grows the dialog instead of
    // trapping it behind an inner scrollbar. margin:auto centres it while it fits.
    + 'position:fixed;inset:0;z-index:1000;display:flex;overflow-y:auto;overscroll-behavior:contain;padding:24px 16px;'
    + 'background:rgba(8,23,53,.58);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);'
    + 'font-family:var(--lc-sans);color:var(--lc-ink);line-height:1.5;'
    + 'animation:lc-fade .35s var(--lc-ease) both;}'
    // The site's card language (/theme.css, /site.css): 22px corners, the deep shadow with a blue
    // glow, and a header that is the same navy card as the homepage's "What you can collect".
    + '.lc-dialog{position:relative;margin:auto;width:100%;max-width:540px;background:var(--lc-paper);'
    + 'border-radius:22px;box-shadow:0 8px 24px rgba(14,34,72,.18),0 30px 80px rgba(14,34,72,.30),0 30px 90px rgba(42,91,215,.16);'
    + 'animation:lc-rise .35s var(--lc-ease) both;transition:max-width .35s var(--lc-ease);}'
    + '.lc-dialog.lc-wide{max-width:780px;}'
    + '.lc-dialog:focus{outline:none;}'
    + '.lc-head{position:relative;padding:22px 66px 18px 28px;border-radius:22px 22px 0 0;color:#fff;'
    + 'background:var(--ink-grad,#0C1F45);}'
    + '.lc-head::after{content:"";position:absolute;inset:0 0 auto 0;height:1px;border-radius:22px 22px 0 0;'
    + 'background:linear-gradient(90deg,transparent,rgba(143,178,255,.7),transparent);}'
    + '.lc-steps{list-style:none;margin:0;padding:0;display:flex;gap:6px;}'
    + '.lc-steps li{flex:1;min-width:0;}'
    + '.lc-steps .lc-seg{display:block;height:4px;border-radius:4px;background:rgba(143,178,255,.18);'
    + 'transition:background .35s var(--lc-ease),box-shadow .35s var(--lc-ease);}'
    + '.lc-steps li.is-done .lc-seg{background:var(--blue-bright,#8FB2FF);}'
    + '.lc-steps li.is-current .lc-seg{background:linear-gradient(90deg,var(--blue-bright,#8FB2FF),#fff);box-shadow:0 0 12px rgba(143,178,255,.6);}'
    + '.lc-steps .lc-lbl{display:block;margin-top:8px;font-family:var(--lc-mono);font-size:.62rem;letter-spacing:.1em;'
    + 'text-transform:uppercase;color:rgba(201,213,234,.55);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color .35s var(--lc-ease);}'
    + '.lc-steps li.is-current .lc-lbl{color:#fff;font-weight:600;}'
    + '.lc-steps li.is-done .lc-lbl{color:var(--on-ink,#C9D5EA);}'
    + '.lc-count{display:none;margin:10px 0 0;font-family:var(--lc-mono);font-size:.66rem;letter-spacing:.12em;text-transform:uppercase;color:var(--blue-bright,#8FB2FF);}'
    // More steps than fit as labels: segments only, and the current step named underneath.
    + '.lc-head.lc-many .lc-lbl{display:none;}.lc-head.lc-many .lc-count{display:block;}'
    + '.lc-head.lc-off .lc-steps{opacity:.35;}'
    + '.lc-close{position:absolute;top:14px;right:14px;width:38px;height:38px;border:none;border-radius:50%;'
    + 'background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 1px rgba(143,178,255,.22);color:#fff;font-size:1.35rem;line-height:1;cursor:pointer;'
    + 'transition:background .35s var(--lc-ease),transform .35s var(--lc-ease);}'
    + '.lc-close:hover{background:rgba(255,255,255,.18);transform:rotate(90deg);}'
    + '.lc-backdrop button:focus-visible,.lc-backdrop a:focus-visible{outline:2.5px solid var(--lc-blue);outline-offset:2px;}'
    + '.lc-head button:focus-visible{outline-color:var(--blue-bright,#8FB2FF);}'
    + '.lc-body{padding:26px 28px 28px;}'
    // Motion: whatever a click reveals — a new screen, the next section, an error message —
    // fades up over 350ms, ease-in. One timing for all of it.
    + '.lc-panel{animation:lc-up .35s ease-in both;}'
    + '.lc-host fieldset.lc-enter{animation:lc-up .35s ease-in both;}'
    // Error messages: the page shows them with display:none -> block, which drops the message
    // in AND shoves every field below it down in the same frame — that jump is what reads as
    // "no animation" even while the text itself fades. In the popup the message is always in
    // the flow, collapsed, and opens its own space as it fades up, so nothing below jumps.
    + '.lc-host .errmsg{display:block;max-height:0;margin-top:0;opacity:0;transform:translateY(8px);overflow:hidden;visibility:hidden;'
    + 'transition:max-height .35s ease-in,margin-top .35s ease-in,opacity .35s ease-in,transform .35s ease-in,visibility 0s linear .35s;}'
    // max-height is about two lines: the height has to finish opening WITH the fade, not in
    // the first half of it, or the space pops open and the text fades into it afterwards.
    + '.lc-host .errmsg.show,.lc-host .field.show-err .errmsg{max-height:2.9em;margin-top:6px;opacity:1;transform:none;visibility:visible;'
    + 'transition:max-height .35s ease-in,margin-top .35s ease-in,opacity .35s ease-in,transform .35s ease-in,visibility 0s;}'
    // Inputs, in the site's own control language — the same as the "own or rent?" buttons and
    // the gates in front of each form: white fill, 1.5px hairline border, 10px corners, a
    // blue focus ring. The page's inputs used a cream fill that vanished on the cream dialog,
    // a green focus ring, and a GOLD outline for an error whose message is red.
    // :where() keeps the type filter from adding specificity, so the state rules below
    // (focus, valid, error) can each override the base look in the order they are written.
    + '.lc-host .field :where(input:not([type=checkbox]):not([type=radio]):not([type=file]),select,textarea){'
    // display:block drops the empty text-line space an inline input leaves beneath itself.
    + 'display:block;background:#fff;border:1.5px solid var(--lc-hair);border-radius:10px;padding:13px 15px;font-size:1rem;color:var(--lc-ink);'
    + 'box-shadow:0 1px 2px rgba(14,34,72,.04);transition:border-color .35s var(--lc-ease),box-shadow .35s var(--lc-ease);}'
    + '.lc-host .field > label{font-weight:680;color:var(--lc-navy);font-size:.9rem;margin-bottom:7px;}'
    + '.lc-host .field input::placeholder,.lc-host .field textarea::placeholder{color:var(--lc-muted-2);opacity:.7;}'
    + '.lc-host .field :where(input,select,textarea):hover{border-color:rgba(42,91,215,.5);}'
    + '.lc-host .field :where(input,select,textarea):focus{outline:none;border-color:var(--lc-blue);box-shadow:0 0 0 4px rgba(42,91,215,.16);}'
    + '.lc-host .field.lc-ok > :where(input,select,textarea),.lc-host .field .lc-confirm input.lc-match{border-color:rgba(47,158,94,.6);}'
    // An error is red — the same red as its message — and stays red while the field has focus.
    // (.err/.bad stay OUTSIDE :where, or the page's own gold `.field input.err` would outrank it.)
    + '.lc-host .field :where(input,select,textarea).err,.lc-host .field :where(input,select,textarea).bad,'
    + '.lc-host .field :where(input,select,textarea).err:focus,.lc-host .field :where(input,select,textarea).bad:focus{'
    + 'border-color:#B4432F;box-shadow:0 0 0 3px rgba(180,67,47,.13);}'
    // No bottom margin: the site's paragraph margin would otherwise leave a blank band under
    // every field even while its (collapsed) message is hidden.
    + '.lc-host .errmsg{color:#9A3B33;font-size:.84rem;margin-bottom:0;}'
    // A two-column row stacks on a phone; its row gap PLUS each field's own bottom margin
    // doubled the space between those fields. The field margin alone spaces them evenly.
    + '.lc-host .row,.lc-host .row2{row-gap:0;}'
    // File uploads: the drop box is the card, so the page's own dashed wrapper steps back.
    + '.lc-host .file-field{background:none;border:none;padding:0;}'
    + '.lc-drop{position:relative;display:flex;align-items:center;gap:14px;padding:16px 18px;background:#fff;'
    + 'border:1.5px dashed rgba(42,91,215,.55);border-radius:10px;transition:border-color .15s,background .15s,box-shadow .15s;}'
    + '.lc-drop:hover,.lc-drop.lc-over{border-color:var(--lc-blue);background:#FFFCF4;}'
    + '.lc-drop.lc-over{box-shadow:0 0 0 3px rgba(42,91,215,.22);}'
    + '.lc-drop:has(input:focus-visible){border-color:var(--lc-blue);box-shadow:0 0 0 3px rgba(42,91,215,.3);}'
    + '.lc-drop.lc-has{border-style:solid;border-color:rgba(47,158,94,.6);}'
    + '.lc-drop.lc-bad{border-color:#B4432F;}'
    + '.lc-drop input[type=file]{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;z-index:1;padding:0;margin:0;}'
    + '.lc-drop-ico{flex:none;width:42px;height:42px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;'
    + 'background:rgba(42,91,215,.13);color:var(--lc-blue-2);}'
    + '.lc-drop.lc-has .lc-drop-ico{background:#DDEFE3;color:var(--green-deep,#207044);}'
    + '.lc-drop-txt{min-width:0;flex:1;}'
    + '.lc-drop-main{display:block;font-weight:650;color:var(--lc-navy);font-size:.95rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
    + '.lc-drop-main u{color:var(--lc-blue-2);text-underline-offset:2px;}'
    + '.lc-drop-sub{display:block;font-size:.8rem;color:var(--lc-muted-2);margin-top:2px;}'
    + '.lc-drop-remove{position:relative;z-index:2;flex:none;background:none;border:1.5px solid var(--lc-hair);border-radius:8px;'
    + 'padding:6px 12px;font:inherit;font-size:.84rem;font-weight:650;color:var(--lc-navy);cursor:pointer;}'
    + '.lc-drop-remove:hover{border-color:#B4432F;color:#9A3B33;}'
    + '.lc-drop-remove[hidden]{display:none;}'
    // The date: a text box with a calendar button, and the site-styled calendar floating by it.
    + '.lc-date-native{display:none !important;}'
    + '.lc-host .field.lc-datefield{position:relative;}'
    + '.lc-date,.lc-date-row{position:relative;}'
    + '.lc-host .field .lc-date input{padding-right:48px;}'
    + '.lc-date-btn{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:36px;height:36px;border:none;border-radius:8px;'
    + 'background:transparent;color:var(--lc-blue-2);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;}'
    + '.lc-date-btn:hover,.lc-date-btn[aria-expanded=true]{background:rgba(42,91,215,.13);}'
    // FLOATING over the fields below — opening it moves nothing (Kyle, 2026-09-19: "it
    // shouldn't create space at the bottom"). It opens below the date box when there is room,
    // and flips ABOVE it when there isn't (placeCal), so it is never cut off at the bottom.
    // Compact: 280px wide, 30px day cells.
    + '.lc-cal{position:absolute;left:0;top:calc(100% + 6px);z-index:8;width:280px;max-width:100%;padding:10px;background:#fff;'
    + 'border-radius:12px;box-shadow:0 0 0 1px var(--lc-hair),0 14px 30px rgba(14,34,72,.18),0 2px 6px rgba(14,34,72,.06);}'
    + '.lc-cal.lc-cal-up{top:auto;bottom:calc(100% + 6px);}'
    + '.lc-cal[hidden]{display:none;}'
    + '.lc-cal.lc-drop-in{animation:lc-down .35s ease-in both;}'
    + '.lc-cal.lc-cal-up.lc-drop-in{animation-name:lc-up;}'
    + '.lc-cal-head{display:flex;align-items:center;gap:4px;margin-bottom:6px;}'
    + '.lc-host .field .lc-cal-sel[data-cal-month]{flex:1.8;}'
    // The browser's own select arrow is wide and grey; a slim blue chevron takes its place,
    // which also leaves room for "September" and the year in a compact header.
    + '.lc-host .field .lc-cal-sel{flex:1;min-width:0;-webkit-appearance:none;appearance:none;padding:5px 20px 5px 8px;'
    + 'border:1.5px solid var(--lc-hair);border-radius:7px;font:inherit;font-size:.82rem;font-weight:650;color:var(--lc-navy);cursor:pointer;'
    + 'background:#fff url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath d=\'M1 1l4 4 4-4\' fill=\'none\' stroke=\'%231B3FA0\' stroke-width=\'1.6\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E") no-repeat right 7px center;}'
    + '.lc-host .field .lc-cal-sel:focus{outline:none;border-color:var(--lc-blue);box-shadow:0 0 0 3px rgba(42,91,215,.24);}'
    + '.lc-cal-nav{flex:none;width:26px;height:28px;border:none;border-radius:7px;background:transparent;font-size:1.2rem;line-height:1;'
    + 'color:var(--lc-navy);cursor:pointer;}'
    + '.lc-cal-nav:hover:not([disabled]){background:rgba(42,91,215,.13);}'
    + '.lc-cal-nav[disabled]{opacity:.3;cursor:default;}'
    + '.lc-cal-grid{width:100%;border-collapse:collapse;table-layout:fixed;}'
    + '.lc-cal-grid th{font-family:var(--lc-mono);font-size:.6rem;letter-spacing:.06em;text-transform:uppercase;'
    + 'color:var(--lc-muted-2);font-weight:600;padding:2px 0 4px;}'
    + '.lc-cal-grid td{padding:1px;text-align:center;}'
    + '.lc-day{width:100%;height:30px;border:none;border-radius:7px;background:transparent;font:inherit;'
    + 'font-size:.82rem;color:var(--lc-navy);cursor:pointer;transition:background .15s;}'
    + '.lc-day:hover:not([disabled]){background:rgba(42,91,215,.13);}'
    + '.lc-day.lc-out{color:var(--lc-muted-2);opacity:.55;}'
    + '.lc-day.lc-today{box-shadow:inset 0 0 0 1.5px var(--lc-blue);font-weight:700;}'
    + '.lc-day[aria-selected=true]{background:var(--lc-blue);color:#FFFFFF;font-weight:700;}'
    + '.lc-day[disabled]{opacity:.25;cursor:default;}'
    + '.lc-day:focus-visible{outline:2.5px solid var(--lc-blue);outline-offset:1px;}'
    + '.lc-cal-foot{display:flex;justify-content:space-between;margin-top:6px;padding-top:6px;border-top:1px solid var(--lc-hair);}'
    + '.lc-cal-link{background:none;border:none;padding:3px 6px;font:inherit;font-size:.8rem;font-weight:650;color:var(--lc-blue-2);cursor:pointer;border-radius:6px;}'
    + '.lc-cal-link:hover{background:rgba(42,91,215,.13);}'
    // Smaller screens: a touch narrower and tighter still, and never wider than the field.
    + '@media (max-width:640px){.lc-cal{width:264px;padding:8px;}.lc-day{height:28px;font-size:.8rem;}}'
    // Once a field is filled in and passes, its asterisk turns into a green check (and a field
    // with no asterisk gets the check after its label). It fades up like everything else.
    // The icon is exactly 1em and sits on the text's own bottom edge (vertical-align:text-bottom),
    // so the label keeps its height and nothing below it moves. (Shrinking the "*" to font-size:0
    // instead dropped the icon below the text and grew the label ~11px — a jump.)
    + '.lc-host .field.lc-ok .req{display:inline-block;width:1em;height:1em;margin-left:2px;vertical-align:text-bottom;'
    + 'color:transparent;overflow:hidden;background:' + TICK + ' center/contain no-repeat;animation:lc-up .35s ease-in both;}'
    + '.lc-host .field.lc-ok > label:not(:has(.req))::after{content:"";display:inline-block;width:1em;height:1em;margin-left:6px;'
    + 'vertical-align:text-bottom;background:' + TICK + ' center/contain no-repeat;animation:lc-up .35s ease-in both;}'
    // A well-formed email is green straight away; its check + "Verified" wait for the retype.
    + '.lc-host .field.lc-emailok > input{border-color:rgba(47,158,94,.6);}'
    // The email confirm box: a small white card attached under the email (Kyle's mock-up,
    // 2026-09-18) — green label, rounded input. It drops DOWN out of the email field: fades in,
    // slides down 8px into place and opens its own space, all over the same 350ms ease-in.
    // The height is animated EXACTLY (grid rows 0fr -> 1fr), not towards a max-height guess:
    // a guess taller than the card makes the height finish early and stop dead mid-fade,
    // which is what read as "not smooth". The border is a shadow ring so it takes no space
    // while closed, and the inner padding grows with it so the closed card is truly 0px.
    + '.lc-host .lc-confirm{display:grid;grid-template-rows:0fr;opacity:0;transform:translateY(-8px);visibility:hidden;'
    + 'margin-top:0;background:#fff;border-radius:10px;box-shadow:0 0 0 1px transparent;'
    + 'transition:grid-template-rows .35s ease-in,margin-top .35s ease-in,opacity .35s ease-in,transform .35s ease-in,'
    + 'box-shadow .35s ease-in,visibility 0s linear .35s;}'
    + '.lc-host .lc-confirm.show{grid-template-rows:1fr;opacity:1;transform:none;visibility:visible;margin-top:6px;'
    + 'box-shadow:0 0 0 1px var(--lc-hair),0 10px 24px rgba(14,34,72,.10),0 2px 6px rgba(14,34,72,.05);'
    + 'transition:grid-template-rows .35s ease-in,margin-top .35s ease-in,opacity .35s ease-in,transform .35s ease-in,'
    + 'box-shadow .35s ease-in,visibility 0s;}'
    + '.lc-host .lc-confirm-in{min-height:0;overflow:hidden;padding:0 10px;transition:padding .35s ease-in;}'
    // Address suggestions: a list that drops down over the fields below the address box
    // (it overlays rather than pushing them), fading down over 350ms ease-in.
    // "Welcome back" line shown when a saved draft was put back.
    + '.lc-restored{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 20px;'
    + 'padding:11px 15px;border-radius:12px;background:var(--blue-soft,#DCE6FB);border-left:3px solid var(--lc-blue);font-size:.86rem;color:var(--lc-navy);'
    + 'animation:lc-up .35s ease-in both;}'
    + '.lc-restored[hidden]{display:none;}'
    + '.lc-startover{background:none;border:none;padding:0;font:inherit;font-weight:650;color:var(--lc-blue-2);'
    + 'text-decoration:underline;cursor:pointer;}'
    + '.lc-host .field.lc-addr{position:relative;}'
    + '.lc-suggest{position:absolute;left:0;right:0;z-index:5;list-style:none;margin:6px 0 0;padding:6px;background:#fff;'
    + 'border-radius:10px;box-shadow:0 0 0 1px var(--lc-hair),0 14px 30px rgba(14,34,72,.14),0 2px 6px rgba(14,34,72,.06);}'
    + '.lc-suggest[hidden]{display:none;}'
    + '.lc-suggest.lc-suggest-in{animation:lc-down .35s ease-in both;}'
    + '.lc-suggest [role=option]{display:flex;gap:10px;align-items:flex-start;padding:9px 10px;border-radius:8px;cursor:pointer;'
    + 'transition:background .15s;}'
    + '.lc-suggest [role=option]:hover,.lc-suggest [role=option][aria-selected=true]{background:rgba(42,91,215,.13);}'
    + '.lc-sg-pin{flex:none;color:var(--lc-blue-2);margin-top:2px;display:inline-flex;}'
    + '.lc-sg-1{display:block;font-weight:650;color:var(--lc-navy);font-size:.95rem;line-height:1.3;}'
    + '.lc-sg-2{display:block;font-size:.82rem;color:var(--lc-muted-2);line-height:1.35;}'
    + '.lc-suggest-manual{display:flex;gap:10px;align-items:flex-start;padding:9px 10px;margin-top:4px;border-top:1px solid var(--lc-hair);'
    + 'font-size:.86rem;line-height:1.4;color:var(--lc-muted);cursor:default;}'
    + '.lc-suggest-manual svg{flex:none;color:var(--lc-blue-2);margin-top:1px;}'
    + '.lc-suggest.lc-only-manual .lc-suggest-manual{margin-top:0;border-top:none;}'
    + '.lc-suggest-note{font-size:.7rem;color:var(--lc-muted-2);padding:5px 10px 3px;}'
    + '@keyframes lc-down{from{opacity:0;transform:translateY(-8px);}to{opacity:1;transform:none;}}'
    // On a phone the sheet ends at the screen's bottom edge, so a floating list would be cut
    // off there. It sits in the flow instead: the fields below move down, the sheet grows and
    // scrolls, and every suggestion (and the credit line) can be reached.
    + '@media (max-width:640px){.lc-suggest{position:static;}}'
    + '.lc-host .lc-confirm.show .lc-confirm-in{padding:11px 10px 10px;}'
    + '.lc-host .lc-confirm label{display:block;font-size:.8rem;font-weight:700;color:var(--green-deep,#207044);margin:0 0 7px 1px;}'
    + '.lc-host .field .lc-confirm input{padding:11px 13px;}'
    // Chrome gives an autofilled field :-webkit-autofill but fires no reliable event; a
    // 1ms animation on that state is the event guardRetype() listens for.
    + '.lc-host .lc-confirm input:-webkit-autofill{animation:lc-autofill 1ms;}'
    + '@keyframes lc-autofill{from{opacity:1;}to{opacity:1;}}'
    // Verified: a green pill after the email's label (its asterisk has already become a check).
    + '.lc-host .field.lc-verified > label::after,.lc-host .field.lc-verified.lc-ok > label:not(:has(.req))::after{'
    + 'content:"Verified";display:inline-block;width:auto;height:auto;margin-left:8px;padding:2px 9px;'
    + 'border-radius:999px;background:#DDEFE3;color:var(--green-deep,#207044);font-size:.72rem;font-weight:700;'
    + 'letter-spacing:.03em;vertical-align:1px;animation:lc-up .35s ease-in both;}'
    + '.lc-panel[hidden]{display:none;}'
    // Headings as the site sets them: light Fraunces, tight tracking.
    + '.lc-q{font-family:var(--lc-serif);font-size:1.65rem;font-weight:420;letter-spacing:-.018em;color:var(--lc-navy);line-height:1.15;margin:0 0 8px;}'
    + '.lc-sub{color:var(--lc-muted);font-size:.95rem;line-height:1.55;margin:0 0 20px;}'
    // The two answers are the site-wide choice cards (.lc-role in /theme.css — the same as the
    // gate's buttons on the page).
    + '.lc-roles{display:grid;gap:10px;}'
    + '.lc-note{color:var(--lc-muted-2);font-size:.82rem;line-height:1.5;margin:16px 0 0;}'
    + '.lc-lines{list-style:none;padding:0;margin:0 0 18px;display:grid;gap:12px;}'
    + '.lc-lines li{border-top:1px solid var(--lc-hair);padding-top:12px;}'
    + '.lc-lines li:first-child{border-top:none;padding-top:0;}'
    + '.lc-lines b{display:block;color:var(--lc-navy);font-size:.95rem;}'
    + '.lc-lines a{font-weight:700;color:var(--lc-navy);text-decoration:none;border-bottom:2px solid var(--lc-blue);}'
    + '.lc-lines span{color:var(--lc-muted-2);font-size:.84rem;margin-left:6px;}'
    // Buttons as the site's: the blue gradient with its glow (.btn-blue), and the ghost (.btn-ghost).
    + '.lc-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-family:var(--lc-sans);font-weight:680;'
    + 'font-size:1rem;line-height:1;padding:15px 26px;border-radius:10px;border:1.5px solid transparent;cursor:pointer;text-decoration:none;'
    + 'transition:transform .35s var(--lc-ease),box-shadow .35s var(--lc-ease),background .35s var(--lc-ease),border-color .35s var(--lc-ease),color .35s var(--lc-ease);}'
    + '.lc-btn:active{transform:translateY(1px);transition-duration:.1s;}'
    + '.lc-btn-main{background:linear-gradient(180deg,#3F6FE6,#2A5BD7 55%,#2350C4);color:#FFFFFF;'
    + 'box-shadow:var(--shadow-blue,0 1px 0 rgba(255,255,255,.22) inset,0 8px 22px rgba(42,91,215,.34));}'
    + '.lc-btn-main:hover{color:#fff;transform:translateY(-2px);box-shadow:0 1px 0 rgba(255,255,255,.28) inset,0 14px 30px rgba(42,91,215,.44);}'
    + '.lc-btn-main[disabled],.lc-btn-main[aria-disabled=true]{opacity:.55;transform:none;box-shadow:none;cursor:not-allowed;}'
    + '.lc-btn-back{background:rgba(255,255,255,.6);border-color:var(--lc-hair);color:var(--lc-navy);white-space:nowrap;}'
    + '.lc-btn-back:hover{border-color:var(--lc-blue);color:var(--lc-blue-2);background:#fff;}'
    + '.lc-stack{display:grid;gap:10px;}'
    + '.lc-nav{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:24px;padding-top:20px;border-top:1px solid var(--lc-hair);}'
    + '.lc-nav .lc-btn-main{margin-left:auto;}'
    + '.lc-nav [hidden]{display:none;}'
    // The page's form, flattened to sit inside the dialog rather than as a card in a card.
    + '.lc-host .intake{max-width:none;margin:0;}'
    + '.lc-host .fs,.lc-host .lead-form{background:none;border:none;box-shadow:none;padding:0;margin:0;}'
    + '.lc-host fieldset[data-lc-off]{display:none !important;}'
    + '.lc-host .fs-head{margin-bottom:4px;}'
    // The section's own number ("1") would contradict the progress bar ("Step 2 of 8"),
    // which counts "Who you are" as step 1. The bar is the one numbering in the popup.
    + '.lc-host .fs-step{display:none;}'
    + '.lc-host .fs h3{font-family:var(--lc-serif);font-size:1.55rem;font-weight:420;letter-spacing:-.016em;line-height:1.15;color:var(--lc-navy);}'
    + '.lc-host .fs-sub{color:var(--lc-muted);font-size:.95rem;margin:4px 0 22px;}'
    // The contact form's confirmation is styled for the dark band it normally sits in (white
    // text, set inline). On the light dialog that would be invisible, so re-colour it here.
    + '.lc-host .callout.on-ink{background:#DDEFE3;border-color:rgba(47,158,94,.3);border-left-color:var(--lc-green);color:var(--lc-ink);}'
    + '.lc-host .callout.on-ink h3,.lc-host .callout.on-ink p{color:var(--lc-ink) !important;}'
    + '.lc-host .callout.on-ink a{color:var(--lc-blue-2) !important;}'
    + 'body.lc-lock{overflow:hidden;}'
    + '@keyframes lc-fade{from{opacity:0;}to{opacity:1;}}'
    + '@keyframes lc-rise{from{opacity:0;transform:translateY(18px);}to{opacity:1;transform:none;}}'
    + '@keyframes lc-up{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:none;}}'
    /* Phone: a bottom sheet, not a full-screen takeover — Google treats an interstitial that
       hides the content a searcher just landed on as a ranking and ad-quality negative. */
    + '@media (max-width:640px){'
    + '.lc-backdrop{padding:0;}'
    + '.lc-dialog,.lc-dialog.lc-wide{max-width:none;margin:auto 0 0;border-radius:22px 22px 0 0;animation-name:lc-sheet;}'
    + '.lc-head{padding:18px 58px 14px 18px;}.lc-body{padding:22px 18px 24px;}.lc-close{top:12px;right:12px;}'
    + '.lc-steps .lc-lbl{display:none;}.lc-count{display:block;}'
    + '.lc-q{font-size:1.28rem;}}'
    + '@keyframes lc-sheet{from{transform:translateY(100%);}to{transform:none;}}'
    // Closing: the still copy left behind by leave() fades and sinks away over the same 350ms the
    // popup arrived in, the phone sheet sliding back down. Nothing inside it replays its entrance.
    + '.lc-backdrop.lc-leaving,.lc-backdrop.lc-leaving *{animation:none !important;transition:none !important;}'
    + '.lc-backdrop.lc-leaving{animation:lc-fade-out .35s ease-in both !important;pointer-events:none;}'
    + '.lc-backdrop.lc-leaving .lc-dialog{animation:lc-sink .35s ease-in both !important;}'
    + '@keyframes lc-fade-out{from{opacity:1;}to{opacity:0;}}'
    + '@keyframes lc-sink{from{opacity:1;transform:none;}to{opacity:0;transform:translateY(18px);}}'
    + '@media (max-width:640px){.lc-backdrop.lc-leaving .lc-dialog{animation-name:lc-sheet-out !important;}}'
    + '@keyframes lc-sheet-out{from{transform:none;}to{transform:translateY(100%);}}'
    + '@media (prefers-reduced-motion:reduce){.lc-backdrop,.lc-dialog,.lc-panel,.lc-host fieldset.lc-enter,'
    + '.lc-host .errmsg,.lc-host .errmsg.show,.lc-host .field.show-err .errmsg,.lc-host .field input,.lc-host .field select,'
    + '.lc-host .field textarea,.lc-host .lc-confirm,.lc-host .lc-confirm.show,.lc-host .lc-confirm-in{transition:none;}'
    + '.lc-host .field.lc-ok .req,.lc-host .field.lc-ok > label::after,.lc-suggest,.lc-restored,.lc-cal{animation:none;}}';

  var HTML = ''
    + '<div class="lc-dialog" role="dialog" aria-modal="true" aria-labelledby="lc-title-role" tabindex="-1">'
    + '<div class="lc-head"><ol class="lc-steps" aria-label="Progress"></ol><p class="lc-count" aria-hidden="true"></p>'
    + '<button type="button" class="lc-close" aria-label="Close" data-lc-close>&times;</button></div>'
    + '<div class="lc-body">'
    // who you are
    + '<div class="lc-panel" data-lc-panel="role">'
    + '<h2 class="lc-q" id="lc-title-role">First &mdash; do you own or rent?</h2>'
    + '<p class="lc-sub">We&rsquo;re hired by Philadelphia property owners to get a tenant&rsquo;s back rent paid by the City.</p>'
    + '<div class="lc-roles">'
    + '<button type="button" class="lc-role" data-lc-role="landlord">I own or manage rental property<small>Landlord or property manager</small></button>'
    + '<button type="button" class="lc-role" data-lc-role="tenant">I rent my home<small>Tenant</small></button>'
    + '</div>'
    + '<p class="lc-note">Rental Assistance Philadelphia is a private filing service hired by owners. We are not the City and we do not represent tenants.</p>'
    + '</div>'
    // tenant — no request of any kind is made on this path
    + '<div class="lc-panel" data-lc-panel="tenant" hidden>'
    + '<h2 class="lc-q" id="lc-title-tenant">We work for landlords &mdash; but there&rsquo;s free help for you.</h2>'
    + '<p class="lc-sub">We&rsquo;re a private service hired by property owners, so there&rsquo;s nothing we can file for you. '
    + 'The City&rsquo;s Eviction Diversion Program can pay a tenant&rsquo;s back rent &mdash; but <strong>the landlord has to apply</strong>. '
    + 'These free lines can explain it so you can raise it with them:</p>'
    + '<ul class="lc-lines" data-lc-tenant-lines>'
    + TENANT_LINES.map(function (l) {
        return '<li><b>' + l.name + '</b><a href="tel:' + l.tel + '" data-no-track>' + l.label + '</a><span>' + l.meta + '</span></li>';
      }).join('')
    + '</ul>'
    + '<div class="lc-stack"><a class="lc-btn lc-btn-main" href="/tenants/">See all free help for tenants &rarr;</a>'
    + '<button type="button" class="lc-btn lc-btn-back" data-lc-close>Close</button></div>'
    + '</div>'
    // the page's form is moved in here
    + '<div class="lc-panel" data-lc-panel="form" hidden>'
    + '<p class="lc-restored" hidden><span>Welcome back — we kept what you typed on this device for an hour.</span>'
    + '<button type="button" class="lc-startover" data-lc-startover>Start over</button></p>'
    + '<div class="lc-host" id="lc-title-form"></div>'
    + '<div class="lc-nav"><button type="button" class="lc-btn lc-btn-back" data-lc-back>&larr; Back</button>'
    + '<button type="button" class="lc-btn lc-btn-main" data-lc-next>Next &rarr;</button></div>'
    + '</div>'
    + '</div></div>';

  /* ---------- address suggestions (Photon) ----------
     As the visitor types the property address, up to five real addresses are offered under
     the box; picking one fills in the whole address. Typing it out by hand still works — this
     only ever suggests.

     Source: Photon (photon.komoot.io), a free address search over OpenStreetMap data — no
     account, no key, CORS-open, built for search-as-you-type. Results are BIASED towards
     Philadelphia (where every RAS case is) but not limited to it. It is a shared public server
     with fair-use limits and no uptime promise: if it is slow, down or rate-limited, the box
     simply behaves like a plain text box. OpenStreetMap's licence requires the attribution
     line at the foot of the list.

     Blocks and lots: anything typed that names a block, lot, unit, apartment, suite or "#…"
     is never thrown away when a suggestion replaces the text. It moves to the
     "Unit / Apt / Block & Lot" box if the form has one, and otherwise stays at the front of
     the address. */
  var PHOTON = 'https://photon.komoot.io/api/';
  var BIAS = { lat: 39.9526, lon: -75.1652 };             // City Hall, Philadelphia
  var UNIT_RE = /(?:\b(?:blk|block|lot|phase|unit|apt|apartment|suite|ste|bldg|building|floor|fl|rm|room)\b\.?\s*#?\s*[\w-]+|#\s*[\w-]+)/gi;
  var US_STATES = { Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO',
    Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI',
    Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME',
    Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO',
    Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM',
    'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR',
    Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN',
    Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV',
    Wisconsin: 'WI', Wyoming: 'WY', 'Puerto Rico': 'PR' };
  var PIN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="9.5" r="2.5" stroke="currentColor" stroke-width="1.8"/></svg>';

  var PEN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-4-4L4 16v4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13.5 6.5l4 4" stroke="currentColor" stroke-width="1.8"/></svg>';
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  // One Photon result -> what the list shows and what the box is filled with.
  function describe(p) {
    var street = p.street || (p.type === 'street' ? p.name : '') || p.name || '';
    if (!street) return null;
    var line1 = (p.housenumber ? p.housenumber + ' ' : '') + street;
    var us = (p.countrycode || '').toUpperCase() === 'US';
    var place = p.city || p.town || p.village || p.district || p.locality || p.county || '';
    var region = us ? (US_STATES[p.state] || p.state || '') : (p.state || '');
    var tail = [region, p.postcode].filter(Boolean).join(' ');
    var line2 = [place, tail].filter(Boolean).join(', ') + (us || !p.country ? '' : ', ' + p.country);
    return { line1: line1, line2: line2, value: line1 + (line2 ? ', ' + line2 : ''), exact: !!p.housenumber };
  }

  function addressAssist(input) {
    if (input._lcAssist) return input._lcAssist;
    var field = input.closest('.field');
    field.classList.add('lc-addr');
    var id = (input.id || 'lc-addr') + '-suggest';
    var list = document.createElement('ul');
    list.className = 'lc-suggest'; list.id = id; list.setAttribute('role', 'listbox'); list.hidden = true;
    input.insertAdjacentElement('afterend', list);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', id);
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('autocomplete', 'off');            // one list under the box, not two

    var items = [], active = -1, timer = null, slowTimer = null, ctrl = null, cache = {}, filling = false;

    function close() {
      clearTimeout(slowTimer);
      list.hidden = true; items = []; active = -1;
      input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
    }
    function highlight(i) {
      active = i;
      Array.prototype.forEach.call(list.querySelectorAll('[role=option]'), function (li, n) {
        li.setAttribute('aria-selected', n === i ? 'true' : 'false');
      });
      if (i >= 0) input.setAttribute('aria-activedescendant', id + '-' + i); else input.removeAttribute('aria-activedescendant');
    }
    // Photon is a free public service and can't be relied on completely, so the list always
    // says plainly that typing the address by hand is fine: under the suggestions, or on its
    // own when there are none, when Photon is down, or when it is too slow to answer. The line
    // is information only — not an option, so the arrow keys skip it and a click does nothing.
    var MANUAL = {
      more: 'Don’t see your address? You can still type it in yourself.',
      none: 'We couldn’t find a match — you can still type your full address yourself.'
    };
    function manualLine(text) {
      return '<li class="lc-suggest-manual" role="presentation">' + PEN + '<span>' + text + '</span></li>';
    }
    function render(found, why) {
      items = found || [];
      var body;
      if (items.length) {
        body = items.map(function (s, i) {
          return '<li role="option" id="' + id + '-' + i + '" aria-selected="false" data-i="' + i + '">'
            + '<span class="lc-sg-pin">' + PIN + '</span><span><span class="lc-sg-1">' + esc(s.line1) + '</span>'
            + '<span class="lc-sg-2">' + esc(s.line2) + '</span></span></li>';
        }).join('')
          + manualLine(MANUAL.more)
          + '<li class="lc-suggest-note" role="presentation">Address search © OpenStreetMap contributors · Photon</li>';
      } else if (why) {
        body = manualLine(MANUAL.none);                      // nothing found, down, or too slow
      } else { close(); return; }
      list.innerHTML = body;
      list.classList.toggle('lc-only-manual', !items.length);
      var wasHidden = list.hidden;
      list.hidden = false;
      if (wasHidden) { list.classList.remove('lc-suggest-in'); void list.offsetWidth; list.classList.add('lc-suggest-in'); }   // fade down
      input.setAttribute('aria-expanded', 'true');
      highlight(-1);
    }
    var SLOW_MS = 2500;                                    // no answer by then: say so
    function lookup(q) {
      if (cache[q]) { render(cache[q], 'none'); return; }
      if (ctrl) ctrl.abort();
      clearTimeout(slowTimer);
      ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var mine = ctrl;
      slowTimer = setTimeout(function () {
        if (document.activeElement === input && val(input) === q && !items.length) render([], 'slow');
      }, SLOW_MS);
      var url = PHOTON + '?q=' + encodeURIComponent(q) + '&limit=6&lang=en&lat=' + BIAS.lat + '&lon=' + BIAS.lon;
      fetch(url, ctrl ? { signal: ctrl.signal } : {})
        .then(function (r) { if (!r.ok) throw new Error('photon ' + r.status); return r.json(); })
        .then(function (data) {
          var seen = {}, found = [];
          (data.features || []).forEach(function (f) {
            var d = describe(f.properties || {});
            if (d && !seen[d.value]) { seen[d.value] = true; found.push(d); }
          });
          found = found.slice(0, 5);
          cache[q] = found;
          clearTimeout(slowTimer);
          if (document.activeElement === input && val(input) === q) render(found, 'none');
        })
        .catch(function (err) {
          // Replaced by a newer lookup: say nothing. Down or rate-limited: say typing is fine.
          if ((err && err.name === 'AbortError') || mine !== ctrl) return;
          clearTimeout(slowTimer);
          if (document.activeElement === input && val(input) === q) render([], 'down');
        });
    }
    function choose(i) {
      var s = items[i];
      if (!s) return;
      // Keep every block / lot / unit the visitor typed — never lose it to the suggestion.
      var kept = (input.value.match(UNIT_RE) || []).map(function (t) { return t.trim(); });
      var value = s.value;
      if (kept.length) {
        var unit = input.form && input.form.querySelector('[name="property_unit"]');
        if (unit) {
          var have = unit.value.trim();
          kept = kept.filter(function (t) { return have.toLowerCase().indexOf(t.toLowerCase()) === -1; });
          if (kept.length) {
            unit.value = [have].concat(kept).filter(Boolean).join(', ');
            unit.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
          }
        } else {
          value = kept.join(' ') + ', ' + s.value;
        }
      }
      filling = true;
      input.value = value;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
      filling = false;
      close();
      track('address_suggestion', { form_id: input.form ? input.form.id : '', exact: s.exact });
      input.setSelectionRange(value.length, value.length);
    }

    input.addEventListener('input', function () {
      if (filling) return;
      clearTimeout(timer);
      var q = val(input);
      if (q.length < 3) { close(); return; }
      timer = setTimeout(function () { lookup(q); }, 250);
    });
    input.addEventListener('blur', function () { setTimeout(close, 120); });
    list.addEventListener('mousedown', function (e) { e.preventDefault(); });    // keep focus in the box
    list.addEventListener('click', function (e) {
      var li = e.target.closest('[role=option]');
      if (li) choose(Number(li.getAttribute('data-i')));
    });

    // Called by the popup's keydown handler first; true = the list used the key.
    var api = {
      key: function (e) {
        if (list.hidden) return false;
        // Only the "type it yourself" line showing: Escape still closes the LIST, not the popup.
        if (!items.length) {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return true; }
          return false;
        }
        if (e.key === 'ArrowDown') { e.preventDefault(); highlight(active < items.length - 1 ? active + 1 : 0); return true; }
        if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active > 0 ? active - 1 : items.length - 1); return true; }
        if (e.key === 'Enter' && active >= 0) { e.preventDefault(); e.stopPropagation(); choose(active); return true; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return true; }
        if (e.key === 'Tab') { close(); return false; }
        return false;
      }
    };
    input._lcAssist = api;
    return api;
  }
  function val(el) { return String(el.value || '').trim(); }

  // A field's own error line (made if the field has none), shown/hidden with the popup's
  // fade-up + open-its-space styling.
  function fieldMsg(field) {
    for (var i = 0; i < field.children.length; i++) if (field.children[i].classList.contains('errmsg')) return field.children[i];
    var m = document.createElement('p'); m.className = 'errmsg'; field.appendChild(m); return m;
  }
  function say(field, text) { var m = fieldMsg(field); m.textContent = text || ''; m.classList.toggle('show', !!text); }
  // Reformat a masked input without losing the caret: count the digits in front of it.
  function reformat(el, fmt) {
    var v = el.value, caret = typeof el.selectionStart === 'number' ? el.selectionStart : v.length;
    var before = v.slice(0, caret).replace(/\D/g, '').length;
    var out = fmt(v.replace(/\D/g, ''));
    if (out === v) return;
    el.value = out;
    var pos = 0, seen = 0;
    while (pos < out.length && seen < before) { if (/\d/.test(out[pos])) seen++; pos++; }
    if (document.activeElement === el) { try { el.setSelectionRange(pos, pos); } catch (e) {} }
  }

  /* ---------- file uploads ----------
     The browser's own "Choose File / No file chosen" becomes a drop box in the site's style.
     The real file input is kept — stretched invisibly over the box — so clicking anywhere
     opens the picker, dropping a file onto it works natively, and the form submits exactly
     as before. A chosen file shows its name and size with Remove; a wrong type or a file over
     15MB (the server's limit, MAX_FILE_BYTES) is refused on the spot with a line saying why. */
  var MAX_FILE_MB = 15;
  var UPLOAD = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 15V4m0 0l-4 4m4-4l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var DOC = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 3v5h5" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  function typesFrom(accept) {
    var ext = String(accept || '').split(',').map(function (s) { return s.trim().replace(/^\./, '').toUpperCase(); })
      .filter(function (s) { return s && s !== 'JPEG'; });
    if (!ext.length) return '';
    return ext.length === 1 ? ext[0] : ext.slice(0, -1).join(', ') + ' or ' + ext[ext.length - 1];
  }
  function sizeText(b) { return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  function fileAssist(input) {
    if (input._lcFile) return;
    input._lcFile = true;
    var field = input.closest('.field');
    field.classList.add('lc-file');
    var zone = document.createElement('div');
    zone.className = 'lc-drop';
    var types = typesFrom(input.getAttribute('accept'));
    zone.innerHTML = '<span class="lc-drop-ico">' + UPLOAD + '</span>'
      + '<span class="lc-drop-txt"><b class="lc-drop-main">Drag a file here or <u>browse</u></b>'
      + '<small class="lc-drop-sub">' + (types ? types + ' · ' : '') + 'up to ' + MAX_FILE_MB + 'MB</small></span>'
      + '<button type="button" class="lc-drop-remove" hidden>Remove</button>';
    input.parentNode.insertBefore(zone, input);
    zone.appendChild(input);
    var main = zone.querySelector('.lc-drop-main'), sub = zone.querySelector('.lc-drop-sub');
    var ico = zone.querySelector('.lc-drop-ico'), remove = zone.querySelector('.lc-drop-remove');
    var emptySub = sub.textContent;
    var allowed = String(input.getAttribute('accept') || '').toLowerCase().split(',').map(function (s) { return s.trim(); }).filter(Boolean);

    function show() {
      var f = input.files && input.files[0];
      zone.classList.toggle('lc-has', !!f);
      field.classList.toggle('lc-ok', !!f);
      remove.hidden = !f;
      ico.innerHTML = f ? DOC : UPLOAD;
      if (f) { main.textContent = f.name; sub.textContent = sizeText(f.size) + ' · click to replace'; }
      else { main.innerHTML = 'Drag a file here or <u>browse</u>'; sub.textContent = emptySub; }
    }
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (f) {
        var ext = '.' + (f.name.split('.').pop() || '').toLowerCase();
        var problem = allowed.length && allowed.indexOf(ext) === -1
          ? '“' + f.name + '” isn’t a file we can take — please use ' + types + '.'
          : f.size > MAX_FILE_MB * 1048576
            ? '“' + f.name + '” is ' + sizeText(f.size) + ' — files must be under ' + MAX_FILE_MB + 'MB.' : '';
        if (problem) { input.value = ''; say(field, problem); zone.classList.add('lc-bad'); show(); return; }
      }
      say(field, ''); zone.classList.remove('lc-bad');
      show();
      if (f) track('file_added', { field: input.name });
    });
    remove.addEventListener('click', function () {
      input.value = '';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.focus();
    });
    ['dragenter', 'dragover'].forEach(function (t) { input.addEventListener(t, function () { zone.classList.add('lc-over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { input.addEventListener(t, function () { zone.classList.remove('lc-over'); }); });
    show();
  }

  /* ---------- the date field ----------
     The browser's own calendar can't be styled, so the popup shows its own: a card in the
     site's style with month and year dropdowns (a move-in date can be years back), Today and
     Clear, the gold selection, full keyboard use and the 350ms fade-down. The date can also be
     typed — digits only, "03152024" reads "03/15/2024".
     The ORIGINAL <input type="date"> stays in the form, hidden, and is the one submitted: the
     CRM keeps receiving exactly the YYYY-MM-DD it always has. A move-in date can't be in the
     future. */
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
    'October', 'November', 'December'];
  var CAL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { var t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
  function fromIso(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function shown(d) { return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear(); }
  // "MM/DD/YYYY" -> a Date, or a reason it isn't one. unfinished => null (not wrong yet).
  function readDate(v) {
    var d = v.replace(/\D/g, '');
    if (d.length < 8) return { unfinished: true };
    var mm = +d.slice(0, 2), dd = +d.slice(2, 4), yy = +d.slice(4, 8);
    var dt = new Date(yy, mm - 1, dd);
    if (mm < 1 || mm > 12 || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return { problem: 'That isn’t a real date — use MM/DD/YYYY, e.g. 03/15/2024.' };
    if (yy < 1900) return { problem: 'Please check the year.' };
    if (dt > today()) return { problem: 'The move-in date can’t be in the future.' };
    return { date: dt };
  }
  function dateProblem(v, strict) {
    var r = readDate(v);
    if (r.unfinished) return strict ? 'Enter the full date, e.g. 03/15/2024.' : null;
    return r.problem || null;
  }
  function dateAssist(native) {
    if (native._lcDate) return native._lcDate;
    var field = native.closest('.field');
    field.classList.add('lc-datefield');
    var box = document.createElement('div');
    box.className = 'lc-date';
    var shownId = native.id + '-shown', calId = native.id + '-cal';
    // The input and its button share a row of their own, so the button stays centred on the
    // INPUT when the calendar opens underneath and the box grows.
    box.innerHTML = '<div class="lc-date-row"><input id="' + shownId + '" type="text" inputmode="numeric" autocomplete="off" placeholder="MM/DD/YYYY"'
      + ' maxlength="10" data-lc-date aria-haspopup="dialog" aria-controls="' + calId + '">'
      + '<button type="button" class="lc-date-btn" aria-label="Open calendar" aria-controls="' + calId + '" aria-expanded="false">' + CAL + '</button></div>';
    native.parentNode.insertBefore(box, native);
    native.classList.add('lc-date-native');
    native.tabIndex = -1;
    var lab = field.querySelector('label[for="' + native.id + '"]');
    if (lab) lab.setAttribute('for', shownId);
    var text = box.querySelector('input'), btn = box.querySelector('button');
    var cal = document.createElement('div');
    cal.className = 'lc-cal'; cal.id = calId; cal.hidden = true;
    cal.setAttribute('role', 'dialog'); cal.setAttribute('aria-label', 'Choose a date');
    box.appendChild(cal);
    var view = today(), focusDay = null;

    function commit(dt, via) {                        // put a date in both boxes
      native.value = dt ? iso(dt) : '';
      text.value = dt ? shown(dt) : '';
      text.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
      native.dispatchEvent(new Event('change', { bubbles: true }));
      if (dt) track('date_picked', { field: native.name, via: via });
    }
    function build() {
      var y0 = today().getFullYear(), years = '';
      for (var y = y0; y >= y0 - 40; y--) years += '<option value="' + y + '"' + (y === view.getFullYear() ? ' selected' : '') + '>' + y + '</option>';
      var months = MONTHS.map(function (m, i) { return '<option value="' + i + '"' + (i === view.getMonth() ? ' selected' : '') + '>' + m + '</option>'; }).join('');
      var first = new Date(view.getFullYear(), view.getMonth(), 1), start = new Date(first);
      start.setDate(1 - first.getDay());
      var chosen = native.value, now = today(), cells = '';
      if (!focusDay || focusDay.getMonth() !== view.getMonth() || focusDay.getFullYear() !== view.getFullYear()) {
        focusDay = fromIso(chosen);
        if (!focusDay || focusDay.getMonth() !== view.getMonth() || focusDay.getFullYear() !== view.getFullYear()) focusDay = first;
      }
      // Only the weeks this month touches (usually 5, sometimes 4 or 6) — a fixed 6 rows made
      // the calendar a row taller than it needed to be.
      var daysIn = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
      var weeks = Math.ceil((first.getDay() + daysIn) / 7);
      for (var w = 0; w < weeks; w++) {
        cells += '<tr>';
        for (var dI = 0; dI < 7; dI++) {
          var d = new Date(start); d.setDate(start.getDate() + w * 7 + dI);
          var s = iso(d), out = d.getMonth() !== view.getMonth(), future = d > now;
          cells += '<td><button type="button" class="lc-day' + (out ? ' lc-out' : '') + (s === iso(now) ? ' lc-today' : '') + '"'
            + ' data-day="' + s + '" tabindex="' + (s === iso(focusDay) ? '0' : '-1') + '"'
            + ' aria-selected="' + (s === chosen) + '"' + (future ? ' disabled' : '')
            + ' aria-label="' + MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + '">' + d.getDate() + '</button></td>';
        }
        cells += '</tr>';
      }
      cal.innerHTML = '<div class="lc-cal-head">'
        + '<button type="button" class="lc-cal-nav" data-cal-move="-1" aria-label="Previous month">‹</button>'
        + '<select class="lc-cal-sel" data-cal-month aria-label="Month">' + months + '</select>'
        + '<select class="lc-cal-sel" data-cal-year aria-label="Year">' + years + '</select>'
        + '<button type="button" class="lc-cal-nav" data-cal-move="1" aria-label="Next month"'
        + (view.getFullYear() === now.getFullYear() && view.getMonth() === now.getMonth() ? ' disabled' : '') + '>›</button></div>'
        + '<table class="lc-cal-grid" role="grid"><thead><tr>'
        + ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(function (x) { return '<th scope="col">' + x + '</th>'; }).join('')
        + '</tr></thead><tbody>' + cells + '</tbody></table>'
        + '<div class="lc-cal-foot"><button type="button" class="lc-cal-link" data-cal-today>Today</button>'
        + '<button type="button" class="lc-cal-link" data-cal-clear>Clear</button></div>';
      cal.querySelectorAll('button,select').forEach(function (el) { el._lcAssist = api; });
    }
    function openCal() {
      var picked = fromIso(native.value);
      view = picked ? new Date(picked.getFullYear(), picked.getMonth(), 1) : new Date(today().getFullYear(), today().getMonth(), 1);
      focusDay = picked || today();
      build();
      cal.hidden = false;
      placeCal();
      cal.classList.remove('lc-drop-in'); void cal.offsetWidth; cal.classList.add('lc-drop-in');
      btn.setAttribute('aria-expanded', 'true');
      var f = cal.querySelector('.lc-day[tabindex="0"]'); if (f) f.focus({ preventScroll: true });
      // If neither side has room (a very short window), scroll just enough to show it all.
      try { cal.scrollIntoView({ block: 'nearest' }); } catch (e) {}
    }
    // Below the date box if it fits in the window, otherwise above it if there is more room
    // there — a floating calendar must never open into the bottom edge and get cut off.
    function placeCal() {
      cal.classList.remove('lc-cal-up');
      var row = box.querySelector('.lc-date-row').getBoundingClientRect();
      var need = cal.offsetHeight + 12;
      var below = window.innerHeight - row.bottom, above = row.top;
      if (below < need && above > below) cal.classList.add('lc-cal-up');
    }
    function closeCal(back) {
      if (cal.hidden) return;
      cal.hidden = true; btn.setAttribute('aria-expanded', 'false');
      if (back) text.focus();
    }
    function moveFocus(days, months) {
      var d = new Date(focusDay);
      if (months) d.setMonth(d.getMonth() + months); else d.setDate(d.getDate() + days);
      if (d > today()) d = today();
      focusDay = d;
      view = new Date(d.getFullYear(), d.getMonth(), 1);
      build();
      var f = cal.querySelector('[data-day="' + iso(d) + '"]'); if (f) f.focus();
    }
    btn.addEventListener('click', function () { if (cal.hidden) openCal(); else closeCal(true); });
    cal.addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (!t) return;
      if (t.hasAttribute('data-day')) { commit(fromIso(t.getAttribute('data-day')), 'calendar'); closeCal(true); return; }
      if (t.hasAttribute('data-cal-move')) { view.setMonth(view.getMonth() + Number(t.getAttribute('data-cal-move'))); focusDay = null; build(); return; }
      if (t.hasAttribute('data-cal-today')) { commit(today(), 'today'); closeCal(true); return; }
      if (t.hasAttribute('data-cal-clear')) { commit(null); closeCal(true); }
    });
    cal.addEventListener('change', function (e) {
      if (e.target.hasAttribute('data-cal-month')) view.setMonth(+e.target.value);
      if (e.target.hasAttribute('data-cal-year')) view.setFullYear(+e.target.value);
      if (view > today()) view = new Date(today().getFullYear(), today().getMonth(), 1);
      focusDay = null; build();
      var s = cal.querySelector(e.target.hasAttribute('data-cal-month') ? '[data-cal-month]' : '[data-cal-year]'); if (s) s.focus();
    });
    // Typing: digits only, the slashes place themselves; a complete real date fills the
    // hidden original, anything else empties it (never submit half a date).
    text.addEventListener('input', function (e) {
      if (e.inputType === 'insertReplacementText') return;
      reformat(text, function (d) {
        d = d.slice(0, 8);
        return d.slice(0, 2) + (d.length > 2 ? '/' + d.slice(2, 4) : '') + (d.length > 4 ? '/' + d.slice(4) : '');
      });
      var r = readDate(text.value);
      native.value = r.date ? iso(r.date) : '';
      native.dispatchEvent(new Event('change', { bubbles: true }));
    }, true);
    document.addEventListener('mousedown', function (e) { if (!box.contains(e.target)) closeCal(false); });

    var api = {
      key: function (e) {
        if (cal.hidden) {
          if (e.target === text && e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); openCal(); return true; }
          return false;
        }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeCal(true); return true; }
        if (!e.target.hasAttribute || !e.target.hasAttribute('data-day')) return false;
        var map = { ArrowLeft: [-1], ArrowRight: [1], ArrowUp: [-7], ArrowDown: [7], PageUp: [0, -1], PageDown: [0, 1] };
        if (map[e.key]) { e.preventDefault(); moveFocus(map[e.key][0], map[e.key][1] || 0); return true; }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault(); e.stopPropagation();
          if (!e.target.disabled) { commit(fromIso(e.target.getAttribute('data-day')), 'calendar'); closeCal(true); }
          return true;
        }
        return false;
      },
      // After the saved answers are put back (or cleared), show the original's date.
      sync: function () { var d = fromIso(native.value); text.value = d ? shown(d) : ''; }
    };
    text._lcAssist = api; btn._lcAssist = api;
    native._lcDate = api;
    api.sync();
    return api;
  }

  /* ---------- closing over 350ms ---------- */
  // The real popup has to come down at once: the form goes straight back to the page, where the
  // page's own code (and a reopen) expects to find it. What animates away is a still copy of the
  // dialog, taken the moment it closes, inside a CLOSED shadow root: it looks the same (the page's
  // styles are copied in), but no selector, script, focus or screen reader can reach it, and its
  // ids and field names cannot collide with the real ones. Removed when the 350ms are up.
  var leaveSheet = null;
  function leaveStyles() {
    if (leaveSheet) return leaveSheet;
    var css = Array.prototype.map.call(document.styleSheets, function (s) {
      try { return Array.prototype.map.call(s.cssRules, function (r) { return r.cssText; }).join('\n'); }
      catch (e) { return ''; }                 // a cross-origin sheet (the web fonts) can't be read
    }).join('\n');
    if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in Document.prototype) {
      try { leaveSheet = new CSSStyleSheet(); leaveSheet.replaceSync(css); return leaveSheet; } catch (e) {}
    }
    leaveSheet = css;
    return leaveSheet;
  }
  function leave(root) {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!document.body.attachShadow) return;
    var ghost = root.cloneNode(true);
    // cloneNode keeps what the markup says, not what was typed: carry the typed values over, or
    // the fields would blank out as the popup leaves.
    var from = root.querySelectorAll('input,select,textarea'), to = ghost.querySelectorAll('input,select,textarea');
    for (var i = 0; i < from.length && i < to.length; i++) {
      to[i].removeAttribute('name');
      if (from[i].type === 'checkbox' || from[i].type === 'radio') to[i].checked = from[i].checked;
      else if (from[i].type !== 'file') { try { to[i].value = from[i].value; } catch (e) {} }
    }
    ghost.removeAttribute('data-landlord-check');
    ghost.classList.add('lc-leaving');
    var host = document.createElement('div');
    host.className = 'lc-ghost';
    host.setAttribute('aria-hidden', 'true');
    host.inert = true;
    host.style.cssText = 'position:fixed;inset:0;z-index:1000;pointer-events:none;';
    var shadow = host.attachShadow({ mode: 'closed' });
    var sheet = leaveStyles();
    if (typeof sheet === 'string') { var st = document.createElement('style'); st.textContent = sheet; shadow.appendChild(st); }
    else shadow.adoptedStyleSheets = [sheet];
    shadow.appendChild(ghost);
    document.body.appendChild(host);
    ghost.scrollTop = root.scrollTop;
    setTimeout(function () { if (host.parentNode) host.parentNode.removeChild(host); }, 360);
  }

  /* ---------- the popup ---------- */
  // trigger: 'first_visit' | 'cta' | 'gate' | 'handoff'
  // opts: {target: 'apply'|'contact', formId, role: 'landlord'|'tenant'}
  function open(trigger, opts) {
    opts = opts || {};
    if (document.querySelector('[data-landlord-check]')) return;
    if (!document.querySelector('[data-landlord-check-style]')) {
      var style = document.createElement('style');
      style.setAttribute('data-landlord-check-style', '');
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    var root = document.createElement('div');
    root.className = 'lc-backdrop';
    root.setAttribute('data-landlord-check', '');
    root.innerHTML = HTML;
    document.body.appendChild(root);
    document.body.classList.add('lc-lock');

    var dialog = root.querySelector('.lc-dialog');
    var head = root.querySelector('.lc-head');
    var list = root.querySelector('.lc-steps');
    var count = root.querySelector('.lc-count');
    var host = root.querySelector('.lc-host');
    var backBtn = root.querySelector('[data-lc-back]');
    var nextBtn = root.querySelector('[data-lc-next]');
    var lastFocus = document.activeElement;

    var form = findForm(opts);
    var labels = ['Who you are'].concat(stepLabels(form));
    var sections = [], idx = -1, placeholder = null, observer = null, screen = 'role';

    list.innerHTML = labels.map(function (s, i) {
      return '<li data-lc-dot="' + (i + 1) + '"><span class="lc-seg"></span><span class="lc-lbl">' + s + '</span></li>';
    }).join('');
    head.classList.toggle('lc-many', labels.length > 4);

    // at: 1-based step the bar marks as current; 0 = greyed out (tenant); labels.length+1 = all done
    function progress(at) {
      root.querySelectorAll('[data-lc-dot]').forEach(function (li) {
        var i = parseInt(li.getAttribute('data-lc-dot'), 10);
        li.classList.toggle('is-done', at > 0 && i < at);
        li.classList.toggle('is-current', i === at);
        if (i === at) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      });
      head.classList.toggle('lc-off', at === 0);
      count.textContent = at >= 1 && at <= labels.length
        ? 'Step ' + at + ' of ' + labels.length + ' · ' + labels[at - 1]
        : (at > labels.length ? 'Done' : '');
    }
    function panel(name) {
      screen = name;
      root.querySelectorAll('[data-lc-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-lc-panel') !== name; });
      dialog.setAttribute('aria-labelledby', 'lc-title-' + name);
      dialog.classList.toggle('lc-wide', name === 'form' && sections.length > 0);
      root.scrollTop = 0;
    }
    function focusFirst(scope) {
      var el = scope && scope.querySelector('input:not([type=hidden]):not([tabindex="-1"]),select,textarea');
      if (el) el.focus({ preventScroll: true });
    }

    function showRole() {
      panel('role'); progress(1);
      // Focus the dialog, not the first button: its focus ring would make "landlord" look
      // pre-selected, which nudges the answer.
      dialog.focus({ preventScroll: true });
    }
    function showTenant() {
      panel('tenant'); progress(0);
      var a = root.querySelector('[data-lc-panel="tenant"] .lc-btn-main');
      if (a) a.focus({ preventScroll: true });
    }

    function mount() {
      if (!form) {
        // No application on this page (the blog, /services/…, /portal/, /faq/): it lives on the homepage.
        try { sessionStorage.setItem(HANDOFF, 'apply'); } catch (e) {}
        track('handoff', { page: location.pathname });
        // To the homepage's TOP, not /#apply: the HANDOFF flag already opens the application
        // there. With the #apply the browser jumped the page down to the form section, so the
        // popup opened over the bottom of the page and closing it left the visitor down there.
        location.href = '/';
        return;
      }
      if (!placeholder) {
        stampLandlord(form);
        // Already submitted on an earlier open: bring the confirmation in with the form.
        var nodes = [form], prev = form.previousElementSibling;
        if (submitted(form) && prev && prev.getAttribute('role') === 'status') nodes.unshift(prev);
        placeholder = document.createComment('landlord-check: form lives here');
        nodes[0].parentNode.insertBefore(placeholder, nodes[0]);
        nodes.forEach(function (n) { host.appendChild(n); });
        sections = sectionsOf(form);
        // Both pages report success by inserting a confirmation before the form and hiding
        // the form. Watch for it, so the popup can mark the application done.
        observer = new MutationObserver(function () { if (submitted(form)) showDone(); });
        observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
        // Capture, so it runs before the page's own submit handler and can hold it back.
        form.addEventListener('submit', guardSubmit, true);
        form.querySelectorAll('input[name="property_address"]').forEach(addressAssist);
        form.querySelectorAll('.file-field input[type="file"]').forEach(fileAssist);
        form.querySelectorAll('input[type="date"]').forEach(dateAssist);
      }
      panel('form');
      if (submitted(form)) { showDone(); return; }
      // Back within the hour: put their answers back and pick up on the step they were on.
      var start = 0, d = readDraft();
      if (d) {
        var filled = applyDraft(d);
        start = Math.max(0, Math.min(d.step || 0, Math.max(sections.length - 1, 0)));
        restoredNote.hidden = !filled;
        if (filled) track('draft_restored', { form_id: form.id, fields: filled });
      }
      showStep(start);
    }

    /* --- the 1-hour draft ---
       What the visitor has typed is kept on this device (localStorage) for one hour after
       their last edit, so a closed tab, a reload or a phone call doesn't cost them the form.
       That includes a verified email: it comes back verified, retype and all.
       NOT kept: the two consent boxes (a legal authorisation is ticked fresh every time),
       uploaded files (a browser can't refill a file picker), the honeypot, and the role
       (that is stamped by the gate). A submitted application deletes its draft, and "Start
       over" deletes it on demand — it is personal data on what may be a shared computer. */
    var DRAFT_TTL = 60 * 60 * 1000;
    var NOT_KEPT = { hp_x7f2: true, visitor_role: true, consent: true, agree_terms: true };
    var draftTimer = null, restoring = false;
    var restoredNote = root.querySelector('.lc-restored');
    function draftKey() { return 'ras_lc_draft:' + form.id; }
    function keepable(el) {
      return !!el.name && !NOT_KEPT[el.name] && !/^(file|hidden|password|submit|button)$/.test(el.type);
    }
    function ownerEmail() { return form.querySelector('input[type="email"][required]'); }
    function readDraft() {
      try {
        var o = JSON.parse(localStorage.getItem(draftKey()) || 'null');
        if (!o || !o.values) return null;
        if (Date.now() - o.t > DRAFT_TTL) { localStorage.removeItem(draftKey()); return null; }
        return o;
      } catch (e) { return null; }
    }
    function clearDraft() { clearTimeout(draftTimer); try { localStorage.removeItem(draftKey()); } catch (e) {} }
    function saveDraft() {
      if (!form || restoring || submitted(form)) return;
      var values = {}, any = false;
      form.querySelectorAll('input,select,textarea').forEach(function (el) {
        if (!keepable(el)) return;
        if (el.type === 'checkbox') { if (el.checked) { values[el.name] = true; any = true; } return; }
        if (el.type === 'radio') { if (el.checked) values[el.name] = el.value; if (el.checked && !el.defaultChecked) any = true; return; }
        if (val(el)) { values[el.name] = el.value; any = true; }
      });
      var em = ownerEmail();
      var ver = em && verified(em) ? val(em).toLowerCase() : '';
      try {
        if (!any) { localStorage.removeItem(draftKey()); return; }
        // The hour runs from the last EDIT: re-saving unchanged answers (reopening the popup,
        // moving between steps) keeps the original time, so a draft can't live on forever.
        var old = readDraft(), same = old && JSON.stringify(old.values) === JSON.stringify(values) && old.verified === ver;
        localStorage.setItem(draftKey(), JSON.stringify({ t: same ? old.t : Date.now(), step: Math.max(idx, 0),
          values: values, verified: ver }));
      } catch (e) {}
    }
    function scheduleSave() { if (restoring) return; clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 250); }
    // Fill only EMPTY fields: never overwrite something typed since. Returns how many it filled.
    function applyDraft(d) {
      var filled = 0;
      restoring = true;
      try {
        Object.keys(d.values).forEach(function (name) {
          var v = d.values[name];
          form.querySelectorAll('[name="' + name.replace(/"/g, '') + '"]').forEach(function (el) {
            if (!keepable(el)) return;
            if (el.type === 'radio') {
              if (el.value === v && !el.checked) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
            } else if (el.type === 'checkbox') {
              if (v && !el.checked) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); filled++; }
            } else if (!val(el) && v) {
              el.value = v; filled++;
            }
          });
        });
        // A restored date lives in the hidden original; show it in the visible box.
        form.querySelectorAll('.lc-date-native').forEach(function (n) { if (n._lcDate) n._lcDate.sync(); });
        // Show them as checked fields, exactly as when they were typed.
        form.querySelectorAll('input,select,textarea').forEach(function (el) {
          if (isEntry(el) && val(el)) { el.setAttribute('data-lc-touched', ''); runPageCheck(el, true); refreshTick(el); }
        });
        // A verified email comes back verified — the retype included.
        var em = ownerEmail();
        if (em && d.verified && val(em).toLowerCase() === d.verified) {
          var box = confirmBox(em, true), c = box.querySelector('input');
          c.value = em.value;
          em.setAttribute('data-lc-verified-for', d.verified);   // restored, not a fresh verification
          box.classList.add('show');
          checkConfirm(em, false);
        }
      } finally { restoring = false; }
      return filled;
    }
    // "Start over": empty everything the draft kept, forget the draft, back to the first step.
    function startOver() {
      clearDraft();
      form.querySelectorAll('input,select,textarea').forEach(function (el) {
        if (!keepable(el)) return;
        if (el.type === 'radio') { el.checked = el.defaultChecked; if (el.checked) el.dispatchEvent(new Event('change', { bubbles: true })); return; }
        if (el.type === 'checkbox') { el.checked = false; return; }
        el.value = '';
        el.removeAttribute('data-lc-touched');
        el.removeAttribute('data-lc-verified-for');
        clearErr(el);
        var f = el.closest('.field');
        if (f) f.classList.remove('lc-ok', 'lc-emailok', 'lc-verified');
      });
      form.querySelectorAll('.lc-date-native').forEach(function (n) { if (n._lcDate) n._lcDate.sync(); });
      form.querySelectorAll('input[type="file"]').forEach(function (f) {
        if (f.value) { f.value = ''; f.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      var em = ownerEmail(), box = em && confirmBox(em, false);
      if (box) { var c = box.querySelector('input'); c.value = ''; c.classList.remove('err', 'lc-match'); box.querySelector('.errmsg').classList.remove('show'); box.classList.remove('show'); }
      restoredNote.hidden = true;
      track('draft_cleared', { form_id: form.id });
      showStep(0);
    }
    host.addEventListener('input', function () { scheduleSave(); });
    host.addEventListener('change', function () { scheduleSave(); });

    function showStep(i) {
      idx = i;
      sections.forEach(function (fs, n) {
        if (n === i) fs.removeAttribute('data-lc-off'); else fs.setAttribute('data-lc-off', '');
        fs.classList.remove('lc-enter');
      });
      if (sections[i]) { void sections[i].offsetWidth; sections[i].classList.add('lc-enter'); }   // restart the fade-up
      var last = !sections.length || i === sections.length - 1;
      nextBtn.hidden = last;
      backBtn.hidden = false;
      progress(i + 2);
      root.scrollTop = 0;
      focusFirst(sections.length ? sections[i] : form);
      track('step', { lc_step: i + 2, form_id: form.id });
      scheduleSave();                                     // remember which step they reached
    }

    function showDone() {
      if (screen === 'done') return;
      screen = 'done';
      sections.forEach(function (fs) { fs.removeAttribute('data-lc-off'); });
      nextBtn.hidden = true; backBtn.hidden = true;
      progress(labels.length + 1);
      track('submit', { form_id: form.id });
      clearDraft();                                       // sent: nothing left to keep
      restoredNote.hidden = true;
    }

    /* --- validation: the page's own rules, shown only once a field has been typed in ---
       Both pages validate a field on blur (and checkboxes/radios on change), marking it
       `.err` (homepage) or `.bad` (back-rent). The popup reuses those rules instead of
       copying them, and changes only WHEN they run:
       - while the visitor types in a field, it is checked live;
       - leaving a field that was never typed in shows no error (the blur is stopped here);
       - pressing Next checks the whole section, since the visitor is trying to move on.
       A field that has been typed into and passes turns its asterisk into a green check.

       On top of the page's rules the popup adds a few of its own (popupProblem): a length
       cap on the owner's name, and — for a form the page never validates live, the case-review
       form — required / email / phone checks. And a required email must be typed twice: a
       confirm box fades up beneath it, and the email is only "Verified" once both match. */
    var validating = false;
    var NAME_FIELDS = { owner_name: true, name: true };   // the owner's full name, on every form
    function val(el) { return String(el.value || '').trim(); }
    function isEntry(el) {
      return el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && el.closest('.field')
        && !/^(hidden|checkbox|radio|file)$/.test(el.type) && el.name !== 'hp_x7f2' && !el.hasAttribute('data-lc-confirm');
    }
    function isOwnerEmail(el) { return el.type === 'email' && el.required && !el.hasAttribute('data-lc-confirm'); }
    function hasErr(el) { return el.classList.contains('err') || el.classList.contains('bad'); }
    function ownMsg(f) {
      for (var i = 0; i < f.children.length; i++) if (f.children[i].classList.contains('errmsg')) return f.children[i];
      var m = document.createElement('p');                     // the case-review form has none
      m.className = 'errmsg';
      f.appendChild(m);
      return m;
    }
    function clearErr(el) {
      el.classList.remove('err', 'bad');
      var f = el.closest('.field');
      if (f) { f.classList.remove('show-err'); ownMsg(f).classList.remove('show'); }
    }
    function showErr(el, text) {
      var m = ownMsg(el.closest('.field'));
      if (!m.hasAttribute('data-lc-orig')) m.setAttribute('data-lc-orig', m.textContent);
      m.textContent = text;
      el.classList.add('err');
      m.classList.add('show');
    }
    // Two kinds of problem. A WRONG value (a digit in a name, a letter in a phone, too long)
    // is shown the moment it is typed. An UNFINISHED one (only a first name so far, too few
    // digits) is only an error once the visitor leaves the field or presses Next — `strict` —
    // so nobody is told off halfway through typing their own name.
    var NAME_CHARS = /^[\p{L}\p{M}' ’.\-]+$/u;
    // Caps Lock: any part of a name with 2+ letters that are ALL capitals ("MARCUS", "O'NEIL").
    // Mixed case is fine ("McDonald", "DeShawn"), and so are generation suffixes (III, IV).
    var CAPS_MSG = 'Please type your name normally, not in all capitals — e.g. Marcus Reed.';
    var SUFFIX = /^(II|III|IV|VI{0,3}|IX)\.?$/;              // generation suffixes: Carter III
    function shouting(v) {
      return v.split(/[\s\-.'’,&]+/).some(function (w) {
        var L = w.replace(/[^\p{L}]/gu, '');
        return L.length >= 2 && L === L.toUpperCase() && L !== L.toLowerCase() && !SUFFIX.test(L);
      });
    }
    function nameProblem(v, strict) {
      if (v.length >= NAME_MAX)
        return 'Please keep your name under ' + NAME_MAX + ' characters (' + v.length + ' now).';
      if (!NAME_CHARS.test(v))
        return 'Names can only use letters, spaces, hyphens (-), apostrophes (’) and periods.';
      if (shouting(v)) return CAPS_MSG;
      // three of the same letter in a row is keyboard-mash — except the suffix "III"
      if (v.split(/\s+/).some(function (w) { return !SUFFIX.test(w) && /(\p{L})\1\1/iu.test(w); }))
        return 'That doesn’t look like a real name.';
      var words = v.split(/\s+/).filter(function (w) { return /\p{L}/u.test(w); });
      if (strict && words.length < 2) return 'Please enter your first and last name.';
      if (strict && !words.some(function (w) { return w.replace(/[^\p{L}]/gu, '').length >= 2; }))
        return 'Please enter your full first and last name, not just initials.';
      return null;
    }
    function tenantNameProblem(v) {                          // "Tenant name(s)": may list several
      if (v.length >= NAME_MAX) return 'Please keep this under ' + NAME_MAX + ' characters (' + v.length + ' now).';
      if (!/^[\p{L}\p{M}' ’.,&\-]+$/u.test(v))
        return 'Names can only use letters, spaces, commas, &, hyphens, apostrophes and periods.';
      if (shouting(v)) return CAPS_MSG;
      return null;
    }
    // A US number: 10 digits (a leading 1 is allowed), a real area code and exchange.
    function phoneDigits(v) { var d = v.replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? d.slice(1) : d; }
    function phoneProblem(v, strict) {
      if (!/^[\d\s().+\-]+$/.test(v)) return 'Phone numbers can only use digits, spaces, ( ) and -.';
      var raw = v.replace(/\D/g, ''), d = phoneDigits(v);
      if (raw.length > 11 || (raw.length === 11 && raw[0] !== '1'))
        return 'That’s too many digits — enter a 10-digit US number, e.g. (215) 555-0123.';
      if (d.length < 10) return strict ? 'Enter a 10-digit US phone number, e.g. (215) 555-0123.' : null;
      if (!/^[2-9]/.test(d)) return 'That area code isn’t valid — it can’t start with 0 or 1.';
      if (!/^[2-9]/.test(d.slice(3))) return 'That number isn’t valid — check the three digits after the area code.';
      if (/^(\d)\1{9}$/.test(d)) return 'That doesn’t look like a real phone number.';
      return null;
    }
    // As-you-type phone formatting: the visitor types digits only; the brackets, space and
    // dash appear on their own — "2155550123" reads "(215) 555-0123". Anything that isn't a
    // digit never lands, digits past ten are ignored, and a leading 1 is shown as "1 (215) …".
    // Formatting characters are only ever placed BEFORE a digit, so the last character is
    // always a digit and Backspace always removes a digit (never gets stuck on a ")" or "-").
    // The caret keeps its place by counting the digits in front of it.
    function liveFormatPhone(el) {
      var v = el.value;
      var caret = typeof el.selectionStart === 'number' ? el.selectionStart : v.length;
      var before = v.slice(0, caret).replace(/\D/g, '').length;
      var d = v.replace(/\D/g, ''), lead = '';
      if (d[0] === '1') { lead = '1'; d = d.slice(1); }
      d = d.slice(0, 10);
      var out = !d.length ? '' : d.length <= 3 ? '(' + d
        : d.length <= 6 ? '(' + d.slice(0, 3) + ') ' + d.slice(3)
        : '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
      if (lead) out = '1' + (out ? ' ' + out : '');
      if (out === v) return;
      el.value = out;
      var pos = 0, seen = 0, want = Math.min(before, (lead + d).length);
      while (pos < out.length && seen < want) { if (/\d/.test(out[pos])) seen++; pos++; }
      if (document.activeElement === el) { try { el.setSelectionRange(pos, pos); } catch (e) {} }
    }
    function formatPhone(el) {
      var d = phoneDigits(val(el));
      if (d.length === 10 && !phoneProblem(val(el), true)) el.value = '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
    }
    function popupProblem(el, strict) {
      var v = val(el);
      if (el.required && !v) return 'This field is required.';
      if (!v) return null;
      if (el.hasAttribute('data-lc-date')) return dateProblem(v, strict);
      if (NAME_FIELDS[el.name]) return nameProblem(v, strict);
      if (el.name === 'tenant_name') return tenantNameProblem(v);
      if (el.type === 'tel') return phoneProblem(v, strict);
      if (el.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Enter a valid email address.';
      return null;
    }
    function runPageCheck(el, strict) {
      var f = el.closest('.field'), m = f && ownMsg(f);
      if (m && m.hasAttribute('data-lc-orig')) m.textContent = m.getAttribute('data-lc-orig');   // the page's own wording
      validating = true;
      try { el.dispatchEvent(new Event(el.type === 'checkbox' || el.type === 'radio' ? 'change' : 'blur')); }
      finally { validating = false; }
      if (!isEntry(el)) return;
      // The pages skip an EMPTY optional field, so an error from an earlier value would stay.
      if (!el.required && !val(el)) clearErr(el);
      // Names and phones: the popup's rules are stricter than the page's and decide on their
      // own once there is a value (the page's phone check would flag an unfinished number
      // mid-typing). An empty required field keeps the page's own wording.
      if (ownsRules(el) && val(el)) { clearErr(el); var q = popupProblem(el, strict); if (q) showErr(el, q); return; }
      if (!hasErr(el)) { var p = popupProblem(el, strict); if (p) showErr(el, p); }
    }
    function ownsRules(el) { return !!NAME_FIELDS[el.name] || el.name === 'tenant_name' || el.type === 'tel' || el.hasAttribute('data-lc-date'); }
    function verified(el) { return el.getAttribute('data-lc-verified-for') === val(el).toLowerCase() && !!val(el); }
    function refreshTick(el) {
      var f = el.closest('.field');
      if (!f || !isEntry(el)) return;
      // A check means FINISHED and right, so it also needs the strict rules: "Marcus" alone is
      // not flagged while typing, but it doesn't earn a check either.
      var ok = el.hasAttribute('data-lc-touched') && !!val(el) && !hasErr(el) && !popupProblem(el, true);
      if (isOwnerEmail(el)) { f.classList.toggle('lc-emailok', ok); ok = ok && verified(el); f.classList.toggle('lc-verified', ok); }
      f.classList.toggle('lc-ok', ok);
    }

    /* --- the email confirm box --- */
    function confirmBox(el, create) {
      var f = el.closest('.field'), box = f.querySelector('.lc-confirm');
      if (!box && create) {
        var id = (el.id || 'lc-email') + '-confirm';
        box = document.createElement('div');
        box.className = 'lc-confirm';
        // Not type="email" and no name: browsers and password managers offer saved addresses
        // to email fields regardless of autocomplete="off", and an autofilled copy would
        // "confirm" a typo. The ignore attributes are LastPass / 1Password / Bitwarden's.
        box.innerHTML = '<div class="lc-confirm-in"><label for="' + id + '">Retype email to confirm</label>'
          + '<input id="' + id + '" type="text" inputmode="email" autocomplete="off" autocorrect="off" autocapitalize="off"'
          + ' spellcheck="false" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other"'
          + ' placeholder="Retype your email" data-lc-confirm>'
          + '<p class="errmsg" aria-live="polite"></p></div>';
        f.appendChild(box);
        // Make the browser lay out the CLOSED card now. Otherwise it is created and opened in
        // the same frame, there is no "before" to animate from, and it just appears — which is
        // exactly how it looked before this line existed.
        void box.offsetHeight;
        guardRetype(box.querySelector('input'), el);
      }
      return box;
    }
    // The point of the retype is a second, independent typing — so it can't be pasted,
    // dropped in, or filled by the browser. Any of those is refused with a line saying why.
    var NO_FILL = 'Please type your email again — pasting and autofill are turned off here, so a typo can’t slip through.';
    function guardRetype(c, email) {
      function refuse(e) {
        if (e) e.preventDefault();
        c.value = '';
        var m = c.parentNode.querySelector('.errmsg');
        m.textContent = NO_FILL; m.classList.add('show'); c.classList.add('err');
        email.removeAttribute('data-lc-verified-for'); refreshTick(email);
        track('retype_refused', { form_id: form.id });
      }
      c.addEventListener('beforeinput', function (e) {
        if (/^insertFrom|insertReplacementText/.test(e.inputType || '')) refuse(e);
      });
      c.addEventListener('paste', refuse);
      c.addEventListener('drop', refuse);
      // Browser autofill fills without a keystroke: its input event is not a typed InputEvent
      // (or is a "replacement"), and Chrome also marks the field :-webkit-autofill, which the
      // CSS turns into an animation we can hear.
      c.addEventListener('input', function (e) {
        if (!(e instanceof InputEvent) || !e.inputType || e.inputType === 'insertReplacementText') {
          e.stopImmediatePropagation(); refuse();
        }
      }, true);
      c.addEventListener('animationstart', function (e) { if (e.animationName === 'lc-autofill') refuse(); });
    }
    // strict: the visitor is trying to move on, so an empty or unfinished confirm is an error.
    function checkConfirm(el, strict) {
      var box = confirmBox(el, true), c = box.querySelector('input'), m = box.querySelector('.errmsg');
      var a = val(el).toLowerCase(), b = val(c).toLowerCase();
      if (b && a === b) {
        var was = verified(el);
        el.setAttribute('data-lc-verified-for', a);
        c.classList.remove('err'); c.classList.add('lc-match'); m.classList.remove('show');
        refreshTick(el);
        if (!was) track('email_verified', { form_id: form.id });
        return true;
      }
      el.removeAttribute('data-lc-verified-for');
      c.classList.remove('lc-match');
      // While typing, only flag it once it can no longer turn into a match.
      var wrong = !!b && (a.indexOf(b) !== 0 || b.length >= a.length);
      var show = wrong || strict;
      m.textContent = b ? 'The two emails don’t match.' : 'Please retype your email to confirm it.';
      c.classList.toggle('err', show);
      m.classList.toggle('show', show);
      refreshTick(el);
      return false;
    }
    // Show the confirm box once the email itself is valid; hide it (and un-verify) if not.
    var emailTimer = null;
    function syncEmail(el, now) {
      clearTimeout(emailTimer);
      var box = confirmBox(el, false);
      if (el.hasAttribute('data-lc-verified-for') && !verified(el)) {
        el.removeAttribute('data-lc-verified-for');          // the email changed after it was verified
        if (box) { var c = box.querySelector('input'); c.value = ''; c.classList.remove('err', 'lc-match'); box.querySelector('.errmsg').classList.remove('show'); }
      }
      refreshTick(el);
      var good = !!val(el) && !hasErr(el);
      if (!good) { if (box) box.classList.remove('show'); return; }
      if (box && box.classList.contains('show')) { if (val(box.querySelector('input'))) checkConfirm(el, false); return; }
      // Don't pop it open mid-word: wait until they pause, or leave the field.
      var open = function () { confirmBox(el, true).classList.add('show'); };
      if (now) open(); else emailTimer = setTimeout(open, 700);
    }

    function liveCheck(e) {
      var el = e.target;
      if (el.hasAttribute && el.hasAttribute('data-lc-confirm')) {
        var owner = el.closest('.field').querySelector('input[type="email"]:not([data-lc-confirm])');
        if (owner) checkConfirm(owner, false);
        return;
      }
      if (!isEntry(el)) return;
      el.setAttribute('data-lc-touched', '');
      // A select or date picker "finishes" in one change, so it is checked strictly.
      runPageCheck(el, e.type === 'change');
      refreshTick(el);
      if (isOwnerEmail(el)) syncEmail(el, false);
    }
    // Capture phase: the phone is reformatted before anything (the live check included) reads it.
    host.addEventListener('input', function (e) {
      if (e.target && e.target.type === 'tel' && isEntry(e.target)) liveFormatPhone(e.target);
    }, true);
    host.addEventListener('input', liveCheck);
    host.addEventListener('change', liveCheck);
    // Tab out of a valid email: open the confirm box BEFORE the browser moves focus, so the
    // Tab lands in it rather than skipping past to the phone field.
    host.addEventListener('keydown', function (e) {
      if (e.key === 'Tab' && !e.shiftKey && isOwnerEmail(e.target) && e.target.hasAttribute('data-lc-touched')) syncEmail(e.target, true);
    });
    host.addEventListener('focusout', function (e) {
      var el = e.target;
      if (!isEntry(el) || !el.hasAttribute('data-lc-touched')) return;
      // Leaving a field is when an unfinished value becomes an error ("Marcus" alone, 7 digits).
      if (el.type === 'tel') formatPhone(el);             // 2155550123 -> (215) 555-0123
      runPageCheck(el, true);
      refreshTick(el);
      if (isOwnerEmail(el)) syncEmail(el, true);
    });
    // Capture phase on the host runs before the field's own blur listener, so an untouched
    // field can be tabbed past without being marked wrong.
    host.addEventListener('blur', function (e) {
      if (!validating && isEntry(e.target) && !e.target.hasAttribute('data-lc-touched')) e.stopPropagation();
    }, true);

    // The checks only the popup knows about. A single-step form is submitted by the page's own
    // button, so these also hold its submit back. Everything else the page checks itself.
    function popupBlocks(scope) {
      var first = null;
      scope.querySelectorAll('input,select,textarea').forEach(function (el) {
        if (!isEntry(el)) return;
        // Only fields with a value: an empty required field is the page's to report, and
        // holding its submit back here would hide the page's own "Please fix" message.
        var p = val(el) && popupProblem(el, true);
        if (p) { showErr(el, p); first = first || el; }
        if (isOwnerEmail(el) && val(el) && !hasErr(el) && !verified(el)) {
          confirmBox(el, true).classList.add('show');
          checkConfirm(el, true);
          first = first || confirmBox(el, false).querySelector('input');
        }
      });
      return first;
    }
    function guardSubmit(e) {
      var first = popupBlocks(form);
      if (first) { e.preventDefault(); e.stopImmediatePropagation(); first.focus(); }
    }

    function sectionValid() {
      var scope = sections[idx] || form, ok = true, first = null;
      scope.querySelectorAll('input,select,textarea').forEach(function (el) {
        if (el.type === 'hidden' || el.name === 'hp_x7f2' || el.tabIndex === -1 || el.closest('[aria-hidden="true"]')) return;
        if (el.hasAttribute('data-lc-confirm')) return;                    // checked with its email
        if (el.offsetParent === null && el.type !== 'file') return;          // inside a closed reveal block
        if (isEntry(el)) el.setAttribute('data-lc-touched', '');
        if (el.type === 'tel') formatPhone(el);
        runPageCheck(el, true);
        refreshTick(el);
        var bad = hasErr(el) || (el.required && (el.type === 'checkbox' ? !el.checked : !val(el)));
        if (bad) { ok = false; if (!first) first = el; }
      });
      var blocked = popupBlocks(scope);
      if (blocked) { ok = false; first = first || blocked; }
      if (first) first.focus();
      return ok;
    }

    function close(reason) {
      if (!root.parentNode) return;
      leave(root);                             // the 350ms exit, played by a copy — see leave()
      if (reason === 'dismiss' && !readChoice()) { saveChoice('dismissed'); }
      if (reason === 'dismiss') track('dismiss', { lc_screen: screen });
      if (observer) observer.disconnect();
      clearTimeout(emailTimer);
      if (form) form.removeEventListener('submit', guardSubmit, true);
      if (placeholder) {
        // Put the form (and a confirmation, if one was added) back where it came from.
        sections.forEach(function (fs) { fs.removeAttribute('data-lc-off'); fs.classList.remove('lc-enter'); });
        while (host.firstChild) placeholder.parentNode.insertBefore(host.firstChild, placeholder);
        placeholder.parentNode.removeChild(placeholder);
        var gate = gateFor(form);
        if (submitted(form)) {
          if (gate) gate.hidden = true;        // the page now shows the confirmation instead
        } else {
          form.hidden = true;                  // forms are filled in the popup, never on the page
          if (gate) gate.classList.remove('chosen');
        }
      }
      root.parentNode.removeChild(root);
      document.body.classList.remove('lc-lock');
      document.removeEventListener('keydown', onKey, true);
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} }
    }

    function onKey(e) {
      // An open address list gets first say: arrows move through it, Enter picks, Escape
      // closes the LIST (not the popup).
      var assist = document.activeElement && document.activeElement._lcAssist;
      if (assist && assist.key(e)) return;
      if (e.key === 'Escape') { e.preventDefault(); close('dismiss'); return; }
      // Enter in a field moves to the next section instead of submitting a half-filled form.
      if (e.key === 'Enter' && screen === 'form' && !nextBtn.hidden && e.target.tagName === 'INPUT'
          && e.target.type !== 'checkbox' && e.target.type !== 'radio' && e.target.type !== 'file') {
        e.preventDefault(); nextBtn.click(); return;
      }
      if (e.key !== 'Tab') return;
      var f = Array.prototype.filter.call(
        dialog.querySelectorAll('button,a[href],input:not([type=hidden]):not([tabindex="-1"]),select,textarea'),
        function (el) { return el.offsetParent !== null && !el.disabled; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (document.activeElement === dialog) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey, true);

    root.addEventListener('click', function (e) {
      if (e.target === root) { close('dismiss'); return; }
      var t = e.target.closest('button,a');
      if (!t || !root.contains(t)) return;
      if (t.hasAttribute('data-lc-close')) { close(screen === 'tenant' || screen === 'done' ? 'answered' : 'dismiss'); return; }
      if (t.hasAttribute('data-lc-role')) {
        var role = t.getAttribute('data-lc-role');
        saveChoice(role);
        track('role', { visitor_role: role });
        if (role === 'landlord') mount(); else showTenant();
        return;
      }
      if (t.hasAttribute('data-lc-startover')) { startOver(); return; }
      if (t.hasAttribute('data-lc-back')) { if (idx > 0) showStep(idx - 1); else showRole(); return; }
      if (t.hasAttribute('data-lc-next')) { if (sectionValid()) showStep(idx + 1); }
    });

    track('open', { page: location.pathname, lc_trigger: trigger });
    var role = opts.role || (trigger === 'cta' && readChoice() === 'landlord' ? 'landlord' : null);
    if (opts.role) saveChoice(opts.role);
    if (role === 'landlord') mount();
    else if (role === 'tenant') showTenant();
    else showRole();
  }

  /* ---------- what opens it ---------- */
  // Capture phase, because the homepage binds a smooth-scroll handler to every "#" link and
  // initRoleGate() binds each gate button — both on the element itself, so they would run
  // before any bubble-phase listener here. Stopping the click at the document keeps the page
  // from scrolling to, or revealing, a form the popup is about to show.
  function onClick(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!e.target.closest || e.target.closest('[data-landlord-check]')) return;

    // 1) The landlord/tenant question in front of a form.
    var gb = e.target.closest('[data-role-gate] .rg-btn');
    if (gb && !bypass) {
      e.preventDefault(); e.stopPropagation();
      var gate = gb.closest('[data-role-gate]');
      open('gate', { formId: gate.getAttribute('data-gate-for'), role: gb.getAttribute('data-role') });
      return;
    }

    // 2) A link that jumps to a form.
    var a = e.target.closest('a[href]');
    if (!a) return;
    var url;
    try { url = new URL(a.getAttribute('href'), location.href); } catch (err) { return; }
    if (url.origin !== location.origin) return;
    // This page's own form, or the homepage's from any page: a landlord is handed over from here.
    var home = url.pathname === '/' || url.pathname === '/index.html';
    if (url.pathname !== location.pathname && !home) return;
    var target = FORM_ANCHORS[url.hash];
    if (!target) return;
    e.preventDefault(); e.stopPropagation();
    // Stopping the click also skips the mobile menu's close-on-click, so close it here.
    var nav = a.closest('.nav-links');
    if (nav) {
      nav.classList.remove('open');
      var toggle = document.getElementById('nav-toggle');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }
    open('cta', { target: target });
  }

  function init() {
    document.addEventListener('click', onClick, true);
    var handoff = null;
    try { handoff = sessionStorage.getItem(HANDOFF); sessionStorage.removeItem(HANDOFF); } catch (e) {}
    if (handoff) { open('handoff', { target: handoff, role: 'landlord' }); return; }
    if (readChoice()) return;               // answered or dismissed before: don't open unprompted
    // A short beat so the page paints first and the popup reads as a question, not a wall.
    setTimeout(function () { open('first_visit', { target: 'apply' }); }, 600);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
