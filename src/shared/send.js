// "Send to Tucket". When Tucket 1.3.8+ is connected, captures go straight to it over the bridge and
// the clipboard is left alone. Otherwise they go to the clipboard, where any Tucket version (or
// the user's own paste) picks them up. Classic script; defines globalThis.TGSend.
(() => {
  if (globalThis.TGSend) return;

  // Tucket polls the clipboard at 250ms. A batch sent through the clipboard waits longer than
  // one poll between writes, or clips get lost.
  const BATCH_GAP_MS = 400;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function status() {
    try {
      return (await chrome.runtime.sendMessage({ type: 'tucket:status' })) || { state: 'missing' };
    } catch {
      return { state: 'missing' };
    }
  }

  async function hasTucket() {
    return (await status()).state === 'connected';
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

  async function png(blob) {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1]);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  /**
   * kind: 'text' | 'svg' | 'png'. data: a string, or a Blob for png.
   * Resolves { via: 'tucket' | 'clipboard' }; rejects only if the clipboard write fails too.
   */
  async function send(kind, data, meta = {}) {
    try {
      const payload = kind === 'png' ? await blobToBase64(data) : data;
      const res = await chrome.runtime.sendMessage({ type: 'tucket:send', kind: kind === 'png' ? 'image' : kind, data: payload, ...meta });
      if (res?.ok) return { via: 'tucket' };
    } catch { /* fall back to the clipboard */ }
    if (kind === 'png') await png(data);
    else await text(data);
    return { via: 'clipboard' };
  }

  /** items: [{ kind, data }]. Sequential; paced for Tucket's poll when going through the clipboard. */
  async function all(items, onProgress, meta = {}) {
    let via = 'clipboard';
    for (let i = 0; i < items.length; i++) {
      ({ via } = await send(items[i].kind, items[i].data, meta));
      onProgress?.(i + 1, items.length);
      if (via === 'clipboard' && i < items.length - 1) await sleep(BATCH_GAP_MS);
    }
    return { via };
  }

  function doneMessage(via, count = 1, tucket = false) {
    if (via === 'tucket') return count > 1 ? `Sent ${count} to Tucket` : 'Sent to Tucket';
    if (count > 1) return tucket ? `Copied ${count} — Tucket saved them` : `Copied ${count}`;
    return tucket ? 'Copied — Tucket saved it' : 'Copied';
  }

  globalThis.TGSend = { send, text, png, all, status, hasTucket, doneMessage, BATCH_GAP_MS };
})();
