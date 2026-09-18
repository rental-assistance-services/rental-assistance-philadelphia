/* Rental Assistance Philadelphia — the script every main page shares (/, /services/back-rent/,
   /services/licensing/, /portal/, /faq/). Was the homepage's two inline <script>s: the site
   behaviour and forms, then paid-acquisition attribution + conversion tracking. Every part looks
   its elements up and does nothing on a page without them. */
/* ============================================================
   site-v2.html — single-file inline JS, no dependencies.
   1) Masthead scroll-refine
   2) Mobile nav toggle + auto-close
   3) Smooth scroll for in-page anchors
   4) Scroll-reveal (IntersectionObserver)
   5) FAQ single-open accordion
   6) Intake-form validation (client-side convenience only)
   7) Contact lead-form handler
   8) Landlord / tenant gate
   ============================================================ */
(function(){
  'use strict';

  /* ---- 1) Masthead scroll-refine ---- */
  var mast = document.getElementById('masthead');
  function onScroll(){ if(mast) mast.classList.toggle('scrolled', window.scrollY > 12); }
  window.addEventListener('scroll', onScroll, {passive:true}); onScroll();

  /* ---- 2) Mobile nav toggle ---- */
  var toggle = document.getElementById('nav-toggle');
  var links  = document.getElementById('nav-links');
  if(toggle && links){
    toggle.addEventListener('click', function(){
      var open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    links.querySelectorAll('a').forEach(function(a){
      a.addEventListener('click', function(){
        links.classList.remove('open');
        toggle.setAttribute('aria-expanded','false');
      });
    });
  }

  /* ---- 3) Smooth scroll for in-page anchors ---- */
  document.querySelectorAll('a[href^="#"]').forEach(function(a){
    a.addEventListener('click', function(e){
      var id = a.getAttribute('href');
      if(id.length < 2) return;
      var target = document.querySelector(id);
      if(!target) return;
      e.preventDefault();
      target.scrollIntoView({behavior:'smooth', block:'start'});
      if(history.pushState){ history.pushState(null, '', id); }
    });
  });

  /* ---- 4) Scroll-reveal ---- */
  var revealEls = document.querySelectorAll('.reveal');
  if('IntersectionObserver' in window){
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if(en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, {threshold:0.12, rootMargin:'0px 0px -8% 0px'});
    revealEls.forEach(function(el){ io.observe(el); });
  } else {
    revealEls.forEach(function(el){ el.classList.add('in'); });
  }

  /* ---- 5) FAQ accordion: single-open ---- */
  var faqItems = document.querySelectorAll('#faq .faq-item');
  faqItems.forEach(function(item){
    item.addEventListener('toggle', function(){
      if(item.open){
        faqItems.forEach(function(other){ if(other !== item) other.open = false; });
      }
    });
  });

  /* ---- 6) Intake-form validation (client-side only) ---- */
  var phoneOk = function(v){ return (v.replace(/\D/g,'').length >= 10); };
  var emailOk = function(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); };

  function setErr(field, on, msg){
    var input = field.querySelector('input,select,textarea');
    var em = field.querySelector('.errmsg');
    if(input) input.classList.toggle('err', on);
    if(em){ em.classList.toggle('show', on); if(msg) em.textContent = msg; }
  }
  function validateField(input){
    var field = input.closest('.field');
    if(!field) return true;
    var val = (input.value || '').trim();
    var ok = true;
    if(input.type === 'checkbox'){ ok = input.required ? input.checked : true; }
    else if(input.type === 'radio'){
      if(input.required){
        var grp = input.form.querySelectorAll('input[name="'+input.name+'"]');
        ok = Array.prototype.some.call(grp, function(r){ return r.checked; });
      }
    }
    else if(input.required && !val){ ok = false; }
    else if(input.type === 'email' && val){ ok = emailOk(val); }
    else if(input.type === 'tel' && val){ ok = phoneOk(val); }
    else if(input.type === 'number' && val){ ok = !isNaN(Number(val)) && Number(val) >= (Number(input.min)||0); }
    setErr(field, !ok);
    return ok;
  }
  function wireReveal(form, radioName, block, matchValue){
    if(!form || !block) return;
    function sync(){
      var checked = form.querySelector('input[name="'+radioName+'"]:checked');
      block.classList.toggle('show', !!checked && checked.value === matchValue);
    }
    form.querySelectorAll('input[name="'+radioName+'"]').forEach(function(r){ r.addEventListener('change', sync); });
    sync();
  }
  // Live CRM intake endpoint (Rio Platform — Supabase contacts CRM, segmented
  // service_line='landlord-assistance'). Mounted in Rio/Engine/api/app.py at
  // /rental-assist; nginx proxies it to the rio-api service.
  var INTAKE_ENDPOINT = 'https://rio.tworiverdevelopment.tech/rental-assist/intake';

  // Forward utm_* params (mirror of apply_chat's _clean_utm) if present in the URL.
  function utmParams(){
    var out = {}, q = new URLSearchParams(window.location.search);
    ['utm_source','utm_medium','utm_campaign','utm_content'].forEach(function(k){
      var v = q.get(k); if(v){ out[k] = String(v).slice(0,200); }
    });
    return out;
  }
  function labelFor(form, input){
    var lab = form.querySelector('label[for="'+input.id+'"]');
    return lab ? lab.textContent.trim() : input.name;
  }
  function showConfirmation(form, status, data){
    // Confirmation (item 11): reference number, next steps, and any still-needed documents (item 12).
    // The reference is the CRM contact id the server just created. It used to be a
    // client-side 'RAS-<date>-<random>' string that existed nowhere else, so an applicant
    // who called quoting their reference could not be found by anyone.
    var ref = (data && data.contact_id) ? String(data.contact_id) : '';
    // What is still outstanding is decided by the SERVER, from what it actually stored —
    // not by what the browser attached. The endpoint silently drops files that are empty,
    // over 15MB, of an unsupported type, or that lose their upload, and still returns 200;
    // trusting the browser told those applicants "we have everything" after their
    // documents were binned.
    var docs = (data && data.documents) || null;
    var missing = [], dropped = [];
    if(docs){
      var stored = docs.stored || [];
      form.querySelectorAll('input[type="file"]').forEach(function(f){
        if(stored.indexOf(f.name) === -1){ missing.push(labelFor(form, f)); }
      });
      (docs.rejected || []).forEach(function(r){
        var input = form.querySelector('input[type="file"][name="'+r.field+'"]');
        dropped.push(input ? labelFor(form, input) : r.field);
      });
    } else {
      // Endpoint predates the documents report — fall back to the browser's view rather
      // than claiming everything is missing.
      form.querySelectorAll('input[type="file"]').forEach(function(f){
        if(!f.files || !f.files.length){ missing.push(labelFor(form, f)); }
      });
    }
    var missHtml = missing.length
      ? '<p style="margin-top:12px;"><strong>Still needed:</strong> ' + missing.join(', ') + '. We&rsquo;ll email you a secure link to add these &mdash; your place is saved, so you won&rsquo;t lose your application.</p>'
      : '';
    if(dropped.length){
      missHtml += '<p style="margin-top:12px;"><strong>Please re-send:</strong> ' + dropped.join(', ')
        + ' &mdash; we couldn&rsquo;t read ' + (dropped.length > 1 ? 'those files' : 'that file')
        + '. Each document must be under 15MB and a PDF, photo, or spreadsheet.</p>';
    }
    var nextFile = (form.id === 'intake-form')
      ? 'If it&rsquo;s a fit, we open diversion, elect the Targeted Financial Assistance (TFA) track, and run the whole filing.'
      : 'If it&rsquo;s a fit, we map your exact steps and handle the filing.';
    var panel = document.createElement('div');
    panel.className = 'callout';
    panel.setAttribute('role','status');
    panel.style.marginTop = '8px';
    panel.innerHTML = '<h3 style="margin:0 0 8px;">Application received'
      + (ref ? ' &mdash; reference ' + ref : '') + '</h3>'
      + '<p>Thanks! Here&rsquo;s what happens next:</p>'
      + '<ul class="checklist"><li>We review your details &mdash; usually within one business day.</li>'
      + '<li>We tell you straight whether the City will likely pay.</li>'
      + '<li>' + nextFile + '</li></ul>'
      + '<p>We&rsquo;ll email a confirmation to the address you provided and follow up shortly. Questions? <a href="mailto:info@rentalassistanceservices.com">info@rentalassistanceservices.com</a>.</p>'
      + missHtml;
    form.parentNode.insertBefore(panel, form);
    form.style.display = 'none';
    panel.scrollIntoView({behavior:'smooth', block:'center'});
  }
  function initIntakeForm(formId, statusId, formType){
    var form = document.getElementById(formId);
    if(!form) return;
    var status = document.getElementById(statusId);
    form.querySelectorAll('input,select,textarea').forEach(function(el){
      var evt = (el.type === 'radio' || el.type === 'checkbox') ? 'change' : 'blur';
      el.addEventListener(evt, function(){ if(el.required || el.value) validateField(el); });
    });
    form.addEventListener('submit', function(e){
      e.preventDefault(); // wired to the live CRM endpoint below.
      var firstBad = null, allOk = true, seenRadioGroups = {};
      form.querySelectorAll('input,select,textarea').forEach(function(el){
        if(el.name === 'hp_x7f2') return; // honeypot
        if(el.type === 'radio'){
          if(seenRadioGroups[el.name]) return;
          seenRadioGroups[el.name] = true;
        }
        var fieldOk = validateField(el);
        if(!fieldOk && !firstBad){ firstBad = el; }
        if(!fieldOk) allOk = false;
      });
      if(status) status.className = 'form-status';
      if(!allOk){
        if(status){ status.textContent = 'Please fix the highlighted fields above.'; status.classList.add('bad','show'); }
        if(firstBad){ firstBad.focus(); firstBad.scrollIntoView({behavior:'smooth', block:'center'}); }
        return;
      }

      // Build the payload. The back-rent intake has file uploads -> multipart;
      // license/tax are field-only -> JSON. Both carry form_type + the honeypot
      // (hp_x7f2) + any utm_* params so the server can segment + attribute.
      var btn = form.querySelector('button[type="submit"]');
      var hasFiles = !!form.querySelector('input[type="file"]');
      var body, headers = null;
      var utm = utmParams();
      if(hasFiles){
        var fd = new FormData(form);          // includes file inputs + the hp_x7f2 honeypot
        fd.set('form_type', formType);
        Object.keys(utm).forEach(function(k){ fd.set(k, utm[k]); });
        body = fd;                             // browser sets multipart boundary header
      } else {
        var obj = {form_type: formType};
        form.querySelectorAll('input,select,textarea').forEach(function(el){
          if(!el.name || el.type === 'file') return;
          if(el.type === 'checkbox' || el.type === 'radio'){ if(!el.checked) return; }
          obj[el.name] = el.value;
        });
        Object.keys(utm).forEach(function(k){ obj[k] = utm[k]; });
        body = JSON.stringify(obj);
        headers = {'Content-Type': 'application/json'};
      }

      if(btn){ btn.disabled = true; }
      if(status){ status.textContent = 'Submitting…'; status.classList.remove('bad'); status.classList.add('show'); }

      // `headers` is null for the multipart path, and fetch() REJECTS on a null headers
      // value ("Failed to read the 'headers' property from 'RequestInit'") — the request
      // was never even attempted, which is why the back-rent application form banked zero
      // leads from the day it launched. Omit the key entirely instead, which is also what
      // lets the browser set the multipart boundary itself.
      var init = {method:'POST', body: body};
      if(headers){ init.headers = headers; }

      fetch(INTAKE_ENDPOINT, init)
        .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(d){ return {ok: r.ok, data: d}; }); })
        .then(function(res){
          if(!res.ok || !res.data || res.data.ok === false){
            var e = new Error((res.data && res.data.reply) || 'submit_failed');
            // Only a `reply` the SERVER wrote is meant for a human to read.
            e.userMessage = (res.data && res.data.reply) || '';
            throw e;
          }
          showConfirmation(form, status, res.data);   // only on a real 200 from the endpoint
          // Conversion tracking fires HERE — on a confirmed server success — and nowhere
          // else. It used to run from a document-level capture-phase listener, ahead of
          // both validation and the network call, so a failed or half-filled submit still
          // booked a $600 Google Ads conversion and would have poisoned Smart Bidding.
          if(window.rasTrackLead){ window.rasTrackLead(form.id, res.data && res.data.contact_id); }
        })
        .catch(function(err){
          if(btn){ btn.disabled = false; }
          // The applicant gets a human sentence and a phone number; the technical detail
          // goes to the console. A Philadelphia landlord was being shown raw strings like
          // "Failed to fetch" and a 200-character ByteString conversion error.
          try { console.error('[RAS] submit failed:', err); } catch(_e){}
          if(status){
            status.textContent = (err && err.userMessage)
              ? err.userMessage
              : 'Something went wrong submitting your application. Please try again, or call (215) 402-6882.';
            status.classList.add('bad','show');
          }
        });
    });
  }

  // Back rent / TFA intake
  initIntakeForm('intake-form', 'form-status', 'intake');
  (function(){ var f = document.getElementById('intake-form');
    if(f) wireReveal(f, 'diversion_filed', document.getElementById('evp-block'), 'yes'); })();

  // Rental License intake
  initIntakeForm('license-form', 'license-status', 'license');
  (function(){
    var f = document.getElementById('license-form'); if(!f) return;
    wireReveal(f, 'has_birt',           document.getElementById('lic-birt-block'), 'yes');
    wireReveal(f, 'has_rental_license', document.getElementById('lic-exp-block'),  'yes');
    wireReveal(f, 'has_violations',     document.getElementById('lic-viol-block'), 'yes');
    var calNote = document.getElementById('lic-cal-note');
    var unitsEl = document.getElementById('lic-units');
    function syncCal(){
      var occ = f.querySelector('input[name="owner_occupied"]:checked');
      var units = Number(unitsEl && unitsEl.value);
      var exempt = !!occ && occ.value === 'yes' && units >= 1 && units <= 4;
      if(calNote) calNote.classList.toggle('show', exempt);
    }
    f.querySelectorAll('input[name="owner_occupied"]').forEach(function(r){ r.addEventListener('change', syncCal); });
    if(unitsEl) unitsEl.addEventListener('input', syncCal);
    syncCal();
  })();

  // City Tax Compliance intake
  initIntakeForm('tax-form', 'tax-status', 'tax');
  (function(){
    var f = document.getElementById('tax-form'); if(!f) return;
    wireReveal(f, 'has_birt',    document.getElementById('tax-birt-block'),    'yes');
    wireReveal(f, 'has_balance', document.getElementById('tax-balance-block'), 'yes');
  })();

  /* ---- 7) Contact lead-form handler — posts to the live CRM endpoint ---- */
  var contactForm = document.getElementById('contact-form');
  if(contactForm){
    contactForm.addEventListener('submit', function(e){
      e.preventDefault(); // wired to the live CRM endpoint below.
      var status = document.getElementById('contact-status');
      if(!status){
        status = document.createElement('div');
        status.id = 'contact-status'; status.className = 'form-status';
        status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
        var noteEl = contactForm.querySelector('.form-note');
        contactForm.insertBefore(status, noteEl ? noteEl.nextSibling : null);
      }
      // honeypot — silently accept bots without submitting
      var hp = contactForm.querySelector('input[name="hp_x7f2"]');
      if(hp && hp.value.trim()){ return; }
      // minimal required: name + (phone or email)
      var name  = (contactForm.querySelector('[name="name"]')  || {}).value || '';
      var phone = (contactForm.querySelector('[name="phone"]') || {}).value || '';
      var email = (contactForm.querySelector('[name="email"]') || {}).value || '';
      if(!name.trim() || (!phoneOk(phone) && !emailOk(email))){
        status.textContent = 'Please give your name and a valid phone or email.';
        status.className = 'form-status bad show';
        return;
      }
      var obj = {form_type: 'contact'};
      contactForm.querySelectorAll('input,select,textarea').forEach(function(el){
        if(!el.name) return;
        if(el.type === 'checkbox' || el.type === 'radio'){ if(!el.checked) return; }
        obj[el.name] = el.value;
      });
      var utm = utmParams();
      Object.keys(utm).forEach(function(k){ obj[k] = utm[k]; });
      var btn = contactForm.querySelector('button[type="submit"]');
      if(btn){ btn.disabled = true; }
      status.textContent = 'Submitting…'; status.className = 'form-status show';
      fetch(INTAKE_ENDPOINT, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(obj)})
        .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(d){ return {ok:r.ok, data:d}; }); })
        .then(function(res){
          if(!res.ok || !res.data || res.data.ok === false){
            var e = new Error((res.data && res.data.reply) || 'submit_failed');
            e.userMessage = (res.data && res.data.reply) || '';
            throw e;
          }
          if(window.rasTrackLead){ window.rasTrackLead('contact-form', res.data && res.data.contact_id); }
          var panel = document.createElement('div');
          panel.className = 'callout on-ink'; panel.setAttribute('role','status'); panel.style.marginTop = '8px';
          panel.innerHTML = '<h3 style="margin:0 0 8px;color:#fff;">Thanks &mdash; we&rsquo;ve got it.</h3>'
            + '<p style="color:#B7C3D6;">We review your details, usually within one business day, and tell you straight whether the City will likely pay. '
            + 'Prefer to talk? Call <a href="tel:+12154026882" style="color:var(--brass);">(215) 402-6882</a>.</p>';
          contactForm.parentNode.insertBefore(panel, contactForm);
          contactForm.style.display = 'none';
          panel.scrollIntoView({behavior:'smooth', block:'center'});
        })
        .catch(function(err){
          if(btn){ btn.disabled = false; }
          try { console.error('[RAS] contact submit failed:', err); } catch(_e){}
          status.textContent = (err && err.userMessage)
            ? err.userMessage
            : 'Something went wrong. Please try again, or call (215) 402-6882.';
          status.className = 'form-status bad show';
        });
    });
  }

  /* ---- 8) Landlord / tenant gate ----
   *
   * WHY: this site sells a filing service to PROPERTY OWNERS, but its brand, its domain
   * and the search terms it ranks for ("rental assistance philadelphia") all read as
   * tenant-side. Tenants were arriving, filling these forms, and being booked both as
   * landlord leads in the CRM and as paid Google Ads conversions — of the four RAS
   * conversions recorded 25-31 Aug 2026, two came from tenant-side queries.
   *
   * HOW: every lead form starts `hidden` and is only revealed after the visitor says they
   * are a landlord. A tenant gets the resource panel instead. The tenant path issues NO
   * network request at all, so there is no contact row, no contact id and therefore no
   * conversion — see rasTrackLead(), which additionally refuses any form whose
   * visitor_role is not an explicit 'landlord'.
   *
   * The panel below duplicates the resource list on /tenants/. tests/intake-forms.spec.js
   * asserts the two carry the same numbers, so one cannot go stale while the other is
   * updated. Numbers verified 2026-09-13.
   */
  var TENANT_RESOURCES = [
    {name:'Eviction Diversion Program — tenant hotline', tel:'+12155239501', label:'215-523-9501',
     meta:'City of Philadelphia · Mon–Fri, 9am–4pm',
     note:'They explain the program and connect you to a housing counselor.'},
    {name:'Philly Tenant Hotline', tel:'+12674432500', label:'(267) 443-2500',
     meta:'Free legal help &amp; tenant advocacy',
     note:'Eviction notice, repairs, your lease, rental assistance, subsidized housing.'},
    {name:'PA 211', tel:'211', label:'211',
     meta:'Statewide referral line',
     note:'Rent, utilities, food and housing referrals. Dial 211 from any phone.'}
  ];

  function tenantPanelHTML(){
    var items = TENANT_RESOURCES.map(function(r){
      return '<li><span class="tp-name">' + r.name + '</span>'
        + '<a class="tp-tel" href="tel:' + r.tel + '" data-no-track>' + r.label + '</a> '
        + '<span class="tp-meta">' + r.meta + '</span>'
        + '<p style="margin:6px 0 0;">' + r.note + '</p></li>';
    }).join('');
    return '<h3>We work for landlords &mdash; but you’re not out of options.</h3>'
      + '<p>Rental Assistance Philadelphia is a private filing service hired by <strong>property owners</strong>, '
      + 'so there is nothing we can file for you. We would rather tell you that now than take your details.</p>'
      + '<p><strong>The part worth knowing:</strong> the City’s Eviction Diversion Program can pay your past-due '
      + 'rent &mdash; up to $3,500 plus two months of future rent &mdash; but <strong>the landlord files it, not you</strong>. '
      + 'The first hotline below can explain it to you so you can raise it with them.</p>'
      + '<ul class="tp-list">' + items + '</ul>'
      + '<p class="tp-more"><a href="/tenants/"><strong>Full list of free help for Philadelphia tenants &rarr;</strong></a></p>';
  }

  function initRoleGate(gate){
    var form = document.getElementById(gate.getAttribute('data-gate-for'));
    if(!form) return;
    var roleInput = form.querySelector('input[name="visitor_role"]');
    var panel = null;

    function showTenantPanel(){
      if(!panel){
        panel = document.createElement('div');
        panel.className = 'tenant-panel';
        panel.setAttribute('data-tenant-panel', '');
        panel.setAttribute('role', 'status');
        panel.innerHTML = tenantPanelHTML();
        gate.parentNode.insertBefore(panel, gate.nextSibling);
      }
      panel.hidden = false;
      panel.scrollIntoView({behavior:'smooth', block:'center'});
    }

    function choose(role){
      if(roleInput){ roleInput.value = role; }
      if(role === 'landlord'){
        if(panel){ panel.hidden = true; }
        gate.classList.add('chosen');
        form.hidden = false;
        // `.reveal` elements are faded in by an IntersectionObserver, which never fires for
        // a `hidden` element because it has no layout box. Without this the form would be
        // un-hidden at opacity 0 and the applicant would see an empty section.
        form.classList.add('in');
      } else {
        gate.classList.remove('chosen');
        form.hidden = true;
        showTenantPanel();
      }
    }

    gate.querySelectorAll('.rg-btn').forEach(function(b){
      b.addEventListener('click', function(){ choose(b.getAttribute('data-role')); });
    });
    var change = gate.querySelector('.rg-change');
    if(change){
      change.addEventListener('click', function(){
        gate.classList.remove('chosen');
        form.hidden = true;
        if(panel){ panel.hidden = true; }
        if(roleInput){ roleInput.value = ''; }
      });
    }
  }

  document.querySelectorAll('[data-role-gate]').forEach(initRoleGate);
})();


/* ============================================================
     Paid-acquisition attribution + conversion tracking (RAS)
     Self-contained, no external dependency. Captures Google Ads
     click ids, preserves them through the form fill, and pushes a
     dataLayer event on submit so a GTM container can fire a Google
     Ads conversion later. Safe/no-op until GTM is added.
     GTM container GTM-KCNCLC5Z installed in <head> + <body> (2026-06-22).
     Remaining: build the lead_submit -> Google Ads conversion tag inside
     GTM once the Google Ads conversion action exists.
     ============================================================ */
(function () {
  window.dataLayer = window.dataLayer || [];
  var CLICK_KEYS = ['gclid', 'gbraid', 'wbraid'];
  var STORE = 'ras_click_ids';
  // 1) Capture click ids from the URL, persist 90 days.
  try {
    var qs = new URLSearchParams(location.search), found = {}, hit = false;
    CLICK_KEYS.forEach(function (k) { var v = qs.get(k); if (v) { found[k] = v; hit = true; } });
    if (hit) localStorage.setItem(STORE, JSON.stringify({ v: found, t: Date.now() }));
  } catch (e) {}
  function clickIds() {
    try {
      var raw = localStorage.getItem(STORE); if (!raw) return {};
      var o = JSON.parse(raw);
      if (Date.now() - o.t > 90 * 864e5) { localStorage.removeItem(STORE); return {}; }
      return o.v || {};
    } catch (e) { return {}; }
  }
  // 2) Inject the captured ids as hidden fields into every form, so they
  //    flow to the CRM when the forms get wired to a real endpoint.
  function stampForms() {
    var ids = clickIds();
    document.querySelectorAll('form').forEach(function (f) {
      CLICK_KEYS.forEach(function (k) {
        if (!ids[k]) return;
        var el = f.querySelector('input[name="' + k + '"]');
        if (!el) { el = document.createElement('input'); el.type = 'hidden'; el.name = k; f.appendChild(el); }
        el.value = ids[k];
      });
    });
  }
  // 3) Push the GTM-consumable lead_submit event — ONLY on a confirmed server success.
  //
  // This used to be a document-level listener registered in the CAPTURE phase, so it ran
  // before the form's own handler: ahead of validation and ahead of the network call.
  // Every rejected, failed or half-filled submit therefore booked a conversion — worth
  // $600 on the back-rent form — against a live Google Ads tag. With paid traffic pointed
  // at /back-rent/ that would have fed Smart Bidding phantom conversions from day one.
  // The form handlers now call window.rasTrackLead() themselves, after the endpoint has
  // confirmed the lead was saved.
  function txId() { return 'ras-' + Date.now() + '-' + Math.floor(Math.random() * 1e6); }
  var LEAD_VALUE = { 'intake-form': 600, 'license-form': 250, 'tax-form': 250, 'contact-form': 250 };
  window.rasTrackLead = function (formId, contactId) {
    // No CRM contact id means no lead was stored, so there is nothing to book. The
    // endpoint answers a tripped honeypot with a bare {"ok":true} and saves nothing —
    // and bots trip it constantly — so counting a 200 alone would hand Google Ads a
    // conversion for every bot that fills the decoy. Under-counting a rare save that
    // returned no id is the safe direction; a phantom conversion is not.
    if (!contactId) { return; }
    // A conversion means a LANDLORD lead. Two of the four conversions Google Ads recorded
    // for this account 25–31 Aug 2026 came from tenant-side queries, and a tenant can never
    // become a customer — Smart Bidding was being optimised against leads we cannot sell to.
    // The gate already prevents a tenant from submitting at all; this refuses to depend on
    // that. The role is read off the form that actually submitted (never a page-level
    // global, because two gated forms share this page and can be answered differently),
    // and anything that is not an explicit 'landlord' books nothing.
    var srcForm = formId && document.getElementById(formId);
    var roleEl = srcForm && srcForm.querySelector('input[name="visitor_role"]');
    if (!roleEl || roleEl.value !== 'landlord') { return; }
    var ids = clickIds();
    window.dataLayer.push({
      event: 'lead_submit',
      form_id: formId || 'unknown',
      lead_value: LEAD_VALUE[formId] || 250,
      currency: 'USD',
      // The CRM contact id doubles as the Google Ads dedup key, so a retry or a
      // double-click can never be counted as two conversions.
      transaction_id: contactId,
      gclid: ids.gclid || '', gbraid: ids.gbraid || '', wbraid: ids.wbraid || ''
    });
  };
  // 4) Track tel: clicks as a phone_click event.
  //    EXCEPT links marked data-no-track. Those are the tenant help lines (the City's
  //    diversion hotline, the Philly Tenant Hotline, 211) — someone else's phone numbers,
  //    dialled by someone we cannot sell to. phone_click feeds the "Phone Call from Ads"
  //    conversion action, so tracking them would book a paid conversion every time a
  //    tenant we just turned away called for help.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="tel:"]');
    if (!a || a.hasAttribute('data-no-track')) return;
    window.dataLayer.push({ event: 'phone_click', phone: a.getAttribute('href').replace('tel:', '') });
  }, true);
  if (document.readyState !== 'loading') stampForms();
  else document.addEventListener('DOMContentLoaded', stampForms);
})();
