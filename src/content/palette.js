// Page palette. Every colour in use, weighted by how much of the page it visibly covers, and the
// page's three key colours:
//   Primary   — the most-used colour (usually the background, and that's the honest answer)
//   Secondary — the call-to-action colour, read off the page's main buttons (black counts)
//   Tertiary  — the next most-used colour that looks clearly different from those two
// Plus colour-valued CSS custom properties. Injected after shared/color.js.
// Exposes __tg.palette.scan().
(() => {
  const tg = (globalThis.__tg ??= {});
  if (tg.palette) return;

  const MAX_ELEMENTS = 6000;
  const MAX_COLOURS = 200;
  const MAX_VARIABLES = 400;
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta', 'head', 'title', 'tucket-grab', 'tucket-grab-highlight']);
  // Not <use>: its own fill is the black default; what paints is the referenced shape.
  const SHAPES = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan']);
  const COLOUR_FN_RE = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*(?:\([^()]*\)[^()]*)*\)|#[0-9a-f]{3,8}\b/gi;
  // Design systems often store bare channels in variables: "240 91% 70%" (shadcn) or "108 108 248".
  const HSL_TRIPLE = /^(-?[\d.]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%$/;
  const RGB_TRIPLE = /^([\d.]+)\s+([\d.]+)\s+([\d.]+)$/;
  const NOT_COLOURS = new Set(['inherit', 'initial', 'unset', 'revert', 'currentcolor', 'transparent', 'none']);

  const MERGE_DELTA_E = 12;   // CIE76; closer than this, two colours read as the same one
  const TEXT_INK = 0.12;      // share of a text line's box that glyphs actually paint

  // A call to action looks like a button, says an action, and sits where people look.
  const ACTION_WORDS = /\b(get started|start|sign ?up|join|try|buy|shop|order|subscribe|book|download|install|register|create|contact|request|demo|free|continue|upgrade|pricing|apply|donate|add to (cart|bag)|checkout|get)\b/i;
  const NOT_CTA_WORDS = /\b(accept|reject|decline|cookies?|dismiss|close|cancel|manage preferences)\b/i;
  const CONSENT_UI = '[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[aria-label*="cookie" i]';

  function ownText(el) {
    let n = 0;
    for (const node of el.childNodes) if (node.nodeType === 3) n += node.textContent.trim().length;
    return n;
  }

  // ---------- colour maths ----------

  function lab({ r, g, b }) {
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const R = lin(r), G = lin(g), B = lin(b);
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
    const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
    const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }
  const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // Ranks by score, folding near-duplicates into whichever ranked first, and skipping anything
  // that reads the same as a colour already taken.
  function pickDistinct(list, limit, score, taken = []) {
    const out = [];
    for (const c of [...list].sort((a, b) => score(b) - score(a))) {
      const L = lab(c);
      if (taken.some((t) => deltaE(t.lab, L) < MERGE_DELTA_E)) continue;
      const twin = out.find((o) => deltaE(o.lab, L) < MERGE_DELTA_E);
      if (twin) { twin.merged += score(c); continue; }
      out.push({ ...c, lab: L, merged: score(c) });
    }
    return out.sort((a, b) => b.merged - a.merged).slice(0, limit);
  }

  // ---------- scan ----------

  function scan() {
    const counts = new Map();
    const add = (c, weight, seen) => {
      if (!c || c.a === 0 || !(weight > 0)) return;
      const key = TGColor.toHex(c);
      if (seen) { if (seen.has(key)) return; seen.add(key); }
      const w = weight * c.a;
      const entry = counts.get(key);
      if (entry) { entry.count++; entry.weight += w; }
      else counts.set(key, { r: c.r, g: c.g, b: c.b, a: c.a, count: 1, weight: w });
    };
    const addValue = (value, weight, seen) => add(TGColor.parse(value), weight, seen);

    // Visible coverage: each painted box owns its area minus whatever painted boxes sit inside it,
    // so a page background hidden under full-width sections doesn't count as "most used".
    const docEl = document.documentElement;
    const body = document.body;
    const docArea = Math.max(docEl.scrollWidth, innerWidth) * Math.max(docEl.scrollHeight, body?.scrollHeight || 0, innerHeight);
    const htmlBg = TGColor.parse(getComputedStyle(docEl).backgroundColor);
    const bodyBg = body ? TGColor.parse(getComputedStyle(body).backgroundColor) : null;
    // CSS paints the canvas with html's background, or body's if html has none, or white.
    const canvasColour = htmlBg?.a > 0 ? htmlBg : bodyBg?.a > 0 ? bodyBg : { r: 255, g: 255, b: 255, a: 1 };
    const rootBox = { colours: [canvasColour], area: docArea };
    const boxes = [rootBox];
    const painted = new Map();
    if (body && htmlBg?.a > 0 && bodyBg?.a > 0) {
      const r = body.getBoundingClientRect();
      const box = { colours: [bodyBg], area: r.width * r.height };
      rootBox.area = Math.max(0, rootBox.area - box.area);
      boxes.push(box);
      painted.set(body, box);
    }
    const behindOf = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) if (painted.has(p)) return painted.get(p);
      return rootBox;
    };

    const buttons = [];
    const all = body ? body.getElementsByTagName('*') : [];
    let scanned = 0;
    for (const el of all) {
      if (scanned >= MAX_ELEMENTS) break;
      if (SKIP.has(el.localName)) continue;
      scanned++;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      const seen = new Set();

      const bg = TGColor.parse(cs.backgroundColor);
      const stops = cs.backgroundImage && cs.backgroundImage !== 'none' ? (cs.backgroundImage.match(COLOUR_FN_RE) || []).map((s) => TGColor.parse(s)).filter(Boolean) : [];
      if ((bg && bg.a > 0) || stops.length) {
        const behind = behindOf(el);
        const box = { colours: stops.length ? stops : [bg], area };
        behind.area = Math.max(0, behind.area - area);
        boxes.push(box);
        painted.set(el, box);
      }

      const chars = ownText(el);
      if (chars) {
        const size = parseFloat(cs.fontSize) || 16;
        addValue(cs.color, chars * size * size * TEXT_INK, seen);
      }
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        const width = parseFloat(cs[`border${side}Width`]);
        if (width > 0 && cs[`border${side}Style`] !== 'none') {
          addValue(cs[`border${side}Color`], width * (side === 'Top' || side === 'Bottom' ? r.width : r.height), seen);
        }
      }
      if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) addValue(cs.outlineColor, parseFloat(cs.outlineWidth) * (r.width + r.height) * 2, seen);
      if (SHAPES.has(el.localName)) {
        if (cs.fill && cs.fill !== 'none' && !cs.fill.startsWith('url')) addValue(cs.fill, area * 0.6, seen);
        if (cs.stroke && cs.stroke !== 'none' && !cs.stroke.startsWith('url')) addValue(cs.stroke, (r.width + r.height) * 2 * (parseFloat(cs.strokeWidth) || 1), seen);
      }
      for (const prop of ['boxShadow', 'textShadow']) {
        const v = cs[prop];
        if (v && v !== 'none') for (const m of v.match(COLOUR_FN_RE) || []) addValue(m, 40, seen);
      }

      if (isButtonLike(el, cs)) {
        const candidate = ctaCandidate(el, cs, r, behindOf);
        if (candidate) buttons.push(candidate);
      }
    }

    for (const box of boxes) {
      const share = box.area / box.colours.length;
      for (const c of box.colours) add(c, share);
    }

    const { variables, blockedSheets } = scanVariables();
    const colours = [...counts.values()].sort((a, b) => b.weight - a.weight);
    return {
      brand: roles(colours, buttons),
      colours: colours.slice(0, MAX_COLOURS),
      totalColours: colours.length,
      buttons: buttons.length,
      variables,
      blockedSheets,
      scanned,
      truncated: all.length > scanned,
    };
  }

  // ---------- call to action ----------

  function isButtonLike(el, cs) {
    const tag = el.localName;
    if (tag === 'button' || el.getAttribute('role') === 'button') return true;
    if (tag === 'input') return /^(submit|button)$/i.test(el.type);
    if (tag === 'a') {
      // Links styled as buttons: laid out as a box (many size buttons by height, not padding),
      // or inline with real padding on both axes.
      if (cs.display !== 'inline') return true;
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      return padX >= 16 && padY >= 6;
    }
    return false;
  }

  // The colour a button shows. Many design systems paint it on an inner <span> that fills the
  // button, so if the element itself is unpainted, look at a child covering most of it.
  function paintedColour(el, cs, r) {
    const own = buttonColour(cs);
    if (own) return own;
    for (const child of el.children) {
      const cr = child.getBoundingClientRect();
      if (cr.width * cr.height < r.width * r.height * 0.8) continue;
      const inner = buttonColour(getComputedStyle(child));
      if (inner) return inner;
    }
    return null;
  }

  // Fill, a gradient's first stop, or for an outline button its border.
  function buttonColour(cs) {
    const bg = TGColor.parse(cs.backgroundColor);
    if (bg && bg.a >= 0.5) return { c: bg, outline: false };
    if (cs.backgroundImage && cs.backgroundImage !== 'none') {
      const stop = TGColor.parse((cs.backgroundImage.match(COLOUR_FN_RE) || [])[0]);
      if (stop && stop.a >= 0.5) return { c: stop, outline: false };
    }
    if (parseFloat(cs.borderTopWidth) >= 1 && cs.borderTopStyle !== 'none') {
      const border = TGColor.parse(cs.borderTopColor);
      if (border && border.a >= 0.5) return { c: border, outline: true };
    }
    return null;
  }

  function ctaCandidate(el, cs, r, behindOf) {
    if (r.width < 56 || r.width > 720 || r.height < 24 || r.height > 110) return null;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return null;
    if (el.closest(CONSENT_UI)) return null;
    const label = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 80);
    if (!label || NOT_CTA_WORDS.test(label)) return null;
    const colour = paintedColour(el, cs, r);
    if (!colour) return null;
    // It has to stand out from what's behind it, or it isn't a call to action.
    const behind = behindOf(el).colours[0];
    if (deltaE(lab(colour.c), lab(behind)) < MERGE_DELTA_E) return null;

    const aboveFold = r.top + scrollY < innerHeight;
    const score = Math.sqrt(r.width * r.height)
      * (aboveFold ? 2 : 1)
      * (ACTION_WORDS.test(label) ? 2 : 1)
      * (colour.outline ? 0.4 : 1);
    return { ...colour.c, score, label };
  }

  // ---------- roles ----------

  function roles(colours, buttons) {
    const opaque = colours.filter((c) => c.a >= 0.5);
    if (!opaque.length) return [];
    const byWeight = (c) => c.weight;

    const primary = pickDistinct(opaque, 1, byWeight)[0];
    const out = [{ ...primary, role: 'Primary', note: 'Most used' }];

    // Buttons of the same colour add up: consistency is what makes a colour the CTA.
    const cta = pickDistinct(buttons, 1, (b) => b.score, out)[0];
    if (cta) out.push({ ...cta, role: 'Secondary', note: 'Buttons', cta: true });

    const rest = pickDistinct(opaque, 3 - out.length, byWeight, out);
    for (const c of rest) {
      const role = out.length === 1 ? 'Secondary' : 'Tertiary';
      out.push({ ...c, role, note: role === 'Secondary' ? 'Second most used' : 'Third most used' });
    }
    return out.map(({ r, g, b, a, role, note, cta: isCta }) => ({ r, g, b, a, role, note, cta: !!isCta }));
  }

  // ---------- CSS variables ----------

  function variableColour(value) {
    const v = value.trim();
    if (!v || NOT_COLOURS.has(v.toLowerCase()) || v.includes('var(')) return null;
    let m = v.match(HSL_TRIPLE);
    if (m) return TGColor.parse(`hsl(${m[1]}, ${m[2]}%, ${m[3]}%)`);
    m = v.match(RGB_TRIPLE);
    if (m && [m[1], m[2], m[3]].every((n) => +n <= 255)) return TGColor.parse(`rgb(${m[1]}, ${m[2]}, ${m[3]})`);
    if (!CSS.supports('color', v)) return null;
    return TGColor.parse(v);
  }

  function scanVariables() {
    const found = new Map();
    const rootStyle = getComputedStyle(document.documentElement);
    let blockedSheets = 0;

    const visit = (rules) => {
      for (const rule of rules) {
        if (found.size >= MAX_VARIABLES) return;
        const style = rule.style;
        if (style) {
          for (let i = 0; i < style.length; i++) {
            const name = style[i];
            if (!name.startsWith('--') || found.has(name)) continue;
            // Prefer the resolved value on :root (var() chains substituted); fall back to the literal.
            const resolved = rootStyle.getPropertyValue(name).trim();
            const raw = style.getPropertyValue(name).trim();
            const c = variableColour(resolved || raw);
            if (c && c.a > 0) found.set(name, { name, value: resolved || raw, ...c });
          }
        }
        if (rule.cssRules) visit(rule.cssRules);
      }
    };

    const sheets = [...document.styleSheets, ...(document.adoptedStyleSheets || [])];
    for (const sheet of sheets) {
      try { visit(sheet.cssRules); } catch { blockedSheets++; }
    }
    return { variables: [...found.values()], blockedSheets };
  }

  tg.palette = { scan };
})();
