// Service worker. Opens the in-page panel from the toolbar, runs screenshots (they need
// captureVisibleTab, which only extension contexts have), and talks to Tucket over the bridge.
import { putCapture, pruneCaptures } from './lib/idb.js';
import * as tucket from './lib/tucket.js';

const PANEL_FILES = [
  'src/shared/color.js', 'src/shared/send.js', 'src/shared/fonts.js',
  'src/content/palette.js', 'src/content/fonts.js', 'src/content/svgs.js',
  'src/content/panel-css.js', 'src/content/panel.js',
];

const CAPTURE_GAP_MS = 520;      // Chrome allows two captureVisibleTab calls per second.
const SETTLE_MS = 160;           // Let the page repaint after a scroll before capturing.
const LAZY_STEP_MS = 90;         // Dwell per screen on the pre-pass that wakes lazy images.
const MAX_FRAMES = 60;           // Infinite feeds never end; stop somewhere sensible.
const MAX_CHUNK_HEIGHT = 20000;  // Canvas limits: past this, split into several images.
const MAX_CHUNK_AREA = 200_000_000;
const DIFF_THRESHOLD = 8;        // total channel change that counts as "this pixel is not the same"
const MOVED_SHARE = 0.02;        // share of a row or column that must move for it to be content
const FLAT_RANGE = 12;           // a line this uniform is empty space, not a bar

let job = null;
let lastCaptureAt = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome/welcome.html') });
});

// ---------- toolbar → panel ----------

chrome.action.onClicked.addListener((tab) => togglePanel(tab));

async function togglePanel(tab) {
  try {
    const [probe] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (globalThis.__tg?.panel ? globalThis.__tg.panel.toggle() : 'missing'),
    });
    if (probe?.result !== 'missing') return;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: PANEL_FILES });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.__tg.panel.open() });
  } catch {
    // chrome://, the Web Store, the new tab page: nothing can be injected, so explain in a popup.
    // blocked.html clears this per-tab popup again, so the next click on a normal page works.
    await chrome.action.setPopup({ tabId: tab.id, popup: 'src/blocked/blocked.html' });
    await chrome.action.openPopup({ windowId: tab.windowId }).catch(() => {});
  }
}

// ---------- keyboard shortcuts ----------

// Each capture mode has its own shortcut (rebindable at chrome://extensions/shortcuts). A shortcut
// grants activeTab exactly as a toolbar click does.
const COMMAND_MODES = { 'shot-full': 'full', 'shot-visible': 'visible', 'shot-region': 'region' };

chrome.commands.onCommand.addListener((command, tab) => runCommand(command, tab));

function runCommand(command, tab) {
  const mode = COMMAND_MODES[command];
  if (!mode || !tab?.id) return false;
  if (job) return false;
  runShot({ mode, tabId: tab.id });
  return true;
}

// The automated tests can't click the toolbar or press a shortcut, so they call the same handlers.
globalThis.tucketGrab = { togglePanel, runCommand };

// ---------- messages ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg?.type) {
    case 'shot:start': {
      const tabId = msg.tabId ?? sender.tab?.id;
      if (job) {
        sendResponse({ ok: false, error: 'A capture is already running.' });
      } else if (tabId == null) {
        sendResponse({ ok: false, error: 'No page to capture.' });
      } else {
        sendResponse({ ok: true });
        runShot({ mode: msg.mode, tabId });
      }
      return;
    }
    case 'shot:cancel':
      if (job) job.cancelled = true;
      sendResponse({ ok: true });
      return;
    case 'shot:status':
      sendResponse({ progress: job ? job.progress : null });
      return;
    case 'tucket:status':
      tucket.status({ fresh: !!msg.fresh }).then(sendResponse);
      return true;
    case 'tucket:send':
      sendToTucket(msg, sender).then(sendResponse);
      return true;
    case 'fonts:lookup':
      lookupFonts(msg.families || []).then(sendResponse);
      return true;
    case 'tool:start':
      sendResponse({ ok: false, error: 'This arrives with Tucket 1.3.8.' });
      return;
  }
});

async function sendToTucket({ kind, data, pageUrl, pageTitle }, sender) {
  const s = await tucket.status();
  if (s.state !== 'connected') return { ok: false };
  try {
    await tucket.request('ingest', {
      kind, data,
      pageUrl: pageUrl || sender.tab?.url || '',
      pageTitle: pageTitle || sender.tab?.title || '',
    });
    return { ok: true };
  } catch (err) {
    tucket.forget();
    return { ok: false, error: String(err?.message || err) };
  }
}

// ---------- font lookups ----------

// For web fonts the page doesn't say the source of (self-hosted), ask Fontsource whether the family
// is a free, open-licence font. Only the family name is sent — never the page. Answers are cached
// on this computer so each family is looked up at most once a month.
const FONTSOURCE_API = 'https://api.fontsource.org/v1/fonts/';
const LOOKUP_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOOKUP_CACHE_MAX = 500;

const fontId = (family) => family.toLowerCase().replace(/['"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function lookupFonts(families) {
  const { fontLookups = {} } = await chrome.storage.local.get('fontLookups');
  const out = {};
  let changed = false;
  await Promise.all(families.slice(0, 20).map(async (family) => {
    const id = fontId(family);
    if (!id) return;
    const hit = fontLookups[id];
    if (hit && Date.now() - hit.at < LOOKUP_TTL_MS) { out[family] = hit.value; return; }
    try {
      // Sites rename variable builds ("Inter Variable", "sohne-var"); try the plain family too.
      const plain = id.replace(/-(variable|var|vf)$/, '');
      let value = null;
      for (const candidate of plain !== id ? [id, plain] : [id]) {
        const res = await fetch(FONTSOURCE_API + candidate, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
        if (res.status === 404) { value = { found: false }; continue; }
        if (!res.ok) { value = null; break; }
        const f = await res.json();
        value = { found: true, id: f.id || candidate, family: f.family || family, type: f.type || '', license: f.license || '' };
        break;
      }
      if (value) {
        out[family] = value;
        fontLookups[id] = { at: Date.now(), value };
        changed = true;
      }
    } catch { /* offline: no link rather than a wrong one */ }
  }));
  if (changed) {
    const entries = Object.entries(fontLookups).sort((a, b) => b[1].at - a[1].at).slice(0, LOOKUP_CACHE_MAX);
    await chrome.storage.local.set({ fontLookups: Object.fromEntries(entries) });
  }
  return out;
}

// ---------- plumbing ----------

function report(progress) {
  if (job) job.progress = progress;
  const tabId = job?.tabId;
  chrome.runtime.sendMessage({ type: 'shot:progress', progress }).catch(() => {});
  if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'shot:progress', progress }).catch(() => {});
  if (!tabId) return;
  if (progress.phase === 'capturing' && progress.total > 1) {
    chrome.action.setBadgeBackgroundColor({ color: '#6C6CF8', tabId });
    chrome.action.setBadgeText({ text: `${Math.round((progress.current / progress.total) * 100)}%`, tabId });
  } else if (progress.phase === 'loading' || progress.phase === 'stitching') {
    chrome.action.setBadgeBackgroundColor({ color: '#6C6CF8', tabId });
    chrome.action.setBadgeText({ text: '…', tabId });
  }
}

async function inject(tabId, files) {
  await chrome.scripting.executeScript({ target: { tabId }, files });
}

async function call(tabId, path, ...args) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [path, args],
    func: (path, args) => {
      const [ns, fn] = path.split('.');
      return globalThis.__tg[ns][fn](...args);
    },
  });
  return res?.result;
}

async function captureTab(tabId, windowId) {
  for (let attempt = 0; ; attempt++) {
    const wait = lastCaptureAt + CAPTURE_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active) throw new Error('TAB_SWITCHED');
    lastCaptureAt = Date.now();
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    } catch (err) {
      if (attempt < 3 && /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota/i.test(String(err?.message))) {
        await sleep(800);
        continue;
      }
      throw err;
    }
  }
}

async function toBitmap(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
}

// Which part of the window actually scrolls, measured from two screens rather than believed from
// the DOM. App shells put their sidebar and composer inside a full-window fixed container, so the
// DOM can report the whole window as scrollable, and an overlaid composer sits inside that area.
//
// Rows and columns are judged one at a time: a row belongs to the scrolling content when much of
// its width changed, which a composer with content sliding past in the margins beside it fails.
// Flat rows and columns (a plain background scrolling over itself changes no pixels) are then
// folded back in, out to the DOM's edges, so the band isn't cut short by empty space.
async function measureBand(a, b, dom, step = 4) {
  const w = Math.max(1, Math.floor(a.width / step));
  const h = Math.max(1, Math.floor(a.height / step));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(a, 0, 0, w, h);
  const A = ctx.getImageData(0, 0, w, h).data;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(b, 0, 0, w, h);
  const B = ctx.getImageData(0, 0, w, h).data;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const x0d = clamp(Math.floor(dom.x / step), 0, w - 1);
  const x1d = clamp(Math.ceil((dom.x + dom.w) / step) - 1, 0, w - 1);
  const y0d = clamp(Math.floor(dom.y / step), 0, h - 1);
  const y1d = clamp(Math.ceil((dom.y + dom.h) / step) - 1, 0, h - 1);
  if (x1d <= x0d || y1d <= y0d) return null;

  const moved = (x, y) => {
    const i = (y * w + x) * 4;
    return Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) >= DIFF_THRESHOLD;
  };
  const lum = (x, y) => { const i = (y * w + x) * 4; return A[i] + A[i + 1] + A[i + 2]; };
  // A line of one flat colour scrolling over itself changes nothing, so it reads as quiet rather
  // than as a bar. Those get folded back in afterwards.
  const flat = (from, to, at) => {
    let min = 765, max = 0;
    for (let i = from; i <= to; i++) {
      const v = at(i);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return max - min < FLAT_RANGE;
  };
  const share = (from, to, test) => {
    let n = 0;
    for (let i = from; i <= to; i++) if (test(i)) n++;
    return n / (to - from + 1);
  };
  const mean = (from, to, at) => {
    let sum = 0;
    for (let i = from; i <= to; i++) sum += at(i);
    return sum / (to - from + 1);
  };
  // Quiet, and the same colour as what it's extending from. A flat bar laid over the content (a
  // composer, a toolbar) is flat too, but it is not the same colour, so the band stops at it.
  const extend = (from, to, at, atPrev) =>
    flat(from, to, at) && Math.abs(mean(from, to, at) - mean(from, to, atPrev)) < FLAT_RANGE;

  // The longest unbroken stretch of moving lines, bridging quiet stretches of the same colour.
  // A bar laid over the content (a composer, a toolbar) breaks the stretch, and the content
  // peeking out beyond it is a shorter stretch that loses, so the band stops at the bar.
  const longestRun = (from, to, isMoving, bridges) => {
    const runs = [];
    let run = null;
    for (let i = from; i <= to; i++) {
      if (isMoving(i)) {
        if (run) run.to = i;
        else run = { from: i, to: i };
      } else if (run && !bridges(i, i - 1)) {
        runs.push(run);
        run = null;
      }
    }
    if (run) runs.push(run);
    if (!runs.length) return null;
    return runs.sort((a, b) => b.to - b.from - (a.to - a.from))[0];
  };

  // Columns first: a sidebar never changes, whatever the DOM claims the scrolling element is.
  const cols = longestRun(x0d, x1d, (x) => share(y0d, y1d, (y) => moved(x, y)) >= MOVED_SHARE,
    (x, px) => extend(y0d, y1d, (y) => lum(x, y), (y) => lum(px, y)));
  if (!cols) return null;
  let { from: left, to: right } = cols;
  while (left > x0d && extend(y0d, y1d, (y) => lum(left - 1, y), (y) => lum(left, y))) left--;
  while (right < x1d && extend(y0d, y1d, (y) => lum(right + 1, y), (y) => lum(right, y))) right++;

  // Rows are judged across the middle of those columns only. A composer or toolbar laid over the
  // content covers that middle, so it stays still there even while content slides past beside it.
  const inset = Math.floor((right - left + 1) * 0.1);
  const midLeft = left + inset;
  const midRight = right - inset;
  const rows = longestRun(y0d, y1d, (y) => share(midLeft, midRight, (x) => moved(x, y)) >= MOVED_SHARE,
    (y, py) => extend(midLeft, midRight, (x) => lum(x, y), (x) => lum(x, py)));
  if (!rows) return null;
  let { from: top, to: bottom } = rows;
  while (top > y0d && extend(midLeft, midRight, (x) => lum(x, top - 1), (x) => lum(x, top))) top--;
  while (bottom < y1d && extend(midLeft, midRight, (x) => lum(x, bottom + 1), (x) => lum(x, bottom))) bottom++;

  const rect = {
    x: left * step,
    y: top * step,
    w: Math.min((right - left + 1) * step, a.width - left * step),
    h: Math.min((bottom - top + 1) * step, a.height - top * step),
  };
  // Far smaller than the element the DOM pointed at: something else moved, so don't trust it.
  return rect.w * rect.h < dom.w * dom.h * 0.25 ? null : rect;
}

async function crop(bmp, sx, sy, w, h) {
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bmp, sx, sy, w, h, 0, 0, w, h);
  return { blob: await canvas.convertToBlob({ type: 'image/png' }), width: w, height: h };
}

function friendlyError(err) {
  const msg = String(err?.message || err);
  if (msg === 'TAB_SWITCHED') return 'You switched tabs, so the capture stopped. Stay on the page while it runs.';
  if (/cannot be scripted|Cannot access|chrome:\/\/|edge:\/\/|brave:\/\/|extensions gallery|permission/i.test(msg)) {
    return 'The browser doesn’t let extensions capture this page.';
  }
  return `Capture failed: ${msg}`;
}

// ---------- screenshots ----------

async function runShot({ mode, tabId }) {
  job = { tabId, mode, cancelled: false, progress: { phase: 'starting', mode } };
  // Started from a shortcut, the panel may be open on the page: it must never be in the capture.
  // It comes back by itself when the capture reports done, cancelled or failed.
  // Wait two frames so the page has repainted without it before anything is captured.
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => new Promise((done) => {
      if (!globalThis.__tg?.panel?.isOpen?.()) { done(); return; }
      globalThis.__tg.panel.hideForCapture();
      requestAnimationFrame(() => requestAnimationFrame(() => done()));
      setTimeout(done, 120);
    }),
  }).catch(() => {});
  report({ phase: 'starting', mode });
  try {
    const tab = await chrome.tabs.get(tabId);
    const result = mode === 'visible' ? await shootVisible(tab)
      : mode === 'region' ? await shootRegion(tab)
      : await shootFullPage(tab);
    if (!result) {
      report({ phase: 'cancelled', mode });
      return;
    }
    report({ phase: 'saving', mode });
    const id = crypto.randomUUID();
    await pruneCaptures();
    const [dpr] = await chrome.scripting.executeScript({ target: { tabId }, func: () => devicePixelRatio }).catch(() => [null]);
    await putCapture({
      id, mode, createdAt: Date.now(), pageUrl: tab.url, pageTitle: tab.title,
      dpr: dpr?.result || 1, parts: result.parts, notes: result.notes,
    });
    report({ phase: 'done', mode, id });
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`src/capture/capture.html?id=${id}`),
      windowId: tab.windowId, // not the focused window: the user may have moved on to another
      index: tab.index + 1,
      openerTabId: tab.id,
    });
  } catch (err) {
    console.error('Tucket Grab capture failed', err);
    report({ phase: 'error', mode, message: friendlyError(err) });
  } finally {
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
    job = null;
  }
}

async function shootVisible(tab) {
  report({ phase: 'capturing', mode: 'visible', current: 1, total: 1 });
  const bmp = await toBitmap(await captureTab(tab.id, tab.windowId));
  const part = await crop(bmp, 0, 0, bmp.width, bmp.height);
  bmp.close();
  return { parts: [part], notes: [] };
}

async function shootRegion(tab) {
  await inject(tab.id, ['src/content/region.js']);
  report({ phase: 'selecting', mode: 'region' });
  const rect = await call(tab.id, 'region.select');
  if (!rect) return null;
  report({ phase: 'capturing', mode: 'region', current: 1, total: 1 });
  const bmp = await toBitmap(await captureTab(tab.id, tab.windowId));
  const s = bmp.width / rect.viewportW;
  const sx = Math.max(0, Math.round(rect.x * s));
  const sy = Math.max(0, Math.round(rect.y * s));
  const w = Math.min(bmp.width - sx, Math.round(rect.w * s));
  const h = Math.min(bmp.height - sy, Math.round(rect.h * s));
  const part = await crop(bmp, sx, sy, w, h);
  bmp.close();
  return { parts: [part], notes: [] };
}

async function shootFullPage(tab) {
  const { id: tabId, windowId } = tab;
  await inject(tabId, ['src/content/screenshot.js']);
  let info = await call(tabId, 'shot.prepare');
  const notes = [];

  try {
    // 1. One quick pass down the page so lazy images and scroll-triggered content load.
    const passSteps = Math.min(MAX_FRAMES, Math.ceil(info.totalH / info.stepH));
    for (let i = 1; i < passSteps; i++) {
      if (job.cancelled) return null;
      report({ phase: 'loading', mode: 'full', current: i, total: passSteps - 1 });
      await call(tabId, 'shot.scrollTo', i * info.stepH);
      await sleep(LAZY_STEP_MS);
    }
    await call(tabId, 'shot.scrollTo', 0);
    await sleep(passSteps > 1 ? 450 : 50);
    info = await call(tabId, 'shot.measure');

    // 2. Take the first screen, and in a panel a probe screen too, which shows which band of the
    //    window actually scrolls. An app's sidebar, top bar and composer never move; only the band
    //    between them does, and the content hidden behind a composer is only ever seen if the
    //    scroll step matches that visible band rather than the element's full height.
    const screen = async (y, i, count) => {
      const actualY = await call(tabId, 'shot.scrollTo', y);
      if (i > 0) await call(tabId, 'shot.hideFixed');
      await sleep(SETTLE_MS);
      report({
        phase: 'capturing', mode: 'full', current: Math.min(i + 1, count), total: count,
        secondsLeft: Math.ceil(((count - i) * CAPTURE_GAP_MS) / 1000),
      });
      return { bmp: await toBitmap(await captureTab(tabId, windowId)), y: actualY };
    };

    const rough = Math.ceil(info.totalH / info.stepH);
    const first = await screen(0, 0, rough);
    const scale = first.bmp.width / info.viewportW;
    const domBand = info.mode === 'element'
      ? { x: info.rect.x * scale, y: info.rect.y * scale, w: info.rect.w * scale, h: info.rect.h * scale }
      : null;
    let band = null;
    if (domBand && info.totalH > info.stepH) {
      if (job.cancelled) return null;
      const probe = await screen(info.stepH, 1, rough);
      band = await measureBand(first.bmp, probe.bmp, domBand);
      probe.bmp.close();
    }
    if (domBand && !band) notes.push('The scrolling area couldn’t be measured exactly, so part of the window may repeat.');

    // 3. Plan the screens. Step by what's actually visible (so nothing hides behind a composer),
    //    but stop where the page itself stops: it can't scroll past its own end.
    const step = band ? band.h / scale : info.stepH;
    let maxScroll = Math.max(0, info.totalH - info.stepH);
    if (maxScroll > MAX_FRAMES * step) {
      maxScroll = MAX_FRAMES * step;
      notes.push(`This page is very long, so the capture stops after ${MAX_FRAMES} screens.`);
    }
    const positions = [];
    for (let y = step; y < maxScroll; y += step) positions.push(y);
    if (maxScroll > 0) positions.push(maxScroll);

    const stitcher = new Stitcher(first.bmp, info, maxScroll, band || domBand);
    await stitcher.add(first.bmp, first.y);
    for (let i = 0; i < positions.length; i++) {
      if (job.cancelled) return null;
      const { bmp, y } = await screen(positions[i], i + 1, positions.length + 1);
      await stitcher.add(bmp, y);
      bmp.close();
    }

    report({ phase: 'stitching', mode: 'full' });
    const parts = await stitcher.finish();
    if (parts.length > 1) notes.push(`The page is too tall for one image, so it’s split into ${parts.length} parts.`);
    if (info.mode === 'element') notes.push('This app scrolls inside a panel. The panel is expanded in full; the sidebar and bars around it come from the first screen.');
    return { parts, notes };
  } finally {
    await call(tabId, 'shot.restore').catch(() => {});
  }
}

// Draws each screen onto one or more canvases as it arrives, so memory holds at most a couple of
// canvases, never every screen at once. Only the part of each screen below what's already drawn
// is used, which keeps overlap on the final (short) screen from doubling content.
//
// When the page itself doesn't scroll and a panel inside it does (Gemini, docs sites, web apps),
// the whole window is kept: the panel is expanded in place, while the sidebar and the bars above
// and below it come from the first screen, with their edges carried down the sides.
class Stitcher {
  constructor(first, info, maxScroll, band) {
    const s = (this.scale = first.width / info.viewportW);
    this.element = info.mode === 'element';
    this.first = first;
    if (this.element) {
      // The measured band wins over the DOM's idea of the scrolling element.
      this.w = first.width;
      this.panelX = Math.max(0, Math.round(band.x));
      this.panelW = Math.min(first.width - this.panelX, Math.round(band.w));
      this.top = Math.max(0, Math.round(band.y));
      this.panelH = Math.min(first.height - this.top, Math.round(band.h));
      this.bottom = Math.max(0, first.height - this.top - this.panelH);
    } else {
      this.w = Math.min(first.width, Math.round(info.clientW * s)); // drop the scrollbar
      this.panelX = 0;
      this.panelW = this.w;
      this.top = 0;
      this.panelH = first.height;
      this.bottom = 0;
    }
    // The last screen sits at the page's maximum scroll, so the image is that distance plus one band.
    this.total = this.top + Math.round(maxScroll * s) + this.panelH + this.bottom;
    this.chunkH = Math.max(1, Math.min(MAX_CHUNK_HEIGHT, Math.floor(MAX_CHUNK_AREA / this.w)));
    this.open = [];   // { index, start, canvas, ctx }
    this.parts = [];
    this.drawnBottom = 0;
    this.firstDrawn = false;
  }

  chunk(index) {
    let c = this.open.find((o) => o.index === index);
    if (!c) {
      const start = index * this.chunkH;
      const canvas = new OffscreenCanvas(this.w, Math.min(this.chunkH, this.total - start));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      c = { index, start, canvas, ctx };
      this.open.push(c);
      if (this.element) this.carrySides(c);
    }
    return c;
  }

  // Below the first screen there's no sidebar left to photograph, so the columns beside the panel
  // are filled with the sidebar's own background colour. Flat, never a repeated avatar or menu.
  carrySides(c) {
    const from = Math.max(c.start, this.first.height);
    const to = Math.min(c.start + c.canvas.height, this.total - this.bottom);
    if (to <= from) return;
    const rightX = this.panelX + this.panelW;
    const rightW = this.w - rightX;
    if (this.panelX > 0) {
      c.ctx.fillStyle = this.sideColour(0, this.panelX);
      c.ctx.fillRect(0, from - c.start, this.panelX, to - from);
    }
    if (rightW > 0) {
      c.ctx.fillStyle = this.sideColour(rightX, rightW);
      c.ctx.fillRect(rightX, from - c.start, rightW, to - from);
    }
  }

  // The commonest colour down a column of the first screen: an app's sidebar background.
  sideColour(x, width) {
    if (!this.sides) this.sides = new Map();
    const key = `${x}:${width}`;
    if (this.sides.has(key)) return this.sides.get(key);
    const probe = new OffscreenCanvas(1, 64);
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(this.first, x + Math.floor(width / 2), 0, 1, this.first.height, 0, 0, 1, 64);
    const data = ctx.getImageData(0, 0, 1, 64).data;
    const counts = new Map();
    let best = '#ffffff';
    let bestN = 0;
    for (let i = 0; i < data.length; i += 4) {
      const hex = `#${[data[i], data[i + 1], data[i + 2]].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
      const n = (counts.get(hex) || 0) + 1;
      counts.set(hex, n);
      if (n > bestN) { bestN = n; best = hex; }
    }
    this.sides.set(key, best);
    return best;
  }

  async add(bmp, cssY) {
    // The first screen goes down whole: it holds the sidebar, the top bar and the panel's top.
    if (!this.firstDrawn) {
      this.firstDrawn = true;
      const height = Math.min(bmp.height, this.total);
      for (let k = Math.floor(0 / this.chunkH); k * this.chunkH < height; k++) {
        const c = this.chunk(k);
        c.ctx.drawImage(bmp, 0, 0, this.w, height, 0, -c.start, this.w, height);
      }
      this.drawnBottom = Math.min(this.top + this.panelH, this.total - this.bottom);
      if (!this.element) this.drawnBottom = Math.min(bmp.height, this.total);
      await this.flush(false);
      return;
    }

    const destY = this.top + Math.round(cssY * this.scale);
    const from = Math.max(destY, this.drawnBottom);
    const to = Math.min(destY + this.panelH, this.total - this.bottom);
    if (to <= from) return;
    const srcY = this.top + (from - destY);
    for (let k = Math.floor(from / this.chunkH); k * this.chunkH < to; k++) {
      const c = this.chunk(k);
      c.ctx.drawImage(bmp, this.panelX, srcY, this.panelW, to - from, this.panelX, from - c.start, this.panelW, to - from);
    }
    this.drawnBottom = to;
    await this.flush(false);
  }

  // The app's bottom bar (a composer, a toolbar) belongs at the very bottom of the finished image.
  carryBottom() {
    if (!this.element || !this.bottom) return;
    const from = this.total - this.bottom;
    for (const c of this.open) {
      const top = Math.max(from, c.start);
      const end = Math.min(this.total, c.start + c.canvas.height);
      if (end <= top) continue;
      c.ctx.drawImage(this.first, 0, this.first.height - this.bottom + (top - from), this.w, end - top, 0, top - c.start, this.w, end - top);
    }
    this.drawnBottom = this.total;
  }

  async flush(all) {
    this.open.sort((a, b) => a.index - b.index);
    while (this.open.length && (all || this.open[0].start + this.open[0].canvas.height <= this.drawnBottom)) {
      const c = this.open.shift();
      let canvas = c.canvas;
      const used = Math.min(canvas.height, this.drawnBottom - c.start);
      if (used <= 0) continue;
      if (used < canvas.height) {
        // The page came up shorter than measured: trim the blank tail.
        const trimmed = new OffscreenCanvas(canvas.width, used);
        trimmed.getContext('2d').drawImage(canvas, 0, 0);
        canvas = trimmed;
      }
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      this.parts.push({ blob, width: canvas.width, height: canvas.height });
    }
  }

  async finish() {
    this.carryBottom();
    await this.flush(true);
    this.first.close();
    return this.parts;
  }
}
