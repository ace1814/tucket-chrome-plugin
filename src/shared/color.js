// Colour parsing and formatting. A classic script (not a module) so the popup, the capture
// page and injected content scripts can all load the same file; it defines globalThis.TGColor.
(() => {
  if (globalThis.TGColor) return;

  const cache = new Map();
  let ctx;

  function canvasContext() {
    if (!ctx) {
      const canvas = typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(1, 1)
        : Object.assign(document.createElement('canvas'), { width: 1, height: 1 });
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    return ctx;
  }

  const RGB_RE = /^rgba?\(\s*(-?[\d.]+)(%?)[\s,]+(-?[\d.]+)(%?)[\s,]+(-?[\d.]+)(%?)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const channel = (v, pct) => clamp(Math.round(pct ? parseFloat(v) * 2.55 : parseFloat(v)), 0, 255);

  /** Any CSS colour string → { r, g, b, a } (0–255, alpha 0–1), or null. */
  function parse(input) {
    if (input == null) return null;
    const s = String(input).trim();
    if (!s) return null;
    if (cache.has(s)) return cache.get(s);

    let out = null;
    const lower = s.toLowerCase();
    if (lower === 'transparent') {
      out = { r: 0, g: 0, b: 0, a: 0 };
    } else if (lower === 'none' || lower.includes('var(') || lower.includes('currentcolor') || lower.startsWith('url(')) {
      out = null;
    } else {
      const m = s.match(RGB_RE);
      if (m) {
        out = {
          r: channel(m[1], m[2]), g: channel(m[3], m[4]), b: channel(m[5], m[6]),
          a: m[7] == null ? 1 : clamp(m[8] ? parseFloat(m[7]) / 100 : parseFloat(m[7]), 0, 1),
        };
      } else if (typeof CSS !== 'undefined' && CSS.supports('color', s)) {
        // Anything else (oklch, color(), named colours…): let the browser paint one pixel.
        const c = canvasContext();
        c.clearRect(0, 0, 1, 1);
        c.fillStyle = '#000';
        c.fillStyle = s;
        c.fillRect(0, 0, 1, 1);
        const d = c.getImageData(0, 0, 1, 1).data;
        out = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
      }
    }
    if (out) out.a = Math.round(out.a * 100) / 100;
    if (cache.size > 4000) cache.clear();
    cache.set(s, out);
    return out;
  }

  const hex2 = (n) => n.toString(16).padStart(2, '0').toUpperCase();

  function toHex({ r, g, b, a = 1 }) {
    return `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(Math.round(a * 255)) : ''}`;
  }

  function toRgb({ r, g, b, a = 1 }) {
    return a < 1 ? `rgba(${r}, ${g}, ${b}, ${a})` : `rgb(${r}, ${g}, ${b})`;
  }

  function toHsl({ r, g, b, a = 1 }) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), d = max - min;
    const l = (max + min) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d) {
      if (max === rn) h = ((gn - bn) / d) % 6;
      else if (max === gn) h = (bn - rn) / d + 2;
      else h = (rn - gn) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    const H = Math.round(h), S = Math.round(s * 100), L = Math.round(l * 100);
    return a < 1 ? `hsla(${H}, ${S}%, ${L}%, ${a})` : `hsl(${H}, ${S}%, ${L}%)`;
  }

  /** fmt: 'hex' | 'rgb' | 'hsl'. Every output is a literal Tucket's ColorDetector accepts. */
  function format(c, fmt) {
    if (fmt === 'rgb') return toRgb(c);
    if (fmt === 'hsl') return toHsl(c);
    return toHex(c);
  }

  /** True when dark text reads better on this colour. */
  function isLight({ r, g, b, a = 1 }) {
    if (a < 0.5) return true;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
  }

  globalThis.TGColor = { parse, toHex, toRgb, toHsl, format, isLight };
})();
