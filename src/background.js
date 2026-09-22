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

// The automated tests can't click the toolbar, so they call the same handler.
globalThis.tucketGrab = { togglePanel };

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

    // 2. Plan the screens.
    let totalH = info.totalH;
    if (totalH > MAX_FRAMES * info.stepH) {
      totalH = MAX_FRAMES * info.stepH;
      notes.push(`This page is very long, so the capture stops after ${MAX_FRAMES} screens.`);
    }
    const positions = [];
    for (let y = 0; y < totalH - info.stepH; y += info.stepH) positions.push(y);
    positions.push(Math.max(0, totalH - info.stepH));

    // 3. Scroll, hide repeated fixed elements, capture, stitch as we go.
    let stitcher = null;
    for (let i = 0; i < positions.length; i++) {
      if (job.cancelled) return null;
      const actualY = await call(tabId, 'shot.scrollTo', positions[i]);
      if (i > 0) await call(tabId, 'shot.hideFixed');
      await sleep(SETTLE_MS);
      report({
        phase: 'capturing', mode: 'full', current: i + 1, total: positions.length,
        secondsLeft: Math.ceil(((positions.length - i) * CAPTURE_GAP_MS) / 1000),
      });
      const bmp = await toBitmap(await captureTab(tabId, windowId));
      const first = !stitcher;
      stitcher ||= new Stitcher(bmp, info, totalH);
      await stitcher.add(bmp, actualY);
      if (!first) bmp.close();   // the first screen is kept: it carries the app's sidebar and bars
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
  constructor(first, info, totalH) {
    const s = (this.scale = first.width / info.viewportW);
    this.element = info.mode === 'element';
    this.first = first;
    if (this.element) {
      this.w = first.width;
      this.panelX = Math.max(0, Math.round(info.rect.x * s));
      this.panelW = Math.min(first.width - this.panelX, Math.round(info.rect.w * s));
      this.top = Math.max(0, Math.round(info.rect.y * s));
      this.panelH = Math.min(first.height - this.top, Math.round(info.rect.h * s));
      this.bottom = Math.max(0, first.height - this.top - this.panelH);
    } else {
      this.w = Math.min(first.width, Math.round(info.clientW * s)); // drop the scrollbar
      this.panelX = 0;
      this.panelW = this.w;
      this.top = 0;
      this.panelH = first.height;
      this.bottom = 0;
    }
    this.total = this.top + Math.round(totalH * s) + this.bottom;
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

  // Below the first screen there is no sidebar to copy, so its last row is carried down. On the
  // flat backgrounds app shells use, that's exactly right; on a patterned one it stays a sensible
  // continuation rather than a white gap.
  carrySides(c) {
    const from = Math.max(c.start, this.first.height);
    const to = Math.min(c.start + c.canvas.height, this.total - this.bottom);
    if (to <= from) return;
    const srcY = Math.min(this.first.height - 1, this.top + this.panelH - 1);
    const rightX = this.panelX + this.panelW;
    const rightW = this.w - rightX;
    if (this.panelX > 0) c.ctx.drawImage(this.first, 0, srcY, this.panelX, 1, 0, from - c.start, this.panelX, to - from);
    if (rightW > 0) c.ctx.drawImage(this.first, rightX, srcY, rightW, 1, rightX, from - c.start, rightW, to - from);
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
