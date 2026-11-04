/* ============================================================
   The tenant application: its one switch, and the hand-off to the homepage application

   A tenant who has their landlord's details can start an application that we send to the
   landlord to finish (Adam asked for it 2026-10-14; Kean and RK approved it going live). The
   application itself is the homepage's #tenant-form, run in the popup by /landlord-check.js and
   sent by /site.js.

   This small first-party file is the ONE place for what more than one page needs:
   - TENANT_APPLICATION, the switch. landlord-check.js reads it from window.rasTenantApplication,
     and site.js refuses to send the tenant form unless it is true.
   - The hand-off (handOff below and its sessionStorage key): how a page without the application
     sends a visitor to the homepage's, a landlord ('apply') or a tenant ('tenant').
   - The page copy that offers the application: a link marked data-tenant-apply and a block marked
     data-tenant-apply-block (the /faq/ answer, /tenants/).
   Loaded with defer just before /landlord-check.js on every page that has the popup, and on its
   own on /tenants/, which has none. Nothing else keeps a copy of any of it.

   Set TENANT_APPLICATION to false and every page behaves as it did before the tenant application
   existed: the popup's free-help screen, no tenant form, no request, the /tenants/ block hidden,
   and every data-tenant-apply link going where its href says, /tenants/, never to the landlord
   Apply. The words in the static pages (/faq/, /services/back-rent/, /tenants/, /terms.html) are
   not switched: turning it off means changing those back by hand (README).
   Tested by tests/tenant-flow.spec.js.
   ============================================================ */
(function () {
  'use strict';

  var TENANT_APPLICATION = true;
  var HANDOFF = 'ras_lc_open';             // sessionStorage: open the application on arrival

  /* ---------- the hand-off to the homepage ----------
     Kind 'apply' for a landlord, 'tenant' for the tenant application.
     Whether the flag was actually stored decides where they go, because a browser can refuse
     to store it: Safari private mode and partitioned third-party embeds both throw on setItem.
     Assuming it worked sent those visitors to the top of the homepage with no popup and no
     form, a dead end out of a button marked Apply.
     Stored: the homepage's TOP, not /#apply, because the flag opens the popup there by itself.
     With the #apply the browser jumped the page down to the form section, so the popup opened
     over the bottom of the page and closing it left the visitor down there.
     Not stored: /#apply, so the browser's own jump puts them on the form section; the popup can
     no longer carry them, so the anchor has to. A tenant lands there too, and the gate on that
     section asks them the same "Do you have your landlord's details?" question. */
  function handOff(kind) {
    var ok = false;
    try { sessionStorage.setItem(HANDOFF, kind); ok = true; } catch (e) {}
    var ev = { event: 'landlord_check', lc_action: 'handoff', page: location.pathname };
    if (kind === 'tenant') ev.lc_path = 'tenant';
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(ev);
    location.href = ok ? '/' : '/#apply';
  }
  // On arrival at the homepage: the hand-off asked for ('apply' | 'tenant'), or null. Read once.
  function takeHandOff() {
    var kind = null;
    try { kind = sessionStorage.getItem(HANDOFF); sessionStorage.removeItem(HANDOFF); } catch (e) {}
    return kind;
  }

  window.rasTenantApplication = TENANT_APPLICATION;
  window.rasHandOff = handOff;
  window.rasTakeHandOff = takeHandOff;

  /* ---------- the page copy that offers it ----------
     Off: each block goes, and each link is left to its href, /tenants/.
     On: a link opens the application, in this page's own popup when it has one (landlord-check.js
     sets window.rasOpenTenantApplication), otherwise on the homepage by the hand-off. */
  function wire() {
    document.querySelectorAll('[data-tenant-apply-block]').forEach(function (b) { b.hidden = !TENANT_APPLICATION; });
    if (!TENANT_APPLICATION) return;
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest('a[data-tenant-apply]');
      if (!a) return;
      e.preventDefault();
      if (window.rasOpenTenantApplication) window.rasOpenTenantApplication();
      else handOff('tenant');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
