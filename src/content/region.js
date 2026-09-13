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
      root.innerHTML = `
        <style>
          :host { all: initial; }
          .shade { position: fixed; inset: 0; background: rgba(15, 15, 25, .35); }
          .rect { position: fixed; border: 1.5px solid #fff; box-shadow: 0 0 0 100vmax rgba(15,15,25,.35);
                  outline: 1px solid rgba(0,0,0,.3); display: none; }
          .hint { position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
                  font: 500 13px/1.2 system-ui, -apple-system, sans-serif; color: #fff; background: rgba(20,20,28,.88);
                  padding: 8px 12px; border-radius: 8px; pointer-events: none; }
          .size { position: fixed; font: 500 11px/1 ui-monospace, monospace; color: #fff; background: rgba(20,20,28,.88);
                  padding: 4px 6px; border-radius: 4px; display: none; pointer-events: none; }
        </style>
        <div class="shade"></div><div class="rect"></div><div class="size"></div>
        <div class="hint">Drag to select an area · Esc to cancel</div>`;
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
