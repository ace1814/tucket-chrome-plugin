// Renders tools/icon.svg to icons/icon-{16,32,48,128}.png with Chrome for Testing.
// Usage: npm run icons
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { findChrome } from './chrome.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const svg = await fs.readFile(path.join(ROOT, 'tools/icon.svg'), 'utf8');
await fs.mkdir(path.join(ROOT, 'icons'), { recursive: true });

const browser = await puppeteer.launch({ executablePath: await findChrome(), headless: true });
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: path.join(ROOT, `icons/icon-${size}.png`), omitBackground: true });
  console.log(`icons/icon-${size}.png`);
}
await browser.close();
