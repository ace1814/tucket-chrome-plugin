// Lays the panel screens from `npm test -- screens` side by side in one PNG for design review.
// Usage: node tools/review-sheet.mjs  →  test/out/review-sheet.png
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { findChrome } from './chrome.mjs';

const OUT = path.resolve(import.meta.dirname, '../test/out');
const rows = [
  ['Light', ['screen-shot-marketing-light', 'screen-font-marketing-light', 'screen-colour-marketing-light', 'screen-colour-all-light', 'screen-svg-docs-light']],
  ['Dark', ['screen-shot-marketing-dark', 'screen-font-marketing-dark', 'screen-colour-marketing-dark', 'screen-colour-all-dark', 'screen-svg-docs-dark']],
];
const labels = { shot: 'Screenshot', locked: 'Locked tool', font: 'Font', colour: 'Colour', 'colour-all': 'All colours', svg: 'SVG' };

const cell = async (name) => {
  const data = (await fs.readFile(path.join(OUT, `${name}.png`))).toString('base64');
  const key = name.replace(/^screen-/, '').replace(/-(marketing|docs)?-?(light|dark)$/, '').replace(/-(light|dark)$/, '');
  return `<figure><img src="data:image/png;base64,${data}"><figcaption>${labels[key] || key}</figcaption></figure>`;
};

let html = '<body style="margin:0;padding:32px;background:#e9e9ee;font:600 15px -apple-system,system-ui">';
for (const [title, names] of rows) {
  html += `<h2 style="margin:8px 0 16px;font-size:18px">${title}</h2><div style="display:grid;grid-template-columns:repeat(5,400px);gap:20px;margin-bottom:28px">`;
  for (const n of names) html += await cell(n);
  html += '</div>';
}
html += '<style>figure{margin:0}img{width:400px;border-radius:14px;display:block}figcaption{margin-top:8px;color:#555}</style></body>';

const browser = await puppeteer.launch({ executablePath: await findChrome(), headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 5 * 400 + 4 * 20 + 64, height: 1000, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.screenshot({ path: path.join(OUT, 'review-sheet.png'), fullPage: true });
await browser.close();
console.log('test/out/review-sheet.png');
