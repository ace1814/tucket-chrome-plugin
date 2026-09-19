// Drag-to-select overlay for "Selected region". Resolves with the rectangle in CSS pixels, or
// null on Escape. The overlay is gone (and a frame painted) before it resolves, so it never
// appears in the capture. Exposes __tg.region.select().
(() => {
  const tg = (globalThis.__tg ??= {});
  if (tg.region) return;

  let active = null;

  function select() {
    if (active) return active;
    active = new Promise((resolve) => {
      const host = document.createElement('tucket-grab');
      host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;cursor:crosshair;';
      const root = host.attachShadow({ mode: 'closed' });
      // adoptedStyleSheets, not <style>: strict-CSP pages block injected style tags.
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(`
        :host { all: initial; }
        .shade { position: fixed; inset: 0; background: rgba(12, 12, 20, .32); }
        .rect { position: fixed; border-radius: 6px; border: 1.5px solid rgba(255,255,255,.95);
                box-shadow: 0 0 0 100vmax rgba(12,12,20,.32), 0 0 0 .5px rgba(0,0,0,.25), inset 0 0 0 .5px rgba(0,0,0,.2); display: none; }
        .pill { position: fixed; pointer-events: none; color: #1d1d1f; white-space: nowrap;
                font: 600 13px/1 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; letter-spacing: -.005em;
                background: rgba(252,252,254,.66); -webkit-backdrop-filter: blur(24px) saturate(190%); backdrop-filter: blur(24px) saturate(190%);
                box-shadow: 0 0 0 .5px rgba(0,0,0,.1), 0 10px 30px rgba(0,0,0,.22), inset 0 1px 0 rgba(255,255,255,.9);
                border-radius: 999px; }
        .hint { top: 18px; left: 50%; transform: translateX(-50%); padding: 11px 18px; }
        .hint span { color: rgba(60,60,67,.6); font-weight: 500; }
        .size { padding: 6px 10px; font: 600 11.5px/1 ui-monospace, "SF Mono", Menlo, monospace; display: none; }
        @media (prefers-color-scheme: dark) {
          .pill { color: #f5f5f7; background: rgba(40,40,46,.62); box-shadow: 0 0 0 .5px rgba(0,0,0,.6), 0 10px 30px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.3); }
          .hint span { color: rgba(235,235,245,.6); }
        }`);
      root.adoptedStyleSheets = [sheet];
      root.innerHTML = `
        <div class="shade"></div><div class="rect"></div><div class="pill size"></div>
        <div class="pill hint">Drag to select an area <span>· Esc to cancel</span></div>`;
      const shade = root.querySelector('.shade');
      const rectEl = root.querySelector('.rect');
      const sizeEl = root.querySelector('.size');
      document.documentElement.appendChild(host);

      let start = null;
      let current = null;

      const finish = (rect) => {
        window.removeEventListener('keydown', onKey, true);
        host.remove();
        active = null;
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(rect)));
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
      };
      const draw = () => {
        const x = Math.min(start.x, current.x), y = Math.min(start.y, current.y);
        const w = Math.abs(current.x - start.x), h = Math.abs(current.y - start.y);
        Object.assign(rectEl.style, { display: 'block', left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
        shade.style.display = 'none';
        sizeEl.textContent = `${Math.round(w)} × ${Math.round(h)}`;
        Object.assign(sizeEl.style, { display: 'block', left: `${x}px`, top: `${Math.max(4, y - 24)}px` });
        return { x, y, w, h };
      };

      host.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        host.setPointerCapture(e.pointerId);
        start = current = { x: e.clientX, y: e.clientY };
      });
      host.addEventListener('pointermove', (e) => {
        if (!start) return;
        current = { x: e.clientX, y: e.clientY };
        draw();
      });
      host.addEventListener('pointerup', (e) => {
        if (!start) return;
        current = { x: e.clientX, y: e.clientY };
        const r = draw();
        if (r.w < 4 || r.h < 4) {
          start = null;
          rectEl.style.display = sizeEl.style.display = 'none';
          shade.style.display = 'block';
          return;
        }
        finish({ ...r, viewportW: innerWidth, viewportH: innerHeight });
      });
      window.addEventListener('keydown', onKey, true);
    });
    return active;
  }

  tg.region = { select };
})();
