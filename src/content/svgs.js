// SVG finder and serialiser. Finds inline <svg>, sprite <symbol>s, <img src="*.svg">,
// CSS url(*.svg) backgrounds and <object>/<embed>, and turns each into standalone markup that
// looks the same outside the page: computed styles baked in, currentColor resolved, <use>
// references inlined, out-of-tree defs copied in, a viewBox guaranteed, page-only ids removed.
// Injected after shared/color.js. Exposes __tg.svgs.scan() and __tg.svgs.highlight(id).
(() => {
  const tg = (globalThis.__tg ??= {});
  if (tg.svgs) return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XLINK_NS = 'http://www.w3.org/1999/xlink';
  const MAX_ITEMS = 300;
  const MAX_BYTES = 2_000_000;
  const MAX_CSS_ELEMENTS = 6000;
  const FETCH_TIMEOUT_MS = 6000;

  // [property, initial value, inherited]. Written as attributes when they differ from what the
  // element would get anyway (its parent's value, or the initial value), or when the source
  // set them explicitly — which is how currentColor gets resolved.
  const PAINT_PROPS = [
    ['fill', 'rgb(0, 0, 0)', true], ['fill-opacity', '1', true], ['fill-rule', 'nonzero', true],
    ['stroke', 'none', true], ['stroke-opacity', '1', true], ['stroke-width', '1px', true],
    ['stroke-linecap', 'butt', true], ['stroke-linejoin', 'miter', true], ['stroke-miterlimit', '4', true],
    ['stroke-dasharray', 'none', true], ['stroke-dashoffset', '0px', true], ['clip-rule', 'nonzero', true],
    ['stop-color', 'rgb(0, 0, 0)', false], ['stop-opacity', '1', false],
    ['flood-color', 'rgb(0, 0, 0)', false], ['flood-opacity', '1', false],
    ['opacity', '1', false], ['visibility', 'visible', true], ['paint-order', 'normal', true],
    ['vector-effect', 'none', false], ['mix-blend-mode', 'normal', false],
  ];
  const TEXT_PROPS = [
    ['font-family', '', true], ['font-size', '', true], ['font-weight', '400', true],
    ['font-style', 'normal', true], ['letter-spacing', 'normal', true],
    ['text-anchor', 'start', true], ['dominant-baseline', 'auto', true],
  ];
  const TEXT_ELEMENTS = new Set(['text', 'tspan', 'textPath']);
  const OPACITY_OF = { fill: 'fill-opacity', stroke: 'stroke-opacity', 'stop-color': 'stop-opacity', 'flood-color': 'flood-opacity' };
  const BAKED = new Set([...PAINT_PROPS, ...TEXT_PROPS].map(([p]) => p));
  const COLOUR_ATTRS = ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'color'];

  const elements = new Map(); // item id → page element, for highlight()
  const round = (n) => Math.round(n * 100) / 100;

  // ---------- baking computed styles ----------

  function paint(value, alphaOut, opacityProp) {
    if (/^url\(/i.test(value)) {
      const m = value.match(/#([^"')\s]+)/);
      const rest = value.slice(value.indexOf(')') + 1).trim();
      return m ? `url(#${m[1]})${rest ? ` ${rest}` : ''}` : value;
    }
    const c = TGColor.parse(value);
    if (!c) return value;
    if (c.a < 1 && opacityProp) alphaOut[opacityProp] = c.a;
    return TGColor.toHex({ ...c, a: 1 });
  }

  function bake(src, dst) {
    const srcEls = [src, ...src.querySelectorAll('*')];
    const dstEls = [dst, ...dst.querySelectorAll('*')];
    if (srcEls.length !== dstEls.length) return;
    const styles = new Map();

    srcEls.forEach((s, i) => {
      const d = dstEls[i];
      if (!(s instanceof SVGElement)) return;
      const cs = getComputedStyle(s);
      styles.set(s, cs);
      const parent = s === src ? null : styles.get(s.parentElement);
      const props = TEXT_ELEMENTS.has(s.localName) ? PAINT_PROPS.concat(TEXT_PROPS) : PAINT_PROPS;
      const alpha = {};

      for (const [prop, initial, inherited] of props) {
        let v = cs.getPropertyValue(prop).trim();
        if (!v) continue;
        const explicit = s.hasAttribute(prop) || s.style.getPropertyValue(prop) !== '';
        const differs = inherited && parent ? v !== parent.getPropertyValue(prop).trim() : v !== initial;
        const textFont = TEXT_ELEMENTS.has(s.localName) && (prop === 'font-family' || prop === 'font-size');
        const extra = alpha[prop];
        if (!explicit && !differs && !textFont && extra == null) continue;
        if (OPACITY_OF[prop]) v = paint(v, alpha, OPACITY_OF[prop]);
        if (extra != null) v = String(round(parseFloat(v) * extra));
        d.setAttribute(prop, v);
      }

      // Hidden by page CSS — keep it hidden standalone. Non-rendered containers are exempt.
      if (cs.display === 'none' && s !== src && !s.closest('defs, symbol, clipPath, mask, pattern, marker, linearGradient, radialGradient, filter')) {
        d.setAttribute('display', 'none');
      }
    });
  }

  // ---------- <use> inlining ----------

  const externalDocs = new Map();

  async function resolveRef(href, doc, base) {
    const hash = href.indexOf('#');
    if (hash < 0) return null;
    let id;
    try { id = decodeURIComponent(href.slice(hash + 1)); } catch { return null; }
    const path = href.slice(0, hash);
    const find = (d) => d.getElementById?.(id) || d.querySelector?.(`[id="${CSS.escape(id)}"]`);
    if (!path) return { el: find(doc), doc, base };
    let url;
    try { url = new URL(path, base); } catch { return null; }
    if (url.href === location.href.split('#')[0]) return { el: find(document), doc: document, base: document.baseURI };
    if (!externalDocs.has(url.href)) {
      const text = await fetchText(url.href);
      const parsed = text ? new DOMParser().parseFromString(text, 'image/svg+xml') : null;
      externalDocs.set(url.href, parsed && !parsed.querySelector('parsererror') ? parsed : null);
    }
    const ext = externalDocs.get(url.href);
    return ext ? { el: find(ext), doc: ext, base: url.href } : null;
  }

  function hrefOf(el) {
    return el.getAttribute('href') || el.getAttributeNS(XLINK_NS, 'href') || el.getAttribute('xlink:href');
  }

  function resolveCurrentColor(root, hex) {
    for (const el of [root, ...root.querySelectorAll('*')]) {
      for (const attr of COLOUR_ATTRS) {
        const v = el.getAttribute(attr);
        if (v && /currentcolor/i.test(v)) el.setAttribute(attr, v.replace(/currentcolor/gi, hex));
      }
      const style = el.getAttribute('style');
      if (style && /currentcolor/i.test(style)) el.setAttribute('style', style.replace(/currentcolor/gi, hex));
    }
  }

  async function replaceUse(use, colourHex, doc, base, depth) {
    const href = hrefOf(use);
    if (!href || depth > 4) return;
    const ref = await resolveRef(href, doc, base);
    if (!ref?.el) return;
    const owner = use.ownerDocument;
    const target = ref.el;

    // Outer <g> carries the <use>'s own presentation attributes and transform.
    const outer = owner.createElementNS(SVG_NS, 'g');
    for (const attr of [...use.attributes]) {
      if (['href', 'xlink:href', 'x', 'y', 'width', 'height', 'id'].includes(attr.name)) continue;
      outer.setAttribute(attr.name, attr.value);
    }
    const x = use.getAttribute('x') || '0';
    const y = use.getAttribute('y') || '0';
    let inner;
    if (target.localName === 'symbol' || target.localName === 'svg') {
      inner = owner.createElementNS(SVG_NS, 'svg');
      for (const a of ['viewBox', 'preserveAspectRatio']) if (target.hasAttribute(a)) inner.setAttribute(a, target.getAttribute(a));
      inner.setAttribute('x', x);
      inner.setAttribute('y', y);
      inner.setAttribute('width', use.getAttribute('width') || target.getAttribute('width') || '100%');
      inner.setAttribute('height', use.getAttribute('height') || target.getAttribute('height') || '100%');
      for (const child of target.childNodes) inner.appendChild(owner.importNode(child, true));
    } else {
      inner = owner.createElementNS(SVG_NS, 'g');
      if (x !== '0' || y !== '0') inner.setAttribute('transform', `translate(${x} ${y})`);
      const copy = owner.importNode(target, true);
      copy.removeAttribute('id');
      inner.appendChild(copy);
    }
    outer.appendChild(inner);
    resolveCurrentColor(inner, colourHex);
    use.replaceWith(outer);

    for (const nested of [...inner.querySelectorAll('use')]) {
      await replaceUse(nested, colourHex, ref.doc, ref.base, depth + 1);
    }
  }

  // ---------- defs, ids, cleanup ----------

  function referencedIds(root) {
    const ids = new Set();
    for (const el of [root, ...root.querySelectorAll('*')]) {
      for (const attr of el.attributes) {
        const v = attr.value;
        if (v.includes('url(')) for (const m of v.matchAll(/url\(\s*["']?#([^"')\s]+)/g)) ids.add(m[1]);
        if ((attr.localName === 'href') && v.startsWith('#')) ids.add(v.slice(1));
        if (attr.name === 'aria-labelledby' || attr.name === 'aria-describedby') v.split(/\s+/).forEach((id) => ids.add(id));
      }
    }
    return ids;
  }

  // Gradients, clip paths, masks and filters often live in a shared <svg> elsewhere on the page.
  function copyExternalDefs(root, doc) {
    let defs = null;
    for (let pass = 0; pass < 4; pass++) {
      let added = false;
      for (const id of referencedIds(root)) {
        if (root.querySelector(`[id="${CSS.escape(id)}"]`)) continue;
        const source = doc.getElementById(id);
        if (!source || !(source instanceof SVGElement) || source.contains(root)) continue;
        if (!defs) {
          defs = root.ownerDocument.createElementNS(SVG_NS, 'defs');
          root.insertBefore(defs, root.firstChild);
        }
        defs.appendChild(root.ownerDocument.importNode(source, true));
        added = true;
      }
      if (!added) break;
    }
  }

  function stripIds(root) {
    const keep = referencedIds(root);
    for (const el of root.querySelectorAll('[id]')) if (!keep.has(el.id)) el.removeAttribute('id');
    if (root.id && !keep.has(root.id)) root.removeAttribute('id');
  }

  function cleanup(root) {
    const ownStyles = root.querySelector('style') !== null;
    root.querySelectorAll('script').forEach((n) => n.remove());
    for (const el of [root, ...root.querySelectorAll('*')]) {
      for (const attr of [...el.attributes]) {
        const name = attr.name;
        if (name.startsWith('on') || name.startsWith('data-') || (name === 'class' && !ownStyles)) el.removeAttribute(name);
      }
      const style = el.getAttribute('style');
      if (style != null) {
        // Baked properties now live in attributes; drop them (and any var()) from the style.
        const kept = style.split(';').map((d) => d.trim()).filter((d) => {
          const prop = d.split(':')[0]?.trim().toLowerCase();
          return d && prop && !BAKED.has(prop) && !d.includes('var(') && prop !== 'color';
        });
        if (kept.length) el.setAttribute('style', kept.join('; '));
        else el.removeAttribute('style');
      }
    }
    for (const a of ['x', 'y', 'focusable', 'aria-hidden', 'tabindex']) root.removeAttribute(a);
  }

  const numeric = (v) => v != null && /^\s*[\d.]+(px)?\s*$/.test(v);

  function ensureGeometry(root, renderedW, renderedH) {
    const attrW = numeric(root.getAttribute('width')) ? parseFloat(root.getAttribute('width')) : null;
    const attrH = numeric(root.getAttribute('height')) ? parseFloat(root.getAttribute('height')) : null;
    if (!root.hasAttribute('viewBox')) {
      const w = attrW ?? renderedW;
      const h = attrH ?? renderedH;
      if (w > 0 && h > 0) root.setAttribute('viewBox', `0 0 ${round(w)} ${round(h)}`);
    }
    const vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    if (attrW == null) {
      const w = renderedW > 0 ? renderedW : vb[2];
      if (w > 0) root.setAttribute('width', round(w)); else root.removeAttribute('width');
    }
    if (attrH == null) {
      const h = renderedH > 0 ? renderedH : vb[3];
      if (h > 0) root.setAttribute('height', round(h)); else root.removeAttribute('height');
    }
  }

  const serializer = new XMLSerializer();

  async function serializeInline(svg) {
    const clone = svg.cloneNode(true);
    const srcUses = [...svg.querySelectorAll('use')];
    const dstUses = [...clone.querySelectorAll('use')];
    bake(svg, clone);
    const doc = svg.ownerDocument;
    for (let i = 0; i < dstUses.length; i++) {
      const colour = TGColor.parse(getComputedStyle(srcUses[i]).color);
      await replaceUse(dstUses[i], colour ? TGColor.toHex({ ...colour, a: 1 }) : '#000000', doc, doc.baseURI, 0);
    }
    const rootColour = TGColor.parse(getComputedStyle(svg).color);
    resolveCurrentColor(clone, rootColour ? TGColor.toHex({ ...rootColour, a: 1 }) : '#000000');
    const rect = svg.getBoundingClientRect();
    ensureGeometry(clone, rect.width, rect.height);
    copyExternalDefs(clone, doc);
    cleanup(clone);
    stripIds(clone);
    return serializer.serializeToString(clone);
  }

  async function serializeSymbol(symbol, sprite) {
    const out = document.createElementNS(SVG_NS, 'svg');
    for (const a of ['viewBox', 'preserveAspectRatio']) if (symbol.hasAttribute(a)) out.setAttribute(a, symbol.getAttribute(a));
    for (const child of symbol.childNodes) out.appendChild(child.cloneNode(true));
    const colour = TGColor.parse(getComputedStyle(sprite).color);
    const hex = colour ? TGColor.toHex({ ...colour, a: 1 }) : '#000000';
    for (const use of [...out.querySelectorAll('use')]) await replaceUse(use, hex, document, document.baseURI, 1);
    resolveCurrentColor(out, hex);
    const vb = (symbol.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    ensureGeometry(out, vb[2] || 0, vb[3] || 0);
    copyExternalDefs(out, document);
    cleanup(out);
    stripIds(out);
    return serializer.serializeToString(out);
  }

  // A standalone file already works on its own: only make it safe and give it a viewBox.
  function sanitizeFile(text) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.localName !== 'svg' || doc.querySelector('parsererror')) return null;
    root.querySelectorAll('script').forEach((n) => n.remove());
    for (const el of [root, ...root.querySelectorAll('*')]) {
      for (const attr of [...el.attributes]) if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
    }
    ensureGeometry(root, 0, 0);
    return serializer.serializeToString(root);
  }

  // ---------- fetching ----------

  async function fetchText(url) {
    try {
      if (url.startsWith('data:')) {
        const comma = url.indexOf(',');
        const meta = url.slice(5, comma);
        const body = url.slice(comma + 1);
        if (meta.includes(';base64')) return new TextDecoder().decode(Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0)));
        return decodeURIComponent(body);
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      const sameOrigin = new URL(url).origin === location.origin;
      const res = await fetch(url, { signal: ctrl.signal, credentials: sameOrigin ? 'include' : 'omit' });
      clearTimeout(timer);
      if (!res.ok) return null;
      const text = await res.text();
      return text.length > MAX_BYTES ? null : text;
    } catch {
      return null;
    }
  }

  function isSvgUrl(u) {
    if (!u) return false;
    if (/^data:image\/svg\+xml/i.test(u)) return true;
    try { return new URL(u, document.baseURI).pathname.toLowerCase().endsWith('.svg'); } catch { return false; }
  }

  async function pool(tasks, size, worker) {
    let next = 0;
    const run = async () => { while (next < tasks.length) await worker(tasks[next++]); };
    await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, run));
  }

  // ---------- scan ----------

  function isSpriteSheet(svg) {
    const kids = [...svg.children];
    return kids.length > 0 && kids.every((k) => ['defs', 'symbol', 'style', 'title', 'desc'].includes(k.localName));
  }

  async function scan() {
    elements.clear();
    const items = [];
    const byMarkup = new Map();
    let n = 0;

    const push = (item, el) => {
      const dedupeKey = item.markup || `url:${item.url}`;
      const existing = byMarkup.get(dedupeKey);
      if (existing) { existing.instances++; return; }
      if (items.length >= MAX_ITEMS) return;
      item.id = `svg${n++}`;
      item.instances = 1;
      item.bytes = item.markup ? new Blob([item.markup]).size : 0;
      byMarkup.set(dedupeKey, item);
      if (el) elements.set(item.id, el);
      items.push(item);
    };

    // Inline <svg> and sprite sheets.
    for (const svg of document.querySelectorAll('svg')) {
      if (items.length >= MAX_ITEMS) break;
      if (svg.parentElement?.closest('svg')) continue;
      const rect = svg.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0 && getComputedStyle(svg).visibility !== 'hidden';
      const symbols = svg.querySelectorAll('symbol[id]');
      if (symbols.length && (!visible || isSpriteSheet(svg))) {
        for (const symbol of symbols) {
          try { push({ source: 'Sprite symbol', name: symbol.id, markup: await serializeSymbol(symbol, svg) }, null); } catch { /* skip */ }
        }
        continue;
      }
      if (!visible || isSpriteSheet(svg)) continue;
      try { push({ source: 'Inline SVG', markup: await serializeInline(svg) }, svg); } catch { /* skip */ }
    }

    // Files: <img>, <object>/<embed>, CSS url(). Fetched with the page's own origin.
    const files = new Map();
    const addFile = (url, el, source) => {
      let abs;
      try { abs = new URL(url, document.baseURI).href; } catch { return; }
      if (!files.has(abs)) files.set(abs, { url: abs, el, source, instances: 0 });
      files.get(abs).instances++;
    };

    for (const img of document.images) {
      const src = img.currentSrc || img.src;
      if (isSvgUrl(src)) addFile(src, img, 'Image');
    }
    for (const el of document.querySelectorAll('object, embed')) {
      const src = el.data || el.src || el.getAttribute('data') || el.getAttribute('src');
      if (!isSvgUrl(src) && el.type !== 'image/svg+xml') continue;
      let root = null;
      try { root = el.contentDocument?.documentElement; } catch { root = null; }
      if (root?.localName === 'svg') {
        try { push({ source: 'Embedded SVG', markup: await serializeInline(root) }, el); continue; } catch { /* fall through */ }
      }
      if (src) addFile(src, el, 'Embedded SVG');
    }

    const all = document.body ? document.body.getElementsByTagName('*') : [];
    let checked = 0;
    for (const el of all) {
      if (checked++ >= MAX_CSS_ELEMENTS) break;
      for (const pseudo of [null, '::before', '::after']) {
        const cs = getComputedStyle(el, pseudo);
        if (pseudo && cs.content === 'none') continue;
        for (const value of [cs.backgroundImage, cs.maskImage, cs.webkitMaskImage, cs.listStyleImage, pseudo ? cs.content : '']) {
          if (!value || !value.includes('url(')) continue;
          for (const m of value.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/g)) {
            if (isSvgUrl(m[2])) addFile(m[2], el, 'CSS background');
          }
        }
      }
    }

    await pool([...files.values()], 6, async (file) => {
      const text = await fetchText(file.url);
      const markup = text ? sanitizeFile(text) : null;
      const rect = file.el.getBoundingClientRect();
      const name = file.url.startsWith('data:') ? '' : decodeURIComponent(new URL(file.url).pathname.split('/').pop() || '').replace(/\.svg$/i, '');
      push({ source: file.source, name, url: file.url.startsWith('data:') ? null : file.url, markup, width: rect.width, height: rect.height }, file.el);
      const item = byMarkup.get(markup || `url:${file.url}`);
      if (item && file.instances > 1) item.instances += file.instances - 1;
    });

    return { items, total: items.length, capped: items.length >= MAX_ITEMS };
  }

  // ---------- pick mode: the SVG under the cursor ----------

  // Tucket's own icon rule (TucketCore/SVGIconDetector), so the label matches where the clip lands.
  const ICON_MAX_SIDE = 512;
  const ICON_ASPECT = [0.75, 1.34];
  const ICON_MAX_BYTES = 20_000;

  function geometry(markup) {
    const tag = markup.slice(0, markup.indexOf('>') + 1);
    const attr = (name) => tag.match(new RegExp(`\\s${name}=["']([^"']*)["']`))?.[1];
    const vb = attr('viewBox')?.split(/[\s,]+/).map(Number);
    if (vb?.length === 4 && vb[2] > 0 && vb[3] > 0) return { w: vb[2], h: vb[3] };
    const w = parseFloat(attr('width')), h = parseFloat(attr('height'));
    return w > 0 && h > 0 ? { w, h } : null;
  }

  function kindOf(markup, bytes) {
    const g = geometry(markup);
    if (!g || bytes > ICON_MAX_BYTES || Math.max(g.w, g.h) > ICON_MAX_SIDE) return 'SVG';
    const aspect = g.w / g.h;
    return aspect >= ICON_ASPECT[0] && aspect <= ICON_ASPECT[1] ? 'Icon' : 'SVG';
  }

  function cssSvgUrl(el) {
    for (const pseudo of [null, '::before', '::after']) {
      const cs = getComputedStyle(el, pseudo);
      if (pseudo && cs.content === 'none') continue;
      for (const value of [cs.backgroundImage, cs.maskImage, cs.webkitMaskImage, pseudo ? cs.content : '']) {
        if (!value || !value.includes('url(')) continue;
        for (const m of value.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/g)) if (isSvgUrl(m[2])) return m[2];
      }
    }
    return null;
  }

  /** The grabbable SVG at this element, climbing a few levels: { el, type, url? } or null. */
  function targetAt(start) {
    if (!(start instanceof Element)) return null;
    const svg = start.closest('svg');
    if (svg) {
      let root = svg;
      while (root.parentElement?.closest('svg')) root = root.parentElement.closest('svg');
      return { el: root, type: 'inline' };
    }
    let node = start;
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      if (node === document.body || node === document.documentElement) break;
      if (node.localName === 'img') {
        const src = node.currentSrc || node.src;
        if (isSvgUrl(src)) return { el: node, type: 'file', url: src };
      }
      if (node.localName === 'object' || node.localName === 'embed') {
        const src = node.data || node.src || node.getAttribute('data') || node.getAttribute('src');
        if (isSvgUrl(src) || node.type === 'image/svg+xml') return { el: node, type: 'object', url: src };
      }
      const url = cssSvgUrl(node);
      if (url) return { el: node, type: 'file', url };
    }
    return null;
  }

  /** Serialise a target from targetAt(). { markup, name, kind, w, h, bytes } or { error, url }. */
  async function grab(target) {
    let markup = null;
    let name = '';
    if (target.type === 'inline') {
      markup = await serializeInline(target.el);
      name = target.el.getAttribute('aria-label') || target.el.querySelector('title')?.textContent || '';
    } else {
      if (target.type === 'object') {
        let root = null;
        try { root = target.el.contentDocument?.documentElement; } catch { root = null; }
        if (root?.localName === 'svg') markup = await serializeInline(root);
      }
      if (!markup && target.url) {
        const abs = new URL(target.url, document.baseURI).href;
        const text = await fetchText(abs);
        markup = text ? sanitizeFile(text) : null;
        if (!abs.startsWith('data:')) {
          try { name = decodeURIComponent(new URL(abs).pathname.split('/').pop() || '').replace(/\.svg$/i, ''); } catch { /* keep */ }
        }
      }
      if (!markup) return { error: 'unreadable', url: target.url?.startsWith('data:') ? null : target.url };
    }
    const bytes = new Blob([markup]).size;
    const g = geometry(markup);
    return { markup, name: name.trim().slice(0, 60), kind: kindOf(markup, bytes), w: g?.w || 0, h: g?.h || 0, bytes };
  }

  /** Label for the hover outline, without serialising: "Icon · 24×24"-ish from the element. */
  function describeTarget(target) {
    const r = target.el.getBoundingClientRect();
    const vb = target.type === 'inline' ? target.el.viewBox?.baseVal : null;
    const w = vb?.width || r.width, h = vb?.height || r.height;
    const aspect = w / h;
    const icon = Math.max(w, h) <= ICON_MAX_SIDE && aspect >= ICON_ASPECT[0] && aspect <= ICON_ASPECT[1];
    return `${icon ? 'Icon' : 'SVG'} · ${Math.round(w)}×${Math.round(h)}`;
  }

  // ---------- highlight ----------

  let box = null;
  let timer = 0;

  function highlight(id) {
    clearTimeout(timer);
    const el = id ? elements.get(id) : null;
    if (!el || !el.isConnected) {
      box?.remove();
      box = null;
      return false;
    }
    let rect = el.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight) {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      rect = el.getBoundingClientRect();
    }
    if (!box) {
      box = document.createElement('tucket-grab-highlight');
      box.style.cssText = 'all:initial;position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;'
        + 'border:2px solid #6C6CF8;background:rgba(108,108,248,.14);border-radius:4px;'
        + 'box-shadow:0 0 0 100vmax rgba(15,15,25,.28);transition:left .1s,top .1s,width .1s,height .1s;';
      document.documentElement.appendChild(box);
    }
    Object.assign(box.style, {
      left: `${rect.left - 4}px`, top: `${rect.top - 4}px`,
      width: `${rect.width + 8}px`, height: `${rect.height + 8}px`,
    });
    // The popup can close without saying goodbye; never leave the page dimmed.
    timer = setTimeout(() => highlight(null), 4000);
    return true;
  }

  tg.svgs = { scan, highlight, targetAt, grab, describeTarget };
})();
