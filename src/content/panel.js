// The Tucket Grab panel: floating Liquid Glass over the page, opened from the toolbar icon.
// Four tabs, each one or two taps from done: Screenshot, Font, Colour, SVG.
// Injected after shared/color.js, shared/send.js, shared/fonts.js, content/palette.js,
// content/fonts.js, content/svgs.js and content/panel-css.js. Exposes __tg.panel.
(() => {
  const tg = (globalThis.__tg ??= {});
  if (tg.panel) return;

  const CTA = 'https://trytucket.com/?utm_source=chrome-extension&utm_medium=panel&utm_campaign=grab';
  const MAX_RECENT = 10;
  const MAX_GRABS = 8;

  const icon = (body, size = 18, extra = '') =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;
  const I = {
    mark: `<svg width="24" height="24" viewBox="0 0 640 640" fill="none" aria-hidden="true">
      <rect width="640" height="640" rx="166.957" fill="#6C6CF8"/>
      <path d="M0 320.881C75.754 231.776 191.22 174.858 320.57 174.858C449.273 174.858 564.23 231.209 640 319.546V525.714C640 588.832 588.832 640 525.714 640H114.286C51.168 640 0 588.832 0 525.714V320.881Z" fill="#8C8CFB"/>
      <ellipse cx="205.715" cy="438.288" rx="90.286" ry="100" fill="#fff"/><ellipse cx="205.157" cy="417.144" rx="61.143" ry="67.429" fill="#3B3A88"/>
      <ellipse cx="433.139" cy="438.289" rx="90.286" ry="100" fill="#fff"/><ellipse cx="432.573" cy="417.144" rx="61.143" ry="67.429" fill="#3B3A88"/>
    </svg>`,
    close: icon('<path d="M17 7 7 17M7 7l10 10"/>', 13, 'stroke-width="2.4"'),
    shot: icon('<rect x="3" y="6.5" width="18" height="13.5" rx="3.5"/><circle cx="12" cy="13.2" r="3.4"/><path d="M8.5 6.5 10 4h4l1.5 2.5"/>'),
    font: icon('<path d="M4 19 9 5l5 14"/><path d="M5.8 14h6.4"/><path d="M20 12.5v6.5"/><circle cx="17.2" cy="16.2" r="2.8"/>'),
    colour: icon('<path d="M12 3.2s6.2 6.6 6.2 11.2a6.2 6.2 0 0 1-12.4 0C5.8 9.8 12 3.2 12 3.2z"/><path d="M9 15a3 3 0 0 0 3 3"/>'),
    svg: icon('<path d="M5 18C7 9 17 9 19 18"/><rect x="2.5" y="16.5" width="4" height="4" rx="1"/><rect x="17.5" y="16.5" width="4" height="4" rx="1"/><rect x="10" y="3.5" width="4" height="4" rx="1"/><path d="M12 7.5v3"/>'),
    fullpage: icon('<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M9 7h6M9 10.5h6M9 14h4"/><path d="m12 17 0 2.5"/>', 26, 'stroke-width="1.6"'),
    visible: icon('<rect x="2.5" y="4.5" width="19" height="13" rx="2.5"/><path d="M8 21h8M12 17.5V21"/>', 26, 'stroke-width="1.6"'),
    region: icon('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><rect x="8.5" y="8.5" width="7" height="7" rx="1.2"/>', 26, 'stroke-width="1.6"'),
    chevron: icon('<path d="m9.5 6 6 6-6 6"/>', 14, 'stroke-width="2.2"'),
    eyedropper: icon('<path d="m2.5 21.5 1-1h3l8.5-8.5"/><path d="M3.5 20.5v-3l8.5-8.5"/><path d="m14.5 5.5 3-3a2.1 2.1 0 0 1 3 3l-3 3 .5.5a1.8 1.8 0 0 1-2.5 2.5l-4-4A1.8 1.8 0 0 1 14 5l.5.5z"/>', 18),
    pointer: icon('<path d="m5 3 14 7-6 2-2 6z"/><path d="m13 12 5 5"/>', 28, 'stroke-width="1.7"'),
    download: icon('<path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 20h14"/>', 15, 'stroke-width="2"'),
    copy: icon('<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>', 15, 'stroke-width="2"'),
  };

  const TABS = [
    { id: 'shot', label: 'Screenshot', icon: I.shot },
    { id: 'font', label: 'Font', icon: I.font },
    { id: 'colour', label: 'Colour', icon: I.colour },
    { id: 'svg', label: 'SVG', icon: I.svg },
  ];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isMac = () => /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
  const frames = (n = 2) => new Promise((r) => { const step = (k) => (k ? requestAnimationFrame(() => step(k - 1)) : r()); step(n); });

  let ui = null;

  // ---------- inline SVG previews (no data: URLs: strict-CSP pages block them) ----------

  let svgSeq = 0;
  function svgNode(markup) {
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.localName !== 'svg' || doc.querySelector('parsererror')) return null;
    // Previews share one shadow root, so ids from different SVGs must not collide.
    const prefix = `tgp${++svgSeq}-`;
    const ids = new Set([...root.querySelectorAll('[id]')].map((el) => el.id));
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (el.id) el.id = prefix + el.id;
      for (const attr of [...el.attributes]) {
        let v = attr.value;
        if (v.includes('url(#')) v = v.replace(/url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g, (m, q, id) => (ids.has(id) ? `url(#${prefix}${id})` : m));
        if (attr.localName === 'href' && v.startsWith('#') && ids.has(v.slice(1))) v = `#${prefix}${v.slice(1)}`;
        if (v !== attr.value) el.setAttributeNS(attr.namespaceURI, attr.name, v);
      }
    }
    root.removeAttribute('width');
    root.removeAttribute('height');
    return document.importNode(root, true);
  }

  // ---------- the panel ----------

  function create() {
    const host = document.createElement('tucket-grab');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(tg.panelCss);
    shadow.adoptedStyleSheets = [sheet];
    shadow.innerHTML = `
      <div class="root">
        <div class="ghosts" hidden></div>
        <div class="outline" hidden></div>
        <div class="tag glass" hidden></div>
        <div class="tip glass" hidden></div>
        <section class="panel glass" role="dialog" aria-label="Tucket Grab">
          <header class="head">
            <span class="mark">${I.mark}</span><strong>Tucket Grab</strong><span class="grow"></span>
            <button class="close" data-act="close" aria-label="Close" title="Close (Esc)">${I.close}</button>
          </header>
          <nav class="tabs" role="tablist">
            <span class="lens"></span>
            ${TABS.map((t) => `<button role="tab" data-tab="${t.id}" aria-selected="false">${t.icon}<span>${t.label}</span></button>`).join('')}
          </nav>
          <div class="body"></div>
          <footer class="foot"></footer>
        </section>
        <div class="toast glass" role="status" aria-live="polite"></div>
      </div>`;
    document.documentElement.appendChild(host);

    const $ = (sel) => shadow.querySelector(sel);
    const panel = $('.panel'), body = $('.body'), foot = $('.foot'), lens = $('.lens');
    const outline = $('.outline'), tag = $('.tag'), tip = $('.tip'), toastEl = $('.toast'), ghosts = $('.ghosts');

    const s = {
      tab: 'shot',
      format: 'hex',
      status: { state: 'checking' },
      palette: null,
      fonts: null,
      showAll: false,
      inspect: false,
      recent: [],
      grabs: [],
      current: null,        // the SVG grab shown in the preview
      svgCount: 0,
      shotError: null,
    };
    let copies = [];
    let target = null;      // what the pointer is over, in a pick mode
    let pointer = null;
    let toastTimer = 0;
    let raf = 0;
    let capturing = false;

    // ---------- storage + status ----------

    chrome.storage.local.get(['colorFormat', 'recentPicks', 'panelTab', 'panelPos']).then((v) => {
      s.format = v.colorFormat || 'hex';
      s.recent = v.recentPicks || [];
      if (v.panelTab && TABS.some((t) => t.id === v.panelTab)) s.tab = v.panelTab;
      const pos = v.panelPos?.[location.origin];
      if (pos) place(pos.left, pos.top);
      select(s.tab);
    });
    const onStorage = (changes, area) => {
      if (area !== 'local') return;
      if (changes.colorFormat) { s.format = changes.colorFormat.newValue || 'hex'; render(); }
    };
    chrome.storage.onChanged.addListener(onStorage);

    function refreshStatus() {
      chrome.runtime.sendMessage({ type: 'tucket:status', fresh: true })
        .then((status) => { s.status = status || { state: 'missing' }; render(); })
        .catch(() => { s.status = { state: 'missing' }; render(); });
    }
    const connected = () => s.status.state === 'connected';

    // ---------- helpers ----------

    function toast(msg) {
      toastEl.textContent = msg;
      toastEl.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1700);
    }

    async function send(kind, data) {
      try {
        const res = await TGSend.send(kind, data, { pageUrl: location.href, pageTitle: document.title });
        toast(res.via === 'tucket' ? 'Sent to Tucket' : connected() ? 'Copied — Tucket saved it' : 'Copied');
        return true;
      } catch {
        toast('Couldn’t copy — click the page, then try again');
        return false;
      }
    }

    function copyId(value) {
      return copies.push(value) - 1;
    }

    function download(name, blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    function place(left, top) {
      const r = panel.getBoundingClientRect();
      const x = Math.max(8, Math.min(left, innerWidth - r.width - 8));
      const y = Math.max(8, Math.min(top, innerHeight - 80));
      Object.assign(panel.style, { left: `${x}px`, top: `${y}px`, right: 'auto' });
    }

    // Inline styles are set through the CSSOM, never as style="" (strict CSP blocks those).
    function paint(scope) {
      for (const el of scope.querySelectorAll('[data-bg]')) el.style.background = el.dataset.bg;
      for (const el of scope.querySelectorAll('[data-skel-h]')) el.style.height = `${el.dataset.skelH}px`;
      for (const el of scope.querySelectorAll('[data-family]')) {
        el.style.fontFamily = el.dataset.family;
        el.style.fontWeight = el.dataset.weight || '400';
        el.style.fontStyle = el.dataset.style || 'normal';
      }
      for (const el of scope.querySelectorAll('[data-svg]')) {
        const node = svgNode(s.grabs[+el.dataset.svg]?.markup || '');
        if (node) el.replaceChildren(node);
      }
    }

    // ---------- tabs ----------

    function select(tab) {
      s.tab = tab;
      if (tab !== 'font') s.inspect = false;
      chrome.storage.local.set({ panelTab: tab });
      const index = TABS.findIndex((t) => t.id === tab);
      lens.style.transform = `translateX(${index * 100}%)`;
      for (const b of shadow.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
      clearTarget();
      render();
      if (tab === 'svg') {
        s.svgCount = tg.svgs.findAll();
        render();
        drawGhosts();
      } else {
        clearGhosts();
      }
      if (tab === 'colour' && !s.palette) setTimeout(() => { s.palette = tg.palette.scan(); render(); }, 30);
      if (tab === 'font' && !s.fonts) setTimeout(() => { s.fonts = tg.fonts.scan(); render(); lookupFonts(); }, 30);
    }

    function render() {
      copies = [];
      const views = { shot: viewShot, font: viewFont, colour: viewColour, svg: viewSvg };
      body.innerHTML = views[s.tab]();
      paint(body);
      foot.innerHTML = viewFoot();
    }

    // ---------- Screenshot ----------

    function viewShot() {
      return `
        <div class="tiles">
          <button class="tile primary" data-shot="full">${I.fullpage}<span>Full page</span></button>
          <button class="tile" data-shot="visible">${I.visible}<span>Visible area</span></button>
          <button class="tile" data-shot="region">${I.region}<span>Selected area</span></button>
        </div>
        ${s.shotError ? `<p class="error">${esc(s.shotError)}</p>` : '<p class="note">Sticky headers show once and lazy images load first. Save as PNG, JPEG, WebP or PDF.</p>'}`;
    }

    async function startShot(mode) {
      s.shotError = null;
      hideForCapture();
      await frames(2);
      const res = await chrome.runtime.sendMessage({ type: 'shot:start', mode }).catch((e) => ({ ok: false, error: e.message }));
      if (!res?.ok) {
        showAfterCapture();
        s.shotError = res?.error || 'Couldn’t start the capture.';
        render();
      }
    }


    // ---------- Font ----------

    // Where to get the font: straight from where the page loads it, else what Fontsource knows.
    const plus = (name) => encodeURIComponent(name).replace(/%20/g, '+');
    const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    function fontLink(f) {
      const q = encodeURIComponent(f.family);
      let link = null;
      switch (f.source) {
        case 'google': link = ['Download free', `https://fonts.google.com/specimen/${plus(f.family)}`]; break;
        case 'fontshare': link = ['Download free', `https://www.fontshare.com/fonts/${slug(f.family)}`]; break;
        case 'adobe': link = ['Adobe Fonts', `https://fonts.adobe.com/search?query=${q}`]; break;
        case 'monotype': link = ['Buy on MyFonts', `https://www.myfonts.com/search?query=${q}`]; break;
        case 'self':
        case 'unknown': {
          const hit = s.fontLookup?.[f.family];
          if (!hit) break;
          if (!hit.found) link = ['Find to buy', `https://www.myfonts.com/search?query=${q}`];
          else if (hit.type === 'google') link = ['Download free', `https://fonts.google.com/specimen/${plus(hit.family)}`];
          else link = ['Download free', `https://fontsource.org/fonts/${hit.id}`];
          break;
        }
      }
      return link ? `<a class="pill go" href="${esc(link[1])}" target="_blank" rel="noopener noreferrer">${link[0]} ↗</a>` : '';
    }

    function lookupFonts() {
      const families = (s.fonts?.used || []).filter((f) => f.source === 'self' || f.source === 'unknown').map((f) => f.family);
      if (!families.length) return;
      chrome.runtime.sendMessage({ type: 'fonts:lookup', families })
        .then((found) => { s.fontLookup = found || {}; if (s.tab === 'font') render(); })
        .catch(() => {});
    }

    function viewFont() {
      const inspectRow = `
        <div class="inspect-row">
          <span class="t"><b>Inspect</b><span>${s.inspect ? 'Hover any text · click to copy its style' : 'Read the exact font of any text'}</span></span>
          <button class="switch" role="switch" aria-checked="${s.inspect}" data-act="inspect" aria-label="Inspect text on the page"></button>
        </div>`;
      if (!s.fonts) return `${inspectRow}<div class="fonts">${skeletons(3, 70)}</div>`;
      const { used } = s.fonts;
      if (!used.length) return `${inspectRow}<p class="note">No text on this page.</p>`;
      const sources = { google: 'Google Fonts', adobe: 'Adobe Fonts', monotype: 'Monotype', fontshare: 'Fontshare', self: 'Web font', unknown: 'Web font', installed: 'Installed', default: 'System' };
      return `${inspectRow}
        <div class="label">${used.length} ${used.length === 1 ? 'family' : 'families'} on this page</div>
        <div class="fonts">
          ${used.map((f) => {
            const stack = f.kind === 'generic' ? f.family : `"${f.family.replace(/"/g, '')}", ${f.family.includes('mono') ? 'monospace' : 'sans-serif'}`;
            const weight = f.line.split(' · ')[2]?.split(' ')[0] || '400';
            return `<div class="font">
              <button class="main" data-copy="${copyId(f.family)}" title="Copy “${esc(f.family)}”">
                <div class="sample" data-family="${esc(stack)}" data-weight="${esc(weight)}">${esc(f.family)}</div>
                <div class="meta"><span class="badge">${sources[f.source] || 'Web font'}</span><span>${esc(f.weights.join(' · '))}</span><span>· ${f.elements} ${f.elements === 1 ? 'use' : 'uses'}</span></div>
              </button>
              <div class="more">
                <button class="pill" data-copy="${copyId(f.line)}" title="${esc(f.line)}">Copy style</button>
                <button class="pill" data-copy="${copyId(f.css)}">Copy CSS</button>
                ${fontLink(f)}
              </div>
            </div>`;
          }).join('')}
        </div>`;
    }

    function skeletons(n, h) {
      return Array.from({ length: n }, () => `<div class="skeleton" data-skel-h="${h}"></div>`).join('');
    }

    // ---------- Colour ----------

    function swatchValue(c) { return TGColor.format(c, s.format); }

    function viewColour() {
      const seg = `<div class="seg" role="group" aria-label="Colour format">${['hex', 'rgb', 'hsl']
        .map((f) => `<button data-format="${f}" aria-pressed="${s.format === f}">${f.toUpperCase()}</button>`).join('')}</div>`;
      const recent = s.recent.length ? `
        <div class="label">Picked</div>
        <div class="dots">${s.recent.map((c) => `<button class="dot" data-bg="${TGColor.toRgb(c)}" data-copy="${copyId(swatchValue(c))}" title="${esc(swatchValue(c))}"></button>`).join('')}</div>` : '';

      let brand;
      if (!s.palette) {
        brand = `<div class="brand">${skeletons(3, 116)}</div>`;
      } else if (!s.palette.brand.length) {
        brand = '<p class="note">No colours found on this page.</p>';
      } else {
        brand = `<div class="brand">${s.palette.brand.map((c) => {
          const v = swatchValue(c);
          return `<button class="sw" data-copy="${copyId(v)}" title="Copy ${esc(v)}">
            <div class="chip" data-bg="${TGColor.toRgb(c)}"></div>
            <div class="meta"><div class="role" title="${esc(c.note || '')}">${c.cta ? 'Secondary · CTA' : c.role}</div><div class="val">${esc(v)}</div></div>
          </button>`;
        }).join('')}</div>`;
      }

      let all = '';
      if (s.palette && s.palette.colours.length > 3) {
        const { colours, variables } = s.palette;
        all = `<button class="disclose" data-act="all" aria-expanded="${s.showAll}"><span>All ${colours.length} colours</span>${I.chevron}</button>`;
        if (s.showAll) {
          all += `<div class="label">By how much of the page they paint</div>
            <div class="grid">${colours.map((c) => `<button class="dot" data-bg="${TGColor.toRgb(c)}" data-copy="${copyId(swatchValue(c))}" title="${esc(swatchValue(c))}"></button>`).join('')}</div>`;
          if (variables.length) {
            all += `<div class="label">CSS variables</div><div class="vars">${variables.map((v) => `
              <button class="var" data-copy="${copyId(swatchValue(v))}" title="Copy ${esc(swatchValue(v))}">
                <span class="dot" data-bg="${TGColor.toRgb(v)}"></span><span class="name">${esc(v.name)}</span><span class="val">${esc(swatchValue(v))}</span>
              </button>`).join('')}</div>`;
          }
        }
      }

      return `
        <button class="btn big primary" data-act="eyedropper">${I.eyedropper}<span>Pick a colour</span></button>
        ${recent}
        <div class="label"><span>Brand colours</span>${seg}</div>
        ${brand}
        ${all}`;
    }

    async function eyedropper() {
      if (!('EyeDropper' in window)) { toast('The eyedropper needs Chrome 95 or newer'); return; }
      host.style.visibility = 'hidden';
      let picked = null;
      try {
        const { sRGBHex } = await new EyeDropper().open();
        picked = TGColor.parse(sRGBHex);
      } catch { /* cancelled */ }
      host.style.visibility = '';
      if (!picked) return;
      s.recent = [picked, ...s.recent.filter((c) => TGColor.toHex(c) !== TGColor.toHex(picked))].slice(0, MAX_RECENT);
      chrome.storage.local.set({ recentPicks: s.recent });
      render();
      send('text', swatchValue(picked));
    }

    // ---------- SVG ----------

    function viewSvg() {
      const cur = s.current;
      let top;
      if (!cur) {
        top = `<div class="hint"><div class="art">${I.pointer}</div>
          <b>${s.svgCount ? `${s.svgCount} ${s.svgCount === 1 ? 'SVG' : 'SVGs'} on this page` : 'Point at any icon or illustration'}</b>
          <span>${s.svgCount ? 'Every one is outlined. Click one to grab it.' : 'Click it on the page to grab the real SVG.'}</span></div>`;
      } else if (cur.error) {
        top = `<div class="preview checker"><div class="none">This SVG lives on another site,<br>so the browser won’t hand it over.</div></div>
          ${cur.url ? `<div class="actions"><button class="btn" data-copy="${copyId(cur.url)}">${I.copy} Copy its link</button></div>` : ''}`;
      } else {
        const idx = s.grabs.indexOf(cur);
        const size = cur.w && cur.h ? `${Math.round(cur.w)}×${Math.round(cur.h)}` : '';
        top = `<div class="preview checker"><div class="art-svg" data-svg="${idx}"></div></div>
          <div class="pmeta"><b>${esc(cur.name || cur.kind)}</b><span>${[cur.name ? cur.kind : '', size, `${Math.max(1, Math.round(cur.bytes / 1024))} KB`].filter(Boolean).join(' · ')}</span></div>
          <div class="actions">
            <button class="btn primary" data-act="svg-send">${connected() ? 'Send to Tucket' : `${I.copy} Copy SVG`}</button>
            <button class="btn" data-act="svg-download">${I.download} Download</button>
          </div>
          <p class="note">${s.svgCount > 1 ? `${s.svgCount - 1} more outlined on the page — click any of them.` : 'Keep pointing — click another to grab it.'}</p>`;
      }
      const strip = s.grabs.length > 1 ? `<div class="label">Grabbed here</div>
        <div class="strip">${s.grabs.map((g, i) => `<button class="thumb checker" data-grab="${i}" title="${esc(g.name || g.kind)}"><div class="art-svg" data-svg="${i}"></div></button>`).join('')}</div>` : '';
      return top + strip;
    }

    async function grabSvg(t) {
      const result = await tg.svgs.grab(t);
      if (result.error) {
        s.current = result;
        render();
        toast('Can’t read that one — it’s on another site');
        return;
      }
      const existing = s.grabs.find((g) => g.markup === result.markup);
      const item = existing || result;
      if (!existing) s.grabs = [item, ...s.grabs].slice(0, MAX_GRABS);
      s.current = item;
      render();
      send('svg', item.markup);
    }

    // ---------- footer ----------

    function viewFoot() {
      if (s.status.state === 'connected') return `<span class="dot-on"></span><span>Connected to Tucket ${esc(s.status.version || '')}</span>`;
      if (s.status.state === 'checking') return '<span>&nbsp;</span>';
      if (!isMac()) return '<span>Everything here copies and downloads.</span>';
      return `<span>Everything you grab can land in Tucket.</span><a href="${CTA}" target="_blank" rel="noopener">Get Tucket →</a>`;
    }

    // ---------- pick modes on the page ----------

    const mode = () => (capturing ? null : s.tab === 'svg' ? 'svg' : s.tab === 'font' && s.inspect ? 'font' : null);
    const inHost = (e) => e.composedPath().includes(host);

    function textTarget(el) {
      for (let node = el, depth = 0; node && depth < 5; node = node.parentElement, depth++) {
        if (node === document.body || node === document.documentElement) return null;
        for (const n of node.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return { el: node, type: 'text' };
      }
      return null;
    }

    // Every SVG on the page outlined at once, so it's obvious what can be grabbed.
    function drawGhosts() {
      if (s.tab !== 'svg' || capturing) return clearGhosts();
      const rects = tg.svgs.rects();
      while (ghosts.children.length < rects.length) ghosts.append(document.createElement('div'));
      while (ghosts.children.length > rects.length) ghosts.lastChild.remove();
      ghosts.hidden = rects.length === 0;
      rects.forEach((r, i) => {
        const box = ghosts.children[i];
        box.className = 'ghost';
        box.hidden = !r.on;
        if (!r.on) return;
        Object.assign(box.style, { left: `${r.x - 3}px`, top: `${r.y - 3}px`, width: `${r.w + 6}px`, height: `${r.h + 6}px` });
      });
    }

    function clearGhosts() {
      ghosts.replaceChildren();
      ghosts.hidden = true;
    }

    function clearTarget() {
      target = null;
      outline.hidden = tag.hidden = tip.hidden = true;
    }

    function drawTarget() {
      if (!target || !target.el.isConnected) { clearTarget(); return; }
      const r = target.el.getBoundingClientRect();
      outline.hidden = false;
      Object.assign(outline.style, { left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
      if (target.type === 'text') {
        tag.hidden = true;
        const cs = getComputedStyle(target.el);
        const resolved = TGFonts.resolve(cs.fontFamily);
        tip.innerHTML = `<b>${esc(resolved.family)}</b><div class="line">${esc(TGFonts.line(cs, resolved.family))}</div>
          <dl><dt>Size</dt><dd>${esc(cs.fontSize)}</dd><dt>Weight</dt><dd>${esc(cs.fontWeight)}${cs.fontStyle !== 'normal' ? ` ${esc(cs.fontStyle)}` : ''}</dd>
          <dt>Line height</dt><dd>${esc(cs.lineHeight)}</dd><dt>Letter spacing</dt><dd>${esc(cs.letterSpacing)}</dd></dl>
          <div class="foot-hint">Click to copy the style</div>`;
        tip.hidden = false;
        const tr = tip.getBoundingClientRect();
        let x = (pointer?.x ?? r.left) + 16;
        let y = (pointer?.y ?? r.bottom) + 18;
        if (x + tr.width > innerWidth - 8) x = (pointer?.x ?? r.right) - tr.width - 16;
        if (y + tr.height > innerHeight - 8) y = (pointer?.y ?? r.top) - tr.height - 14;
        Object.assign(tip.style, { left: `${Math.max(8, x)}px`, top: `${Math.max(8, y)}px` });
      } else {
        tip.hidden = true;
        tag.textContent = tg.svgs.describeTarget(target);
        tag.hidden = false;
        const top = r.top > 36 ? r.top - 34 : r.bottom + 8;
        Object.assign(tag.style, { left: `${Math.max(8, Math.min(r.left, innerWidth - 160))}px`, top: `${Math.min(top, innerHeight - 30)}px` });
      }
    }

    function findTarget(el) {
      const m = mode();
      if (m === 'svg') return tg.svgs.targetAt(el);
      if (m === 'font') return textTarget(el);
      return null;
    }

    function onMove(e) {
      if (!mode()) return;
      pointer = { x: e.clientX, y: e.clientY };
      if (inHost(e)) { clearTarget(); return; }
      const el = e.composedPath()[0];
      target = el instanceof Element ? findTarget(el) : null;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(drawTarget);
    }

    // While a pick mode is aiming at something, the page mustn't also react (links around icons).
    function swallow(e) {
      if (!mode() || !target || inHost(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }

    function onPageClick(e) {
      if (!mode() || !target || inHost(e)) return;
      swallow(e);
      const t = target;
      if (t.type === 'text') {
        const cs = getComputedStyle(t.el);
        send('text', TGFonts.line(cs, TGFonts.resolve(cs.fontFamily).family));
      } else {
        grabSvg(t);
      }
    }

    function onScroll() {
      if (!target) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (pointer) {
          const el = document.elementFromPoint(pointer.x, pointer.y);
          target = el ? findTarget(el) : null;
        }
        drawTarget();
        drawGhosts();
      });
    }

    function onKey(e) {
      if (e.key !== 'Escape' || capturing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (s.inspect) { s.inspect = false; clearTarget(); render(); return; }
      destroy();
    }

    // ---------- panel events ----------

    shadow.addEventListener('click', (e) => {
      const btn = e.target.closest('button, a');
      if (!btn || btn.localName === 'a') return;
      if (btn.dataset.tab) return select(btn.dataset.tab);
      if (btn.dataset.copy != null) return send('text', copies[+btn.dataset.copy]);
      if (btn.dataset.shot) return startShot(btn.dataset.shot);
      if (btn.dataset.format) return chrome.storage.local.set({ colorFormat: btn.dataset.format });
      if (btn.dataset.grab) { s.current = s.grabs[+btn.dataset.grab]; return render(); }
      switch (btn.dataset.act) {
        case 'close': return destroy();
        case 'inspect': s.inspect = !s.inspect; clearTarget(); return render();
        case 'all': s.showAll = !s.showAll; return render();
        case 'eyedropper': return eyedropper();
        case 'svg-send': return s.current?.markup && send('svg', s.current.markup);
        case 'svg-download': {
          const c = s.current;
          if (!c?.markup) return;
          let host = 'page';
          try { host = location.hostname.replace(/^www\./, ''); } catch { /* keep */ }
          const name = `${host}-${(c.name || c.kind).toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'svg'}.svg`;
          return download(name, new Blob([c.markup], { type: 'image/svg+xml' }));
        }
      }
    });

    // Drag by the header; remember where it was left, per site.
    $('.head').addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const start = panel.getBoundingClientRect();
      const dx = e.clientX - start.left, dy = e.clientY - start.top;
      const head = e.currentTarget;
      head.setPointerCapture(e.pointerId);
      const move = (ev) => place(ev.clientX - dx, ev.clientY - dy);
      const up = () => {
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
        const r = panel.getBoundingClientRect();
        chrome.storage.local.get('panelPos').then(({ panelPos = {} }) => {
          panelPos[location.origin] = { left: Math.round(r.left), top: Math.round(r.top) };
          chrome.storage.local.set({ panelPos });
        });
      };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
    });

    const blocked = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'auxclick'];
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('click', onPageClick, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll, true);
    blocked.forEach((t) => window.addEventListener(t, swallow, true));

    // ---------- capture visibility ----------

    function hideForCapture() {
      capturing = true;
      clearTarget();
      clearGhosts();
      host.style.display = 'none';
    }
    function showAfterCapture() {
      capturing = false;
      host.style.display = '';
      drawGhosts();
    }

    function onProgress(p) {
      if (!['done', 'error', 'cancelled'].includes(p.phase)) return;
      showAfterCapture();
      s.shotError = p.phase === 'error' ? p.message : null;
      render();
    }

    function destroy() {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('click', onPageClick, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll, true);
      blocked.forEach((t) => window.removeEventListener(t, swallow, true));
      try { chrome.storage.onChanged.removeListener(onStorage); } catch { /* extension reloaded */ }
      host.remove();
      ui = null;
    }

    refreshStatus();
    render();

    return { destroy, onProgress, hideForCapture, showAfterCapture, select, refreshStatus };
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'shot:progress') ui?.onProgress(msg.progress);
    if (msg?.type === 'panel:status') ui?.refreshStatus();
  });

  tg.panel = {
    open(opts = {}) {
      ui ||= create();
      if (opts.tab) ui.select(opts.tab);
      return true;
    },
    close() { ui?.destroy(); },
    toggle() {
      if (ui) { ui.destroy(); return false; }
      ui = create();
      return true;
    },
    isOpen: () => !!ui,
    hideForCapture() { ui?.hideForCapture(); },
  };
})();
