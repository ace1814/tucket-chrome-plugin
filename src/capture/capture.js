import { getCapture } from '../lib/idb.js';
import { buildPdf, pageSize } from '../lib/pdf.js';
import { Markup, burnIn, COLOURS } from './markup.js';

const FORMATS = {
  png: { type: 'image/png', ext: 'png', label: 'PNG' },
  jpeg: { type: 'image/jpeg', ext: 'jpg', label: 'JPEG', quality: 0.92 },
  webp: { type: 'image/webp', ext: 'webp', label: 'WebP', quality: 0.92 },
  pdf: { type: 'application/pdf', ext: 'pdf', label: 'PDF' },
};
let format = 'png';

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

let captureMeta = {};

async function sendPng(part) {
  try {
    const { via } = await TGSend.send('png', await finalBlob(part), captureMeta);
    toast(TGSend.doneMessage(via, 1, await TGSend.hasTucket()));
  } catch (err) {
    toast('Couldn’t copy the image — click the page and try again');
    console.error(err);
  }
}

// ---------- markup toolbar ----------

const KEYS = { a: 'arrow', r: 'box', h: 'highlight', t: 'text', b: 'blur' };

function updateUndo() {
  $('#undo').disabled = history.length === 0;
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
    if (e.target.closest?.('input, textarea')) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.key === 'Escape' && tool) { setTool(tool); return; }
    if (!e.metaKey && !e.ctrlKey && !e.altKey && KEYS[e.key.toLowerCase()]) setTool(KEYS[e.key.toLowerCase()]);
  });
}

async function boot() {
  TGFooter.mount($('#footer'), 'capture');
  const id = new URLSearchParams(location.search).get('id');
  const capture = id ? await getCapture(id).catch(() => null) : null;
  if (!capture) {
    $('#missing').hidden = false;
    return;
  }

  const { parts, notes = [] } = capture;
  captureMeta = { pageUrl: capture.pageUrl, pageTitle: capture.pageTitle };
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
    if (parts.length > 1) {
      head.append(
        button('Send to Tucket', 'btn primary', () => sendPng(part)),
        button('Save', 'btn', () => saveParts(capture, [part], i)),
      );
    }
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
  if (parts.length > 1) {
    $('#send-first').hidden = true;
    $('#save-all').textContent = `Save all ${parts.length}`;
  }
  $('#send-first').onclick = () => sendPng(parts[0]);
  setUpMarkup();

  // Tucket tools live here, after a capture, rather than as a pitch in the panel.
  $('#lock-cta').href = TGFooter.ctaUrl('capture-tools');
  if (!/mac/i.test(navigator.userAgentData?.platform || navigator.platform || '')) {
    $('#lock-body').textContent = 'Tucket reads text and lifts subjects on the Mac, with Apple’s on-device Vision. It’s Mac-only, so these two aren’t available here — saving and copying work as usual.';
    $('#lock-cta').hidden = true;
    $('#lock-fine').hidden = true;
    $('#lock-close').textContent = 'Got it';
  }
  $('#format').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-format]');
    if (!btn) return;
    format = btn.dataset.format;
    for (const b of $('#format').querySelectorAll('[data-format]')) b.setAttribute('aria-pressed', String(b.dataset.format === format));
    $('#save-all').textContent = format === 'pdf' || parts.length === 1 ? 'Save' : `Save all ${parts.length}`;
  });

  $('#lock-close').onclick = () => { $('#lock-card').hidden = true; };
  for (const btn of document.querySelectorAll('[data-tool]')) {
    btn.onclick = async () => {
      if (!(await TGSend.hasTucket())) {
        $('#lock-card').hidden = false;
        return;
      }
      const res = await chrome.runtime.sendMessage({ type: 'tool:start', tool: btn.dataset.tool, captureId: id }).catch(() => null);
      if (!res?.ok) toast(res?.error || 'Tucket didn’t answer');
    };
  }
  $('#save-all').onclick = () => saveParts(capture, parts);
}

boot();
