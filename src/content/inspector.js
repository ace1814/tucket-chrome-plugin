// Element mode: hover to highlight, click to lock, then send any of the element's colours or its
// type. Also hosts the eyedropper, since a click inside the page is the user gesture it needs.
// Injected after shared/color.js, shared/send.js and shared/fonts.js. Exposes __tg.inspector.
(() => {
  const tg = (globalThis.__tg ??= {});
  if (tg.inspector) return;

  let session = null;

  const CSS_TEXT = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .box { position: fixed; pointer-events: none; border: 1.5px solid #6C6CF8; background: rgba(108,108,248,.10);
           border-radius: 2px; transition: all .06s linear; }
    .box.locked { border-color: #F5A524; background: rgba(245,165,36,.10); border-width: 2px; }
    .tag { position: fixed; pointer-events: none; font: 500 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
           color: #fff; background: #1d1d24; padding: 4px 6px; border-radius: 4px; white-space: nowrap; }
    .panel { position: fixed; right: 16px; bottom: 16px; width: 300px; max-height: min(520px, calc(100vh - 32px));
             overflow: auto; pointer-events: auto; background: #fff; color: #1d1d24; border-radius: 12px;
             box-shadow: 0 12px 40px rgba(0,0,0,.22), 0 0 0 1px rgba(0,0,0,.08);
             font: 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
    .panel.left { right: auto; left: 16px; }
    header { display: flex; align-items: center; gap: 6px; padding: 10px 10px 8px 12px; border-bottom: 1px solid #eee;
             position: sticky; top: 0; background: #fff; }
    header strong { font-size: 12px; font-weight: 650; }
    header .hint { flex: 1; color: #888; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
    .icon { width: 26px; height: 26px; border-radius: 6px; display: grid; place-items: center; color: #555; }
    .icon:hover { background: #f1f1f4; color: #111; }
    .seg { display: flex; margin: 10px 12px 0; background: #f1f1f4; border-radius: 7px; padding: 2px; }
    .seg button { flex: 1; padding: 3px 0; border-radius: 5px; font-size: 10.5px; font-weight: 600; color: #666; }
    .seg button[aria-pressed="true"] { background: #fff; color: #111; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
    section { padding: 10px 12px 12px; }
    section + section { border-top: 1px solid #f0f0f0; }
    h3 { margin: 0 0 6px; font-size: 10.5px; font-weight: 650; text-transform: uppercase; letter-spacing: .04em; color: #888; }
    .el { font: 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; color: #555; padding: 10px 12px 0;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 6px; margin: 0 -6px; width: calc(100% + 12px);
           border-radius: 6px; text-align: left; }
    .row:hover { background: #f4f4f7; }
    .row .label { color: #777; width: 72px; flex: none; }
    .row .value { flex: 1; font: 11.5px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row .go { color: #6C6CF8; font-size: 11px; font-weight: 600; opacity: 0; }
    .row:hover .go { opacity: 1; }
    .sw { width: 18px; height: 18px; border-radius: 5px; flex: none; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12);
          background-image: linear-gradient(45deg,#ddd 25%,transparent 25%,transparent 75%,#ddd 75%),linear-gradient(45deg,#ddd 25%,transparent 25%,transparent 75%,#ddd 75%);
          background-size: 8px 8px; background-position: 0 0, 4px 4px; position: relative; overflow: hidden; }
    .sw i { position: absolute; inset: 0; }
    .family { font-size: 15px; font-weight: 600; margin: 2px 0 2px; }
    .stack { color: #888; font-size: 11px; margin-bottom: 6px; word-break: break-word; }
    .grid { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 6px 0 8px; font-size: 11.5px; }
    .grid dt { color: #888; } .grid dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .buttons { display: flex; gap: 6px; }
    .btn { flex: 1; padding: 6px 8px; border-radius: 7px; background: #f1f1f4; font-weight: 600; font-size: 11.5px; }
    .btn:hover { background: #e7e7ec; }
    .btn.primary { background: #6C6CF8; color: #fff; }
    .btn.primary:hover { background: #5b5be8; }
    .empty { color: #888; margin: 0; padding: 14px 12px; }
    .toast { position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 12px); opacity: 0; pointer-events: none;
             background: #1d1d24; color: #fff; font: 500 12.5px/1 system-ui, -apple-system, sans-serif; padding: 9px 14px;
             border-radius: 999px; transition: opacity .15s, transform .15s; }
    .toast.show { opacity: 1; transform: translate(-50%, 0); }
    @media (prefers-color-scheme: dark) {
      .panel, header { background: #1f1f26; color: #ececf1; }
      header { border-color: #2e2e37; } section + section { border-color: #2a2a32; }
      .icon { color: #aaa; } .icon:hover, .row:hover { background: #2a2a33; color: #fff; }
      .seg { background: #2a2a33; } .seg button { color: #aaa; } .seg button[aria-pressed="true"] { background: #3a3a45; color: #fff; }
      .el { color: #aaa; } .btn { background: #2d2d36; } .btn:hover { background: #383842; }
    }
  `;

  const EYEDROPPER_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></svg>';
  const CLOSE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function describe(el) {
    let s = el.localName;
    if (el.id) s += `#${el.id}`;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    if (cls.length) s += `.${cls.join('.')}`;
    return s;
  }

  function effectiveBackground(el) {
    for (let node = el.parentElement; node; node = node.parentElement) {
      const c = TGColor.parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  function createSession(opts) {
    const host = document.createElement('tucket-grab');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${CSS_TEXT}</style>
      <div class="box" hidden></div>
      <div class="tag" hidden></div>
      <aside class="panel" role="dialog" aria-label="Tucket Grab inspector">
        <header>
          <strong>Tucket Grab</strong>
          <span class="hint">Click an element to lock it</span>
          <button class="icon" data-act="eyedropper" title="Eyedropper — pick any pixel">${EYEDROPPER_ICON}</button>
          <button class="icon" data-act="close" title="Close (Esc)">${CLOSE_ICON}</button>
        </header>
        <div class="seg" role="group" aria-label="Colour format">
          <button data-format="hex">HEX</button><button data-format="rgb">RGB</button><button data-format="hsl">HSL</button>
        </div>
        <div class="content"><p class="empty">Hover over the page to read colours and type.</p></div>
      </aside>
      <div class="toast" role="status" aria-live="polite"></div>`;
    document.documentElement.appendChild(host);

    const $ = (sel) => root.querySelector(sel);
    const box = $('.box'), tag = $('.tag'), panel = $('.panel'), content = $('.content'), hint = $('.hint'), toastEl = $('.toast');
    let format = 'hex';
    let first = opts.section || 'colours';
    let hovered = null;
    let locked = null;
    let picked = null;
    let copies = [];
    let toastTimer = 0;
    let raf = 0;

    chrome.storage.local.get('colorFormat').then(({ colorFormat }) => { if (colorFormat) { format = colorFormat; refresh(); } });
    const onStorage = (changes) => { if (changes.colorFormat) { format = changes.colorFormat.newValue || 'hex'; refresh(); } };
    chrome.storage.onChanged.addListener(onStorage);

    function toast(msg) {
      toastEl.textContent = msg;
      toastEl.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
    }

    async function copy(value) {
      try {
        await TGSend.text(value);
        toast(await TGSend.doneMessage());
      } catch {
        toast('Couldn’t copy — click the page and try again');
      }
    }

    function drawBox() {
      const el = locked || hovered;
      if (!el || !el.isConnected) { box.hidden = tag.hidden = true; return; }
      const r = el.getBoundingClientRect();
      box.hidden = tag.hidden = false;
      box.classList.toggle('locked', !!locked);
      Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      tag.textContent = `${describe(el)}  ${Math.round(r.width)} × ${Math.round(r.height)}`;
      const top = r.top > 26 ? r.top - 24 : r.bottom + 4;
      Object.assign(tag.style, { left: `${Math.max(4, Math.min(r.left, innerWidth - 260))}px`, top: `${Math.min(top, innerHeight - 22)}px` });
    }

    function colourRow(label, c, note) {
      const value = TGColor.format(c, format);
      const i = copies.push(value) - 1;
      return `<button class="row" data-copy="${i}" title="Send ${escapeHtml(value)}">
          <span class="sw"><i style="background:${TGColor.toRgb(c)}"></i></span>
          <span class="label">${escapeHtml(label)}</span>
          <span class="value">${escapeHtml(value)}${note ? ` <span style="color:#999">· ${escapeHtml(note)}</span>` : ''}</span>
          <span class="go">Send</span>
        </button>`;
    }

    function render(el) {
      copies = [];
      const parts = [];

      if (picked) parts.push(`<section><h3>Eyedropper</h3>${colourRow('Picked', picked)}</section>`);

      if (!el) {
        content.innerHTML = parts.join('') || '<p class="empty">Hover over the page to read colours and type.</p>';
        return;
      }
      const cs = getComputedStyle(el);

      // Colours
      const rows = [];
      const text = TGColor.parse(cs.color);
      if (text && text.a > 0) rows.push(colourRow('Text', text));
      const bg = TGColor.parse(cs.backgroundColor);
      if (bg && bg.a > 0) rows.push(colourRow('Background', bg));
      else rows.push(colourRow('Background', effectiveBackground(el), 'behind'));
      const borders = new Map();
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        if (parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== 'none') {
          const c = TGColor.parse(cs[`border${side}Color`]);
          if (c && c.a > 0) borders.set(TGColor.toHex(c), c);
        }
      }
      [...borders.values()].forEach((c, i) => rows.push(colourRow(borders.size > 1 ? `Border ${i + 1}` : 'Border', c)));
      if (el instanceof SVGElement) {
        const fill = TGColor.parse(cs.fill);
        if (fill && fill.a > 0) rows.push(colourRow('Fill', fill));
        const stroke = TGColor.parse(cs.stroke);
        if (stroke && stroke.a > 0 && cs.stroke !== 'none') rows.push(colourRow('Stroke', stroke));
      }
      const gradient = cs.backgroundImage.match(/(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^()]*\)/gi) || [];
      gradient.slice(0, 4).forEach((g, i) => { const c = TGColor.parse(g); if (c) rows.push(colourRow(`Gradient ${i + 1}`, c)); });
      const colourSection = `<section><h3>Colours</h3>${rows.join('')}</section>`;

      // Type
      const resolved = TGFonts.resolve(cs.fontFamily);
      const line = TGFonts.line(cs, resolved.family);
      const cssText = TGFonts.css(cs, text ? TGColor.toHex(text) : null);
      const lineIdx = copies.push(line) - 1;
      const cssIdx = copies.push(cssText) - 1;
      const kind = { web: 'web font', system: 'installed font', generic: 'browser default' }[resolved.kind];
      const fontSection = `<section><h3>Type</h3>
          <div class="family">${escapeHtml(resolved.family)}</div>
          <div class="stack">${escapeHtml(kind)} · ${escapeHtml(cs.fontFamily)}</div>
          <dl class="grid">
            <dt>Size</dt><dd>${escapeHtml(cs.fontSize)}</dd>
            <dt>Weight</dt><dd>${escapeHtml(cs.fontWeight)}${cs.fontStyle !== 'normal' ? ` ${escapeHtml(cs.fontStyle)}` : ''}</dd>
            <dt>Line height</dt><dd>${escapeHtml(cs.lineHeight)}</dd>
            <dt>Letter spacing</dt><dd>${escapeHtml(cs.letterSpacing)}</dd>
          </dl>
          <div class="buttons">
            <button class="btn primary" data-copy="${lineIdx}" title="${escapeHtml(line)}">Send line</button>
            <button class="btn" data-copy="${cssIdx}">Copy as CSS</button>
          </div>
        </section>`;

      parts.push(`<div class="el">${escapeHtml(describe(el))}</div>`);
      parts.push(...(first === 'fonts' ? [fontSection, colourSection] : [colourSection, fontSection]));
      content.innerHTML = parts.join('');
    }

    function refresh() {
      for (const b of root.querySelectorAll('[data-format]')) b.setAttribute('aria-pressed', String(b.dataset.format === format));
      render(locked || hovered);
    }

    const inHost = (e) => e.composedPath().includes(host);
    const targetOf = (e) => {
      const t = e.composedPath()[0];
      return t instanceof Element ? t : e.target;
    };

    function onMove(e) {
      if (inHost(e)) return;
      if (!locked) {
        // Keep the panel out from under the cursor while exploring.
        const r = panel.getBoundingClientRect();
        if (e.clientX > r.left - 40 && e.clientX < r.right + 40 && e.clientY > r.top - 40) panel.classList.toggle('left');
        const el = targetOf(e);
        if (el !== hovered) { hovered = el; render(el); }
      }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(drawBox);
    }

    function swallow(e) {
      if (inHost(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }

    function onClick(e) {
      if (inHost(e)) return;
      swallow(e);
      const el = targetOf(e);
      locked = locked === el ? null : el;
      hovered = el;
      hint.textContent = locked ? 'Locked — click it again to unlock' : 'Click an element to lock it';
      render(el);
      drawBox();
    }

    function onKey(e) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (locked) {
        locked = null;
        hint.textContent = 'Click an element to lock it';
        drawBox();
      } else {
        destroy();
      }
    }

    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(drawBox); };

    async function eyedropper() {
      if (!('EyeDropper' in window)) { toast('The eyedropper needs Chrome 95 or newer'); return; }
      host.style.visibility = 'hidden';
      try {
        const { sRGBHex } = await new EyeDropper().open();
        picked = TGColor.parse(sRGBHex);
        render(locked || hovered);
        if (picked) await copy(TGColor.format(picked, format));
      } catch {
        /* cancelled */
      } finally {
        host.style.visibility = '';
      }
    }

    root.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.copy != null) copy(copies[+btn.dataset.copy]);
      else if (btn.dataset.format) chrome.storage.local.set({ colorFormat: btn.dataset.format });
      else if (btn.dataset.act === 'close') destroy();
      else if (btn.dataset.act === 'eyedropper') eyedropper();
    });

    const blocked = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu', 'auxclick'];
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    blocked.forEach((t) => window.addEventListener(t, swallow, true));

    function destroy() {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      blocked.forEach((t) => window.removeEventListener(t, swallow, true));
      try { chrome.storage.onChanged.removeListener(onStorage); } catch { /* extension reloaded */ }
      host.remove();
      session = null;
    }

    refresh();
    return {
      destroy,
      focus(next) {
        first = next.section || first;
        render(locked || hovered);
        if (next.eyedropper) eyedropper();
      },
    };
  }

  tg.inspector = {
    start(opts = {}) {
      if (session) session.focus(opts);
      else session = createSession(opts);
    },
    stop() { session?.destroy(); },
  };
})();
