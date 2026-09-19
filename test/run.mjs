// End-to-end checks against hostile fixture pages, in Chrome for Testing with the unpacked
// extension loaded. Writes screenshots, stitched captures and serialised SVGs to test/out/.
//
//   npm test                 all suites
//   npm test -- svgs shots   just those suites (palette, fonts, svgs, panel, pick, shots, screens)
//   HEADFUL=1 npm test       watch it run
//
// Two test-only changes to the build in test/.build, never shipped:
//  - host_permissions, because activeTab is only granted by a real toolbar click, which
//    automation can't make (the tests call the same togglePanel handler instead);
//  - the panel's shadow root is opened, so Puppeteer can reach inside it.
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
    const headers = { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' };
    // strict.html imitates GitHub-style CSP: no inline styles, no data: images.
    if (file.endsWith('strict.html')) headers['content-security-policy'] = "default-src 'self'; style-src 'self'; img-src 'self'; script-src 'self'";
    res.writeHead(200, headers);
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
const panelFile = path.join(EXT, 'src/content/panel.js');
const panelSrc = await fs.readFile(panelFile, 'utf8');
if (!panelSrc.includes("attachShadow({ mode: 'closed' })")) throw new Error('panel.js no longer attaches a closed shadow root; update the test build patch');
await fs.writeFile(panelFile, panelSrc.replace("attachShadow({ mode: 'closed' })", "attachShadow({ mode: 'open' })"));

const browser = await puppeteer.launch({
  executablePath: await findChrome(),
  headless: !process.env.HEADFUL,
  pipe: true,
  defaultViewport: null,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1280,860', `--force-device-scale-factor=${DPR}`],
});
const clipboardPerms = ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'];
await browser.defaultBrowserContext().overridePermissions(`chrome-extension://${EXPECTED_ID}`, clipboardPerms).catch(() => {});
await browser.defaultBrowserContext().overridePermissions(BASE, clipboardPerms).catch(() => {});

const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/src/background.js'), { timeout: 15000 });
const worker = await swTarget.worker();
worker.on('console', (m) => console.log(`    [service worker] ${m.text()}`));
worker.on('error', (e) => console.log(`    [service worker error] ${e.message}`));
const extId = new URL(swTarget.url()).host;

const BUNDLES = {
  palette: ['src/shared/color.js', 'src/content/palette.js'],
  fonts: ['src/shared/color.js', 'src/shared/fonts.js', 'src/content/fonts.js'],
  svgs: ['src/shared/color.js', 'src/content/svgs.js'],
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

async function openFixture(name, { dark = false } = {}) {
  const page = await browser.newPage();
  // Always explicit: headless Chrome otherwise follows the Mac's own appearance.
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }]);
  await page.goto(`${BASE}/${name}`, { waitUntil: 'load' });
  await page.bringToFront();
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)?.id, page.url());
  return { page, tabId };
}

// Exactly what a toolbar click does.
async function toggle(tabId) {
  await worker.evaluate(async (id) => globalThis.tucketGrab.togglePanel(await chrome.tabs.get(id)), tabId);
}

async function openPanel(page, tabId, tab) {
  await toggle(tabId);
  await page.waitForSelector('tucket-grab >>> .panel');
  if (tab) await clickIn(page, `[data-tab="${tab}"]`);
  await sleep(250);
}

const clickIn = (page, sel) => page.click(`tucket-grab >>> ${sel}`);
const inPanel = (page, fn, ...args) => page.evaluate((src, args) => {
  const root = document.querySelector('tucket-grab')?.shadowRoot;
  return root ? new Function('root', 'args', `return (${src})(root, ...args)`)(root, args) : null;
}, fn.toString(), args);
const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText().catch((e) => `ERR ${e.message}`));

async function waitForCapture() {
  const target = await browser.waitForTarget((t) => t.url().includes('/src/capture/capture.html'), { timeout: 90000 });
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

const hexOf = (c) => `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

// ---------- suites ----------

console.log(`\nTucket Grab tests · ${BASE}`);
check(extId === EXPECTED_ID, 'extension ID is pinned by the manifest key', extId);

if (want('palette')) {
  console.log('\nPalette — marketing.html');
  const { page, tabId } = await openFixture('marketing.html');
  const result = await tg(tabId, 'palette', 'palette.scan');
  await fs.writeFile(path.join(OUT, 'palette.json'), JSON.stringify(result, null, 2));
  const hexes = new Set(result.colours.map(hexOf));
  for (const hex of ['#111827', '#6C6CF8', '#10B981', '#E0E7FF', '#1F2937']) check(hexes.has(hex), `palette has ${hex}`);
  const vars = Object.fromEntries(result.variables.map((v) => [v.name, v]));
  check(!!vars['--brand-500'], 'CSS variable --brand-500 found');
  check(!!vars['--brand-700'], 'oklch() variable --brand-700 resolved');
  check(!!vars['--accent'], 'bare-channel HSL variable --accent resolved');
  check(!vars['--radius'] && !vars['--space-4'], 'non-colour variables ignored');
  const brand = result.brand.map(hexOf);
  check(result.brand.length === 3 && result.brand.every((c) => !c.neutral), 'three brand colours, none neutral', brand.join(' '));
  check(!brand.some((h) => ['#FFFFFF', '#F3F4F6', '#111827', '#1F2937', '#E0E7FF'].includes(h)), 'brand skips white, greys, ink and pale tints', brand.join(' '));
  check(brand.includes('#F97015') || brand.some((h) => h.startsWith('#F9')), 'orange sub-nav is a brand colour', brand.join(' '));
  check(brand.includes('#6C6CF8') || brand.includes('#3D3CC1'), 'violet button is a brand colour', brand.join(' '));
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
  console.log('\nSVG serialiser — svgs.html');
  const { page, tabId } = await openFixture('svgs.html');
  const { items } = await tg(tabId, 'svgs', 'svgs.scan');
  await fs.mkdir(path.join(OUT, 'svgs'), { recursive: true });
  for (const item of items) if (item.markup) await fs.writeFile(path.join(OUT, 'svgs', `${item.id}-${(item.name || item.source).replace(/\W+/g, '-')}.svg`), item.markup);
  await fs.writeFile(path.join(OUT, 'svgs.json'), JSON.stringify(items, null, 2));
  const find = (pred) => items.find((i) => i.markup && pred(i.markup, i));
  check(items.every((i) => !i.markup || !/currentcolor/i.test(i.markup)), 'no currentColor left in any output');
  const tri = find((m) => m.includes('M12 2 2 22h20z'));
  check(tri && /fill="#E11D48"/.test(tri.markup), 'currentColor icon resolved to #E11D48');
  const logo = find((m) => m.includes('M5 35 40 5 75 35z'));
  check(logo && /fill="#F97316"/.test(logo.markup) && /viewBox="0 0 80 40"/.test(logo.markup), 'page-stylesheet fill baked in, viewBox added');
  const heartUse = find((m, i) => i.source === 'Inline SVG' && m.includes('M12 21s'));
  check(heartUse && heartUse.markup.includes('#0EA5E9') && !heartUse.markup.includes('<use'), '<use> inlined with resolved colour');
  const grad = find((m) => m.includes('url(#brand-grad)'));
  check(grad && grad.markup.includes('<linearGradient'), 'out-of-tree gradient copied in');
  check(!!find((m) => m.includes('viewBox="0 0 1200 800"')), '<img> SVG file fetched');
  const decoded = await page.evaluate(async (markups) => Promise.all(markups.map(async (m) => {
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(m)}`;
    try { await img.decode(); return img.naturalWidth > 0; } catch { return false; }
  })), items.filter((i) => i.markup).map((i) => i.markup));
  check(decoded.every(Boolean), 'every SVG decodes standalone', `${decoded.filter(Boolean).length}/${decoded.length}`);
  await page.close();
}

if (want('panel')) {
  console.log('\nPanel — opens from the toolbar, four tabs, copies');
  const { page, tabId } = await openFixture('marketing.html');
  await openPanel(page, tabId, 'shot');
  check(await inPanel(page, (r) => r.querySelectorAll('[data-tab]').length) === 4, 'four tabs');
  check(await inPanel(page, (r) => [...r.querySelectorAll('[data-shot]')].map((b) => b.textContent.trim()).join('|')) === 'Full page|Visible area|Selected area', 'three screenshot types');

  // Locked Tucket tools: explained kindly in place.
  await clickIn(page, '[data-tool="ocr-area"]');
  await sleep(200);
  check(/This one happens in Tucket/.test(await inPanel(page, (r) => r.querySelector('.card')?.textContent || '')), 'locked tool opens the “happens in Tucket” card');

  // Colour: brand swatch copies a hex literal, format toggle switches to rgb().
  await clickIn(page, '[data-tab="colour"]');
  await page.waitForSelector('tucket-grab >>> .sw');
  const roles = await inPanel(page, (r) => [...r.querySelectorAll('.sw .role')].map((e) => e.textContent).join(','));
  check(roles === 'Primary,Secondary,Tertiary', 'primary, secondary and tertiary shown', roles);
  await clickIn(page, '.sw');
  await sleep(250);
  const hex = await clipboard(page);
  check(/^#[0-9A-F]{6}$/.test(hex), 'brand swatch puts a hex literal on the clipboard', hex);
  await clickIn(page, '[data-format="rgb"]');
  await sleep(200);
  await clickIn(page, '.sw');
  await sleep(250);
  const rgb = await clipboard(page);
  check(/^rgb\(/.test(rgb), 'format toggle switches the output to rgb()', rgb);
  await clickIn(page, '[data-format="hex"]');

  // Font: list, then inspect a heading and copy its style.
  await clickIn(page, '[data-tab="font"]');
  await page.waitForSelector('tucket-grab >>> .font');
  const families = await inPanel(page, (r) => [...r.querySelectorAll('.font .sample')].map((e) => e.textContent));
  check(families.includes('Test Serif') && families.includes('Courier New'), 'font list shows the page’s families', families.join(', '));
  const sampleFont = await inPanel(page, (r) => [...r.querySelectorAll('.font .sample')].find((e) => e.textContent === 'Test Serif')?.style.fontFamily);
  check(/Test Serif/.test(sampleFont || ''), 'sample is set in the page’s own web font', sampleFont);
  await clickIn(page, '[data-act="inspect"]');
  const h1 = await (await page.$('h1')).boundingBox();
  let ctaClicked = false;
  await page.exposeFunction('__h1Clicked', () => { ctaClicked = true; });
  await page.evaluate(() => document.querySelector('h1').addEventListener('click', () => window.__h1Clicked()));
  await page.mouse.move(h1.x + 40, h1.y + h1.height / 2);
  await sleep(200);
  check(/Test Serif/.test(await inPanel(page, (r) => (r.querySelector('.tip').hidden ? '' : r.querySelector('.tip').textContent))), 'hovering text shows its font');
  await page.screenshot({ path: path.join(OUT, 'panel-font-inspect.png') });
  await page.mouse.click(h1.x + 40, h1.y + h1.height / 2);
  await sleep(250);
  check(/^Test Serif · 64px\/\d+ · 400$/.test(await clipboard(page)), 'clicking text copies its style line');
  check(!ctaClicked, 'the page never sees the click');

  // Esc leaves inspect, a second Esc closes; the toolbar handler toggles.
  await page.keyboard.press('Escape');
  check(await inPanel(page, (r) => r.querySelector('[data-act="inspect"]').getAttribute('aria-checked')) === 'false', 'Esc turns inspect off first');
  await page.keyboard.press('Escape');
  check(await page.evaluate(() => !document.querySelector('tucket-grab')), 'second Esc closes the panel');
  await toggle(tabId);
  await page.waitForSelector('tucket-grab');
  await toggle(tabId);
  await sleep(100);
  check(await page.evaluate(() => !document.querySelector('tucket-grab')), 'toolbar click toggles the panel closed');
  await page.close();

  // A page extensions can't touch: the per-tab popup explains.
  const blocked = await browser.newPage();
  await blocked.goto('chrome://version');
  const blockedTab = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]);
  const opened = browser.waitForTarget((t) => t.url().endsWith('/src/blocked/blocked.html'), { timeout: 5000 }).then(() => true, () => false);
  await worker.evaluate((tab) => globalThis.tucketGrab.togglePanel(tab), blockedTab);
  check(await opened, 'protected page gets the “can’t grab here” card');
  // The card clears its per-tab popup as it opens, so the next click on a normal page opens the panel.
  await sleep(300);
  check(await worker.evaluate((id) => chrome.action.getPopup({ tabId: id }), blockedTab.id) === '', 'and resets the toolbar for next time');
  await blocked.close();
}

if (want('pick')) {
  console.log('\nSVG pick mode — svgs.html');
  const { page, tabId } = await openFixture('svgs.html');
  let pageClicks = 0;
  await page.exposeFunction('__svgClicked', () => { pageClicks++; });
  await page.evaluate(() => document.querySelector('.icon').addEventListener('click', () => window.__svgClicked()));
  await openPanel(page, tabId, 'svg');
  const icon = await (await page.$('.icon')).boundingBox();
  await page.mouse.move(icon.x + icon.width / 2, icon.y + icon.height / 2);
  await sleep(150);
  const label = await inPanel(page, (r) => (r.querySelector('.tag').hidden ? '' : r.querySelector('.tag').textContent));
  check(/^Icon · 24×24$/.test(label), 'hovering an SVG outlines it with its kind and size', label);
  await page.mouse.click(icon.x + icon.width / 2, icon.y + icon.height / 2);
  await sleep(400);
  const clip = await clipboard(page);
  check(clip.startsWith('<svg') && clip.includes('fill="#E11D48"'), 'click grabs the real SVG to the clipboard', clip.slice(0, 60));
  check(pageClicks === 0, 'the page never sees the click');
  check(await inPanel(page, (r) => !!r.querySelector('.preview svg')), 'grabbed SVG previews in the panel');
  await page.screenshot({ path: path.join(OUT, 'panel-svg-grabbed.png') });

  const img = await (await page.$('img[src*="illustration"]')).boundingBox();
  await page.mouse.click(img.x + 30, img.y + 30);
  await sleep(500);
  check((await clipboard(page)).includes('viewBox="0 0 1200 800"'), '<img> SVG file grabbed by clicking it');
  check(await inPanel(page, (r) => r.querySelectorAll('.thumb').length) === 2, 'both grabs listed');
  await page.close();

  console.log('\nStrict CSP — strict.html');
  const strict = await openFixture('strict.html');
  const cspErrors = [];
  strict.page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) cspErrors.push(m.text()); });
  await openPanel(strict.page, strict.tabId, 'colour');
  await sleep(400);
  const styled = await inPanel(strict.page, (r) => getComputedStyle(r.querySelector('.panel')).borderRadius);
  check(styled === '28px', 'panel is styled under a strict CSP', styled);
  await strict.page.screenshot({ path: path.join(OUT, 'panel-strict-csp.png') });
  check(cspErrors.length === 0, 'no CSP violations', cspErrors[0]?.slice(0, 80));
  await strict.page.close();
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
    await openPanel(page, tabId, 'shot');
    await clickIn(page, '[data-shot="full"]');
    const capture = await waitForCapture();
    const parts = await readParts(capture, 'shot-marketing', (ctx, w, h) => {
      const rgbAt = (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
      const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 8);
      let headerRows = 0, chatRows = 0;
      const chatX = w - (24 + 28) * 2;
      for (let y = 0; y < h; y += 1) {
        if (near(rgbAt(8, y), [17, 24, 39])) headerRows++;
        if (near(rgbAt(chatX, y), [16, 185, 129])) chatRows++;
      }
      // Where the panel floats (top right), the capture must show the page's dark header.
      return { headerRows, chatRows, underPanel: rgbAt(w - 200 * 2, 30 * 2) };
    });
    const total = parts.reduce((s, p) => s + p.height, 0);
    check(Math.abs(total - layout.scrollH * DPR) <= DPR * 2, 'stitched height matches the page at 2× DPR', `${total} vs ${layout.scrollH * DPR}`);
    check(parts[0].width === layout.clientW * DPR, 'width excludes the scrollbar, at DPR', `${parts[0].width}`);
    check(parts[0].probed.headerRows <= 64 * DPR + 4, 'fixed header appears once', `${parts[0].probed.headerRows} rows`);
    check(parts[0].probed.chatRows <= 56 * DPR + 4, 'fixed chat bubble appears once', `${parts[0].probed.chatRows} rows`);
    const [r, g, b] = parts[0].probed.underPanel;
    check(Math.abs(r - 17) < 8 && Math.abs(g - 24) < 8 && Math.abs(b - 39) < 8, 'the panel never appears in the capture', `${r},${g},${b}`);
    const lazy = await capture.evaluate(async (tops, dpr) => {
      const img = document.querySelector('.part img');
      const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return tops.map(({ x, y }) => [...ctx.getImageData(x * dpr, y * dpr, 1, 1).data.slice(0, 3)]);
    }, layout.lazyTops, DPR);
    check(lazy.every(([r, g, b]) => !(r === 221 && g === 221 && b === 221)), 'lazy images loaded before capture');
    const restored = await page.evaluate(() => ({ y: scrollY, header: getComputedStyle(document.querySelector('header')).visibility, nav: getComputedStyle(document.querySelector('nav.sub')).position }));
    check(restored.y === 0 && restored.header === 'visible' && restored.nav === 'sticky', 'page restored afterwards', JSON.stringify(restored));
    await page.bringToFront();
    check(await page.evaluate(() => document.querySelector('tucket-grab')?.style.display !== 'none'), 'panel comes back after the capture');
    await capture.close();
    await page.close();
  }

  console.log('\nFull-page screenshot — docs.html (inner scroll panel)');
  {
    const { page, tabId } = await openFixture('docs.html');
    const layout = await page.evaluate(() => { const m = document.querySelector('main'); return { h: m.scrollHeight, w: m.clientWidth }; });
    await openPanel(page, tabId, 'shot');
    await clickIn(page, '[data-shot="full"]');
    const capture = await waitForCapture();
    const parts = await readParts(capture, 'shot-docs', (ctx, w, h) => {
      let tocRows = 0;
      for (let y = 0; y < h; y++) { const d = ctx.getImageData(120, y, 1, 1).data; if (Math.abs(d[0] - 253) < 6 && Math.abs(d[1] - 230) < 6 && Math.abs(d[2] - 138) < 8) tocRows++; }
      return { tocRows };
    });
    check(Math.abs(parts[0].height - layout.h * DPR) <= DPR * 2, 'captured the whole scrolling panel', `${parts[0].height} vs ${layout.h * DPR}`);
    check(parts[0].width === layout.w * DPR, 'cropped to the panel width', `${parts[0].width} vs ${layout.w * DPR}`);
    check(parts[0].probed.tocRows < 60 * DPR, 'sticky table of contents appears once', `${parts[0].probed.tocRows} rows`);
    await capture.close();
    await page.close();
  }

  console.log('\nVisible area and selected area — marketing.html');
  {
    const { page, tabId } = await openFixture('marketing.html');
    const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    await openPanel(page, tabId, 'shot');
    await clickIn(page, '[data-shot="visible"]');
    let capture = await waitForCapture();
    let parts = await readParts(capture, 'shot-visible');
    check(parts[0].width === vp.w * DPR && parts[0].height === vp.h * DPR, 'visible area is one viewport at DPR', `${parts[0].width}×${parts[0].height}`);
    await capture.close();

    await page.bringToFront();
    await page.waitForFunction(() => document.querySelector('tucket-grab')?.style.display !== 'none');
    await clickIn(page, '[data-shot="region"]');
    await page.waitForFunction(() => document.querySelectorAll('tucket-grab').length === 2);
    await sleep(200);
    await page.mouse.move(100, 150);
    await page.mouse.down();
    await page.mouse.move(300, 250, { steps: 5 });
    await page.mouse.move(500, 350, { steps: 5 });
    await page.mouse.up();
    capture = await waitForCapture();
    parts = await readParts(capture, 'shot-region');
    check(parts[0].width === 400 * DPR && parts[0].height === 200 * DPR, 'selected area matches the dragged rectangle', `${parts[0].width}×${parts[0].height}`);
    await capture.close();
    await page.close();
  }
}

if (want('screens')) {
  console.log('\nScreens for review — light and dark, busy and plain pages');
  for (const dark of [false, true]) {
    for (const fixture of ['marketing.html', 'docs.html']) {
      const { page, tabId } = await openFixture(fixture, { dark });
      await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: DPR });
      if (fixture === 'marketing.html') await page.evaluate(() => window.scrollTo(0, 820));
      await openPanel(page, tabId);
      for (const tab of ['shot', 'font', 'colour', 'svg']) {
        await clickIn(page, `[data-tab="${tab}"]`);
        await sleep(tab === 'colour' || tab === 'font' ? 700 : 400);
        const name = `screen-${tab}-${fixture.replace('.html', '')}-${dark ? 'dark' : 'light'}`;
        await page.screenshot({ path: path.join(OUT, `${name}.png`), clip: { x: 1280 - 400, y: await page.evaluate(() => scrollY), width: 400, height: 860 } });
      }
      if (fixture === 'marketing.html') {
        await clickIn(page, '[data-tab="shot"]');
        await clickIn(page, '[data-tool="cutout"]');
        await sleep(450);
        await page.screenshot({ path: path.join(OUT, `screen-locked-${dark ? 'dark' : 'light'}.png`), clip: { x: 1280 - 400, y: await page.evaluate(() => scrollY), width: 400, height: 860 } });
        await clickIn(page, '[data-tab="colour"]');
        await clickIn(page, '[data-act="all"]');
        await sleep(300);
        await page.screenshot({ path: path.join(OUT, `screen-colour-all-${dark ? 'dark' : 'light'}.png`), clip: { x: 1280 - 400, y: await page.evaluate(() => scrollY), width: 400, height: 860 } });
      }
      await page.close();
    }
  }
  const { page, tabId } = await openFixture('marketing.html');
  await openPanel(page, tabId, 'shot');
  await clickIn(page, '[data-shot="region"]');
  await page.waitForFunction(() => document.querySelectorAll('tucket-grab').length === 2);
  await page.mouse.move(420, 260);
  await page.mouse.down();
  await page.mouse.move(820, 520, { steps: 4 });
  await page.screenshot({ path: path.join(OUT, 'screen-region.png') });
  await page.mouse.up();
  const capture = await waitForCapture();
  await capture.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await capture.screenshot({ path: path.join(OUT, 'screen-capture-page.png') });
  await capture.close();
  await page.close();
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} failed\n` : '\nAll passed\n');
process.exit(failures ? 1 : 0);
