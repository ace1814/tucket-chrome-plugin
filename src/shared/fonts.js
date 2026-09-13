// Font helpers for injected content scripts: which family in a stack actually renders, and
// how to describe it. Classic script; defines globalThis.TGFonts.
(() => {
  if (globalThis.TGFonts) return;

  const GENERIC = new Set([
    'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'math', 'emoji',
    'fangsong', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
  ]);

  function unquote(s) {
    return s.trim().replace(/^["']|["']$/g, '').trim();
  }

  function splitStack(stack) {
    return (String(stack).match(/"[^"]*"|'[^']*'|[^,]+/g) || []).map(unquote).filter(Boolean);
  }

  function loadedFamilies() {
    const set = new Set();
    try {
      for (const face of document.fonts) {
        if (face.status === 'loaded') set.add(unquote(face.family).toLowerCase());
      }
    } catch { /* FontFaceSet not iterable in some embedders */ }
    return set;
  }

  let measure;
  const installed = new Map();

  // A family is present if text set in it measures differently from each generic fallback.
  function isInstalled(family) {
    const key = family.toLowerCase();
    if (installed.has(key)) return installed.get(key);
    measure ||= document.createElement('canvas').getContext('2d');
    const sample = 'mmmmmmmmmmlli10OQ@#WwAa';
    const quoted = `"${family.replace(/"/g, '')}"`;
    let found = false;
    for (const base of ['monospace', 'serif', 'sans-serif']) {
      measure.font = `72px ${base}`;
      const fallback = measure.measureText(sample).width;
      measure.font = `72px ${quoted}, ${base}`;
      if (measure.measureText(sample).width !== fallback) { found = true; break; }
    }
    installed.set(key, found);
    return found;
  }

  /** 'Inter, system-ui, sans-serif' → { family: 'Inter', kind: 'web' | 'system' | 'generic' } */
  function resolve(stack, loaded = loadedFamilies()) {
    for (const family of splitStack(stack)) {
      const lower = family.toLowerCase();
      if (GENERIC.has(lower)) return { family: lower, kind: 'generic' };
      if (loaded.has(lower)) return { family, kind: 'web' };
      if (isInstalled(family)) return { family, kind: 'system' };
    }
    return { family: 'serif', kind: 'generic' };
  }

  const num = (v) => String(Math.round(parseFloat(v) * 100) / 100);

  /** "Inter · 16px/24 · 600" */
  function line(style, family) {
    const lh = style.lineHeight === 'normal' ? '' : `/${num(style.lineHeight)}`;
    const italic = style.fontStyle && style.fontStyle !== 'normal' ? ` ${style.fontStyle}` : '';
    return `${family} · ${num(style.fontSize)}px${lh} · ${style.fontWeight}${italic}`;
  }

  function css(style, colour) {
    const rows = [
      `font-family: ${style.fontFamily};`,
      `font-size: ${style.fontSize};`,
      `font-weight: ${style.fontWeight};`,
      `line-height: ${style.lineHeight};`,
    ];
    if (style.fontStyle && style.fontStyle !== 'normal') rows.push(`font-style: ${style.fontStyle};`);
    if (style.letterSpacing && style.letterSpacing !== 'normal') rows.push(`letter-spacing: ${style.letterSpacing};`);
    if (colour) rows.push(`color: ${colour};`);
    return rows.join('\n');
  }

  /** A PNG of a sample line set in the page's own copy of the font (black on transparent). */
  function sample(family, kind, weight = '400', style = 'normal') {
    const dpr = 2, w = 320, h = 36; // the popup's font card is 326px wide inside
    const canvas = document.createElement('canvas');
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const c = canvas.getContext('2d');
    c.scale(dpr, dpr);
    const fam = kind === 'generic' ? family : `"${family.replace(/"/g, '')}"`;
    c.font = `${style} ${weight} 22px ${fam}`;
    c.fillStyle = '#000';
    c.textBaseline = 'middle';
    c.fillText('The quick brown fox — Aa Gg 0123', 0, h / 2);
    return canvas.toDataURL('image/png');
  }

  globalThis.TGFonts = { splitStack, loadedFamilies, resolve, line, css, sample, unquote };
})();
