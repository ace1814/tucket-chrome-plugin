# Chrome Web Store listing: draft

**Title** (45 chars): Tucket Grab: Colors, Fonts, SVGs, Screenshots
Check the character limit in the dashboard before submitting.

**Summary** (≤132): Pick colours, read fonts, grab real SVGs and full-page screenshots. Nothing leaves your machine. Works with Tucket for Mac.

**Category**: Developer Tools (alternative: Photos)

## Description

Everything designers take from the web, in one small extension.

COLOURS
• Eyedropper for any pixel on screen
• Hover an element to see its text, background and border colours
• The page's whole palette, sorted by how often each colour is used, plus its CSS colour variables
• HEX, RGB or HSL

FONTS
• The font that actually renders, not just the font stack
• Size, weight, line height, letter spacing, copy as CSS
• Web fonts the page loaded but never used

FULL-PAGE SCREENSHOTS
• Full page, visible area or a region you drag
• Sticky headers and chat bubbles appear once, not on every screen
• Lazy-loaded images are loaded first
• Sharp on Retina displays

SVGS
• Finds inline icons, sprites, SVG images and CSS backgrounds
• Exports the real vector, cleaned up to work outside the page
• Download as .svg or send to Tucket

PRIVATE BY DESIGN
No account. No analytics. No network requests of its own. It only reads a page when you open it there.

WORKS WITH TUCKET FOR MAC
Tucket is a private clipboard manager for designers. Everything you grab lands in your Tucket library: colours named, icons sorted, screenshots searchable. trytucket.com/grab

## Permission justifications

- **activeTab**: Reads the current page only after the user opens the extension on it, so they can pick colours, read fonts, find SVGs and take screenshots of that page.
- **scripting**: Injects the extension's own bundled scripts into the active tab when the user asks. They read colours, fonts and SVGs, show the element inspector and region selector, and scroll the page for full-page screenshots.
- **storage**: Saves two local preferences: the colour format (HEX/RGB/HSL) and whether the user has the Tucket app. Nothing is synced or sent anywhere.
- **clipboardWrite**: Copies what the user captures (a colour value, a font description, SVG markup or a screenshot) to the clipboard when they click Send or Copy.

**Single purpose**: Capture design assets (colours, fonts, SVGs and screenshots) from the current web page.

**Remote code**: None. All code is bundled.

**Data usage**: The extension collects no user data. Tick nothing on the data-collection form.

## Assets to prepare

- Store icon 128×128 (96×96 artwork with 16px padding)
- Screenshots, 1280×800, up to 5: palette, fonts, full-page capture, SVG grid, Tucket library with grabbed clips
- Small promo tile 440×280
- Optional marquee 1400×560
- 30-second demo video (YouTube link)
- Privacy policy URL: trytucket.com/grab/privacy (content in PRIVACY.md)
