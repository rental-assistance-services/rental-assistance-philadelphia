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
   - A page with no form (the blog) hands a landlord to the homepage application, which
     opens straight into the popup (HANDOFF).

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
    + '.lc-backdrop{--lc-navy:var(--navy,#14233A);--lc-ink:var(--ink,#11161C);--lc-brass:var(--brass,#C8A24A);'
    + '--lc-brass-2:var(--brass-2,#A9853A);--lc-paper:var(--paper-3,#FBF7EE);--lc-green:var(--green,#2F9E5E);'
    + '--lc-hair:var(--hairline,rgba(20,35,58,.2));--lc-muted:var(--muted,#4C5667);--lc-muted-2:var(--muted-2,#6A7384);'
    + '--lc-serif:var(--serif,"Fraunces",Georgia,serif);--lc-sans:var(--sans,"Public Sans",-apple-system,"Segoe UI",sans-serif);'
    + '--lc-mono:var(--mono,"Spline Sans Mono",ui-monospace,Menlo,monospace);--lc-ease:cubic-bezier(.22,.61,.36,1);'
    // The backdrop scrolls, not the dialog: a long section grows the dialog instead of
    // trapping it behind an inner scrollbar. margin:auto centres it while it fits.
    + 'position:fixed;inset:0;z-index:1000;display:flex;overflow-y:auto;overscroll-behavior:contain;padding:24px 16px;'
    + 'background:rgba(14,26,44,.55);font-family:var(--lc-sans);color:var(--lc-ink);line-height:1.5;'
    + 'animation:lc-fade .35s var(--lc-ease) both;}'
    + '.lc-dialog{position:relative;margin:auto;width:100%;max-width:520px;background:var(--lc-paper);'
    + 'border-radius:16px;border-top:4px solid var(--lc-brass);box-shadow:0 8px 24px rgba(20,35,58,.18),0 30px 70px rgba(20,35,58,.28);'
    + 'animation:lc-rise .35s ease-in both;transition:max-width .35s ease-in;}'
    + '.lc-dialog.lc-wide{max-width:760px;}'
    + '.lc-dialog:focus{outline:none;}'
    + '.lc-head{padding:18px 56px 14px 24px;border-bottom:1px solid var(--lc-hair);}'
    + '.lc-steps{list-style:none;margin:0;padding:0;display:flex;gap:6px;}'
    + '.lc-steps li{flex:1;min-width:0;}'
    + '.lc-steps .lc-seg{display:block;height:4px;border-radius:4px;background:var(--lc-hair);transition:background .35s var(--lc-ease);}'
    + '.lc-steps li.is-done .lc-seg,.lc-steps li.is-current .lc-seg{background:var(--lc-brass);}'
    + '.lc-steps .lc-lbl{display:block;margin-top:7px;font-family:var(--lc-mono);font-size:.62rem;letter-spacing:.1em;'
    + 'text-transform:uppercase;color:var(--lc-muted-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
    + '.lc-steps li.is-current .lc-lbl{color:var(--lc-brass-2);font-weight:600;}'
    + '.lc-steps li.is-done .lc-lbl{color:var(--lc-navy);}'
    + '.lc-count{display:none;margin:9px 0 0;font-family:var(--lc-mono);font-size:.66rem;letter-spacing:.1em;text-transform:uppercase;color:var(--lc-brass-2);}'
    // More steps than fit as labels: segments only, and the current step named underneath.
    + '.lc-head.lc-many .lc-lbl{display:none;}.lc-head.lc-many .lc-count{display:block;}'
    + '.lc-head.lc-off .lc-steps{opacity:.35;}'
    + '.lc-close{position:absolute;top:10px;right:10px;width:40px;height:40px;border:none;border-radius:50%;background:transparent;'
    + 'color:var(--lc-muted);font-size:1.5rem;line-height:1;cursor:pointer;}'
    + '.lc-close:hover{background:rgba(20,35,58,.07);color:var(--lc-navy);}'
    + '.lc-backdrop button:focus-visible,.lc-backdrop a:focus-visible{outline:2.5px solid var(--lc-brass);outline-offset:2px;}'
    + '.lc-body{padding:22px 24px 24px;}'
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
    // brass focus ring. The page's inputs used a cream fill that vanished on the cream dialog,
    // a green focus ring, and a GOLD outline for an error whose message is red.
    // :where() keeps the type filter from adding specificity, so the state rules below
    // (focus, valid, error) can each override the base look in the order they are written.
    + '.lc-host .field :where(input:not([type=checkbox]):not([type=radio]):not([type=file]),select,textarea){'
    // display:block drops the empty text-line space an inline input leaves beneath itself.
    + 'display:block;background:#fff;border:1.5px solid var(--lc-hair);border-radius:10px;padding:13px 15px;font-size:1rem;color:var(--lc-ink);'
    + 'box-shadow:none;transition:border-color .15s,box-shadow .15s;}'
    + '.lc-host .field input::placeholder,.lc-host .field textarea::placeholder{color:var(--lc-muted-2);opacity:.75;}'
    + '.lc-host .field :where(input,select,textarea):hover{border-color:rgba(200,162,74,.6);}'
    + '.lc-host .field :where(input,select,textarea):focus{outline:none;border-color:var(--lc-brass);box-shadow:0 0 0 3px rgba(200,162,74,.24);}'
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
    + '.lc-host .file-field{background:#fff;border:1.5px dashed var(--lc-hair);border-radius:10px;}'
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
    + 'box-shadow:0 0 0 1px var(--lc-hair),0 10px 24px rgba(20,35,58,.10),0 2px 6px rgba(20,35,58,.05);'
    + 'transition:grid-template-rows .35s ease-in,margin-top .35s ease-in,opacity .35s ease-in,transform .35s ease-in,'
    + 'box-shadow .35s ease-in,visibility 0s;}'
    + '.lc-host .lc-confirm-in{min-height:0;overflow:hidden;padding:0 10px;transition:padding .35s ease-in;}'
    // Address suggestions: a list that drops down over the fields below the address box
    // (it overlays rather than pushing them), fading down over 350ms ease-in.
    + '.lc-host .field.lc-addr{position:relative;}'
    + '.lc-suggest{position:absolute;left:0;right:0;z-index:5;list-style:none;margin:6px 0 0;padding:6px;background:#fff;'
    + 'border-radius:10px;box-shadow:0 0 0 1px var(--lc-hair),0 14px 30px rgba(20,35,58,.14),0 2px 6px rgba(20,35,58,.06);}'
    + '.lc-suggest[hidden]{display:none;}'
    + '.lc-suggest.lc-drop{animation:lc-down .35s ease-in both;}'
    + '.lc-suggest [role=option]{display:flex;gap:10px;align-items:flex-start;padding:9px 10px;border-radius:8px;cursor:pointer;'
    + 'transition:background .15s;}'
    + '.lc-suggest [role=option]:hover,.lc-suggest [role=option][aria-selected=true]{background:rgba(200,162,74,.13);}'
    + '.lc-sg-pin{flex:none;color:var(--lc-brass-2);margin-top:2px;display:inline-flex;}'
    + '.lc-sg-1{display:block;font-weight:650;color:var(--lc-navy);font-size:.95rem;line-height:1.3;}'
    + '.lc-sg-2{display:block;font-size:.82rem;color:var(--lc-muted-2);line-height:1.35;}'
    + '.lc-suggest-note{font-size:.7rem;color:var(--lc-muted-2);padding:7px 10px 3px;margin-top:4px;border-top:1px solid var(--lc-hair);}'
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
    + '.lc-q{font-family:var(--lc-serif);font-size:1.45rem;font-weight:560;color:var(--lc-navy);line-height:1.2;margin:0 0 6px;}'
    + '.lc-sub{color:var(--lc-muted);font-size:.95rem;margin:0 0 18px;}'
    + '.lc-roles{display:grid;gap:10px;}'
    + '.lc-role{font-family:var(--lc-sans);font-size:1.02rem;font-weight:680;line-height:1.25;text-align:left;padding:16px 18px;'
    + 'border-radius:10px;border:1.5px solid var(--lc-hair);background:#fff;color:var(--lc-navy);cursor:pointer;'
    + 'transition:border-color .15s,box-shadow .15s,transform .12s;}'
    + '.lc-role:hover{border-color:var(--lc-brass);box-shadow:0 0 0 3px rgba(200,162,74,.16);transform:translateY(-1px);}'
    + '.lc-role small{display:block;font-weight:500;font-size:.84rem;color:var(--lc-muted-2);margin-top:4px;}'
    + '.lc-note{color:var(--lc-muted-2);font-size:.82rem;margin:14px 0 0;}'
    + '.lc-lines{list-style:none;padding:0;margin:0 0 18px;display:grid;gap:12px;}'
    + '.lc-lines li{border-top:1px solid var(--lc-hair);padding-top:12px;}'
    + '.lc-lines li:first-child{border-top:none;padding-top:0;}'
    + '.lc-lines b{display:block;color:var(--lc-navy);font-size:.95rem;}'
    + '.lc-lines a{font-weight:700;color:var(--lc-navy);text-decoration:none;border-bottom:2px solid var(--lc-brass);}'
    + '.lc-lines span{color:var(--lc-muted-2);font-size:.84rem;margin-left:6px;}'
    + '.lc-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-family:var(--lc-sans);font-weight:680;'
    + 'font-size:1rem;padding:13px 22px;border-radius:10px;border:1.5px solid transparent;cursor:pointer;text-decoration:none;'
    + 'transition:background .15s,transform .12s;}'
    + '.lc-btn-main{background:var(--lc-brass);color:#241B06;}'
    + '.lc-btn-main:hover{background:var(--lc-brass-2);color:#fff;}'
    + '.lc-btn-back{background:none;border-color:var(--lc-hair);color:var(--lc-navy);white-space:nowrap;}'
    + '.lc-btn-back:hover{border-color:var(--lc-navy);}'
    + '.lc-stack{display:grid;gap:10px;}'
    + '.lc-nav{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px;}'
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
    + '.lc-host .fs h3{font-family:var(--lc-serif);font-size:1.35rem;color:var(--lc-navy);}'
    // The contact form's confirmation is styled for the dark band it normally sits in (white
    // text, set inline). On the light dialog that would be invisible, so re-colour it here.
    + '.lc-host .callout.on-ink{background:#DDEFE3;border-color:rgba(47,158,94,.3);border-left-color:var(--lc-green);color:var(--lc-ink);}'
    + '.lc-host .callout.on-ink h3,.lc-host .callout.on-ink p{color:var(--lc-ink) !important;}'
    + '.lc-host .callout.on-ink a{color:var(--lc-brass-2) !important;}'
    + 'body.lc-lock{overflow:hidden;}'
    + '@keyframes lc-fade{from{opacity:0;}to{opacity:1;}}'
    + '@keyframes lc-rise{from{opacity:0;transform:translateY(18px);}to{opacity:1;transform:none;}}'
    + '@keyframes lc-up{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:none;}}'
    /* Phone: a bottom sheet, not a full-screen takeover — Google treats an interstitial that
       hides the content a searcher just landed on as a ranking and ad-quality negative. */
    + '@media (max-width:640px){'
    + '.lc-backdrop{padding:0;}'
    + '.lc-dialog,.lc-dialog.lc-wide{max-width:none;margin:auto 0 0;border-radius:18px 18px 0 0;animation-name:lc-sheet;}'
    + '.lc-head{padding:16px 52px 12px 16px;}.lc-body{padding:18px 16px 22px;}'
    + '.lc-steps .lc-lbl{display:none;}.lc-count{display:block;}'
    + '.lc-q{font-size:1.28rem;}}'
    + '@keyframes lc-sheet{from{transform:translateY(100%);}to{transform:none;}}'
    + '@media (prefers-reduced-motion:reduce){.lc-backdrop,.lc-dialog,.lc-panel,.lc-host fieldset.lc-enter,'
    + '.lc-host .errmsg,.lc-host .errmsg.show,.lc-host .field.show-err .errmsg,.lc-host .field input,.lc-host .field select,'
    + '.lc-host .field textarea,.lc-host .lc-confirm,.lc-host .lc-confirm.show,.lc-host .lc-confirm-in{transition:none;}'
    + '.lc-host .field.lc-ok .req,.lc-host .field.lc-ok > label::after,.lc-suggest{animation:none;}}';

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

    var items = [], active = -1, timer = null, ctrl = null, cache = {}, filling = false;

    function close() {
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
    function render(found) {
      items = found;
      if (!found.length) { close(); return; }
      list.innerHTML = found.map(function (s, i) {
        return '<li role="option" id="' + id + '-' + i + '" aria-selected="false" data-i="' + i + '">'
          + '<span class="lc-sg-pin">' + PIN + '</span><span><span class="lc-sg-1">' + esc(s.line1) + '</span>'
          + '<span class="lc-sg-2">' + esc(s.line2) + '</span></span></li>';
      }).join('')
        + '<li class="lc-suggest-note" role="presentation">Address search © OpenStreetMap contributors · Photon</li>';
      var wasHidden = list.hidden;
      list.hidden = false;
      if (wasHidden) { list.classList.remove('lc-drop'); void list.offsetWidth; list.classList.add('lc-drop'); }   // fade down
      input.setAttribute('aria-expanded', 'true');
      highlight(-1);
    }
    function lookup(q) {
      if (cache[q]) { render(cache[q]); return; }
      if (ctrl) ctrl.abort();
      ctrl = typeof AbortController === 'function' ? new AbortController() : null;
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
          if (document.activeElement === input && val(input) === q) render(found);
        })
        .catch(function () { /* down, slow or rate-limited: it is just a text box */ });
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
        if (list.hidden || !items.length) return false;
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
        // No form on this page (the blog): the application lives on the homepage.
        try { sessionStorage.setItem(HANDOFF, 'apply'); } catch (e) {}
        track('handoff', { page: location.pathname });
        location.href = '/#apply';
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
      }
      panel('form');
      if (submitted(form)) { showDone(); return; }
      showStep(0);
    }

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
    }

    function showDone() {
      if (screen === 'done') return;
      screen = 'done';
      sections.forEach(function (fs) { fs.removeAttribute('data-lc-off'); });
      nextBtn.hidden = true; backBtn.hidden = true;
      progress(labels.length + 1);
      track('submit', { form_id: form.id });
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
    function ownsRules(el) { return !!NAME_FIELDS[el.name] || el.name === 'tenant_name' || el.type === 'tel'; }
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
    if (url.origin !== location.origin || url.pathname !== location.pathname) return;
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
