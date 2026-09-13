// Page-side half of the full-page screenshot. The service worker drives it one step at a time:
// prepare → scrollTo(y) → hideFixed() → (capture) → … → restore().
// Exposes __tg.shot.
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

  // Docs sites and web apps often lock the window and scroll a panel instead.
  function findInnerScroller() {
    let best = null;
    let bestArea = 0;
    const all = document.body ? document.body.getElementsByTagName('*') : [];
    let checked = 0;
    for (const el of all) {
      if (checked++ > 8000) break;
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
    // Instant scrolling, and sticky elements pinned to their place in the flow so they appear once.
    style.textContent = 'html, body, * { scroll-behavior: auto !important; }';
    document.documentElement.appendChild(style);

    const windowScrolls = root.scrollHeight > innerHeight + 4;
    const scroller = windowScrolls ? null : findInnerScroller();
    state = {
      style,
      scroller,
      x: scrollX,
      y: scrollY,
      innerTop: scroller ? scroller.scrollTop : 0,
      touched: new Map(), // element → original inline visibility/position
    };
    pinSticky();
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
      state.touched.set(el, {
        visibility: [el.style.getPropertyValue('visibility'), el.style.getPropertyPriority('visibility')],
        position: [el.style.getPropertyValue('position'), el.style.getPropertyPriority('position')],
      });
    }
  }

  function* candidates() {
    const within = state?.scroller;
    const all = document.body ? document.body.getElementsByTagName('*') : [];
    let checked = 0;
    for (const el of all) {
      if (checked++ > 12000) return;
      if (el.localName === 'tucket-grab' || el.localName === 'tucket-grab-highlight') continue;
      yield [el, within];
    }
  }

  function pinSticky() {
    for (const [el] of candidates()) {
      if (getComputedStyle(el).position === 'sticky') {
        remember(el);
        el.style.setProperty('position', 'static', 'important');
      }
    }
  }

  // Called before every screen after the first, so headers, chat bubbles and cookie bars appear
  // once instead of on every screen. Re-run each time: many sites only fix a header after scroll.
  function hideFixed() {
    const area = innerWidth * innerHeight;
    let hidden = 0;
    for (const [el, within] of candidates()) {
      const cs = getComputedStyle(el);
      if (cs.position === 'sticky') {
        remember(el);
        el.style.setProperty('position', 'static', 'important');
        continue;
      }
      if (cs.position !== 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (within && el.contains(within)) continue;
      const r = el.getBoundingClientRect();
      // A full-screen fixed layer is usually a background, not a header; leave it.
      if (r.width * r.height > area * 0.6) continue;
      remember(el);
      el.style.setProperty('visibility', 'hidden', 'important');
      hidden++;
    }
    return hidden;
  }

  function restore() {
    if (!state) return;
    for (const [el, saved] of state.touched) {
      for (const prop of ['visibility', 'position']) {
        const [value, priority] = saved[prop];
        if (value) el.style.setProperty(prop, value, priority);
        else el.style.removeProperty(prop);
      }
    }
    state.style.remove();
    if (state.scroller) state.scroller.scrollTop = state.innerTop;
    window.scrollTo(state.x, state.y);
    state = null;
  }

  tg.shot = { prepare, measure, scrollTo, hideFixed, restore };
})();
