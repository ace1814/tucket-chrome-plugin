import { getCapture, putCapture } from '../lib/idb.js';
import { buildPdf, pageSize } from '../lib/pdf.js';
import * as tucket from '../lib/tucket.js';
import { Markup, burnIn, COLOURS } from './markup.js';

const FORMATS = {
  png: { type: 'image/png', ext: 'png', label: 'PNG' },
  jpeg: { type: 'image/jpeg', ext: 'jpg', label: 'JPEG', quality: 0.92 },
  webp: { type: 'image/webp', ext: 'webp', label: 'WebP', quality: 0.92 },
  pdf: { type: 'application/pdf', ext: 'pdf', label: 'PDF' },
};
let format = 'png';
const FORMAT_KEY = 'saveFormat';

// Markup state, shared by every part's editor.
let tool = null;
let colour = COLOURS[0];
const history = [];   // [{ markup, mark }] across all parts, for undo

// The image as it leaves the page: marks and blur burned in.
const finalBlob = (part) => burnIn(part.blob, part.markup?.marks || []);

const $ = (sel) => document.querySelector(sel);

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

function button(label, className, onclick) {
  return Object.assign(document.createElement('button'), { type: 'button', className, textContent: label, onclick });
}

// Re-encode the stored PNG. JPEG has no transparency, so it gets a white page under it.
async function encode(blob, key) {
  const { type, quality } = FORMATS[key];
  if (type === 'image/png') return blob;
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d');
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return canvas.convertToBlob({ type, quality });
}

async function toPdf(parts, dpr) {
  const pages = [];
  for (const part of parts) {
    const jpeg = new Uint8Array(await (await encode(await finalBlob(part), 'jpeg')).arrayBuffer());
    pages.push({ jpeg, width: part.width, height: part.height, ...pageSize(part.width, part.height, dpr) });
  }
  return buildPdf(pages);
}

// PDF puts every part in one file; the image formats save one file each.
async function saveParts(capture, parts, indexOffset = 0) {
  const total = capture.parts.length;
  try {
    if (format === 'pdf') {
      download(fileName(capture, indexOffset, parts.length === total ? 1 : total), await toPdf(parts, capture.dpr || 1));
      return;
    }
    for (let i = 0; i < parts.length; i++) {
      download(fileName(capture, indexOffset + i, total), await encode(await finalBlob(parts[i]), format));
      if (i < parts.length - 1) await new Promise((r) => setTimeout(r, 300));
    }
  } catch (err) {
    toast(`Couldn’t save as ${FORMATS[format].label}`);
    console.error(err);
  }
}

function fileName(capture, index, count) {
  let host = 'page';
  try { host = new URL(capture.pageUrl).hostname.replace(/^www\./, ''); } catch { /* keep default */ }
  const d = new Date(capture.createdAt);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} at ${pad(d.getHours())}.${pad(d.getMinutes())}`;
  return `${host} ${stamp}${count > 1 ? ` (${index + 1} of ${count})` : ''}.${FORMATS[format].ext}`;
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------- markup toolbar ----------

const KEYS = { a: 'arrow', r: 'box', h: 'highlight', t: 'text', b: 'blur' };

function updateUndo() {
  $('#undo').disabled = history.length === 0;
  markEdited();
}

function setTool(next) {
  tool = tool === next ? null : next;
  for (const b of document.querySelectorAll('[data-mark]')) b.setAttribute('aria-pressed', String(b.dataset.mark === tool));
  document.body.classList.toggle('marking', !!tool);
  if (tool) document.body.dataset.tool = tool;
  else delete document.body.dataset.tool;
}

function undo() {
  const last = history.pop();
  if (last) last.markup.remove(last.mark);
  updateUndo();
}

function setUpMarkup() {
  const bar = $('#markup-bar');
  bar.hidden = false;
  $('#colours').replaceChildren(...COLOURS.map((c, i) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', title: c });
    b.style.background = c;
    b.dataset.colour = c;
    b.setAttribute('aria-pressed', String(i === 0));
    return b;
  }));
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.mark) setTool(b.dataset.mark);
    else if (b.dataset.colour) {
      colour = b.dataset.colour;
      for (const c of $('#colours').children) c.setAttribute('aria-pressed', String(c === b));
    } else if (b.id === 'undo') undo();
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea') || document.querySelector('dialog[open]')) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.key === 'Escape' && tool) { setTool(tool); return; }
    if (!e.metaKey && !e.ctrlKey && !e.altKey && KEYS[e.key.toLowerCase()]) setTool(KEYS[e.key.toLowerCase()]);
  });
}


// ---------- Tucket ----------
// Everything Tucket does here goes over the native bridge straight from this page: auto-sync,
// Extract text (op "ocr") and Remove background. Results come back and are shown in Grab.

let capture = null;
let bridge = { state: 'checking' };
let sync = 'checking';
let syncError = '';

const pageMeta = () => ({ pageUrl: capture.pageUrl || '', pageTitle: capture.pageTitle || '' });
const siteOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

// The bridge's error codes (and Chrome's), in words.
function explain(err) {
  const code = String(err?.message || err);
  if (tucket.isMissing(code)) return 'Tucket isn’t connected.';
  return {
    'app-not-running': 'Tucket didn’t open in time. Open it and try again.',
    disabled: 'The browser extension is switched off in Tucket’s Settings.',
    'too-large': 'This one is too big for Tucket (over 25 MB). Try a selected area.',
    timeout: 'Tucket took too long with this one.',
    failed: 'Tucket couldn’t finish this one.',
  }[code] || 'Tucket didn’t answer. Try again in a moment.';
}

const SYNC = {
  checking: { label: 'Checking Tucket…', title: '' },
  syncing: { label: 'Saving to Tucket…', title: '' },
  synced: { label: 'In Tucket', title: () => `Saved to Tucket${siteOf(capture.pageUrl) ? `, filed under ${siteOf(capture.pageUrl)} with a link back to the page` : ''}.` },
  edited: { label: 'Update Tucket', title: 'Your marks aren’t in Tucket yet. Click to save this version too.' },
  failed: { label: 'Not saved · Retry', title: () => syncError },
  off: { label: 'Not in Tucket', title: 'You need Tucket for this. Click to see why.' },
};

function setSync(state) {
  sync = state;
  const el = $('#sync');
  el.hidden = state === 'hidden';
  if (state === 'hidden') return;
  const { label, title } = SYNC[state];
  el.dataset.state = state;
  $('#sync-label').textContent = label;
  el.title = typeof title === 'function' ? title() : title;
  el.setAttribute('aria-label', `${label}. ${el.title}`.trim());
  el.disabled = state === 'checking' || state === 'syncing';
}

function markEdited() {
  if (sync === 'synced' && history.length) setSync('edited');
}

// Every capture goes to Tucket by itself when Tucket is connected, with the page it came from.
// It's never put on the clipboard instead: that would overwrite whatever the user copied last.
async function autoSync({ force = false } = {}) {
  if (bridge.state !== 'connected') return;
  if (capture.syncedAt && !force) { setSync('synced'); return; }
  setSync('syncing');
  try {
    for (const part of capture.parts) {
      await tucket.request('ingest', { kind: 'image', data: await blobToBase64(await finalBlob(part)), ...pageMeta() });
    }
    capture.syncedAt = Date.now();
    // Remember it, so reopening this page doesn't save it to Tucket twice.
    putCapture({ ...capture, parts: capture.parts.map(({ markup, ...rest }) => rest) }).catch(() => {});
    setSync('synced');
  } catch (err) {
    syncError = explain(err);
    if (tucket.isMissing(err?.message)) { bridge = { state: 'missing' }; setSync('off'); return; }
    setSync('failed');
  }
}

async function onSyncClick() {
  if (sync === 'off') { upsell('sync'); return; }
  if (sync === 'synced') { toast('Already in Tucket'); return; }
  if (sync === 'failed' && bridge.state !== 'connected') {
    setSync('checking');
    bridge = await tucket.status({ fresh: true });
    if (bridge.state !== 'connected') { syncError = explain(bridge.reason); setSync(bridge.state === 'missing' ? 'off' : 'failed'); return; }
  }
  await autoSync({ force: true });
}

// ---------- the Tucket pop-up ----------

const UPSELL = {
  ocr: { title: 'Sorry, reading text is a Tucket thing', quip: 'Grab can see the words. Tucket can actually read them.', badge: 'Aa' },
  cutout: { title: 'Sorry, the scissors are in Tucket', quip: 'Grab takes the picture. Tucket cuts out the good bit.', badge: '✂︎' },
  sync: { title: 'Sorry, there’s no Tucket to save to', quip: 'Grab takes it. Tucket keeps it, with the page it came from.', badge: '↻' },
};

function upsell(kind) {
  const copy = UPSELL[kind];
  const mac = TGFooter.isMac();
  $('#upsell-title').textContent = mac ? copy.title : 'Tucket is Mac-only, sorry';
  $('#upsell-quip').textContent = mac ? copy.quip : 'Everything else here works as usual: mark up, save and copy.';
  $('#upsell-badge').textContent = copy.badge;
  // The perk they just reached for goes first.
  const perks = $('#upsell-perks');
  const first = perks.querySelector(`[data-perk="${kind}"]`);
  if (first) perks.prepend(first);
  perks.hidden = !mac;
  const offer = TGFooter.OFFER;
  $('#upsell-cta').hidden = !mac;
  $('#upsell-cta').href = TGFooter.ctaUrl(`capture-${kind}`, { offer: true });
  $('#upsell-offer').hidden = !offer;
  if (offer) $('#upsell-offer').textContent = `${offer.percent}% off for Grab users`;
  $('#upsell-fine').hidden = !mac;
  $('#upsell-close').textContent = mac ? 'Maybe later' : 'Got it';
  $('#upsell').showModal();
}

// ---------- Extract text and Remove background ----------

const TOOLS = {
  ocr: { op: 'ocr', busy: 'Reading…' },
  cutout: { op: 'removeBackground', busy: 'Cutting out…' },
};

async function runTool(kind, btn) {
  if (bridge.state === 'checking') bridge = await tucket.status();
  if (bridge.state === 'missing') { upsell(kind); return; }
  const { op, busy } = TOOLS[kind];
  if (bridge.state === 'connected' && !bridge.features?.includes(op)) {
    toast('Update Tucket to 1.3.9 for this');
    return;
  }
  const label = btn.querySelector('span');
  const idle = label.textContent;
  const all = document.querySelectorAll('[data-tool]');
  for (const b of all) b.disabled = true;
  btn.classList.add('busy');
  label.textContent = busy;
  try {
    if (kind === 'ocr') {
      // Marks are burned in first, so text under a blur is never read (or saved).
      const texts = [];
      for (const part of capture.parts) {
        const res = await tucket.request('ocr', { image: await blobToBase64(await finalBlob(part)), ...pageMeta() });
        if (res.text?.trim()) texts.push(res.text.trim());
      }
      showText(texts.join('\n\n'));
    } else {
      const part = capture.parts[0];
      const res = await tucket.request('removeBackground', { image: await blobToBase64(await finalBlob(part)), ...pageMeta() });
      const blob = await (await fetch(`data:image/png;base64,${res.image}`)).blob();
      showCutout(blob);
    }
    bridge = { ...bridge, state: 'connected' };
  } catch (err) {
    if (tucket.isMissing(err?.message)) { bridge = { state: 'missing' }; upsell(kind); }
    else toast(explain(err));
    console.error(err);
  } finally {
    for (const b of all) b.disabled = false;
    btn.classList.remove('busy');
    label.textContent = idle;
  }
}

function resultSheet(title, meta, actions) {
  $('#result-title').textContent = title;
  $('#result-meta').textContent = meta;
  $('#result-actions').replaceChildren(...actions);
  $('#result-text').hidden = true;
  $('#result-image').hidden = true;
  const sheet = $('#result');
  if (!sheet.open) sheet.showModal();
}

function showText(text) {
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
  if (!words) {
    resultSheet('No text found', 'Tucket looked, but there’s no readable text in this one.', [button('Close', 'sheet-btn primary', () => $('#result').close())]);
    return;
  }
  resultSheet('Text from this screenshot', `${words} word${words === 1 ? '' : 's'} · Saved in Tucket too, so you can search for it later`, [
    button('Copy text', 'sheet-btn primary', async () => {
      try { await TGSend.text(text); toast('Text copied'); } catch { toast('Couldn’t copy — click the page and try again'); }
    }),
    button('Save as .txt', 'sheet-btn', () => {
      download(fileName(capture, 0, 1).replace(/\.\w+$/, '.txt'), new Blob([text], { type: 'text/plain' }));
    }),
  ]);
  const area = $('#result-text');
  area.value = text;
  area.hidden = false;
  area.scrollTop = 0;
}

async function showCutout(blob) {
  const url = URL.createObjectURL(blob);
  const bmp = await createImageBitmap(blob);
  const size = `${bmp.width} × ${bmp.height}px`;
  bmp.close();
  resultSheet('Background removed', `${size} · Saved in Tucket too`, [
    button('Copy image', 'sheet-btn primary', async () => {
      try { await TGSend.png(blob); toast('Image copied'); } catch { toast('Couldn’t copy — click the page and try again'); }
    }),
    button('Save PNG', 'sheet-btn', () => download(fileName(capture, 0, 1).replace(/\.\w+$/, ' cut-out.png'), blob)),
  ]);
  const img = $('#result-img');
  if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
  img.src = url;
  $('#result-image').hidden = false;
}

// ---------- Save as ----------

function setFormat(next) {
  format = FORMATS[next] ? next : 'png';
  for (const b of document.querySelectorAll('#save-menu [data-format]')) b.setAttribute('aria-checked', String(b.dataset.format === format));
  const n = capture.parts.length;
  const { label } = FORMATS[format];
  $('#save-main').textContent = n > 1 && format !== 'pdf' ? `Save ${n} as ${label}` : `Save as ${label}`;
  for (const b of document.querySelectorAll('.part-head .save-part')) b.textContent = `Save as ${label}`;
}

function toggleMenu(open = $('#save-menu').hidden) {
  $('#save-menu').hidden = !open;
  $('#save-more').setAttribute('aria-expanded', String(open));
  if (open) $(`#save-menu [data-format="${format}"]`).focus();
}

function setUpSave() {
  chrome.storage.local.get(FORMAT_KEY).then((r) => { if (r[FORMAT_KEY]) setFormat(r[FORMAT_KEY]); }).catch(() => {});
  $('#save-main').onclick = () => saveParts(capture, capture.parts);
  $('#save-more').onclick = (e) => { e.stopPropagation(); toggleMenu(); };
  // Picking a format saves in it straight away, and it becomes the button's format.
  $('#save-menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-format]');
    if (!b) return;
    setFormat(b.dataset.format);
    chrome.storage.local.set({ [FORMAT_KEY]: format }).catch(() => {});
    toggleMenu(false);
    saveParts(capture, capture.parts);
  });
  $('#save-menu').addEventListener('keydown', (e) => {
    const items = [...$('#save-menu').querySelectorAll('[data-format]')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      toggleMenu(false);
      $('#save-more').focus();
    }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#save')) toggleMenu(false); });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveParts(capture, capture.parts); }
  });
}

// ---------- boot ----------

async function boot() {
  const id = new URLSearchParams(location.search).get('id');
  capture = id ? await getCapture(id).catch(() => null) : null;
  if (!capture) {
    TGFooter.mount($('#footer'), 'capture');
    $('#missing').hidden = false;
    return;
  }

  const { parts, notes = [] } = capture;
  const labels = { full: 'Full page', visible: 'Visible area', region: 'Selected region' };
  document.title = `${capture.pageTitle || 'Screenshot'} — Tucket Grab`;
  $('#page-title').textContent = capture.pageTitle || capture.pageUrl || 'Screenshot';
  $('#page-meta').textContent = `${labels[capture.mode] || 'Screenshot'} · ${capture.pageUrl || ''}`;

  if (notes.length) {
    $('#notes').hidden = false;
    $('#notes').replaceChildren(...notes.map((n) => Object.assign(document.createElement('li'), { textContent: n })));
  }

  const container = $('#parts');
  parts.forEach((part, i) => {
    const url = URL.createObjectURL(part.blob);
    const wrap = document.createElement('section');
    wrap.className = 'part';
    const head = document.createElement('div');
    head.className = 'part-head';
    const meta = document.createElement('span');
    meta.textContent = `${parts.length > 1 ? `Part ${i + 1} of ${parts.length} · ` : ''}${part.width} × ${part.height}px · ${(part.blob.size / 1e6).toFixed(1)} MB`;
    head.append(meta);
    if (parts.length > 1) head.append(button('Save as PNG', 'btn save-part', () => saveParts(capture, [part], i)));
    const img = Object.assign(document.createElement('img'), { src: url, alt: `Screenshot${parts.length > 1 ? ` part ${i + 1}` : ''}` });
    const stage = document.createElement('div');
    stage.className = 'stage';
    stage.append(img);
    wrap.append(head, stage);
    container.append(wrap);
    img.addEventListener('load', () => {
      part.markup = new Markup({
        stage, img,
        tools: () => ({ tool, colour }),
        onCommit: (markup, mark) => { history.push({ markup, mark }); updateUndo(); },
      });
    }, { once: true });
  });

  $('#top-actions').hidden = false;
  setFormat('png');
  setUpSave();
  setUpMarkup();

  $('#upsell-close').onclick = () => $('#upsell').close();
  $('#result-close').onclick = () => $('#result').close();
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // click outside the sheet
  }
  for (const btn of document.querySelectorAll('[data-tool]')) btn.onclick = () => runTool(btn.dataset.tool, btn);
  $('#sync').onclick = onSyncClick;

  // Ask Tucket once, fresh, and let the footer show the same answer.
  setSync(TGFooter.isMac() ? 'checking' : 'hidden');
  bridge = await tucket.status({ fresh: true });
  TGFooter.mount($('#footer'), 'capture', bridge);
  if (bridge.state === 'connected') await autoSync();
  else if (bridge.state === 'unavailable') { syncError = explain(bridge.reason); setSync('failed'); }
  else setSync(TGFooter.isMac() ? 'off' : 'hidden');
}

boot();
