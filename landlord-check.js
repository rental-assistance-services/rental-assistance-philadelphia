/* ============================================================
   Landlord check — the first-visit popup (every landing page)

   WHY: this site sells a filing service to PROPERTY OWNERS, but its brand and the search
   terms it ranks for ("rental assistance philadelphia") read as tenant-side, so most
   visitors are tenants. The inline gates in front of each form (initRoleGate() on the
   homepage and /back-rent/) only ask once a visitor has scrolled to a form. This asks up
   front, on the first page a visitor lands on, and qualifies a landlord in four short
   steps using the same questions as the homepage's "Request your free case review" form.

   WHAT IT DOES
   - Opens by itself once per browser. The answer (landlord / tenant) or a dismissal is
     remembered in localStorage under STORE, so a returning visitor is not asked again.
   - Every Apply / case-review link on the page (FORM_ANCHORS) opens it too, at any time,
     instead of scrolling down to the inline form. See interceptFormLinks().
   - Tenant: one screen pointing to /tenants/. NO network request, so no CRM row and no
     Google Ads conversion — the same rule as the inline gates.
   - Landlord: units + balance -> contact -> anything else -> POSTs the contact form's exact
     field set (form_type 'contact', visitor_role 'landlord') to the intake endpoint.
     A conversion is booked only on a confirmed save that returned a contact id.
   - A landlord answer also pre-answers every inline gate on the page, and "Continue to the
     full application" pre-fills the long form with what was just typed.

   Self-contained on purpose: the blog pages carry none of the homepage's form code, so
   this file brings its own CSS, markup, endpoint and conversion guard. Loaded with
   <script src="/landlord-check.js" defer> on every landing page EXCEPT /tenants/ and
   /terms.html. Tested by tests/landlord-check.spec.js.
   ============================================================ */
(function () {
  'use strict';

  var STORE = 'ras_role_check';            // {v: 'landlord'|'tenant'|'dismissed', t: ms}
  var PREFILL = 'ras_lc_prefill';          // sessionStorage hand-off to the full application
  var TTL_DAYS = { landlord: 90, tenant: 90, dismissed: 30 };
  var ENDPOINT = 'https://rio.tworiverdevelopment.tech/rental-assist/intake';
  var FORM_ID = 'landlord-check-form';
  var LEAD_VALUE = 250;                    // same modeled value as the contact form it mirrors
  var STEPS = ['Who you are', 'Your rental', 'Your contact', 'Anything else'];

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
  function clickIds() {
    try {
      var o = JSON.parse(localStorage.getItem('ras_click_ids') || 'null');
      if (!o || Date.now() - o.t > 90 * 864e5) return {};
      return o.v || {};
    } catch (e) { return {}; }
  }
  function utmParams() {
    var out = {};
    try {
      var q = new URLSearchParams(location.search);
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].forEach(function (k) {
        var v = q.get(k); if (v) { out[k] = String(v).slice(0, 200); }
      });
    } catch (e) {}
    return out;
  }
  function track(action, extra) {
    var ev = { event: 'landlord_check', lc_action: action };
    if (extra) Object.keys(extra).forEach(function (k) { ev[k] = extra[k]; });
    window.dataLayer.push(ev);
  }
  function phoneOk(v) { return String(v || '').replace(/\D/g, '').length >= 10; }
  function emailOk(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim()); }

  /* ---------- the inline gates on the page ---------- */
  // A visitor who already told the popup they are a landlord should not be asked again by
  // the gate in front of each form. Clicking the gate's own landlord button runs that page's
  // initRoleGate() exactly as a real click would, so the form's visitor_role is stamped by
  // the same code the tests for those gates cover. A tenant answer is NOT forwarded: the
  // inline tenant branch scrolls to its panel, which would yank the page around.
  function answerInlineGates() {
    document.querySelectorAll('[data-role-gate]').forEach(function (g) {
      if (g.classList.contains('chosen')) return;
      var b = g.querySelector('.rg-btn[data-role="landlord"]');
      if (b) b.click();
    });
  }

  // Fill the long application with what the popup already collected. Only empty fields
  // are touched, so nothing the visitor typed into the form itself is overwritten.
  function applyPrefill() {
    var data;
    try { data = JSON.parse(sessionStorage.getItem(PREFILL) || 'null'); } catch (e) { data = null; }
    if (!data) return;
    var form = document.getElementById('intake-form') || document.getElementById('backrent-form');
    if (!form) return;
    var map = { owner_name: data.name, owner_email: data.email, owner_phone: data.phone,
      owner_units: data.units, back_rent_owed: String(data.tenant_balance || '').replace(/[^\d.]/g, '').split('.')[0] };
    Object.keys(map).forEach(function (n) {
      var el = form.querySelector('[name="' + n + '"]');
      if (el && !el.value && map[n]) el.value = map[n];
    });
    try { sessionStorage.removeItem(PREFILL); } catch (e) {}
  }

  /* ---------- styles ---------- */
  var CSS = ''
    + '.lc-backdrop{--lc-navy:var(--navy,#14233A);--lc-ink:var(--ink,#11161C);--lc-brass:var(--brass,#C8A24A);'
    + '--lc-brass-2:var(--brass-2,#A9853A);--lc-brass-soft:var(--brass-soft,#E8D9B4);--lc-paper:var(--paper-3,#FBF7EE);'
    + '--lc-green:var(--green,#2F9E5E);--lc-green-deep:var(--green-deep,#207044);--lc-green-soft:var(--green-soft,#DDEFE3);'
    + '--lc-hair:var(--hairline,rgba(20,35,58,.2));--lc-muted:var(--muted,#4C5667);--lc-muted-2:var(--muted-2,#6A7384);'
    + '--lc-serif:var(--serif,"Fraunces",Georgia,serif);--lc-sans:var(--sans,"Public Sans",-apple-system,"Segoe UI",sans-serif);'
    + '--lc-mono:var(--mono,"Spline Sans Mono",ui-monospace,Menlo,monospace);--lc-ease:cubic-bezier(.22,.61,.36,1);'
    + 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px 16px;'
    + 'background:rgba(14,26,44,.55);font-family:var(--lc-sans);color:var(--lc-ink);line-height:1.5;'
    + 'animation:lc-fade .35s var(--lc-ease) both;}'
    + '.lc-backdrop[hidden]{display:none;}'
    + '.lc-dialog{position:relative;width:100%;max-width:520px;max-height:calc(100vh - 48px);overflow:auto;background:var(--lc-paper);'
    + 'border-radius:16px;border-top:4px solid var(--lc-brass);box-shadow:0 8px 24px rgba(20,35,58,.18),0 30px 70px rgba(20,35,58,.28);'
    + 'animation:lc-rise .35s var(--lc-ease) both;}'
    + '.lc-head{padding:18px 56px 14px 24px;border-bottom:1px solid var(--lc-hair);}'
    + '.lc-steps{list-style:none;margin:0;padding:0;display:flex;gap:6px;}'
    + '.lc-steps li{flex:1;min-width:0;}'
    + '.lc-steps .lc-seg{display:block;height:4px;border-radius:4px;background:var(--lc-hair);transition:background .35s var(--lc-ease);}'
    + '.lc-steps li.is-done .lc-seg,.lc-steps li.is-current .lc-seg{background:var(--lc-brass);}'
    + '.lc-steps .lc-lbl{display:block;margin-top:7px;font-family:var(--lc-mono);font-size:.62rem;letter-spacing:.1em;'
    + 'text-transform:uppercase;color:var(--lc-muted-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
    + '.lc-steps li.is-current .lc-lbl{color:var(--lc-brass-2);font-weight:600;}'
    + '.lc-steps li.is-done .lc-lbl{color:var(--lc-navy);}'
    + '.lc-count{display:none;margin:8px 0 0;font-family:var(--lc-mono);font-size:.66rem;letter-spacing:.1em;text-transform:uppercase;color:var(--lc-brass-2);}'
    + '.lc-head.lc-off .lc-steps{opacity:.35;}'
    + '.lc-close{position:absolute;top:10px;right:10px;width:40px;height:40px;border:none;border-radius:50%;background:transparent;'
    + 'color:var(--lc-muted);font-size:1.5rem;line-height:1;cursor:pointer;}'
    + '.lc-close:hover{background:rgba(20,35,58,.07);color:var(--lc-navy);}'
    + '.lc-close:focus-visible,.lc-backdrop button:focus-visible,.lc-backdrop a:focus-visible{outline:2.5px solid var(--lc-brass);outline-offset:2px;}'
    + '.lc-body{padding:22px 24px 24px;}'
    + '.lc-panel{animation:lc-step .35s var(--lc-ease) both;}'
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
    + '.lc-field{margin:0 0 14px;}'
    + '.lc-field label{display:block;font-weight:650;font-size:.9rem;color:var(--lc-navy);margin:0 0 6px;}'
    + '.lc-field .lc-opt{font-weight:500;color:var(--lc-muted-2);}'
    + '.lc-field input,.lc-field textarea{width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid var(--lc-hair);border-radius:9px;'
    + 'font:inherit;font-size:1rem;background:#fff;color:var(--lc-ink);}'
    + '.lc-field textarea{min-height:96px;resize:vertical;}'
    + '.lc-field input:focus,.lc-field textarea:focus{outline:none;border-color:var(--lc-brass);box-shadow:0 0 0 3px rgba(200,162,74,.25);}'
    + '.lc-field.lc-bad input{border-color:#B4432F;box-shadow:0 0 0 3px rgba(180,67,47,.14);}'
    + '.lc-err{display:none;color:#9A3A28;font-size:.84rem;margin:6px 0 0;}'
    + '.lc-field.lc-bad .lc-err{display:block;}'
    + '.lc-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;}'
    + '.lc-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:6px;}'
    + '.lc-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-family:var(--lc-sans);font-weight:680;'
    + 'font-size:1rem;padding:13px 22px;border-radius:10px;border:1.5px solid transparent;cursor:pointer;text-decoration:none;'
    + 'transition:background .15s,transform .12s;}'
    + '.lc-btn-main{background:var(--lc-brass);color:#241B06;margin-left:auto;}'
    + '.lc-btn-main:hover{background:var(--lc-brass-2);color:#fff;}'
    + '.lc-btn-main[disabled]{opacity:.6;cursor:progress;}'
    + '.lc-btn-back{background:none;border-color:var(--lc-hair);color:var(--lc-navy);white-space:nowrap;flex:none;}'
    + '.lc-dialog:focus{outline:none;}'
    + '.lc-btn-back:hover{border-color:var(--lc-navy);}'
    + '.lc-fine{color:var(--lc-muted-2);font-size:.8rem;margin:12px 0 0;}'
    + '.lc-status{margin:10px 0 0;font-size:.9rem;color:#9A3A28;}'
    + '.lc-status:empty{display:none;}'
    + '.lc-done{border-left:4px solid var(--lc-green);background:var(--lc-green-soft);border-radius:10px;padding:14px 16px;margin:0 0 16px;'
    + 'color:var(--lc-green-deep);font-weight:600;}'
    + '.lc-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;}'
    + '.lc-stack{display:grid;gap:10px;}'
    + '.lc-stack .lc-btn{margin:0;width:100%;}'
    + 'body.lc-lock{overflow:hidden;}'
    + '@keyframes lc-fade{from{opacity:0;}to{opacity:1;}}'
    + '@keyframes lc-rise{from{opacity:0;transform:translateY(18px);}to{opacity:1;transform:none;}}'
    + '@keyframes lc-step{from{opacity:0;transform:translateX(14px);}to{opacity:1;transform:none;}}'
    /* Phone: a bottom sheet, not a full-screen takeover — Google treats an interstitial that
       hides the content a searcher just landed on as a ranking and ad-quality negative. */
    + '@media (max-width:640px){'
    + '.lc-backdrop{align-items:flex-end;padding:0;}'
    + '.lc-dialog{max-width:none;max-height:88vh;border-radius:18px 18px 0 0;animation-name:lc-sheet;}'
    + '.lc-head{padding:16px 52px 12px 16px;}.lc-body{padding:18px 16px 22px;}'
    + '.lc-steps .lc-lbl{display:none;}.lc-count{display:block;}'
    + '.lc-q{font-size:1.28rem;}.lc-row{grid-template-columns:1fr;gap:0;}}'
    + '@keyframes lc-sheet{from{transform:translateY(100%);}to{transform:none;}}'
    + '@media (prefers-reduced-motion:reduce){.lc-backdrop,.lc-dialog,.lc-panel{animation:none;}}';

  /* ---------- markup ---------- */
  function field(id, name, label, type, attrs, err, optional) {
    return '<div class="lc-field"><label for="' + id + '">' + label
      + (optional ? ' <span class="lc-opt">(optional)</span>' : '') + '</label>'
      + (type === 'textarea'
        ? '<textarea id="' + id + '" name="' + name + '"' + (attrs || '') + '></textarea>'
        : '<input id="' + id + '" name="' + name + '" type="' + type + '"' + (attrs || '') + '>')
      + (err ? '<p class="lc-err">' + err + '</p>' : '') + '</div>';
  }
  function actions(mainLabel, mainType) {
    return '<div class="lc-actions"><button type="button" class="lc-btn lc-btn-back" data-lc-back>&larr; Back</button>'
      + '<button type="' + (mainType || 'button') + '" class="lc-btn lc-btn-main"' + (mainType ? '' : ' data-lc-next') + '>'
      + mainLabel + '</button></div>';
  }

  var HTML = ''
    + '<div class="lc-dialog" role="dialog" aria-modal="true" aria-labelledby="lc-title-1" tabindex="-1">'
    + '<div class="lc-head">'
    + '<ol class="lc-steps" aria-label="Progress">'
    + STEPS.map(function (s, i) {
        return '<li data-lc-dot="' + (i + 1) + '"><span class="lc-seg"></span><span class="lc-lbl">' + s + '</span></li>';
      }).join('')
    + '</ol><p class="lc-count" aria-hidden="true"></p>'
    + '<button type="button" class="lc-close" aria-label="Close" data-lc-close>&times;</button>'
    + '</div>'
    + '<form class="lc-body" id="' + FORM_ID + '" novalidate>'
    // 1 — who you are
    + '<div class="lc-panel" data-lc-step="1">'
    + '<h2 class="lc-q" id="lc-title-1">First &mdash; do you own or rent?</h2>'
    + '<p class="lc-sub">We&rsquo;re hired by Philadelphia property owners to get a tenant&rsquo;s back rent paid by the City.</p>'
    + '<div class="lc-roles">'
    + '<button type="button" class="lc-role" data-lc-role="landlord">I own or manage rental property<small>Landlord or property manager</small></button>'
    + '<button type="button" class="lc-role" data-lc-role="tenant">I rent my home<small>Tenant</small></button>'
    + '</div>'
    + '<p class="lc-note">Rental Assistance Philadelphia is a private filing service hired by owners. We are not the City and we do not represent tenants.</p>'
    + '</div>'
    // tenant exit — no request of any kind is made on this path
    + '<div class="lc-panel" data-lc-step="tenant" hidden>'
    + '<h2 class="lc-q" id="lc-title-tenant">We work for landlords &mdash; but there&rsquo;s free help for you.</h2>'
    + '<p class="lc-sub">We&rsquo;re a private service hired by property owners, so there&rsquo;s nothing we can file for you. '
    + 'The City&rsquo;s Eviction Diversion Program can pay a tenant&rsquo;s back rent &mdash; but <strong>the landlord has to apply</strong>. '
    + 'The City and free tenant hotlines can explain it so you can raise it with them.</p>'
    + '<div class="lc-stack"><a class="lc-btn lc-btn-main" href="/tenants/" data-lc-tenant-help>See free help for tenants &rarr;</a>'
    + '<button type="button" class="lc-btn lc-btn-back" data-lc-close>Close</button></div>'
    + '</div>'
    // 2 — your rental
    + '<div class="lc-panel" data-lc-step="2" hidden>'
    + '<h2 class="lc-q" id="lc-title-2">Tell us about your rental.</h2>'
    + '<p class="lc-sub">A rough number is fine &mdash; we&rsquo;ll confirm the details with you.</p>'
    + '<div class="lc-row">'
    + field('lc-units', 'units', 'Number of units', 'number', ' min="1" inputmode="numeric" placeholder="e.g. 3"', '', true)
    + field('lc-balance', 'tenant_balance', 'Approx. tenant balance owed', 'text', ' inputmode="decimal" placeholder="e.g. $4,200"', '', true)
    + '</div>'
    + actions('Next &rarr;')
    + '</div>'
    // 3 — your contact
    + '<div class="lc-panel" data-lc-step="3" hidden>'
    + '<h2 class="lc-q" id="lc-title-3">How do we reach you?</h2>'
    + '<p class="lc-sub">We review every case, usually within one business day.</p>'
    + field('lc-name', 'name', 'Name', 'text', ' autocomplete="name" required', 'Please enter your name.')
    + '<div class="lc-row">'
    + field('lc-phone', 'phone', 'Phone', 'tel', ' autocomplete="tel" inputmode="tel" required', 'Enter a phone number with at least 10 digits.')
    + field('lc-email', 'email', 'Email', 'email', ' autocomplete="email" required', 'Enter a valid email address.')
    + '</div>'
    + actions('Next &rarr;')
    + '</div>'
    // 4 — anything else + submit
    + '<div class="lc-panel" data-lc-step="4" hidden>'
    + '<h2 class="lc-q" id="lc-title-4">Anything else we should know?</h2>'
    + '<p class="lc-sub">How far behind is the tenant? Need a rental license or tax help? Any prior eviction filings?</p>'
    + field('lc-message', 'message', 'Notes', 'textarea', '', '', true)
    + '<div class="lc-hp" aria-hidden="true"><label for="lc-hp-x7f2">Leave this field empty</label>'
    + '<input id="lc-hp-x7f2" name="hp_x7f2" type="text" tabindex="-1" autocomplete="off"></div>'
    + '<input type="hidden" name="visitor_role" value="">'
    + actions('Request my free case review &rarr;', 'submit')
    + '<p class="lc-status" role="status" aria-live="polite"></p>'
    + '<p class="lc-fine">No fee. No obligation. We only get involved if it&rsquo;s a fit. By submitting, you agree to be contacted about your case.</p>'
    + '</div>'
    // done
    + '<div class="lc-panel" data-lc-step="done" hidden>'
    + '<h2 class="lc-q" id="lc-title-done">Thanks &mdash; we&rsquo;ve got it.</h2>'
    + '<p class="lc-done">&#10003; Your free case review request is in.</p>'
    + '<p class="lc-sub">We&rsquo;ll tell you straight whether the City will likely pay, usually within one business day. '
    + 'Want to move faster? Start the full application now &mdash; we&rsquo;ve filled in what you just told us.</p>'
    + '<div class="lc-stack"><button type="button" class="lc-btn lc-btn-main" data-lc-continue>Continue to the full application &rarr;</button>'
    + '<button type="button" class="lc-btn lc-btn-back" data-lc-close>Keep browsing</button></div>'
    + '</div>'
    + '</form></div>';

  /* ---------- behaviour ---------- */
  // trigger: 'first_visit' (the automatic open) or 'cta' (an Apply / case-review link).
  function open(trigger) {
    if (document.querySelector('[data-landlord-check]')) return;   // already open
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
    var form = root.querySelector('form');
    var head = root.querySelector('.lc-head');
    var count = root.querySelector('.lc-count');
    var status = root.querySelector('.lc-status');
    var roleInput = form.querySelector('input[name="visitor_role"]');
    var lastFocus = document.activeElement;
    var current = '1';

    function show(step) {
      current = String(step);
      root.querySelectorAll('[data-lc-step]').forEach(function (p) {
        p.hidden = p.getAttribute('data-lc-step') !== current;
      });
      var n = parseInt(current, 10);
      var onTrack = !isNaN(n) || current === 'done';
      var at = current === 'done' ? STEPS.length + 1 : n;
      root.querySelectorAll('[data-lc-dot]').forEach(function (li) {
        var i = parseInt(li.getAttribute('data-lc-dot'), 10);
        li.classList.toggle('is-done', onTrack && i < at);
        li.classList.toggle('is-current', onTrack && i === at);
        if (onTrack && i === at) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      });
      head.classList.toggle('lc-off', !onTrack);
      count.textContent = isNaN(n) ? '' : 'Step ' + n + ' of ' + STEPS.length + ' · ' + STEPS[n - 1];
      dialog.setAttribute('aria-labelledby', 'lc-title-' + current);
      dialog.scrollTop = 0;
      var target = root.querySelector('[data-lc-step="' + current + '"] input:not([type=hidden]):not([tabindex="-1"]),'
        + '[data-lc-step="' + current + '"] textarea,[data-lc-step="' + current + '"] button,[data-lc-step="' + current + '"] a');
      // On the role question, focus the dialog itself: focusing the first button would draw
      // its focus ring and make "landlord" look pre-selected, which nudges the answer.
      if (current === '1') dialog.focus({ preventScroll: true });
      else if (target) target.focus({ preventScroll: true });
      if (!isNaN(n) && n > 1) track('step', { lc_step: n });
    }

    function close(reason) {
      if (!root.parentNode) return;
      if (reason === 'dismiss' && !readChoice()) { saveChoice('dismissed'); track('dismiss', { lc_step: current }); }
      root.parentNode.removeChild(root);
      document.body.classList.remove('lc-lock');
      document.removeEventListener('keydown', onKey, true);
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} }
    }

    function check(id, ok) {
      var el = document.getElementById(id);
      el.closest('.lc-field').classList.toggle('lc-bad', !ok);
      return ok;
    }
    function contactValid() {
      var ok = check('lc-name', !!document.getElementById('lc-name').value.trim());
      ok = check('lc-phone', phoneOk(document.getElementById('lc-phone').value)) && ok;
      ok = check('lc-email', emailOk(document.getElementById('lc-email').value)) && ok;
      if (!ok) { var bad = form.querySelector('.lc-bad input'); if (bad) bad.focus(); }
      return ok;
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close('dismiss'); return; }
      if (e.key !== 'Tab') return;
      // keep focus inside the dialog while it is open
      var f = Array.prototype.filter.call(
        dialog.querySelectorAll('button,a[href],input:not([type=hidden]):not([tabindex="-1"]),textarea'),
        function (el) { return !el.closest('[hidden]') && !el.disabled; });
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
      if (!t) return;
      if (t.hasAttribute('data-lc-close')) { close(current === 'done' || current === 'tenant' ? 'answered' : 'dismiss'); return; }
      if (t.hasAttribute('data-lc-role')) {
        var role = t.getAttribute('data-lc-role');
        saveChoice(role);
        roleInput.value = role;
        track('role', { visitor_role: role });
        if (role === 'landlord') { answerInlineGates(); show(2); } else { show('tenant'); }
        return;
      }
      if (t.hasAttribute('data-lc-back')) { var n = parseInt(current, 10); show(n > 2 ? n - 1 : 1); return; }
      if (t.hasAttribute('data-lc-next')) {
        var s = parseInt(current, 10);
        if (s === 3 && !contactValid()) return;
        show(s + 1);
        return;
      }
      if (t.hasAttribute('data-lc-continue')) {
        track('continue');
        close('answered');
        var onPage = document.getElementById('intake-form') ? document.getElementById('apply')
          : document.getElementById('backrent-form') ? document.getElementById('form-card') : null;
        if (onPage) { applyPrefill(); onPage.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        else { location.href = '/#apply'; }
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (current !== '4') return;
      if (!contactValid()) { show(3); contactValid(); return; }
      // Honeypot: a bot filled the decoy. Accept silently, send nothing.
      if (form.querySelector('[name="hp_x7f2"]').value.trim()) { show('done'); return; }
      var obj = { form_type: 'contact' };
      ['name', 'phone', 'email', 'units', 'tenant_balance', 'message', 'visitor_role', 'hp_x7f2'].forEach(function (n) {
        obj[n] = form.querySelector('[name="' + n + '"]').value;
      });
      var ids = clickIds();
      ['gclid', 'gbraid', 'wbraid'].forEach(function (k) { if (ids[k]) obj[k] = ids[k]; });
      var utm = utmParams();
      Object.keys(utm).forEach(function (k) { obj[k] = utm[k]; });

      var btn = form.querySelector('[data-lc-step="4"] button[type="submit"]');
      btn.disabled = true;
      status.textContent = '';
      fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (res) {
          if (!res.ok || !res.data || res.data.ok === false) {
            var err = new Error('submit_failed'); err.userMessage = (res.data && res.data.reply) || ''; throw err;
          }
          track('submit');
          // Same rule as rasTrackLead(): no contact id means nothing was stored (a tripped
          // honeypot is answered {"ok":true}), and only an explicit landlord is a conversion.
          var contactId = res.data.contact_id;
          if (contactId && roleInput.value === 'landlord') {
            window.dataLayer.push({ event: 'lead_submit', form_id: FORM_ID, lead_value: LEAD_VALUE, currency: 'USD',
              transaction_id: contactId, gclid: ids.gclid || '', gbraid: ids.gbraid || '', wbraid: ids.wbraid || '' });
          }
          try {
            sessionStorage.setItem(PREFILL, JSON.stringify({ name: obj.name, email: obj.email, phone: obj.phone,
              units: obj.units, tenant_balance: obj.tenant_balance }));
          } catch (err2) {}
          show('done');
        })
        .catch(function (err) {
          btn.disabled = false;
          try { console.error('[RAS] landlord check submit failed:', err); } catch (e2) {}
          status.textContent = (err && err.userMessage) || 'Something went wrong. Please try again, or call (215) 402-6882.';
        });
    });

    // A visitor who already told us they are a landlord and then clicks Apply is not asked
    // "own or rent?" a second time — they start at "Your rental", already stamped landlord.
    // Back still returns them to the role question if they need to change the answer.
    if (trigger === 'cta' && readChoice() === 'landlord') { roleInput.value = 'landlord'; show(2); }
    else show(1);
    track('open', { page: location.pathname, lc_trigger: trigger });
  }

  // The links that jump down to a back-rent / case-review form. Clicking one opens the popup
  // instead of scrolling to the form: the popup is the form. Anchors to any other section
  // (licensing, FAQ, portal, …) are left alone, and so is a link to another page.
  var FORM_ANCHORS = ['#apply', '#contact', '#form-card', '#backrent-form'];
  function interceptFormLinks(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.closest('[data-landlord-check]')) return;
    var url;
    try { url = new URL(a.getAttribute('href'), location.href); } catch (err) { return; }
    if (url.origin !== location.origin || url.pathname !== location.pathname) return;
    if (FORM_ANCHORS.indexOf(url.hash) === -1) return;
    // The homepage binds its own smooth-scroll handler to every "#" link, and that handler
    // runs on the link itself — before any listener on the document in the bubble phase — and
    // scrolls without checking defaultPrevented. So this listens in the CAPTURE phase and stops
    // the click from reaching the link's handlers at all.
    e.preventDefault();
    e.stopPropagation();
    // Stopping it also skips the mobile menu's close-on-click, so close the menu here.
    var nav = a.closest('.nav-links');
    if (nav) {
      nav.classList.remove('open');
      var toggle = document.getElementById('nav-toggle');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }
    open('cta');
  }

  function init() {
    applyPrefill();                         // arriving from a blog page's "Continue" hand-off
    document.addEventListener('click', interceptFormLinks, true);
    var choice = readChoice();
    if (choice === 'landlord') { answerInlineGates(); return; }
    if (choice) return;                     // tenant or dismissed: never asked again unprompted
    // A short beat so the page paints first and the popup reads as a question, not a wall.
    setTimeout(function () { open('first_visit'); }, 600);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
