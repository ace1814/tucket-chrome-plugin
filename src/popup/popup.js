// Popup. Reads the page by injecting content scripts on demand (activeTab + scripting), renders
// what they return, and sends captures to the clipboard. Screenshots are handed to the service
// worker because they outlive the popup.

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);

const BUNDLES = {
  palette: ['src/shared/color.js', 'src/content/palette.js'],
  fonts: ['src/shared/color.js', 'src/shared/fonts.js', 'src/content/fonts.js'],
  svgs: ['src/shared/color.js', 'src/content/svgs.js'],
  inspector: ['src/shared/color.js', 'src/shared/send.js', 'src/shared/fonts.js', 'src/content/inspector.js'],
};

// Tucket's own icon rule (TucketCore/SVGIconDetector), so the label matches where the clip lands.
const ICON_MAX_SIDE = 512;
const ICON_ASPECT = [0.75, 1.34];
const ICON_MAX_BYTES = 20_000;

let tab = null;
let format = 'hex';
let palette = null;
let svgItems = [];
const loaded = new Set();

// ---------- helpers ----------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v);
  }
  el.append(...children.filter((c) => c != null));
  return el;
}

let toastTimer = 0;
function toast(msg, sticky = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

async function send(kind, data) {
  try {
    if (kind === 'png') await TGSend.png(data);
    else await TGSend.text(data);
    toast(await TGSend.doneMessage());
  } catch (err) {
    toast('Couldn’t copy to the clipboard');
    console.error(err);
  }
}

async function sendAll(items) {
  try {
    await TGSend.all(items, (i, n) => toast(`Sending ${i} of ${n}…`, true));
    toast(await TGSend.doneMessage(items.length));
  } catch (err) {
    toast('Couldn’t copy to the clipboard');
    console.error(err);
  }
}

async function run(bundle, path, ...args) {
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: BUNDLES[bundle] });
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [path, args],
    func: (path, args) => {
      const [ns, fn] = path.split('.');
      return globalThis.__tg[ns][fn](...args);
    },
  });
  return res?.result;
}

function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  h('a', { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function hostName() {
  try { return new URL(tab.url).hostname.replace(/^www\./, ''); } catch { return 'page'; }
}

const chip = (c) => h('span', { className: 'chip checker' }, h('i', { style: { background: TGColor.toRgb(c) } }));

// ---------- tabs ----------

const TABS = ['colours', 'fonts', 'screenshot', 'svgs'];

function selectTab(name) {
  for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const t of TABS) $(`#panel-${t}`).hidden = t !== name;
  chrome.storage.local.set({ lastTab: name });
  if (!loaded.has(name)) {
    loaded.add(name);
    ({ colours: loadPalette, fonts: loadFonts, svgs: loadSvgs, screenshot: loadShot })[name]();
  }
}

// ---------- colours ----------

async function loadPalette() {
  try {
    palette = await run('palette', 'palette.scan');
    renderPalette();
  } catch (err) {
    $('#palette-state').textContent = 'Couldn’t read this page’s colours.';
    console.error(err);
  }
}

function renderPalette() {
  if (!palette) return;
  const { colours, totalColours, variables } = palette;
  $('#palette-state').hidden = colours.length > 0;
  $('#palette-state').textContent = 'No colours found.';
  $('#palette-count').textContent = totalColours > colours.length ? `${colours.length} of ${totalColours}` : String(colours.length);
  $('#palette-all').hidden = colours.length < 2;
  $('#palette').replaceChildren(...colours.map((c) => {
    const value = TGColor.format(c, format);
    return h('button', { className: 'swatch', type: 'button', title: `Send ${value} · used ${c.count}×`, onclick: () => send('text', value) },
      h('span', { className: 'chip checker' }, h('i', { style: { background: TGColor.toRgb(c) } })),
      h('span', { className: 'val', textContent: value }),
      h('span', { className: 'n', textContent: `${c.count}×` }));
  }));

  $('#variables-wrap').hidden = variables.length === 0;
  $('#variables-count').textContent = String(variables.length);
  $('#variables').replaceChildren(...variables.map((v) => {
    const value = TGColor.format(v, format);
    return h('li', {}, h('button', { type: 'button', title: `Send ${value}`, onclick: () => send('text', value) },
      chip(v), h('span', { className: 'name', textContent: v.name }), h('span', { className: 'val', textContent: value })));
  }));
}

$('#palette-all').addEventListener('click', async () => {
  const values = palette.colours.map((c) => TGColor.format(c, format));
  if (await TGSend.hasTucket()) {
    sendAll(values.map((data) => ({ kind: 'text', data })));
  } else {
    // Without Tucket, one-after-another copies would leave only the last on the clipboard.
    send('text', values.join('\n'));
  }
});

async function renderPicked() {
  const { picked = [] } = await chrome.storage.session.get('picked');
  $('#picked').hidden = picked.length === 0;
  $('#picked-list').replaceChildren(...picked.map((c) => {
    const value = TGColor.format(c, format);
    return h('button', { className: 'swatch', type: 'button', title: `Send ${value}`, onclick: () => send('text', value) },
      h('span', { className: 'chip checker' }, h('i', { style: { background: TGColor.toRgb(c) } })));
  }));
}

$('#eyedropper').addEventListener('click', async () => {
  if (!('EyeDropper' in window)) { toast('The eyedropper needs Chrome 95 or newer'); return; }
  try {
    const { sRGBHex } = await new EyeDropper().open();
    const c = TGColor.parse(sRGBHex);
    if (!c) return;
    const { picked = [] } = await chrome.storage.session.get('picked');
    const next = [c, ...picked.filter((p) => TGColor.toHex(p) !== TGColor.toHex(c))].slice(0, 12);
    await chrome.storage.session.set({ picked: next });
    renderPicked();
    send('text', TGColor.format(c, format));
  } catch (err) {
    if (err?.name !== 'AbortError') console.error(err);
  }
});

async function startInspector(section) {
  try {
    await run('inspector', 'inspector.start', { section });
    window.close();
  } catch (err) {
    toast('Couldn’t start on this page');
    console.error(err);
  }
}
$('#inspect-colours').addEventListener('click', () => startInspector('colours'));
$('#inspect-fonts').addEventListener('click', () => startInspector('fonts'));

// ---------- fonts ----------

async function loadFonts() {
  try {
    const { used, unused } = await run('fonts', 'fonts.scan');
    $('#fonts-state').hidden = used.length > 0;
    $('#fonts-state').textContent = 'No text found.';
    $('#fonts-count').textContent = String(used.length);
    const kinds = { web: 'Web font', system: 'Installed', generic: 'Default' };
    $('#fonts').replaceChildren(...used.map((f) => h('li', { className: 'font' },
      h('div', { className: 'top' },
        h('span', { className: 'family', textContent: f.family }),
        h('span', { className: 'badge', textContent: kinds[f.kind] })),
      h('div', { className: 'sample', role: 'img', 'aria-label': `Sample of ${f.family}`, style: { maskImage: `url(${f.sample})`, webkitMaskImage: `url(${f.sample})` } }),
      h('div', { className: 'meta', textContent: `Weights ${f.weights.join(', ')} · ${f.elements} ${f.elements === 1 ? 'element' : 'elements'}` }),
      h('div', { className: 'line', textContent: f.line, title: 'Most common style' }),
      h('div', { className: 'buttons' },
        h('button', { className: 'btn primary', type: 'button', textContent: 'Send line', onclick: () => send('text', f.line) }),
        h('button', { className: 'btn', type: 'button', textContent: 'Copy as CSS', onclick: () => send('text', f.css) }),
        h('button', { className: 'btn', type: 'button', textContent: 'Name', title: 'Copy the family name', onclick: () => send('text', f.family) })),
    )));
    $('#unused-wrap').hidden = unused.length === 0;
    $('#unused').replaceChildren(...unused.map((u) => h('li', { textContent: `${u.family} · ${u.weights.join(', ')}` })));
  } catch (err) {
    $('#fonts-state').textContent = 'Couldn’t read this page’s fonts.';
    console.error(err);
  }
}

// ---------- screenshot ----------

const PHASE_TITLES = {
  starting: 'Getting ready…',
  loading: 'Loading the page…',
  selecting: 'Select an area on the page',
  capturing: 'Capturing…',
  stitching: 'Stitching…',
  saving: 'Saving…',
  done: 'Done — opening it in a new tab',
};

function showShot(progress) {
  const running = progress && !['cancelled', 'error'].includes(progress.phase);
  $('#shot-choose').hidden = !!running;
  $('#shot-progress').hidden = !running;
  $('#shot-error').hidden = progress?.phase !== 'error';
  if (progress?.phase === 'error') $('#shot-error').textContent = progress.message;
  if (!running) return;

  const { phase, current = 0, total = 0, secondsLeft } = progress;
  let title = PHASE_TITLES[phase] || 'Working…';
  let detail = '';
  let pct = 0;
  if (phase === 'loading') {
    detail = 'Scrolling once so lazy images load';
    pct = total ? (current / total) * 15 : 5;
  } else if (phase === 'capturing') {
    title = total > 1 ? `Capturing screen ${current} of ${total}` : 'Capturing…';
    if (total > 1) detail = `About ${secondsLeft}s left — the browser allows two captures a second`;
    pct = 15 + (total ? (current / total) * 75 : 0);
  } else if (phase === 'stitching' || phase === 'saving') {
    pct = 95;
  } else if (phase === 'done') {
    pct = 100;
  }
  $('#shot-title').textContent = title;
  $('#shot-detail').textContent = detail;
  $('#shot-bar').style.width = `${pct}%`;
  $('#shot-cancel').hidden = phase === 'done' || phase === 'saving';
}

async function loadShot() {
  const { progress } = await chrome.runtime.sendMessage({ type: 'shot:status' });
  showShot(progress);
}

for (const btn of document.querySelectorAll('[data-shot]')) {
  btn.addEventListener('click', async () => {
    const mode = btn.dataset.shot;
    const res = await chrome.runtime.sendMessage({ type: 'shot:start', mode, tabId: tab.id, windowId: tab.windowId });
    if (!res?.ok) { showShot({ phase: 'error', message: res?.error || 'Couldn’t start the capture.' }); return; }
    if (mode === 'region') window.close();
    else showShot({ phase: 'starting' });
  });
}

$('#shot-cancel').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'shot:cancel' }));

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'shot:progress') showShot(msg.progress);
});

// ---------- SVGs ----------

function svgGeometry(markup) {
  const tag = markup.slice(0, markup.indexOf('>') + 1);
  const attr = (name) => tag.match(new RegExp(`\\s${name}=["']([^"']*)["']`))?.[1];
  const vb = attr('viewBox')?.split(/[\s,]+/).map(Number);
  if (vb?.length === 4 && vb[2] > 0 && vb[3] > 0) return { w: vb[2], h: vb[3] };
  const w = parseFloat(attr('width')), hh = parseFloat(attr('height'));
  return w > 0 && hh > 0 ? { w, h: hh } : null;
}

function svgKind(item) {
  if (!item.markup) return 'SVG';
  const g = svgGeometry(item.markup);
  if (!g || item.bytes > ICON_MAX_BYTES || Math.max(g.w, g.h) > ICON_MAX_SIDE) return 'SVG';
  const aspect = g.w / g.h;
  return aspect >= ICON_ASPECT[0] && aspect <= ICON_ASPECT[1] ? 'Icon' : 'SVG';
}

const DOWNLOAD_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12m-5-5 5 5 5-5M5 20h14"/></svg>';

async function loadSvgs() {
  try {
    const { items, capped } = await run('svgs', 'svgs.scan');
    svgItems = items;
    const readable = items.filter((i) => i.markup);
    $('#svgs-state').hidden = items.length > 0;
    $('#svgs-state').textContent = 'No SVGs found on this page.';
    $('#svgs-count').textContent = capped ? `${items.length}+` : String(items.length);
    $('#svgs-all').hidden = readable.length < 2 || !(await TGSend.hasTucket());

    $('#svgs').replaceChildren(...items.map((item, index) => {
      const kind = svgKind(item);
      const g = item.markup ? svgGeometry(item.markup) : null;
      const dims = g ? `${Math.round(g.w)}×${Math.round(g.h)}` : '';
      const label = [kind, dims].filter(Boolean).join(' · ');
      const preview = item.markup
        ? h('img', { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(item.markup)}`, alt: item.name || label })
        : h('span', { className: 'none', textContent: 'Can’t read this file (another site)' });
      const sendBtn = h('button', {
        className: 'send checker', type: 'button',
        title: item.markup ? `Send ${item.name || 'SVG'} to Tucket` : 'Copy the file URL',
        onclick: () => (item.markup ? send('svg', item.markup) : item.url && send('text', item.url)),
      }, preview);
      const dl = item.markup
        ? h('button', {
            className: 'dl', type: 'button', title: 'Download .svg', innerHTML: DOWNLOAD_ICON,
            onclick: () => download(`${hostName()}-${(item.name || kind.toLowerCase()).replace(/[^\w-]+/g, '-')}-${index + 1}.svg`, new Blob([item.markup], { type: 'image/svg+xml' })),
          })
        : null;
      const tile = h('div', { className: 'tile', title: `${item.source}${item.instances > 1 ? ` · used ${item.instances}×` : ''}` },
        sendBtn,
        h('div', { className: 'info' }, h('span', { textContent: item.name ? `${item.name} · ${label}` : label }), dl));
      tile.addEventListener('mouseenter', () => highlight(item.id));
      return tile;
    }));
  } catch (err) {
    $('#svgs-state').textContent = 'Couldn’t scan this page for SVGs.';
    console.error(err);
  }
}

let highlightQueued = null;
let highlighting = false;
async function highlight(id) {
  highlightQueued = id;
  if (highlighting) return;
  highlighting = true;
  while (highlightQueued !== undefined) {
    const next = highlightQueued;
    highlightQueued = undefined;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id }, args: [next],
      func: (id) => globalThis.__tg?.svgs?.highlight(id),
    }).catch(() => {});
  }
  highlighting = false;
}
$('#svgs').addEventListener('mouseleave', () => highlight(null));

$('#svgs-all').addEventListener('click', () => {
  sendAll(svgItems.filter((i) => i.markup).map((i) => ({ kind: 'svg', data: i.markup })));
});

// ---------- format ----------

function applyFormat() {
  for (const b of document.querySelectorAll('[data-format]')) b.setAttribute('aria-pressed', String(b.dataset.format === format));
  renderPalette();
  renderPicked();
}

$('#format').addEventListener('click', (e) => {
  const b = e.target.closest('[data-format]');
  if (b) chrome.storage.local.set({ colorFormat: b.dataset.format });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.colorFormat) {
    format = changes.colorFormat.newValue || 'hex';
    applyFormat();
  }
});

// ---------- boot ----------

async function targetTab() {
  // ?tabId= lets the automated tests open the popup as a page aimed at a fixture tab.
  if (params.has('tabId')) return chrome.tabs.get(Number(params.get('tabId')));
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return active;
}

async function boot() {
  TGFooter.mount($('#footer'), 'popup');
  tab = await targetTab();
  const stored = await chrome.storage.local.get(['colorFormat', 'lastTab']);
  format = stored.colorFormat || 'hex';
  applyFormat();

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => true });
  } catch {
    $('.tabs').hidden = true;
    $('#format').hidden = true;
    $('#blocked').hidden = false;
    return;
  }

  for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => selectTab(b.dataset.tab));
  const { progress } = await chrome.runtime.sendMessage({ type: 'shot:status' });
  selectTab(progress ? 'screenshot' : TABS.includes(stored.lastTab) ? stored.lastTab : 'colours');
}

window.addEventListener('pagehide', () => highlight(null));
boot();
