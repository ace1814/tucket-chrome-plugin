# Screens

Every screen Tucket Grab 1.1 has, with its states. The look is the Liquid Glass system in
`src/content/panel-css.js` (the in-page panel) and `src/shared/base.css` plus each page's own CSS
(the extension pages). Both can be replaced without touching the logic.

Items marked *in-page* render inside a website's own tab, in a closed shadow root, so they must
hold up on any site, light or dark, and never leak the page's styles in.
`npm test -- screens` writes all of them to `test/out/`, and `node tools/review-sheet.mjs` lays
them out side by side.

## A. The panel *(in-page, 348px wide, floats top-right, draggable)*

1. **Shell.** Tucket mark, name, close button; a segmented tab bar with a sliding glass lens
   (Screenshot · Font · Colour · SVG); scrolling body; one-line footer.
2. **Screenshot tab**
   - Three tiles: Full page (filled), Visible area, Selected area
   - The note: sticky headers show once, lazy images load first, formats
   - Error ("You switched tabs, so the capture stopped", "The browser doesn't let extensions capture this page")
   - While capturing, the panel hides itself; progress shows on the toolbar badge (see D)
3. **Font tab**
   - Inspect switch (off / on, with its hint)
   - Font rows: the family name set in that font, a source badge (Google Fonts, Adobe Fonts,
     Monotype, Fontshare, Web font, Installed, System), weights and use count, then
     *Copy style*, *Copy CSS*, and a link: **Download free**, **Adobe Fonts**, **Buy on MyFonts** or **Find to buy**
   - Loading skeletons, and "No text on this page"
4. **Colour tab**
   - **Pick a colour** (eyedropper), and the **Picked** row of recent picks
   - **Brand colours**: Primary (most used), Secondary · CTA (the button colour), Tertiary,
     each a swatch with its value; HEX / RGB / HSL toggle
   - **All N colours** disclosure → the full palette grid and the CSS variables list
   - Loading skeletons, and "No colours found on this page"
5. **SVG tab**
   - Empty: "N SVGs on this page — every one is outlined. Click one to grab it."
   - Grabbed: checkerboard preview, name, kind · size · weight, *Copy SVG* / *Send to Tucket*,
     *Download*, and "N more outlined on the page"
   - Unreadable: "This SVG lives on another site" with *Copy its link*
   - The strip of everything grabbed on this page
6. **Footer.** "Connected to Tucket 1.3.9" with a green dot, or "Everything you grab can land in
   Tucket · Get Tucket →", or on a non-Mac "Everything here copies and downloads."
7. **Toast.** "Copied", "Sent to Tucket", "Copied — Tucket saved it", "Can't read that one — it's on another site".

## B. On the page *(in-page)*

8. **SVG outlines.** A dashed violet box around every grabbable SVG, the one under the cursor
   solid, with its "Icon · 24×24" label.
9. **Font inspect.** The hovered text outlined, with a glass tooltip: family, the style line, size,
   weight, line height, letter spacing, and "Click to copy the style".
10. **Region selector.** Dimmed page, the "Drag to select an area · Esc to cancel" pill, the
    selection rectangle with a live "400 × 200" label.

## C. Extension pages

11. **Screenshot result** (opens in a new tab)
    - Sticky top bar: mark, page title, "Full page · URL", *Copy text*, *Remove background*,
      the PNG / JPEG / WebP / PDF picker, *Send to Tucket*, *Save*
    - Notes ("split into 3 parts", "the panel is expanded; the sidebar and bars come from the
      first screen", "stops after 60 screens")
    - The image, or one block per part with its own Send and Save
    - The "This one happens in Tucket" card — only after tapping a Tucket tool without Tucket
      (with a softer, CTA-free version off the Mac)
    - "This screenshot is no longer available", toast, footer
12. **Can't grab here.** The small card for chrome://, the Web Store and the new tab page.
13. **Welcome** (once, on install). Mark, "Tucket Grab is ready", pin and shortcut steps, four
    feature cards, the Tucket section.

## D. Browser chrome

14. **Toolbar icon** at 16, 32, 48 and 128px — Tucket's mark, drawn flat (`tools/icon.svg`, then `npm run icons`).
15. **Badge.** The capture's progress ("45%") and "…" while loading or stitching, in the accent colour.

## E. Outside the extension

16. **Web Store assets.** 128px store icon, up to five 1280×800 screenshots, a 440×280 promo tile,
    an optional 1400×560 marquee, a 30-second demo video.
17. **trytucket.com/grab.** The landing page, and the privacy page (copy in `PRIVACY.md`).
