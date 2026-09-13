# Screens to design

All UI Tucket Grab v1.0 has today, with every state. The placeholder styling lives in
`src/shared/base.css` plus each page's own CSS. A new design can replace those files without
touching the logic. Items marked *in-page* render inside a website's own tab, in a closed
shadow root, so they must look right on any site and in light and dark.

## A. Popup (380 × 580)

1. **Shell.** Header (logo, name, HEX / RGB / HSL toggle), four tabs (Colours, Fonts, Screenshot, SVGs), scrolling body, footer.
2. **Colours tab**
   - Loading ("Reading colours…")
   - Loaded: *Eyedropper* and *Pick from element* buttons, a **Picked** row of recent eyedropper swatches, the **Page palette** grid (swatch, value, use count, *Send all*), and a **CSS variables** list (swatch, `--name`, value)
   - No colours found
   - Large palette (200 colours, "200 of 340")
3. **Fonts tab**
   - Loading
   - Font cards: family name, badge (Web font / Installed / Default), a sample line rendered in the page's font, weights and element count, the style line (`Inter · 16px/24 · 600`), and *Send line*, *Copy as CSS* and *Name* buttons
   - "Loaded but not used" list
   - No text found
4. **Screenshot tab**
   - Choose: Full page (primary), Visible area, Selected region, with a "opens in a new tab" note
   - Progress: getting ready → loading the page (lazy pass) → "Capturing screen 3 of 9" with bar and "about 4s left" → stitching → saving → done
   - Cancel button, then back to choose
   - Error (e.g. "You switched tabs, so the capture stopped", "The browser doesn't let extensions capture this page")
5. **SVGs tab**
   - Loading ("Looking for SVGs…")
   - Grid of tiles: checkerboard preview, kind and size ("Icon · 24×24", "SVG · 1200×800"), symbol or file name, download button, hover state (highlights it on the page)
   - Unreadable tile ("Can't read this file (another site)", click copies the URL)
   - *Send all* (shown only for Tucket users)
   - No SVGs found
6. **Blocked page.** "Can't grab from this page" on chrome://, the Web Store, the new tab page.
7. **Toast.** "Copied", "Copied — Tucket saved it", "Sending 3 of 8…", "Sent 8 — Tucket saved them", "Couldn't copy to the clipboard".
8. **Footer variants**
   - First run on a Mac: "Already have Tucket? Yes · No" plus "Get Tucket for Mac →"
   - Answered No: CTA only
   - Answered Yes: "Tucket saves what you send, via the clipboard · Change"
   - Not a Mac: "Tucket is Mac-only — captures still copy and download."

## B. In-page overlays

9. **Element inspector** *(in-page)*
   - Hover outline plus tag label ("button.cta 110 × 44")
   - Locked outline (distinct colour) with hint "Locked — click it again to unlock"
   - Panel, empty: "Hover over the page to read colours and type."
   - Panel, filled: element name, format toggle, **Colours** rows (Text, Background or "behind", Border, Fill/Stroke, Gradient stops) with Send on hover, **Type** section (resolved family, "web font · stack", size, weight, line height, letter spacing, *Send line*, *Copy as CSS*)
   - Colours-first vs Type-first order (depends on which popup tab opened it)
   - Eyedropper button, the **Picked** row after a pick, close button
   - Panel moves to the other corner when the cursor approaches
   - In-page toast
10. **Region selector** *(in-page)*. Dimmed page, hint pill "Drag to select an area · Esc to cancel", selection rectangle with a live "400 × 200" label.
11. **SVG highlight** *(in-page)*. Dimmed page with an outline around the hovered SVG.

## C. Extension pages

12. **Screenshot result** (a new tab)
    - Sticky top bar: logo, page title, "Full page · URL", *Send to Tucket*, *Save PNG*
    - Notes ("too tall for one image, so it's split into 3 parts", "scrolls inside a panel", "stops after 60 screens")
    - The image(s); for multi-part, a per-part header with its own Send/Save
    - Capture expired or missing
    - Toast and footer
13. **Welcome** (opens once, on install). Logo, "Tucket Grab is ready", pin and shortcut steps, four feature cards, a "Works with Tucket for Mac" section with the footer CTA.

## D. Browser chrome

14. **Toolbar icon** at 16, 32, 48 and 128px (the current one is a placeholder from `tools/icon.svg`; run `npm run icons` after replacing it).
15. **Badge.** Progress percentage ("45%") and "…" while loading or stitching, in the accent colour.

## E. Outside the extension

16. **Web Store assets.** 128px store icon, up to five 1280×800 screenshots, a 440×280 promo tile, an optional 1400×560 marquee, a 30-second demo video.
17. **trytucket.com/grab.** Landing page plus the privacy policy page (copy in `PRIVACY.md`).
