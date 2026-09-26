# Tucket Grab

Pick colours, read fonts, grab real SVGs and take full-page screenshots, in any Chromium browser.
Works with [Tucket for Mac](https://trytucket.com/?utm_source=github&utm_medium=readme&utm_campaign=grab): everything you send lands in your Tucket library.

Free, no account, no analytics. The only thing it ever sends anywhere is a font's name, to see if it's free to download (see [PRIVACY.md](PRIVACY.md)).

## What it does

Click the toolbar icon (or press ⌥⇧G) and a glass panel opens over the page, with four tabs:

- **Screenshots**: full page, visible area or a dragged region. It scrolls and stitches at your screen's pixel density, loads lazy images first, shows fixed headers and chat bubbles only once, handles pages that scroll inside a panel, and splits very tall pages into several images.
  The result tab saves PNG, JPEG, WebP or PDF, and with Tucket also copies the text in it or removes its background.
- **Fonts**: every family the page uses, set in its own font, with where it comes from (Google Fonts, Adobe Fonts, Monotype, Fontshare or the site itself) and a link to download it free or find it to buy. Hover-inspect shows the exact family, size, line height, weight and letter spacing of any text.
- **Colours**: an eyedropper, and the page's three key colours: **Primary** (the most-used colour, by how much of the page it visibly covers), **Secondary** (the call-to-action colour, read off the page's main buttons, black included) and **Tertiary** (the next most-used colour that looks clearly different). The full palette and colour CSS variables are one tap away. HEX, RGB or HSL.
- **SVGs**: point at any icon or illustration and click to grab the real vector: inline SVGs, `<img>` files, CSS backgrounds and `<object>`s, serialised to work outside the page (computed styles baked in, `currentColor` resolved, `<use>` inlined, shared gradients copied in, a `viewBox` guaranteed).

## How it reaches Tucket

With Tucket 1.3.9 or newer, captures go straight to it over Chrome native messaging (protocol in `docs/TUCKET_1.3.9_PRD.md`), and Tucket's on-device OCR and background removal unlock on the screenshot result page.
Without it, captures go to the clipboard. Any Tucket version polls it every 250ms and files each one: a colour literal becomes a named **Colour** clip, SVG markup an **Icon** or **SVG** clip, a PNG an **Image** clip.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Read the page you opened Grab on, only when you open it. |
| `scripting` | Run the colour, font, SVG and screenshot code in that page. |
| `storage` | Remember your colour format, picked colours, panel position and font lookups. |
| `clipboardWrite` | Send captures to the clipboard (and so to Tucket). |
| `nativeMessaging` | Talk to the Tucket app on this Mac, when it's installed. |

No host permissions and no `<all_urls>`. The one network request is the Fontsource font-name lookup.

## Develop

```bash
npm install
```

1. Open `chrome://extensions` (or `brave://extensions`), turn on Developer mode, and choose **Load unpacked** with this folder.
2. Edit, then press the reload arrow on the extension card.

The manifest `key` pins the extension ID to `ccjmgiaekhnnalcjcoilllnamfpenhlc` for local builds. After the first Web Store upload, replace it with the public key the dashboard shows, so the ID Tucket's native host trusts stays the same.

### Tests

```bash
npm test
```

Loads the extension into Chrome for Testing and runs it against the hostile fixture pages in `test/fixtures/`: a fixed header, sticky nav, lazy images, a panel that scrolls inside the page, sprite sheets and a CSS-variable design system. Captures, SVG output and panel screenshots go to `test/out/`; `node tools/review-sheet.mjs` lays the panel screens side by side. Run `npm test -- svgs shots` for specific suites, or set `HEADFUL=1` to watch.

If Chrome for Testing isn't installed, run `npx @puppeteer/browsers install chrome@stable --path ~/.cache/puppeteer`, or point `CHROME_PATH` at a Chromium build. Branded Chrome no longer loads unpacked extensions from the command line.

### Layout

```
src/background.js      service worker: toolbar → panel, screenshots, font lookups, Tucket bridge
src/content/panel.js   the in-page glass panel (styles in panel-css.js)
src/content/           injected on demand: palette, fonts, svgs, screenshot, region
src/lib/               service-worker modules: IndexedDB for captures, the Tucket bridge client
src/shared/            classic scripts shared by pages and content scripts (colour, fonts, send, footer)
src/blocked/           the small card for pages the browser keeps off-limits
src/capture/           the screenshot result page
src/welcome/           shown once, on install
```

## License

MIT
