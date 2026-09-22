/* Rental Assistance Philadelphia — the motion every page shares (with /theme.css). Loaded in
   <head>, right after /theme.css; everything that touches the page waits for DOMContentLoaded.
   1) The top menu's sliding highlight: one pill behind the current page's menu item. A click
      opens the new page AT ONCE — nothing waits on the animation. The new page puts the pill
      where it was on the page just left and slides it onto its own item over 350ms, while the page
      fades in. Hover never moves it.
   2) CountUp: numbers count up to their value as they scroll into view. A port of React Bits'
      <CountUp /> (reactbits.dev) to plain JS — the site has no React and no build step. Same props,
      written as data attributes, and the same spring (damping 20 + 40/duration, stiffness
      100/duration, as motion's useSpring runs it):

        $<span data-count-up data-to="3500" data-separator=",">3,500</span>

      data-to (required), data-from (0), data-direction ("up" | "down"), data-delay (s, 0),
      data-duration (2), data-separator (""). "countup:start" and "countup:end" events fire on the
      element (the component's onStart / onEnd). The markup holds the final value, so without JS,
      with reduced motion, or for a crawler, the real number is simply there. */
(function(){
  'use strict';
  var reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---- 1) The top menu's sliding highlight ---- */
  var FROM = 'ras_nav_pill_from';          // the menu item the pill was on, handed to the next page
  function initNavPill(){
    var nav = document.querySelector('.nav-links');
    if(!nav) return;
    var items = Array.prototype.filter.call(nav.querySelectorAll('a'), function(a){ return !a.classList.contains('cta'); });
    var current = nav.querySelector('a[aria-current="page"]:not(.cta)');
    var pill = document.createElement('span');
    pill.className = 'nav-pill';
    pill.setAttribute('aria-hidden', 'true');
    nav.insertBefore(pill, nav.firstChild);
    nav.classList.add('has-pill');
    var on = null;

    function place(a, animate){
      if(on) on.classList.remove('is-pill');
      on = a || null;
      if(!a){ pill.classList.remove('is-on'); return; }
      a.classList.add('is-pill');
      // From nowhere (no current page, e.g. the blog) the pill appears where it is, not flying in.
      var still = !animate || reduce || !pill.classList.contains('is-on');
      if(still) pill.style.transition = 'none';
      pill.style.width = a.offsetWidth + 'px';
      pill.style.height = a.offsetHeight + 'px';
      pill.style.transform = 'translate(' + a.offsetLeft + 'px,' + a.offsetTop + 'px)';
      if(still){ void pill.offsetWidth; pill.style.transition = ''; }
      pill.classList.add('is-on');
    }

    // Arriving from a menu click: start on the item of the page just left, slide to ours.
    var from = null;
    try { from = sessionStorage.getItem(FROM); sessionStorage.removeItem(FROM); } catch(_e){}
    var fromItem = from && items.filter(function(a){ return a.getAttribute('href') === from; })[0];
    if(fromItem && current && fromItem !== current && !reduce){
      place(fromItem, false);
      requestAnimationFrame(function(){ place(current, true); });
    } else {
      place(current, false);
    }

    // Leaving by a menu click: note where the pill is, and go — no waiting.
    items.forEach(function(a){
      a.addEventListener('click', function(){
        if(a === current) return;
        try { sessionStorage.setItem(FROM, current ? current.getAttribute('href') : ''); } catch(_e){}
      });
    });
    function settle(){ place(on || current, false); }
    window.addEventListener('resize', settle);
    if(document.fonts && document.fonts.ready) document.fonts.ready.then(function(){
      // The web font changes the items' widths; re-measure, but don't cut short a slide in flight.
      if(pill.getAnimations && pill.getAnimations().length) pill.addEventListener('transitionend', settle, { once: true });
      else settle();
    });
  }
  if(document.readyState !== 'loading') initNavPill();
  else document.addEventListener('DOMContentLoaded', initNavPill);

  /* ---- 2) CountUp ---- */
  function decimalPlaces(n){
    var s = String(n);
    if(s.indexOf('.') !== -1){
      var d = s.split('.')[1];
      if(parseInt(d, 10) !== 0) return d.length;
    }
    return 0;
  }

  function countUp(el){
    var d = el.dataset;
    var to = parseFloat(d.to), from = parseFloat(d.from || '0');
    if(isNaN(to) || isNaN(from)) return;
    var down = d.direction === 'down';
    var delay = parseFloat(d.delay || '0') || 0;
    var duration = parseFloat(d.duration || '2') || 2;
    var separator = d.separator || '';
    var damping = 20 + 40 * (1 / duration);
    var stiffness = 100 * (1 / duration);
    var places = Math.max(decimalPlaces(from), decimalPlaces(to));
    var fmt = new Intl.NumberFormat('en-US', {
      useGrouping: !!separator, minimumFractionDigits: places, maximumFractionDigits: places
    });
    function format(v){
      var s = fmt.format(v);
      return separator ? s.replace(/,/g, separator) : s;
    }
    var start = down ? to : from, target = down ? from : to;
    // motion's spring settles "close enough" by the size of the move: whole units for a big one.
    var big = Math.abs(target - start) > 5;
    var restDelta = big ? 0.5 : 0.005, restSpeed = big ? 2 : 0.01;

    el.textContent = format(start);

    function run(){
      el.dispatchEvent(new CustomEvent('countup:start'));
      setTimeout(function(){
        var x = start, v = 0, last = null;
        function frame(now){
          if(last === null) last = now;
          var elapsed = Math.min((now - last) / 1000, 0.064);         // a background tab's gap
          last = now;
          for(var t = 0; t < elapsed; t += 0.001){                     // 1ms steps, mass 1
            v += (-stiffness * (x - target) - damping * v) * 0.001;
            x += v * 0.001;
          }
          if(Math.abs(target - x) <= restDelta && Math.abs(v) <= restSpeed){
            el.textContent = format(target);
            return;
          }
          el.textContent = format(x);
          requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      }, delay * 1000);
      setTimeout(function(){ el.dispatchEvent(new CustomEvent('countup:end')); }, delay * 1000 + duration * 1000);
    }

    if(!('IntersectionObserver' in window)){ run(); return; }
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if(en.isIntersecting){ io.disconnect(); run(); }
      });
    }, {rootMargin: '0px'});
    io.observe(el);
  }

  function initCountUps(){
    if(reduce) return;                                  // the markup already shows the value
    document.querySelectorAll('[data-count-up]').forEach(countUp);
  }
  if(document.readyState !== 'loading') initCountUps();
  else document.addEventListener('DOMContentLoaded', initCountUps);
})();
