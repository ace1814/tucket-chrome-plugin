// Page palette: every colour in use, by frequency, plus colour-valued CSS custom properties.
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

  function hasOwnText(el) {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true;
    return false;
  }

  function scan() {
    const counts = new Map();
    const add = (value, seen) => {
      const c = TGColor.parse(value);
      if (!c || c.a === 0) return;
      const key = TGColor.toHex(c);
      if (seen) { if (seen.has(key)) return; seen.add(key); }
      const entry = counts.get(key);
      if (entry) entry.count++;
      else counts.set(key, { ...c, count: 1 });
    };

    add(getComputedStyle(document.documentElement).backgroundColor);
    if (document.body) add(getComputedStyle(document.body).backgroundColor);

    const all = document.body ? document.body.getElementsByTagName('*') : [];
    let scanned = 0;
    for (const el of all) {
      if (scanned >= MAX_ELEMENTS) break;
      if (SKIP.has(el.localName)) continue;
      scanned++;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const seen = new Set();
      if (hasOwnText(el)) add(cs.color, seen);
      add(cs.backgroundColor, seen);
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        if (parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== 'none') add(cs[`border${side}Color`], seen);
      }
      if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) add(cs.outlineColor, seen);
      if (SHAPES.has(el.localName)) {
        if (cs.fill && cs.fill !== 'none' && !cs.fill.startsWith('url')) add(cs.fill, seen);
        if (cs.stroke && cs.stroke !== 'none' && !cs.stroke.startsWith('url')) add(cs.stroke, seen);
      }
      for (const prop of ['boxShadow', 'textShadow', 'backgroundImage']) {
        const v = cs[prop];
        if (v && v !== 'none') for (const m of v.match(COLOUR_FN_RE) || []) add(m, seen);
      }
    }

    const { variables, blockedSheets } = scanVariables();
    const colours = [...counts.values()].sort((a, b) => b.count - a.count);
    return {
      colours: colours.slice(0, MAX_COLOURS),
      totalColours: colours.length,
      variables,
      blockedSheets,
      scanned,
      truncated: all.length > scanned,
    };
  }

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
