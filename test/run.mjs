// End-to-end checks against hostile fixture pages, in Chrome for Testing with the unpacked
// extension loaded. Writes screenshots, stitched captures and serialised SVGs to test/out/.
//
//   npm test                 all suites
//   npm test -- svgs shots   just those suites (palette, fonts, svgs, inspector, shots, popup)
//   HEADFUL=1 npm test       watch it run
//
// activeTab is only granted by a real toolbar click, which automation can't make, so the test
// build adds host_permissions. The shipped manifest never has them.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../tools/chrome.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = process.env.TG_OUT || path.join(ROOT, 'test/out');
const EXT = path.join(ROOT, 'test/.build');
const EXPECTED_ID = 'ccjmgiaekhnnalcjcoilllnamfpenhlc';
const DPR = 2;
const suites = process.argv.slice(2);
const want = (name) => suites.length === 0 || suites.includes(name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(ok, label, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

// ---------- fixture server ----------

const TYPES = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname === '/font/serif.ttf') {
    res.writeHead(200, { 'content-type': 'font/ttf' });
    res.end(await fs.readFile('/System/Library/Fonts/Supplemental/Georgia.ttf'));
    return;
  }
  const lazy = url.pathname.match(/^\/lazy\/(\d+)\.svg$/);
  if (lazy) {
    await sleep(120);
    const hue = (Number(lazy[1]) * 57) % 360;
    res.writeHead(200, { 'content-type': 'image/svg+xml' });
    res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240"><rect width="480" height="240" fill="hsl(${hue},70%,45%)"/><text x="240" y="135" font-size="36" text-anchor="middle" fill="#fff" font-family="sans-serif">lazy ${lazy[1]} loaded</text></svg>`);
    return;
  }
  try {
    const file = path.join(ROOT, 'test/fixtures', path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    const data = await fs.readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---------- test build + browser ----------

await fs.rm(EXT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });
for (const p of ['manifest.json', 'src', 'icons']) await fs.cp(path.join(ROOT, p), path.join(EXT, p), { recursive: true });
const manifest = JSON.parse(await fs.readFile(path.join(EXT, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['<all_urls>'];
await fs.writeFile(path.join(EXT, 'manifest.json'), JSON.stringify(manifest, null, 2));

const browser = await puppeteer.launch({
  executablePath: await findChrome(),
  headless: !process.env.HEADFUL,
  pipe: true,
  defaultViewport: null,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1280,860', `--force-device-scale-factor=${DPR}`],
});
await browser.defaultBrowserContext().overridePermissions(`chrome-extension://${EXPECTED_ID}`, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']).catch(() => {});

const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/src/background.js'), { timeout: 15000 });
const worker = await swTarget.worker();
worker.on('console', (m) => console.log(`    [service worker] ${m.text()}`));
worker.on('error', (e) => console.log(`    [service worker error] ${e.message}`));
const extId = new URL(swTarget.url()).host;
const extUrl = (p) => `chrome-extension://${extId}/${p}`;

const BUNDLES = {
  palette: ['src/shared/color.js', 'src/content/palette.js'],
  fonts: ['src/shared/color.js', 'src/shared/fonts.js', 'src/content/fonts.js'],
  svgs: ['src/shared/color.js', 'src/content/svgs.js'],
  inspector: ['src/shared/color.js', 'src/shared/send.js', 'src/shared/fonts.js', 'src/content/inspector.js'],
};

async function tg(tabId, bundle, fnPath, ...args) {
  return worker.evaluate(async (tabId, files, fnPath, args) => {
    await chrome.scripting.executeScript({ target: { tabId }, files });
    const [r] = await chrome.scripting.executeScript({
      target: { tabId }, args: [fnPath, args],
      func: (p, a) => { const [ns, fn] = p.split('.'); return globalThis.__tg[ns][fn](...a); },
    });
    return r?.result;
  }, tabId, BUNDLES[bundle], fnPath, args);
}

async function openFixture(name) {
  const page = await browser.newPage();
  await page.goto(`${BASE}/${name}`, { waitUntil: 'load' });
  await page.bringToFront();
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)?.id, page.url());
  return { page, tabId };
}

async function openPopup(tabId) {
  // A unique URL per popup, so a just-closed popup's target is never mistaken for the new one.
  const url = extUrl(`src/popup/popup.html?tabId=${tabId}&n=${Date.now()}`);
  await worker.evaluate((url) => chrome.windows.create({ url, type: 'popup', width: 380, height: 640 }), url);
  const target = await browser.waitForTarget((t) => t.url() === url);
  const page = await target.page();
  await page.setViewport({ width: 380, height: 580, deviceScaleFactor: DPR });
  await page.waitForFunction(() => document.querySelector('[aria-selected="true"]') || !document.querySelector('#blocked').hidden);
  return page;
}

async function waitForCapture(popup) {
  // Promise.resolve().then: on a popup that already closed itself, waitForFunction throws synchronously.
  const failed = popup
    ? Promise.resolve().then(() => popup.waitForFunction(() => { const e = document.querySelector('#shot-error'); return e && !e.hidden && e.textContent; }, { timeout: 90000 }))
        .then(async (h) => { throw new Error(`Capture error in popup: ${await h.jsonValue()}`); }, () => new Promise(() => {}))
    : new Promise(() => {});
  const target = await Promise.race([
    browser.waitForTarget((t) => t.url().includes('/src/capture/capture.html'), { timeout: 90000 }),
    failed,
  ]);
  const page = await target.page();
  await page.waitForFunction(() => document.querySelectorAll('.part img').length && [...document.querySelectorAll('.part img')].every((i) => i.complete && i.naturalWidth), { timeout: 30000 });
  return page;
}

// Pull stitched parts out of the capture page, save them, and run pixel probes in-page.
async function readParts(capturePage, name, probe) {
  const parts = await capturePage.evaluate(async (probeSrc) => {
    const probeFn = probeSrc ? new Function('ctx', 'w', 'h', `return (${probeSrc})(ctx, w, h)`) : null;
    return Promise.all([...document.querySelectorAll('.part img')].map(async (img) => {
      const blob = await (await fetch(img.src)).blob();
      const data = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
      let probed = null;
      if (probeFn) {
        const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        probed = probeFn(ctx, img.naturalWidth, img.naturalHeight);
      }
      return { width: img.naturalWidth, height: img.naturalHeight, data, probed };
    }));
  }, probe ? probe.toString() : null);
  for (const [i, p] of parts.entries()) {
    await fs.writeFile(path.join(OUT, `${name}${parts.length > 1 ? `-${i + 1}` : ''}.png`), Buffer.from(p.data.split(',')[1], 'base64'));
  }
  return parts;
}

// ---------- suites ----------

console.log(`\nTucket Grab tests · ${BASE}`);
check(extId === EXPECTED_ID, 'extension ID is pinned by the manifest key', extId);

if (want('palette')) {
  console.log('\nPalette — marketing.html');
  const { page, tabId } = await openFixture('marketing.html');
  const result = await tg(tabId, 'palette', 'palette.scan');
  await fs.writeFile(path.join(OUT, 'palette.json'), JSON.stringify(result, null, 2));
  const hexes = new Set(result.colours.map((c) => `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase()}`));
  for (const hex of ['#111827', '#6C6CF8', '#10B981', '#E0E7FF', '#1F2937']) check(hexes.has(hex), `palette has ${hex}`);
  const vars = Object.fromEntries(result.variables.map((v) => [v.name, v]));
  check(!!vars['--brand-500'], 'CSS variable --brand-500 found');
  check(!!vars['--brand-700'], 'oklch() variable --brand-700 resolved');
  check(!!vars['--accent'], 'bare-channel HSL variable --accent resolved', vars['--accent'] && `rgb ${vars['--accent'].r},${vars['--accent'].g},${vars['--accent'].b}`);
  check(!vars['--radius'] && !vars['--space-4'], 'non-colour variables ignored');
  check(result.colours[0].count >= result.colours.at(-1).count, 'sorted by frequency');
  await page.close();
}

if (want('fonts')) {
  console.log('\nFonts — marketing.html');
  const { page, tabId } = await openFixture('marketing.html');
  await page.evaluate(() => document.fonts.ready);
  const result = await tg(tabId, 'fonts', 'fonts.scan');
  await fs.writeFile(path.join(OUT, 'fonts.json'), JSON.stringify({ ...result, used: result.used.map((f) => ({ ...f, sample: `${f.sample.length} bytes` })) }, null, 2));
  const by = Object.fromEntries(result.used.map((f) => [f.family, f]));
  check(by['Test Serif']?.kind === 'web', 'web font resolved as "Test Serif"', by['Test Serif']?.line);
  check(by['Courier New']?.kind === 'system', 'installed font resolved as "Courier New"', by['Courier New']?.line);
  check(by['system-ui']?.kind === 'generic', 'generic family reported as system-ui');
  check(!by['Never Used'], 'declared-but-unused font not listed as used');
  check(/^Test Serif · 64px\/\d+ · 400$/.test(by['Test Serif']?.line || ''), 'line format "Family · size/line · weight"', by['Test Serif']?.line);
  await page.close();
}

if (want('svgs')) {
  console.log('\nSVGs — svgs.html');
  const { page, tabId } = await openFixture('svgs.html');
  const { items } = await tg(tabId, 'svgs', 'svgs.scan');
  await fs.mkdir(path.join(OUT, 'svgs'), { recursive: true });
  for (const item of items) if (item.markup) await fs.writeFile(path.join(OUT, 'svgs', `${item.id}-${(item.name || item.source).replace(/\W+/g, '-')}.svg`), item.markup);
  await fs.writeFile(path.join(OUT, 'svgs.json'), JSON.stringify(items, null, 2));
  const find = (pred) => items.find((i) => i.markup && pred(i.markup, i));

  check(items.every((i) => !i.markup || !/currentcolor/i.test(i.markup)), 'no currentColor left in any output');
  const tri = find((m) => m.includes('M12 2 2 22h20z'));
  check(tri && /fill="#E11D48"/.test(tri.markup), 'currentColor icon resolved to #E11D48');
  check(tri?.instances === 2, 'duplicate icon deduped', `instances ${tri?.instances}`);
  const logo = find((m) => m.includes('M5 35 40 5 75 35z'));
  check(logo && /fill="#F97316"/.test(logo.markup) && /stroke="#7C2D12"/.test(logo.markup), 'page-stylesheet fill/stroke baked in');
  check(logo && /viewBox="0 0 80 40"/.test(logo.markup), 'missing viewBox added');
  check(items.some((i) => i.name === 'icon-heart') && items.some((i) => i.name === 'icon-bolt'), 'sprite symbols listed');
  const heartUse = find((m, i) => i.source === 'Inline SVG' && m.includes('M12 21s') );
  check(heartUse && heartUse.markup.includes('#0EA5E9') && !heartUse.markup.includes('<use'), '<use> inlined with resolved colour');
  const boltUse = find((m, i) => i.source === 'Inline SVG' && m.includes('M13 2 3 14'));
  check(boltUse && boltUse.markup.includes('#A855F7'), 'xlink:href <use> inlined', boltUse ? 'ok' : 'missing');
  const grad = find((m) => m.includes('url(#brand-grad)'));
  check(grad && grad.markup.includes('<linearGradient') && grad.markup.includes('id="brand-grad"'), 'out-of-tree gradient copied in');
  const illo = find((m) => m.includes('viewBox="0 0 1200 800"'));
  check(!!illo, '<img> SVG file fetched');
  check(!!find((m) => m.includes('M4 12l5 5L20 6')), 'CSS background SVG fetched');
  check(!!find((m) => m.includes("r='10'") || m.includes('r="10"')), 'data: URI pseudo-element SVG decoded');
  const star = find((m) => m.includes('M24 3l6 15'));
  check(star && /viewBox="0 0 48 48"/.test(star.markup), '<object> SVG read with a viewBox');

  // Every output must render on its own.
  const decoded = await page.evaluate(async (markups) => Promise.all(markups.map(async (m) => {
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(m)}`;
    try { await img.decode(); return img.naturalWidth > 0; } catch { return false; }
  })), items.filter((i) => i.markup).map((i) => i.markup));
  check(decoded.every(Boolean), 'every SVG decodes standalone', `${decoded.filter(Boolean).length}/${decoded.length}`);

  // Contact sheet of the standalone outputs, for eyeballing against the page.
  const sheet = await browser.newPage();
  await sheet.setViewport({ width: 900, height: 600, deviceScaleFactor: 1 });
  await sheet.setContent(`<body style="margin:0;font:12px system-ui;display:grid;grid-template-columns:repeat(5,1fr);gap:12px;padding:16px">${
    items.filter((i) => i.markup).map((i) => `<figure style="margin:0;border:1px solid #ddd;border-radius:8px;padding:8px;text-align:center"><img style="width:120px;height:90px;object-fit:contain" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(i.markup)}"><figcaption>${i.name || i.source}</figcaption></figure>`).join('')}</body>`);
  await sleep(300);
  await sheet.screenshot({ path: path.join(OUT, 'svgs-sheet.png'), fullPage: true });
  await sheet.close();
  await page.close();
}

if (want('inspector')) {
  console.log('\nInspector — marketing.html');
  const { page, tabId } = await openFixture('marketing.html');
  let clicked = false;
  await page.exposeFunction('__ctaClicked', () => { clicked = true; });
  await page.evaluate(() => document.querySelector('.cta').addEventListener('click', () => window.__ctaClicked()));
  await tg(tabId, 'inspector', 'inspector.start', { section: 'colours' });
  const box = await (await page.$('.cta')).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(300);
  check(!clicked, 'clicking an element in inspect mode doesn’t trigger the page');
  await page.screenshot({ path: path.join(OUT, 'inspector.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  check(await page.evaluate(() => !document.querySelector('tucket-grab')), 'Esc twice removes the inspector');
  await page.close();
}

if (want('shots')) {
  console.log('\nFull-page screenshot — marketing.html (fixed header, sticky nav, lazy images, chat bubble)');
  {
    const { page, tabId } = await openFixture('marketing.html');
    const layout = await page.evaluate(() => ({
      scrollH: document.documentElement.scrollHeight,
      clientW: document.documentElement.clientWidth,
      lazyTops: [...document.querySelectorAll('img.lazy')].map((i) => ({ y: i.getBoundingClientRect().top + scrollY + 120, x: i.getBoundingClientRect().left + 240 })),
    }));
    const popup = await openPopup(tabId);
    await popup.evaluate(() => document.querySelector('[data-tab="screenshot"]').click());
    await popup.click('[data-shot="full"]');
    await sleep(2500);
    await popup.screenshot({ path: path.join(OUT, 'popup-shot-progress.png') });
    const capture = await waitForCapture(popup);
    const parts = await readParts(capture, 'shot-marketing', (ctx, w, h) => {
      const rgbAt = (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
      const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 8);
      let headerRows = 0, chatRows = 0;
      const chatX = w - (24 + 28) * 2;
      for (let y = 0; y < h; y += 1) {
        if (near(rgbAt(8, y), [17, 24, 39])) headerRows++;
        if (near(rgbAt(chatX, y), [16, 185, 129])) chatRows++;
      }
      return { headerRows, chatRows, sample: (pts) => pts };
    });
    const total = parts.reduce((s, p) => s + p.height, 0);
    check(parts.length === 1, 'one image');
    check(Math.abs(total - layout.scrollH * DPR) <= DPR * 2, 'stitched height matches the page at 2× DPR', `${total} vs ${layout.scrollH * DPR}`);
    check(parts[0].width === layout.clientW * DPR, 'width excludes the scrollbar, at DPR', `${parts[0].width}`);
    check(parts[0].probed.headerRows <= 64 * DPR + 4, 'fixed header appears once', `${parts[0].probed.headerRows} rows`);
    check(parts[0].probed.chatRows <= 56 * DPR + 4, 'fixed chat bubble appears once', `${parts[0].probed.chatRows} rows`);
    const lazy = await capture.evaluate(async (tops, dpr) => {
      const img = document.querySelector('.part img');
      const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return tops.map(({ x, y }) => [...ctx.getImageData(x * dpr, y * dpr, 1, 1).data.slice(0, 3)]);
    }, layout.lazyTops, DPR);
    check(lazy.every(([r, g, b]) => !(r === 221 && g === 221 && b === 221)), 'lazy images loaded before capture', JSON.stringify(lazy));
    const restored = await page.evaluate(() => ({ y: scrollY, header: getComputedStyle(document.querySelector('header')).visibility, nav: getComputedStyle(document.querySelector('nav.sub')).position }));
    check(restored.y === 0 && restored.header === 'visible' && restored.nav === 'sticky', 'page restored afterwards', JSON.stringify(restored));
    await capture.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await capture.screenshot({ path: path.join(OUT, 'capture-page.png') });
    await capture.close();
    await popup.close();
    await page.close();
  }

  console.log('\nFull-page screenshot — docs.html (inner scroll panel)');
  {
    const { page, tabId } = await openFixture('docs.html');
    const layout = await page.evaluate(() => { const m = document.querySelector('main'); return { h: m.scrollHeight, w: m.clientWidth }; });
    const popup = await openPopup(tabId);
    await popup.evaluate(() => document.querySelector('[data-tab="screenshot"]').click());
    await popup.click('[data-shot="full"]');
    const capture = await waitForCapture(popup);
    const parts = await readParts(capture, 'shot-docs', (ctx, w, h) => {
      let tocRows = 0;
      for (let y = 0; y < h; y++) { const d = ctx.getImageData(120, y, 1, 1).data; /* x=120 is inside main's 40px padding at 2× */ if (Math.abs(d[0] - 253) < 6 && Math.abs(d[1] - 230) < 6 && Math.abs(d[2] - 138) < 8) tocRows++; }
      return { tocRows };
    });
    const notes = await capture.evaluate(() => document.querySelector('#notes').textContent);
    check(Math.abs(parts[0].height - layout.h * DPR) <= DPR * 2, 'captured the whole scrolling panel', `${parts[0].height} vs ${layout.h * DPR}`);
    check(parts[0].width === layout.w * DPR, 'cropped to the panel width', `${parts[0].width} vs ${layout.w * DPR}`);
    check(parts[0].probed.tocRows < 60 * DPR, 'sticky table of contents appears once', `${parts[0].probed.tocRows} rows`);
    check(/panel/.test(notes), 'capture page explains the panel capture');
    await capture.close();
    await popup.close();
    await page.close();
  }

  console.log('\nVisible area and region — marketing.html');
  {
    const { page, tabId } = await openFixture('marketing.html');
    const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    let popup = await openPopup(tabId);
    await popup.evaluate(() => document.querySelector('[data-tab="screenshot"]').click());
    await popup.click('[data-shot="visible"]');
    let capture = await waitForCapture(popup);
    let parts = await readParts(capture, 'shot-visible');
    check(parts[0].width === vp.w * DPR && parts[0].height === vp.h * DPR, 'visible area is one viewport at DPR', `${parts[0].width}×${parts[0].height}`);
    await capture.close();
    await popup.close().catch(() => {});

    await page.bringToFront();
    popup = await openPopup(tabId);
    await popup.evaluate(() => document.querySelector('[data-tab="screenshot"]').click());
    // The popup closes itself so the user can drag on the page; the click never "returns".
    await popup.evaluate(() => document.querySelector('[data-shot="region"]').click()).catch(() => {});
    await page.waitForSelector('tucket-grab');
    await sleep(200);
    await page.mouse.move(100, 150);
    await page.mouse.down();
    await page.mouse.move(300, 250, { steps: 5 });
    await page.mouse.move(500, 350, { steps: 5 });
    await page.mouse.up();
    capture = await waitForCapture(popup);
    parts = await readParts(capture, 'shot-region');
    check(parts[0].width === 400 * DPR && parts[0].height === 200 * DPR, 'region matches the dragged rectangle', `${parts[0].width}×${parts[0].height}`);
    await capture.close();
    await page.close();
  }
}

if (want('popup')) {
  console.log('\nPopup screens');
  const { page, tabId } = await openFixture('svgs.html');
  const popup = await openPopup(tabId);
  await popup.evaluate(() => chrome.storage.local.remove(['hasTucket', 'lastTab']));
  for (const tab of ['colours', 'fonts', 'screenshot', 'svgs']) {
    await popup.evaluate((t) => document.querySelector(`[data-tab="${t}"]`).click(), tab);
    await sleep(tab === 'svgs' ? 1200 : 600);
    await popup.screenshot({ path: path.join(OUT, `popup-${tab}.png`) });
  }
  const count = await popup.$eval('#svgs-count', (e) => e.textContent);
  check(Number(count) >= 9, 'SVG tab lists the page’s SVGs', count);

  // Clipboard: click a swatch, read it back.
  await popup.evaluate(() => document.querySelector('[data-tab="colours"]').click());
  await popup.waitForSelector('#palette .swatch');
  await popup.click('#palette .swatch');
  await sleep(200);
  const clip = await popup.evaluate(() => navigator.clipboard.readText().catch((e) => `ERR ${e.message}`));
  check(/^#[0-9A-F]{6}$/.test(clip), 'swatch click puts a hex literal on the clipboard', clip);
  await popup.click('[data-format="rgb"]');
  await sleep(150);
  await popup.click('#palette .swatch');
  await sleep(200);
  const rgb = await popup.evaluate(() => navigator.clipboard.readText().catch((e) => `ERR ${e.message}`));
  check(/^rgba?\(/.test(rgb), 'format toggle switches the output to rgb()', rgb);
  await popup.click('[data-format="hex"]');
  await popup.screenshot({ path: path.join(OUT, 'popup-toast.png') });

  // Footer states.
  await popup.evaluate(() => chrome.storage.local.set({ hasTucket: true }));
  await sleep(200);
  await popup.screenshot({ path: path.join(OUT, 'popup-footer-has-tucket.png') });
  await popup.evaluate(() => chrome.storage.local.remove('hasTucket'));
  await popup.close();

  // A page extensions can't touch.
  const blocked = await browser.newPage();
  await blocked.goto('chrome://version');
  const blockedId = await worker.evaluate(async () => (await chrome.tabs.query({})).find((t) => !t.url)?.id); // Chrome hides protected pages' URLs from extensions
  const bp = await openPopup(blockedId);
  check(await bp.$eval('#blocked', (e) => !e.hidden), 'protected page shows the blocked state');
  await bp.screenshot({ path: path.join(OUT, 'popup-blocked.png') });
  await bp.close();
  await blocked.close();

  // Welcome page (opened on install).
  const welcomeTarget = browser.targets().find((t) => t.url().includes('/src/welcome/welcome.html'));
  check(!!welcomeTarget, 'welcome page opened on install');
  if (welcomeTarget) {
    const w = await welcomeTarget.page();
    await w.setViewport({ width: 1100, height: 900, deviceScaleFactor: 1 });
    await w.screenshot({ path: path.join(OUT, 'welcome.png'), fullPage: true });
  }
  await page.close();
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} failed\n` : '\nAll passed\n');
process.exit(failures ? 1 : 0);
