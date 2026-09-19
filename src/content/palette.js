// Page palette: every colour in use, weighted by how much of the page it paints, plus the page's
// brand colours (primary, secondary, tertiary) and colour-valued CSS custom properties.
// Injected after shared/color.js. Exposes __tg.palette.scan().
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

  // Brand colours: what's left after dropping the neutrals, with near-duplicates merged.
  const MIN_CHROMA = 0.1;        // (max − min) channel spread; below this reads as grey
  const MIN_SATURATION = 0.12;
  const MIN_LIGHTNESS = 0.07;
  const MAX_LIGHTNESS = 0.95;
  // Pale tints (section backgrounds) paint a lot but are rarely what anyone means by the brand;
  // they're a second tier, used only when the page has fewer than three stronger colours.
  const PALE_LIGHTNESS = 0.9;
  const MERGE_DELTA_E = 12;      // CIE76; below this two colours read as the same one
  const ROLES = ['Primary', 'Secondary', 'Tertiary'];

  function ownText(el) {
    let n = 0;
    for (const node of el.childNodes) if (node.nodeType === 3) n += node.textContent.trim().length;
    return n;
  }

  function scan() {
    const counts = new Map();
    const add = (value, weight, seen) => {
      const c = TGColor.parse(value);
      if (!c || c.a === 0) return;
      const key = TGColor.toHex(c);
      if (seen) { if (seen.has(key)) return; seen.add(key); }
      const entry = counts.get(key);
      const w = weight * c.a;
      if (entry) { entry.count++; entry.weight += w; }
      else counts.set(key, { ...c, count: 1, weight: w });
    };

    const viewportArea = innerWidth * innerHeight;
    // One huge section shouldn't outvote everything else on the page.
    const areaCap = viewportArea * 0.15;

    add(getComputedStyle(document.documentElement).backgroundColor, areaCap);
    if (document.body) add(getComputedStyle(document.body).backgroundColor, areaCap);

    const all = document.body ? document.body.getElementsByTagName('*') : [];
    let scanned = 0;
    for (const el of all) {
      if (scanned >= MAX_ELEMENTS) break;
      if (SKIP.has(el.localName)) continue;
      scanned++;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      const area = Math.min(r.width * r.height, areaCap);
      const seen = new Set();

      const chars = ownText(el);
      if (chars) {
        const size = parseFloat(cs.fontSize) || 16;
        add(cs.color, chars * size * size * 0.5, seen);
      }
      add(cs.backgroundColor, area, seen);
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        const width = parseFloat(cs[`border${side}Width`]);
        if (width > 0 && cs[`border${side}Style`] !== 'none') {
          add(cs[`border${side}Color`], width * (side === 'Top' || side === 'Bottom' ? r.width : r.height), seen);
        }
      }
      if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) add(cs.outlineColor, parseFloat(cs.outlineWidth) * (r.width + r.height) * 2, seen);
      if (SHAPES.has(el.localName)) {
        if (cs.fill && cs.fill !== 'none' && !cs.fill.startsWith('url')) add(cs.fill, area * 0.6, seen);
        if (cs.stroke && cs.stroke !== 'none' && !cs.stroke.startsWith('url')) add(cs.stroke, (r.width + r.height) * 2 * (parseFloat(cs.strokeWidth) || 1), seen);
      }
      const gradient = cs.backgroundImage;
      if (gradient && gradient !== 'none') {
        const stops = gradient.match(COLOUR_FN_RE) || [];
        for (const m of stops) add(m, (area * 0.8) / stops.length, seen);
      }
      for (const prop of ['boxShadow', 'textShadow']) {
        const v = cs[prop];
        if (v && v !== 'none') for (const m of v.match(COLOUR_FN_RE) || []) add(m, 40, seen);
      }
    }

    const { variables, blockedSheets } = scanVariables();
    const colours = [...counts.values()].sort((a, b) => b.weight - a.weight);
    return {
      brand: brand(colours),
      colours: colours.slice(0, MAX_COLOURS),
      totalColours: colours.length,
      variables,
      blockedSheets,
      scanned,
      truncated: all.length > scanned,
    };
  }

  // ---------- brand colours ----------

  function hsl({ r, g, b }) {
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
    const l = (max + min) / 2;
    const d = max - min;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    return { s, l, chroma: d };
  }

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

  // Ranks by score, folding near-duplicates into whichever was chosen first, and skips anything
  // that reads the same as a colour already taken by an earlier tier.
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

  function brand(colours) {
    const opaque = colours.filter((c) => c.a >= 0.5);
    const isVivid = (c) => {
      const { s, l, chroma } = hsl(c);
      return chroma >= MIN_CHROMA && s >= MIN_SATURATION && l >= MIN_LIGHTNESS && l <= MAX_LIGHTNESS;
    };
    const isPale = (c) => hsl(c).l > PALE_LIGHTNESS;
    // Vivid colours win on paint, nudged by how vivid they are.
    const vividScore = (c) => c.weight * (0.4 + hsl(c).chroma);

    const picked = pickDistinct(opaque.filter((c) => isVivid(c) && !isPale(c)), 3, vividScore);
    if (picked.length < 3) {
      picked.push(...pickDistinct(opaque.filter((c) => isVivid(c) && isPale(c)), 3 - picked.length, vividScore, picked));
    }
    // A black-and-white site still gets three answers, marked as neutrals.
    if (picked.length < 3) {
      const neutrals = pickDistinct(opaque.filter((c) => !isVivid(c)), 3 - picked.length, (c) => c.weight, picked);
      picked.push(...neutrals.map((n) => ({ ...n, neutral: true })));
    }
    return picked.map(({ r, g, b, a, neutral }, i) => ({ r, g, b, a, neutral: !!neutral, role: ROLES[i] }));
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
