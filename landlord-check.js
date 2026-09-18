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
    + '.lc-host .errmsg.show,.lc-host .field.show-err .errmsg{animation:lc-up .35s ease-in both;}'
    // A field that has been typed into and passes its check gets a green tick inside it.
    + '.lc-host .field input,.lc-host .field select,.lc-host .field textarea{background-repeat:no-repeat;'
    + 'background-position:right 14px center;background-size:0 0;transition:background-size .35s ease-in;}'
    + '.lc-host .field.lc-ok input,.lc-host .field.lc-ok select,.lc-host .field.lc-ok textarea{padding-right:42px;background-size:18px 18px;'
    + 'background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 20 20\'%3E%3Ccircle cx=\'10\' cy=\'10\' r=\'10\' fill=\'%232F9E5E\'/%3E%3Cpath d=\'M5.6 10.4l2.9 2.9 5.9-6.3\' fill=\'none\' stroke=\'%23fff\' stroke-width=\'2.2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E");}'
    + '.lc-host .field.lc-ok select{background-position:right 36px center;}'
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
    + '.lc-host .errmsg.show,.lc-host .field.show-err .errmsg{animation:none;}.lc-host .field input,.lc-host .field select,'
    + '.lc-host .field textarea{transition:none;}}';

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
       A field that has been typed into and passes gets a green tick. */
    var validating = false;
    function isEntry(el) {
      return el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && el.closest('.field')
        && !/^(hidden|checkbox|radio|file)$/.test(el.type) && el.name !== 'hp_x7f2';
    }
    function hasErr(el) { return el.classList.contains('err') || el.classList.contains('bad'); }
    function clearErr(el) {
      el.classList.remove('err', 'bad');
      var f = el.closest('.field');
      if (f) { f.classList.remove('show-err'); var m = f.querySelector('.errmsg'); if (m) m.classList.remove('show'); }
    }
    function runPageCheck(el) {
      validating = true;
      try { el.dispatchEvent(new Event(el.type === 'checkbox' || el.type === 'radio' ? 'change' : 'blur')); }
      finally { validating = false; }
      // The pages skip an EMPTY optional field, so an error from an earlier value would stay.
      if (!el.required && !String(el.value || '').trim()) clearErr(el);
    }
    function refreshTick(el) {
      var f = el.closest('.field');
      if (!f || !isEntry(el)) return;
      f.classList.toggle('lc-ok', el.hasAttribute('data-lc-touched') && !!String(el.value || '').trim() && !hasErr(el));
    }
    function liveCheck(e) {
      var el = e.target;
      if (!isEntry(el)) return;
      el.setAttribute('data-lc-touched', '');
      runPageCheck(el);
      refreshTick(el);
    }
    host.addEventListener('input', liveCheck);
    host.addEventListener('change', liveCheck);
    // Capture phase on the host runs before the field's own blur listener, so an untouched
    // field can be tabbed past without being marked wrong.
    host.addEventListener('blur', function (e) {
      if (!validating && isEntry(e.target) && !e.target.hasAttribute('data-lc-touched')) e.stopPropagation();
    }, true);

    function sectionValid() {
      var scope = sections[idx] || form, ok = true, first = null;
      scope.querySelectorAll('input,select,textarea').forEach(function (el) {
        if (el.type === 'hidden' || el.name === 'hp_x7f2' || el.tabIndex === -1 || el.closest('[aria-hidden="true"]')) return;
        if (el.offsetParent === null && el.type !== 'file') return;          // inside a closed reveal block
        if (isEntry(el)) el.setAttribute('data-lc-touched', '');
        runPageCheck(el);
        refreshTick(el);
        var v = String(el.value || '').trim();
        var bad = hasErr(el) || (el.required && (el.type === 'checkbox' ? !el.checked : !v));
        if (bad) { ok = false; if (!first) first = el; }
      });
      if (first) first.focus();
      return ok;
    }

    function close(reason) {
      if (!root.parentNode) return;
      if (reason === 'dismiss' && !readChoice()) { saveChoice('dismissed'); }
      if (reason === 'dismiss') track('dismiss', { lc_screen: screen });
      if (observer) observer.disconnect();
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
