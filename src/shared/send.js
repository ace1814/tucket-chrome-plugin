// "Send to Tucket". In v1 the transport is the system clipboard: Tucket polls it every 250ms
// and files what it finds — a colour literal becomes a named Colour clip, SVG markup an Icon
// or SVG clip, a PNG an Image clip. Classic script; defines globalThis.TGSend.
(() => {
  if (globalThis.TGSend) return;

  // Tucket polls at 250ms. Anything faster than one poll per clip loses clips, so batches
  // wait comfortably longer than that between writes.
  const BATCH_GAP_MS = 400;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function hasTucket() {
    try {
      const { hasTucket } = await chrome.storage.local.get('hasTucket');
      return hasTucket === true;
    } catch {
      return false;
    }
  }

  // Last resort for pages where the async clipboard is unavailable (plain http, no focus).
  function execCopy(value) {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'all:initial;position:fixed;top:-9999px;left:0;opacity:0;';
    (document.body || document.documentElement).appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }

  async function text(value) {
    try {
      await navigator.clipboard.writeText(value);
    } catch (err) {
      if (!execCopy(value)) throw err;
    }
  }

  // SVG goes as markup text: Tucket recognises text starting with <svg (or <?xml … <svg).
  const svg = (markup) => text(markup);

  async function png(blob) {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }

  /** items: [{ kind: 'text' | 'svg' | 'png', data }]. Sequential, paced for Tucket's poll. */
  async function all(items, onProgress) {
    for (let i = 0; i < items.length; i++) {
      const { kind, data } = items[i];
      if (kind === 'png') await png(data);
      else await text(data);
      onProgress?.(i + 1, items.length);
      if (i < items.length - 1) await sleep(BATCH_GAP_MS);
    }
  }

  async function doneMessage(count = 1) {
    const tucket = await hasTucket();
    if (count > 1) return tucket ? `Sent ${count} — Tucket saved them` : `Copied ${count}`;
    return tucket ? 'Copied — Tucket saved it' : 'Copied';
  }

  globalThis.TGSend = { text, svg, png, all, hasTucket, doneMessage, BATCH_GAP_MS };
})();
