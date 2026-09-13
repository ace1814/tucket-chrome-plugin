// Page fonts: which families actually render text, how much, and which web fonts were loaded
// but never used. Injected after shared/fonts.js. Exposes __tg.fonts.scan().
(() => {
  const tg = (globalThis.__tg ??= {});
  if (tg.fonts) return;

  const MAX_ELEMENTS = 8000;
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'tucket-grab', 'tucket-grab-highlight']);

  function scan() {
    const loaded = TGFonts.loadedFamilies();
    const byStack = new Map();
    const families = new Map();
    const seen = new Set();
    let scanned = 0;

    if (document.body) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode() && scanned < MAX_ELEMENTS) {
        const node = walker.currentNode;
        const text = node.textContent.trim();
        const el = node.parentElement;
        if (!text || !el || seen.has(el) || SKIP.has(el.localName)) continue;
        seen.add(el);
        scanned++;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;

        let resolved = byStack.get(cs.fontFamily);
        if (!resolved) {
          resolved = TGFonts.resolve(cs.fontFamily, loaded);
          byStack.set(cs.fontFamily, resolved);
        }
        const key = resolved.family.toLowerCase();
        let entry = families.get(key);
        if (!entry) {
          entry = { ...resolved, elements: 0, chars: 0, weights: new Map(), styles: new Map() };
          families.set(key, entry);
        }
        entry.elements++;
        entry.chars += text.length;
        entry.weights.set(cs.fontWeight, (entry.weights.get(cs.fontWeight) || 0) + text.length);

        const combo = `${cs.fontSize}|${cs.lineHeight}|${cs.fontWeight}|${cs.fontStyle}|${cs.letterSpacing}`;
        const style = entry.styles.get(combo);
        if (style) style.chars += text.length;
        else entry.styles.set(combo, {
          chars: text.length,
          fontFamily: cs.fontFamily, fontSize: cs.fontSize, lineHeight: cs.lineHeight,
          fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, letterSpacing: cs.letterSpacing,
          color: cs.color,
        });
      }
    }

    const used = [...families.values()]
      .sort((a, b) => b.chars - a.chars)
      .map((f) => {
        const top = [...f.styles.values()].sort((a, b) => b.chars - a.chars)[0];
        const colour = TGColor.parse(top.color);
        return {
          family: f.family,
          kind: f.kind,
          elements: f.elements,
          weights: [...f.weights.keys()].sort((a, b) => a - b),
          line: TGFonts.line(top, f.family),
          css: TGFonts.css(top, colour ? TGColor.toHex(colour) : null),
          sample: TGFonts.sample(f.family, f.kind, top.fontWeight, top.fontStyle),
        };
      });

    // Web fonts the page declared and downloaded but no scanned text renders in.
    const usedNames = new Set(used.map((f) => f.family.toLowerCase()));
    const declared = new Map();
    try {
      for (const face of document.fonts) {
        const family = TGFonts.unquote(face.family);
        const key = family.toLowerCase();
        if (usedNames.has(key) || face.status !== 'loaded') continue;
        const entry = declared.get(key) || { family, weights: new Set() };
        entry.weights.add(face.weight);
        declared.set(key, entry);
      }
    } catch { /* ignore */ }

    return {
      used,
      unused: [...declared.values()].map((d) => ({ family: d.family, weights: [...d.weights] })),
      scanned,
    };
  }

  tg.fonts = { scan };
})();
