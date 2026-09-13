// Round trip into the real Tucket app on this Mac: sends captures through the system clipboard
// exactly as the popup does (TGSend), then reads Tucket's store (read-only) to confirm each one
// landed as the right kind of clip. Needs Tucket running. Adds ~13 clips to your Tucket history.
//
//   node test/roundtrip.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../tools/chrome.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const STORE = path.join(os.homedir(), 'Library/Application Support/Tucket/tucket.store');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const coreDataNow = () => Date.now() / 1000 - 978307200; // seconds since 2001-01-01

const svgs = JSON.parse(await fs.readFile(path.join(ROOT, 'test/out/svgs.json'), 'utf8'));
const icon = svgs.find((s) => s.markup?.includes('M12 2 2 22h20z')).markup;
const illustration = svgs.find((s) => s.markup?.includes('viewBox="0 0 1200 800"')).markup;
const palette = ['#0B7A75', '#7B2CBF', '#F4A261', '#264653', '#E76F51', '#2A9D8F', '#E9C46A', '#8338EC'];

const EXT = path.join(ROOT, 'test/.build');
await fs.access(path.join(EXT, 'manifest.json')).catch(() => { throw new Error('Run npm test once first (it builds test/.build).'); });

const browser = await puppeteer.launch({
  executablePath: await findChrome(), headless: false, pipe: true, defaultViewport: null,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=900,700'],
});
const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/src/background.js'));
const extId = new URL(sw.url()).host;
const page = await browser.newPage();
await page.goto(`chrome-extension://${extId}/src/capture/capture.html`);
await page.bringToFront();
await page.evaluate(() => chrome.storage.local.set({ hasTucket: true }));
await sleep(800);

const start = coreDataNow() - 1;
const sends = await page.evaluate(async (icon, illustration, palette) => {
  const c = new OffscreenCanvas(900, 240);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 900, 240);
  ctx.fillStyle = '#111'; ctx.font = '600 56px system-ui'; ctx.fillText('Tucket Grab round trip', 40, 140);
  const png = await c.convertToBlob({ type: 'image/png' });
  const log = [];
  const single = [
    ['colour', { kind: 'text', data: '#5E60CE' }],
    ['font line', { kind: 'text', data: 'Inter · 16px/24 · 600' }],
    ['icon svg', { kind: 'svg', data: icon }],
    ['illustration svg', { kind: 'svg', data: illustration }],
    ['screenshot png', { kind: 'png', data: png }],
  ];
  for (const [label, item] of single) {
    await TGSend.all([item]);
    log.push(label);
    await new Promise((r) => setTimeout(r, TGSend.BATCH_GAP_MS));
  }
  const t0 = performance.now();
  await TGSend.all(palette.map((data) => ({ kind: 'text', data })));
  log.push(`palette batch of ${palette.length} in ${Math.round(performance.now() - t0)}ms`);
  return log;
}, icon, illustration, palette);
console.log('Sent:', sends.join(', '));
await browser.close();

await sleep(6000); // let Tucket finish OCR, naming and tagging
const rows = execFileSync('sqlite3', ['-readonly', '-separator', ' | ', STORE,
  `SELECT ZCATEGORYRAW, COALESCE(ZCOLORNAME,''), replace(substr(CAST(ZCONTENTDATA AS TEXT),1,40),char(10),' '), COALESCE(ZSOURCEAPP,''), COALESCE(substr(ZIMAGEOCRTEXT,1,40),'')
   FROM ZCLIPRECORD WHERE ZTIMESTAMP >= ${start} ORDER BY ZTIMESTAMP`], { encoding: 'utf8' }).trim();
console.log(`\nTucket clips since the run started:\n${rows || '(none)'}`);
