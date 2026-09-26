// Page-side half of the full-page screenshot. The service worker drives it one step at a time:
// prepare → scrollTo(y) → hideFixed() → (capture) → … → restore().
//
// The page's layout is left alone. Sticky elements are never restyled (turning one static shifts
// the layout, and an app's own scroll logic reacts to it); the service worker trims them out of
// each screen by measuring what didn't move. Fixed elements are hidden, because they are chrome
// wherever they sit. Exposes __tg.shot.
(() => {
  const tg = (globalThis.__tg ??= {});
  if (tg.shot) return;

  let state = null;

  const nextFrame = () => new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 100);
  });

  // Docs sites and web apps often lock the window and scroll a panel instead. Every element is
  // considered: busy pages (a LinkedIn profile has tens of thousands) put the panel late in the DOM.
  function findInnerScroller() {
    let best = null;
    let bestArea = 0;
    const all = document.body ? document.body.getElementsByTagName('*') : [];
    for (const el of all) {
      if (el.scrollHeight <= el.clientHeight + 40) continue;
      if (el.clientHeight < innerHeight * 0.4 || el.clientWidth < innerWidth * 0.4) continue;
      const oy = getComputedStyle(el).overflowY;
      if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
      const area = el.clientWidth * el.clientHeight;
      if (area > bestArea) { best = el; bestArea = area; }
    }
    return best;
  }

  function prepare() {
    if (state) restore();
    const root = document.scrollingElement || document.documentElement;
    const style = document.createElement('style');
    // Instant scrolling, and animations and transitions run straight to their finished state, so a
    // bar a page reveals on scroll is fully there (and hideable) rather than halfway through fading in.
    style.textContent = 'html, body, * { scroll-behavior: auto !important; }'
      + ' *, *::before, *::after { transition-duration: 0s !important; transition-delay: 0s !important;'
      + ' animation-duration: 0s !important; animation-delay: 0s !important; }';
    document.documentElement.appendChild(style);

    const windowScrolls = root.scrollHeight > innerHeight + 4;
    const scroller = windowScrolls ? null : findInnerScroller();
    state = {
      style,
      scroller,
      x: scrollX,
      y: scrollY,
      innerTop: scroller ? scroller.scrollTop : 0,
      touched: new Map(), // element → original inline visibility
    };
    return measure();
  }

  function measure() {
    const root = document.scrollingElement || document.documentElement;
    const base = { dpr: devicePixelRatio, viewportW: innerWidth, viewportH: innerHeight };
    if (state?.scroller) {
      const el = state.scroller;
      const r = el.getBoundingClientRect();
      return {
        ...base,
        mode: 'element',
        rect: { x: r.left + el.clientLeft, y: r.top + el.clientTop, w: el.clientWidth, h: el.clientHeight },
        stepH: el.clientHeight,
        totalH: el.scrollHeight,
      };
    }
    return {
      ...base,
      mode: 'window',
      clientW: root.clientWidth || innerWidth,
      stepH: innerHeight,
      totalH: Math.max(root.scrollHeight, document.body?.scrollHeight || 0),
    };
  }

  async function scrollTo(y) {
    if (state?.scroller) state.scroller.scrollTop = y;
    else window.scrollTo(0, y);
    await nextFrame();
    return state?.scroller ? state.scroller.scrollTop : scrollY;
  }

  function remember(el) {
    if (!state.touched.has(el)) {
      state.touched.set(el, [el.style.getPropertyValue('visibility'), el.style.getPropertyPriority('visibility')]);
    }
  }

  // One pass over the whole page. Fixed elements are the ones with no offsetParent (along with
  // hidden ones and <body>), so only those few pay for getComputedStyle: fast even at 50,000 nodes.
  function hidePass(bottomOnly) {
    const area = innerWidth * innerHeight;
    const within = state?.scroller;
    let hidden = 0;
    for (const el of document.body ? document.body.getElementsByTagName('*') : []) {
      if (el.offsetParent !== null) continue;
      if (el.localName === 'tucket-grab' || el.localName === 'tucket-grab-highlight') continue;
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (within && el.contains(within)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      // A full-window fixed layer is a background or an app shell, not a bar; leave it.
      if (r.width * r.height > area * 0.6) continue;
      // On the first screen a header belongs at the top; only bars near the bottom go.
      if (bottomOnly && r.top + r.height / 2 < innerHeight / 2) continue;
      remember(el);
      el.style.setProperty('visibility', 'hidden', 'important');
      hidden++;
    }
    return hidden;
  }

  // Hides fixed elements: before the first screen only bottom bars (chat widgets, cookie and
  // messaging bars), before every later one all of them. Two passes a frame apart, because hiding
  // one bar or the page's own scroll handler can reveal another.
  async function hideFixed({ bottomOnly = false } = {}) {
    let hidden = hidePass(bottomOnly);
    await nextFrame();
    hidden += hidePass(bottomOnly);
    if (hidden) await nextFrame();
    return hidden;
  }

  function restore() {
    if (!state) return;
    for (const [el, [value, priority]] of state.touched) {
      if (value) el.style.setProperty('visibility', value, priority);
      else el.style.removeProperty('visibility');
    }
    state.style.remove();
    if (state.scroller) state.scroller.scrollTop = state.innerTop;
    window.scrollTo(state.x, state.y);
    state = null;
  }

  tg.shot = { prepare, measure, scrollTo, hideFixed, restore };
})();
