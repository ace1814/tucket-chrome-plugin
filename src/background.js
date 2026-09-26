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
const SETTLE_MS = 250;           // Let the page's own scroll handlers run (LinkedIn debounces ~180ms).
const OVERLAP = 0.75;            // Step by 75% of what's visible: the overlap is where bars are detected.
const MIN_STEP_CSS = 120;        // Never crawl: even a mostly-covered window moves at least this far.
const LAZY_STEP_MS = 90;         // Dwell per screen on the pre-pass that wakes lazy images.
const MAX_FRAMES = 90;           // Infinite feeds never end; stop somewhere sensible (screens overlap by 20%).
const MAX_CHUNK_HEIGHT = 20000;  // Canvas limits: past this, split into several images.
const MAX_CHUNK_AREA = 200_000_000;
const DIFF_THRESHOLD = 8;        // total channel change that counts as "this pixel is not the same"
const MOVED_SHARE = 0.02;        // share of a line that must change for it to count as moving
const FLAT_RANGE = 12;           // a line this uniform proves nothing either way
const SHIFT_THRESHOLD = 30;      // looser: scrolled content lands on a slightly different sub-pixel
const DETAIL_THRESHOLD = 24;     // a pixel this different from its neighbours is an edge or a letter
const COLUMN_DECAY = 0.5;        // weight of a column's older evidence against the newest pair

let job = null;
let lastCaptureAt = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome/welcome.html') });
});

// ---------- toolbar → panel ----------

// During a capture, the toolbar icon (and the shortcuts) stop it instead: the panel is hidden then,
// and this is the always-visible way to say "that's enough of this very long page".
chrome.action.onClicked.addListener((tab) => {
  if (job && job.tabId === tab.id) { stopShot(); return; }
  togglePanel(tab);
});

function stopShot() {
  if (!job) return false;
  job.stopped = true;
  report({ ...job.progress, phase: job.progress.phase === 'loading' ? 'loading' : 'stopping' });
  return true;
}

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
  if (job) return stopShot();
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
    case 'shot:stop':
      sendResponse({ ok: stopShot() });
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
  if (progress.phase === 'capturing' || progress.phase === 'loading') {
    chrome.action.setTitle({ tabId, title: 'Capturing… click (or press Esc) to stop and keep what’s done' }).catch(() => {});
  }
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

// `before` runs after the rate-limit wait, right before the shot, so whatever it prepares on the
// page (hiding bars) can't be undone by the page in the meantime.
async function captureTab(tabId, windowId, before) {
  for (let attempt = 0; ; attempt++) {
    const wait = lastCaptureAt + CAPTURE_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    if (before) await before();
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

// Which part of the window actually scrolls, measured from pixels rather than believed from the
// DOM. App shells keep their sidebar and composer in a full-window fixed container, LinkedIn reveals
// a bar on scroll, sticky rails stop moving: none of that is visible in the markup, all of it is
// visible in the screens.
//
// Screens overlap: the top of each later screen shows what was at the bottom of the earlier one,
// dy rows lower. Within that overlap every pixel gives evidence:
//   scrolled — it reappears dy rows away on the other screen: content;
//   stayed   — it's in the same place on both and did not scroll: pinned to the window;
//   neither or both — flat, repeating, or animating: no evidence.
// Pinned bars live at the window's edges, never its middle (floating widgets are fixed and already
// hidden), so the overlap is all that's needed: it gives the later screen's top edge and the
// earlier screen's bottom edge. Columns are judged over the same rows; a sidebar never scrolls.
//
// Returns { cols: { x, w } | null, top, bottom } in screen pixels: `top` where the later screen's
// content starts, `bottom` where the earlier screen's content ends.
async function measurePair(earlier, later, dom, scrolledBy, hint = null, step = 4) {
  const w = Math.max(1, Math.floor(earlier.width / step));
  const h = Math.max(1, Math.floor(earlier.height / step));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(earlier, 0, 0, w, h);
  const E = ctx.getImageData(0, 0, w, h).data;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(later, 0, 0, w, h);
  const L = ctx.getImageData(0, 0, w, h).data;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const x0 = clamp(Math.floor(dom.x / step), 0, w - 1);
  const x1 = clamp(Math.ceil((dom.x + dom.w) / step) - 1, 0, w - 1);
  const y0 = clamp(Math.floor(dom.y / step), 0, h - 1);
  const y1 = clamp(Math.ceil((dom.y + dom.h) / step) - 1, 0, h - 1);
  const dy = Math.round(scrolledBy / step);
  const unknown = { cols: null, top: dom.y, bottom: dom.y + dom.h, colStates: null };
  if (x1 <= x0 || y1 <= y0 || dy <= 0 || dy >= y1 - y0 - 4) return unknown;

  const px = (D, x, y) => (y * w + x) * 4;
  const dist = (P, x, yp, Q, yq) => {
    const i = px(P, x, yp), j = px(Q, x, yq);
    return Math.abs(P[i] - Q[j]) + Math.abs(P[i + 1] - Q[j + 1]) + Math.abs(P[i + 2] - Q[j + 2]);
  };
  const near = (P, x, yp, Q, yq) => {
    let best = 765;
    for (let k = -1; k <= 1; k++) {
      const y = yq + k;
      if (y >= 0 && y < h) best = Math.min(best, dist(P, x, yp, Q, y));
    }
    return best < SHIFT_THRESHOLD;
  };
  // Only pixels with detail (an edge, a letter) are evidence. A flat pixel matching a flat pixel is
  // coincidence: alternating section backgrounds line up by chance all the time.
  const detailed = (P, x, y) => x + 1 < w && y + 1 < h
    && dist(P, x, y, P, y + 1) + dist(P, x, y, P, y) + Math.abs(P[px(P, x, y)] - P[px(P, x + 1, y)])
      + Math.abs(P[px(P, x, y) + 1] - P[px(P, x + 1, y) + 1]) + Math.abs(P[px(P, x, y) + 2] - P[px(P, x + 1, y) + 2]) >= DETAIL_THRESHOLD;
  // Evidence for a pixel of the later screen at row y (its twin on the earlier screen is y + dy).
  const laterVote = (x, y) => {
    if (!detailed(L, x, y)) return 0;
    const stayed = dist(L, x, y, E, y) < DIFF_THRESHOLD;
    const scrolled = near(L, x, y, E, y + dy);
    return scrolled && !stayed ? 1 : stayed && !scrolled ? -1 : 0;
  };
  // Evidence for a pixel of the earlier screen at row y (its twin on the later screen is y − dy).
  const earlierVote = (x, y) => {
    if (!detailed(E, x, y)) return 0;
    const stayed = dist(E, x, y, L, y) < DIFF_THRESHOLD;
    const scrolled = near(E, x, y, L, y - dy);
    return scrolled && !stayed ? 1 : stayed && !scrolled ? -1 : 0;
  };
  const state = (from, to, voteAt) => {
    let up = 0, down = 0;
    for (let i = from; i <= to; i++) {
      const v = voteAt(i);
      if (v > 0) up++;
      else if (v < 0) down++;
    }
    const n = to - from + 1;
    if (up / n >= MOVED_SHARE && up > down) return 'moved';
    // A bar is pinned across its width: nearly all of its detail stays put. A line where a little
    // stayed but more scrolled is content passing a sticky sliver, not a bar.
    if (down / n >= MOVED_SHARE && down >= 2 * up) return 'pinned';
    return 'quiet';
  };

  const zoneEnd = Math.min(y1, y0 + (y1 - y0) - dy - 1);   // later screen rows that overlap

  // A bar's plain padding (a composer's top, a header's bottom) has no detail, so no evidence; but it
  // is flat and in the bar's own colour, running on from the bar. Walk from the bar's detailed row
  // across such rows (never past `limit`) so the padding goes with the bar.
  const rowTone = (P, y, l, r) => {
    let sum = 0, min = 765, max = 0;
    for (let x = l; x <= r; x++) {
      const i = px(P, x, y);
      const v = P[i] + P[i + 1] + P[i + 2];
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { mean: sum / (r - l + 1), flat: max - min < FLAT_RANGE };
  };
  const padding = (P, from, dir, limit, l, r) => {
    let y = from;
    let tone = null;
    while (y !== limit) {
      const t = rowTone(P, y, l, r);
      if (!t.flat || (tone !== null && Math.abs(t.mean - tone) >= FLAT_RANGE)) break;
      tone ??= t.mean;
      y += dir;
    }
    return y;
  };
  const middle = (from, to) => {
    const inset = Math.floor((to - from + 1) * 0.1);
    return [from + inset, to - inset];
  };

  // 1. Top of the later screen, judged across the columns known so far (or the whole width):
  //    scanning up from the end of the overlap, the first pinned row ends the content; the band
  //    starts at the first moving row below it, or below the bar's padding.
  const hinted = hint
    ? [clamp(Math.floor(hint.x / step), x0, x1), clamp(Math.ceil((hint.x + hint.w) / step) - 1, x0, x1)]
    : [x0, x1];
  let [midL, midR] = middle(hinted[0], hinted[1]);
  let top = y0;
  {
    let lastMoved = -1;
    for (let y = zoneEnd; y >= y0; y--) {
      const st = state(midL, midR, (x) => laterVote(x, y));
      if (st === 'pinned') { top = lastMoved >= 0 ? lastMoved : padding(L, y + 1, 1, zoneEnd + 1, midL, midR); break; }
      if (st === 'moved') lastMoved = y;
    }
  }

  // 2. Columns, judged only on the overlap rows below that top edge: a header runs across every
  //    column, and letting its text vote would make content columns look pinned. The stretch
  //    between pinned columns with the most scrolling in it wins. Each column's verdict is returned
  //    too, so the capture can vote on columns across every pair of screens.
  let cols = null;
  const colStates = new Int8Array(x1 - x0 + 1);
  const colTop = Math.min(top, zoneEnd);
  {
    let cur = null;
    const close = () => { if (cur?.moved && (!cols || cur.moved > cols.moved)) cols = cur; cur = null; };
    for (let x = x0; x <= x1; x++) {
      const st = zoneEnd - colTop >= 6 ? state(colTop, zoneEnd, (y) => laterVote(x, y)) : 'quiet';
      colStates[x - x0] = st === 'moved' ? 1 : st === 'pinned' ? -1 : 0;
      if (st === 'pinned') { close(); continue; }
      cur ||= { from: x, to: x, moved: 0 };
      cur.to = x;
      if (st === 'moved') cur.moved++;
    }
    close();
  }
  // No column had scrolling detail in the overlap (a sparse page): fall back to the columns known
  // so far, or the whole width. A pinned bar brings its own evidence either way.
  const sure = !!cols;
  cols ||= { from: hinted[0], to: hinted[1] };
  [midL, midR] = middle(cols.from, cols.to);

  // 3. Bottom of the earlier screen: scanning down from where its overlap begins, the first pinned
  //    row ends the content; the band ends after the last moving row above it, or above the bar's
  //    padding.
  let bottom = y1 + 1;
  {
    let lastMoved = -1;
    for (let y = y0 + dy; y <= y1; y++) {
      const st = state(midL, midR, (x) => earlierVote(x, y));
      if (st === 'pinned') { bottom = lastMoved >= 0 ? lastMoved + 1 : padding(E, y - 1, -1, y0 + dy - 1, midL, midR) + 1; break; }
      if (st === 'moved') lastMoved = y;
    }
  }

  const edges = { top: top * step, bottom: Math.min(bottom * step, earlier.height) };
  // Most of the window pinned is not a layout anyone builds: a misreading, so keep what was known.
  const columns = { colStates, colStart: x0, colStep: step };
  if (edges.bottom - edges.top < dom.h * 0.35) return { ...unknown, ...columns, suspect: true };
  const colsPx = { x: cols.from * step, w: Math.min((cols.to - cols.from + 1) * step, earlier.width - cols.from * step) };
  // Only a sliver of the window moving means something else moved (a video, an ad): keep the edges,
  // drop the columns.
  if (!sure || colsPx.w < dom.w * 0.3) return { cols: null, ...edges, ...columns };
  return { cols: colsPx, ...edges, ...columns };
}

// Columns decided by a running vote over the pairs of screens so far, recent ones counting most
// (each older vote is worth half). A column is the page's side (a sidebar, a sticky rail) only when
// most of the weighted evidence in it says pinned. One misreading can't cut real content, and a
// rail that moved on the first scroll and stuck afterwards is outvoted by the very next pair.
class ColumnVote {
  constructor(view) {
    this.view = view;
    this.pinned = null;
    this.seen = null;
  }

  add(pair) {
    if (!pair.colStates) return;
    if (!this.pinned) {
      this.start = pair.colStart;
      this.step = pair.colStep;
      this.pinned = new Float32Array(pair.colStates.length);
      this.seen = new Float32Array(pair.colStates.length);
    }
    const n = Math.min(this.pinned.length, pair.colStates.length);
    for (let i = 0; i < n; i++) {
      const v = pair.colStates[i];
      this.seen[i] = this.seen[i] * COLUMN_DECAY + (v !== 0 ? 1 : 0);
      this.pinned[i] = this.pinned[i] * COLUMN_DECAY + (v < 0 ? 1 : 0);
    }
  }

  // The widest-evidence stretch of columns that aren't sides, in screen pixels; the whole view
  // before anything is known.
  // Once content columns have been found they're kept through a screen that can't tell (a wide
  // table, a blank stretch), rather than falling back to the whole width and repeating the sidebars.
  get cols() {
    const fallback = this.lastGood || { x: this.view.x, w: this.view.w };
    if (!this.pinned) return fallback;
    let best = null;
    let cur = null;
    const close = () => { if (cur && (!best || cur.moved > best.moved)) best = cur; cur = null; };
    for (let i = 0; i < this.pinned.length; i++) {
      const side = this.seen[i] > 0.01 && this.pinned[i] * 2 > this.seen[i];
      if (side) { close(); continue; }
      cur ||= { from: i, to: i, moved: 0 };
      cur.to = i;
      cur.moved += this.seen[i] - this.pinned[i];
    }
    close();
    if (!best) return fallback;
    const x = (this.start + best.from) * this.step;
    const w = Math.min((best.to - best.from + 1) * this.step, this.view.x + this.view.w - x);
    if (w < this.view.w * 0.3) return fallback;
    this.lastGood = { x, w };
    return this.lastGood;
  }
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
    chrome.action.setTitle({ tabId, title: 'Tucket Grab' }).catch(() => {});
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
    let loadedTo = info.totalH;
    for (let i = 1; i < passSteps; i++) {
      if (job.cancelled) return null;
      // Stopped while loading: capture down to where loading got to (Esc again stops that too).
      if (job.stopped) { loadedTo = i * info.stepH; job.stopped = false; notes.push('Stopped early at your request, so the capture ends where it had reached.'); break; }
      report({ phase: 'loading', mode: 'full', current: i, total: passSteps - 1 });
      await call(tabId, 'shot.scrollTo', i * info.stepH);
      await sleep(LAZY_STEP_MS);
    }
    await call(tabId, 'shot.scrollTo', 0);
    await sleep(passSteps > 1 ? 450 : 50);
    info = await call(tabId, 'shot.measure');

    // 2. Screens overlap, and each one is compared with the one before: whatever didn't move
    //    between them (a header the page reveals on scroll, a sticky rail that has stuck, a
    //    chat or messaging bar, an app's sidebar and composer) is chrome and is left out; only the
    //    band that actually scrolled is stitched in. That holds whatever the page's markup says.
    let maxScroll = Math.max(0, Math.min(info.totalH, loadedTo) - info.stepH);
    const estimate = 1 + Math.ceil(maxScroll / (info.stepH * OVERLAP));
    let count = 0;
    const screen = async (y, bottomOnly) => {
      const actualY = await call(tabId, 'shot.scrollTo', y);
      await sleep(SETTLE_MS);
      count++;
      report({
        phase: 'capturing', mode: 'full', current: Math.min(count, estimate), total: estimate,
        secondsLeft: Math.ceil(((estimate - count + 1) * CAPTURE_GAP_MS) / 1000),
      });
      const shot = await captureTab(tabId, windowId, () => call(tabId, 'shot.hideFixed', { bottomOnly }));
      return { bmp: await toBitmap(shot), y: actualY };
    };

    // The first screen keeps the page's top (its header belongs there) but not bottom bars.
    const first = await screen(0, true);
    const s = first.bmp.width / info.viewportW;
    const view = info.mode === 'element'
      ? { x: info.rect.x * s, y: info.rect.y * s, w: info.rect.w * s, h: info.rect.h * s }
      : { x: 0, y: 0, w: Math.min(first.bmp.width, info.clientW * s), h: first.bmp.height };
    view.to = view.y + view.h;

    const stitcher = new Stitcher(first.bmp, info, maxScroll, view);
    await stitcher.drawFirst(first.bmp);

    // Each screen is drawn one step late, when both of its edges are known: its top from the
    // screen before, its bottom from the screen after.
    let prev = first;
    let pending = null;          // { bmp, y, cols, top }
    let lastTop = view.y;
    let lastBottom = view.y + view.h;
    const columns = new ColumnVote(view);
    let measured = 0;
    let frames = 1;
    const draw = async (screenshot, bottom, cols) => {
      const band = { ...(cols || { x: view.x, w: view.w }), y: screenshot.top, to: bottom };
      band.h = band.to - band.y;
      // If this screen's content starts below the seam (a bar appeared over it), step back and take
      // one more screen lined up with the seam, rather than draw the bar or leave a gap.
      const gap = band.y + Math.round(screenshot.y * s) - stitcher.drawnBottom;
      if (gap > 2) {
        const fill = await screen(Math.max(0, screenshot.y - gap / s), false);
        frames++;
        await stitcher.add(fill.bmp, fill.y, band);
        fill.bmp.close();
      }
      await stitcher.add(screenshot.bmp, screenshot.y, band);
    };

    while (prev.y < maxScroll - 0.5) {
      if (job.cancelled) return null;
      if (job.stopped) {
        if (!notes.some((n) => n.startsWith('Stopped early'))) notes.push('Stopped early at your request, so the capture ends where it had reached.');
        maxScroll = prev.y;
        break;
      }
      if (frames >= MAX_FRAMES) {
        notes.push(`This page is very long, so the capture stops after ${MAX_FRAMES} screens.`);
        maxScroll = prev.y;
        break;
      }
      // Never below 35% of the window: nothing real pins more than two-thirds of it.
      const step = Math.max(MIN_STEP_CSS, (view.h / s) * 0.35, ((lastBottom - lastTop) / s) * OVERLAP);
      const cur = await screen(Math.min(maxScroll, prev.y + step), false);
      frames++;
      if (cur.y <= prev.y + 0.5) {            // the page wouldn't scroll any further
        cur.bmp.close();
        maxScroll = prev.y;
        break;
      }
      // Sample at a quarter of the screen's pixels on Retina, half on 1× screens, so body text keeps
      // its edges either way.
      const pair = await measurePair(prev.bmp, cur.bmp, view, (cur.y - prev.y) * s, columns.cols, s >= 1.5 ? 4 : 2);
      if (pair.suspect) { pair.top = lastTop; pair.bottom = lastBottom; }
      columns.add(pair);
      if (pair.cols) measured++;
      if (globalThis.TG_DEBUG_BAND) {
        const st = pair.colStates ? [...pair.colStates].filter((_, i) => i % 4 === 0).map((v) => (v > 0 ? 'm' : v < 0 ? 'P' : '.')).join('') : '-';
        console.log('pair', frames, Math.round(cur.y), `top ${pair.top} bottom ${pair.bottom}`, st);
      }
      if (globalThis.TG_DEBUG_BAND) console.log('cols', JSON.stringify(columns.cols));
      if (pending) {
        await draw(pending, pair.bottom, columns.cols);
        pending.bmp.close();
      } else {
        stitcher.trimFirst(pair.bottom);      // anything pinned at the first screen's foot gets written over
      }
      pending = { bmp: cur.bmp, y: cur.y, cols: pair.cols, top: pair.top };
      lastTop = pair.top;
      lastBottom = pair.bottom;
      prev = cur;
    }
    // The last screen has no screen after it: its content runs to the window's foot, where
    // finish() picks up whatever is pinned there (a composer), once.
    if (pending) await draw(pending, lastBottom, columns.cols);

    report({ phase: 'stitching', mode: 'full' });
    const parts = await stitcher.finish(prev.bmp, prev.y, maxScroll);
    if (prev !== first) prev.bmp.close();
    first.bmp.close();
    if (frames > 2 && !measured) notes.push('The scrolling area couldn’t be measured exactly, so part of the page may repeat.');
    if (parts.length > 1) notes.push(`The page is too tall for one image, so it’s split into ${parts.length} parts.`);
    if (info.mode === 'element') notes.push('This app scrolls inside a panel. The panel is expanded in full; the sidebar and bars around it come from the first screen.');
    return { parts, notes };
  } finally {
    await call(tabId, 'shot.restore').catch(() => {});
  }
}

// Draws screens onto one or more canvases as they arrive, so memory holds at most a couple of
// canvases, never every screen at once. Canvas row = screen row + that screen's scroll offset.
//
// The first screen goes down whole. Every later screen contributes only its moving band, and only
// the rows below what's already drawn, so overlap is never doubled. Columns beside the band (an
// app's sidebar, a sticky rail that has stuck) are filled with that column's own background colour
// rather than copied, so nothing pinned is ever repeated down the image. The last screen's rows
// below its band (the page's foot, or an app's composer) finish the image once.
class Stitcher {
  constructor(first, info, maxScroll, view) {
    this.scale = first.width / info.viewportW;
    this.w = info.mode === 'element' ? first.width : Math.round(view.w); // window: drop the scrollbar
    this.viewH = first.height;
    this.setTotal(maxScroll);
    this.chunkH = Math.max(1, Math.min(MAX_CHUNK_HEIGHT, Math.floor(MAX_CHUNK_AREA / this.w)));
    this.open = [];   // { index, start, canvas, ctx }
    this.parts = [];
    this.drawnBottom = 0;
  }

  setTotal(maxScroll) {
    this.total = this.viewH + Math.round(maxScroll * this.scale);
  }

  chunk(index) {
    let c = this.open.find((o) => o.index === index);
    if (!c) {
      const start = index * this.chunkH;
      const canvas = new OffscreenCanvas(this.w, Math.max(1, Math.min(this.chunkH, this.total - start)));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      c = { index, start, canvas, ctx };
      this.open.push(c);
    }
    return c;
  }

  // Draw rows [from, to) of the canvas from `bmp`, whose row r lands on canvas row r + off.
  paint(bmp, off, from, to, x = 0, w = this.w) {
    for (let k = Math.floor(from / this.chunkH); k * this.chunkH < to; k++) {
      const c = this.chunk(k);
      const a = Math.max(from, c.start);
      const b = Math.min(to, c.start + c.canvas.height);
      if (b <= a) continue;
      c.ctx.drawImage(bmp, x, a - off, w, b - a, x, a - c.start, w, b - a);
    }
  }

  fill(colour, from, to, x, w) {
    for (let k = Math.floor(from / this.chunkH); k * this.chunkH < to; k++) {
      const c = this.chunk(k);
      const a = Math.max(from, c.start);
      const b = Math.min(to, c.start + c.canvas.height);
      if (b <= a) continue;
      c.ctx.fillStyle = colour;
      c.ctx.fillRect(x, a - c.start, w, b - a);
    }
  }

  // The commonest colour down a strip of a screen: a sidebar's or a page's background.
  columnColour(bmp, x, width, top, bottom) {
    const probe = new OffscreenCanvas(1, 64);
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, x + Math.floor(width / 2), top, 1, Math.max(1, bottom - top), 0, 0, 1, 64);
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
    return best;
  }

  async drawFirst(bmp) {
    const to = Math.min(bmp.height, this.total);
    this.paint(bmp, 0, 0, to);
    this.drawnBottom = to;
    await this.flush(false);
  }

  // Rows of the first screen below the moving band hold whatever was pinned to the window's foot;
  // later screens are allowed to write over them.
  trimFirst(bottomRow) {
    const bottom = Math.round(bottomRow);
    if (bottom < this.drawnBottom && this.open.some((c) => c.start <= bottom)) this.drawnBottom = bottom;
  }

  async add(bmp, cssY, band) {
    const off = Math.round(cssY * this.scale);
    const bandTop = Math.round(band.y);
    const bandBottom = Math.round(band.y + band.h);
    // Normally the band starts above what's drawn (the screens overlap). If a newly pinned bar made
    // it start lower, draw from the seam anyway: a sliver of bar beats a white gap. Draw down to the
    // last row that moved; quiet rows below it are left for the next screen, which sees them move.
    const from = this.drawnBottom;
    const to = Math.min(Math.round(band.to ?? band.y + band.h) + off, this.total);
    if (to <= from || from - off >= bmp.height) return;
    const x = Math.max(0, Math.round(band.x));
    const w = Math.min(this.w - x, Math.round(band.w));
    this.paint(bmp, off, from, to, x, w);
    if (x > 0) this.fill(this.columnColour(bmp, 0, x, bandTop, bandBottom), from, to, 0, x);
    if (x + w < this.w) this.fill(this.columnColour(bmp, x + w, this.w - x - w, bandTop, bandBottom), from, to, x + w, this.w - x - w);
    this.drawnBottom = to;
    await this.flush(false);
  }

  // Whatever is left below the last screen's moving rows (the page's foot, an app's composer)
  // comes from the last screen, once.
  async finish(last, lastY, maxScroll) {
    // The page stopped short of what was measured: the image ends where the last screen ends.
    this.setTotal(Math.min(maxScroll, lastY));
    const off = Math.round(lastY * this.scale);
    if (this.drawnBottom < this.total) this.paint(last, off, this.drawnBottom, this.total);
    this.drawnBottom = this.total;
    await this.flush(true);
    return this.parts;
  }

  async flush(all) {
    this.open.sort((a, b) => a.index - b.index);
    while (this.open.length && (all || this.open[0].start + this.open[0].canvas.height <= this.drawnBottom)) {
      const c = this.open.shift();
      let canvas = c.canvas;
      const used = Math.min(canvas.height, this.total - c.start, this.drawnBottom - c.start);
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
}
