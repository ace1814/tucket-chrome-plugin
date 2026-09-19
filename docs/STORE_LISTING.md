# Chrome Web Store listing: draft

**Title** (45 chars): Tucket Grab: Colors, Fonts, SVGs, Screenshots
Check the character limit in the dashboard before submitting.

**Summary** (≤132): Pick colours, read fonts, grab real SVGs and full-page screenshots. Nothing leaves your machine. Works with Tucket for Mac.

**Category**: Developer Tools (alternative: Photos)

## Description

Everything designers take from the web, in one small extension.

COLOURS
• Eyedropper for any pixel on screen
• The page's key colours: the most used, the button (CTA) colour, and the next most used
• The whole palette and its CSS colour variables, one tap away
• HEX, RGB or HSL

FONTS
• Every font on the page, and where it comes from: Google Fonts, Adobe Fonts, Monotype, Fontshare
• Download free fonts, or find paid ones to buy
• Hover any text for its exact size, weight, line height and letter spacing

FULL-PAGE SCREENSHOTS
• Full page, visible area or a region you drag
• Sticky headers and chat bubbles appear once, not on every screen
• Lazy-loaded images are loaded first
• Sharp on Retina displays

SVGS
• Point at any icon or illustration and click to grab it
• Exports the real vector, cleaned up to work outside the page
• Download as .svg or send to Tucket

PRIVATE BY DESIGN
No account. No analytics. It only reads a page when you open it there, and the only thing it ever sends is a font's name, to check whether it's free to download.

WORKS WITH TUCKET FOR MAC
Tucket is a private clipboard manager for designers. Everything you grab lands in your Tucket library: colours named, icons sorted, screenshots searchable. trytucket.com/grab

## Permission justifications

- **activeTab**: Reads the current page only after the user opens the extension on it, so they can pick colours, read fonts, find SVGs and take screenshots of that page.
- **scripting**: Injects the extension's own bundled scripts into the active tab when the user asks. They read colours, fonts and SVGs, show the element inspector and region selector, and scroll the page for full-page screenshots.
- **storage**: Saves local preferences and caches: the colour format, colours picked with the eyedropper, the panel's position per site, and font lookups. Nothing is synced.
- **clipboardWrite**: Copies what the user captures (a colour value, a font description, SVG markup or a screenshot) to the clipboard when they click Send or Copy.
- **nativeMessaging**: Hands captures to the Tucket app on the user's Mac, when it's installed, and runs its on-device text recognition and background removal. Nothing leaves the computer.

**Single purpose**: Capture design assets (colours, fonts, SVGs and screenshots) from the current web page.

**Remote code**: None. All code is bundled.

**Data usage**: The extension collects no user data. The Font tab sends font family names (never page addresses) to api.fontsource.org to check whether a font is free. Tick nothing on the data-collection form, and describe the font lookup in the privacy practices field.

## Assets to prepare

- Store icon 128×128 (96×96 artwork with 16px padding)
- Screenshots, 1280×800, up to 5: the glass panel on a real site (Colour tab), fonts with sources, a full-page capture, SVG pick, Tucket library with grabbed clips
- Small promo tile 440×280
- Optional marquee 1400×560
- 30-second demo video (YouTube link)
- Privacy policy URL: trytucket.com/grab/privacy (content in PRIVACY.md)
