# Tucket Grab

Pick colours, read fonts, grab real SVGs and take full-page screenshots, in any Chromium browser.
Works with [Tucket for Mac](https://trytucket.com/?utm_source=github&utm_medium=readme&utm_campaign=grab): everything you send lands in your Tucket library.

Free, no account, no analytics. Nothing leaves your machine.

## What it does

- **Colours**: an eyedropper, every colour on a hovered element, and the page's whole palette sorted by use, including colour CSS variables (even bare `240 91% 70%` channels). Copy as HEX, RGB or HSL.
- **Fonts**: the family that actually renders (not just the stack), with size, line height, weight and letter spacing. Lists web fonts that were loaded but never used.
- **Screenshots**: full page, visible area or a dragged region. It scrolls and stitches at your screen's pixel density, loads lazy images first, shows fixed headers and chat bubbles only once, handles pages that scroll inside a panel, and splits very tall pages into several images.
- **SVGs**: finds inline SVGs, sprite symbols, `<img>` files, CSS backgrounds and `<object>`s, then serialises each one so it works outside the page: computed styles baked in, `currentColor` resolved, `<use>` inlined, shared gradients copied in, a `viewBox` guaranteed.

## How it reaches Tucket

v1 uses the clipboard. Tucket polls it every 250ms and files each capture: a colour literal becomes a named **Colour** clip, SVG markup becomes an **Icon** or **SVG** clip, and a PNG becomes an **Image** clip. "Send all" paces its writes 400ms apart so Tucket catches every one.
A native-messaging connection (silent sends, real detection) is planned for v1.1 alongside Tucket 1.3.7.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Read the page you opened Grab on, only when you open it. |
| `scripting` | Run the colour, font, SVG and screenshot code in that page. |
| `storage` | Remember your colour format and whether you have Tucket. |
| `clipboardWrite` | Send captures to the clipboard (and so to Tucket). |

No host permissions, no `<all_urls>`, no network requests of its own.

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

Loads the extension into Chrome for Testing and runs it against the hostile fixture pages in `test/fixtures/`: a fixed header, sticky nav, lazy images, a panel that scrolls inside the page, sprite sheets and a CSS-variable design system. Captures, SVG output and popup screenshots go to `test/out/`. Run `npm test -- svgs shots` for specific suites, or set `HEADFUL=1` to watch.

If Chrome for Testing isn't installed, run `npx @puppeteer/browsers install chrome@stable --path ~/.cache/puppeteer`, or point `CHROME_PATH` at a Chromium build. Branded Chrome no longer loads unpacked extensions from the command line.

### Layout

```
src/background.js      service worker: screenshots (scroll, capture, stitch)
src/content/           injected on demand: palette, fonts, svgs, inspector, screenshot, region
src/shared/            classic scripts shared by pages and content scripts (colour, fonts, send, footer)
src/popup/             the toolbar popup
src/capture/           the screenshot result page
src/welcome/           shown once, on install
```

## License

MIT
