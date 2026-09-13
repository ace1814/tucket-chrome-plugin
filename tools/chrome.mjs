// Locates a Chromium that still honours --load-extension (branded Chrome dropped it in 137).
// Set CHROME_PATH to override; otherwise uses Chrome for Testing from `npx @puppeteer/browsers install chrome@stable`.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = path.join(os.homedir(), '.cache/puppeteer/chrome');
  const versions = (await fs.readdir(base).catch(() => [])).sort().reverse();
  for (const v of versions) {
    const candidates = [
      path.join(base, v, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
      path.join(base, v, 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
      path.join(base, v, 'chrome-linux64/chrome'),
    ];
    for (const c of candidates) if (await fs.access(c).then(() => true, () => false)) return c;
  }
  throw new Error('No Chrome for Testing found. Run: npx @puppeteer/browsers install chrome@stable --path ~/.cache/puppeteer');
}
