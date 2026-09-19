// Page fonts: which families actually render text, how much, and which web fonts were loaded
// but never used. Injected after shared/fonts.js. Exposes __tg.fonts.scan().
(() => {
  const tg = (globalThis.__tg ??= {});
  if (tg.fonts) return;

  const MAX_ELEMENTS = 8000;
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'tucket-grab', 'tucket-grab-highlight']);

  // Where a web font comes from is written in the page: the host its stylesheet or files load
  // from. No network needed. Fontsource (looked up by the service worker) only covers the rest.
  const PROVIDERS = [
    ['google', /(^|\.)(fonts\.googleapis\.com|fonts\.gstatic\.com|fonts\.bunny\.net)$/],
    ['adobe', /(^|\.)typekit\.(net|com)$/],
    ['monotype', /(^|\.)(fonts\.net|fonts\.com|monotype\.com)$/],
    ['fontshare', /(^|\.)fontshare\.com$/],
  ];
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

  function providerOf(url, base) {
    try {
      const host = new URL(url, base || document.baseURI).hostname;
      return PROVIDERS.find(([, re]) => re.test(host))?.[0] || null;
    } catch {
      return null;
    }
  }

  // Families named in the stylesheet URL itself (Google's family=, Fontshare's f[]=).
  function familiesInHref(href, provider, into) {
    let url;
    try { url = new URL(href, document.baseURI); } catch { return; }
    if (provider === 'google') {
      for (const param of url.searchParams.getAll('family')) {
        for (const part of param.split('|')) into.set(norm(part.split(':')[0].replace(/\+/g, ' ')), 'google');
      }
    } else if (provider === 'fontshare') {
      for (const param of url.searchParams.getAll('f[]')) into.set(norm(param.split('@')[0]), 'fontshare');
    }
  }

  function detectSources() {
    const byFamily = new Map();   // normalised family → provider, or 'self' for the site's own files
    const unreadable = new Set(); // providers whose (cross-origin) stylesheets we can't open

    const visit = (rules, base) => {
      for (const rule of rules) {
        if (rule.constructor?.name === 'CSSFontFaceRule' || rule.type === 5) {
          const family = norm(TGFonts.unquote(rule.style.getPropertyValue('font-family')));
          const urls = [...rule.style.getPropertyValue('src').matchAll(/url\(\s*["']?([^"')]+)/g)].map((m) => m[1]);
          const provider = urls.map((u) => providerOf(u, base)).find(Boolean) || (urls.length ? 'self' : 'local');
          if (family && !byFamily.has(family)) byFamily.set(family, provider);
        } else if (rule.styleSheet) {
          readSheet(rule.styleSheet, rule.href);
        } else if (rule.cssRules) {
          visit(rule.cssRules, base);
        }
      }
    };
    const readSheet = (sheet, href) => {
      const at = sheet.href || href;
      try {
        visit(sheet.cssRules, at || document.baseURI);
      } catch {
        const provider = at && providerOf(at);
        if (provider) {
          unreadable.add(provider);
          familiesInHref(at, provider, byFamily);
        }
      }
    };
    for (const sheet of document.styleSheets) readSheet(sheet);

    // Font files the page fetched, for kits declared somewhere we can't read.
    try {
      for (const entry of performance.getEntriesByType('resource')) {
        if (/\.(woff2?|ttf|otf)(\?|$)|typekit\.net\/af\//i.test(entry.name)) {
          const provider = providerOf(entry.name);
          if (provider) unreadable.add(provider);
        }
      }
    } catch { /* ignore */ }
    return { byFamily, unreadable };
  }

  function sourceOf(family, kind, detected) {
    if (kind === 'system') return 'installed';
    if (kind === 'generic') return 'default';
    const known = detected.byFamily.get(norm(family));
    if (known && known !== 'local') return known;
    // Loaded from a stylesheet we can't open: if only one font service is on the page, it's theirs.
    if (detected.unreadable.size === 1) return [...detected.unreadable][0];
    return 'unknown';
  }

  function scan() {
    const loaded = TGFonts.loadedFamilies();
    const detected = detectSources();
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
          source: sourceOf(f.family, f.kind, detected),
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
