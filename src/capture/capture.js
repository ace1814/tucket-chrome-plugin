import { getCapture } from '../lib/idb.js';

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

function fileName(capture, index, count) {
  let host = 'page';
  try { host = new URL(capture.pageUrl).hostname.replace(/^www\./, ''); } catch { /* keep default */ }
  const d = new Date(capture.createdAt);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} at ${pad(d.getHours())}.${pad(d.getMinutes())}`;
  return `${host} ${stamp}${count > 1 ? ` (${index + 1} of ${count})` : ''}.png`;
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function sendPng(blob) {
  try {
    await TGSend.png(blob);
    toast(await TGSend.doneMessage());
  } catch (err) {
    toast('Couldn’t copy the image — click the page and try again');
    console.error(err);
  }
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
        button('Send to Tucket', 'btn primary', () => sendPng(part.blob)),
        button('Save PNG', 'btn', () => download(fileName(capture, i, parts.length), part.blob)),
      );
    }
    const img = Object.assign(document.createElement('img'), { src: url, alt: `Screenshot${parts.length > 1 ? ` part ${i + 1}` : ''}` });
    wrap.append(head, img);
    container.append(wrap);
  });

  $('#top-actions').hidden = false;
  if (parts.length > 1) {
    $('#send-first').hidden = true;
    $('#save-all').textContent = `Save all ${parts.length} PNGs`;
  }
  $('#send-first').onclick = () => sendPng(parts[0].blob);
  $('#save-all').onclick = async () => {
    for (let i = 0; i < parts.length; i++) {
      download(fileName(capture, i, parts.length), parts[i].blob);
      if (i < parts.length - 1) await new Promise((r) => setTimeout(r, 300));
    }
  };
}

boot();
