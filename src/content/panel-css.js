// Styles for the in-page glass panel. Kept as a string and applied with adoptedStyleSheets,
// because strict-CSP sites (GitHub and friends) block <style> tags injected into the page.
(() => {
  const tg = (globalThis.__tg ??= {});
  if (tg.panelCss) return;

  tg.panelCss = `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; text-align: inherit; }
a { color: inherit; text-decoration: none; }
button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
svg { display: block; flex: none; }

.root {
  --ink: #1d1d1f;
  --ink-2: rgba(60, 60, 67, .72);
  --ink-3: rgba(60, 60, 67, .46);
  --tint: rgba(250, 250, 252, .72);
  --tint-solid: rgb(246, 246, 249);
  --raised: rgba(255, 255, 255, .78);
  --fill: rgba(118, 118, 128, .12);
  --fill-2: rgba(118, 118, 128, .2);
  --hair: rgba(0, 0, 0, .08);
  --rim-hi: rgba(255, 255, 255, .95);
  --rim-lo: rgba(255, 255, 255, .3);
  --accent: #6c6cf8;
  --accent-hi: #8585fa;
  --good: #30d158;
  --shadow: 0 0 0 .5px rgba(0, 0, 0, .1), 0 2px 8px rgba(0, 0, 0, .06), 0 22px 60px rgba(0, 0, 0, .24);
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace;
  font: 13px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", sans-serif;
  letter-spacing: -.005em;
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  .root {
    --ink: #f5f5f7;
    --ink-2: rgba(235, 235, 245, .7);
    --ink-3: rgba(235, 235, 245, .48);
    --tint: rgba(28, 28, 32, .76);
    --tint-solid: rgb(40, 40, 46);
    --raised: rgba(92, 92, 102, .55);
    --fill: rgba(118, 118, 128, .24);
    --fill-2: rgba(118, 118, 128, .36);
    --hair: rgba(255, 255, 255, .1);
    --rim-hi: rgba(255, 255, 255, .38);
    --rim-lo: rgba(255, 255, 255, .06);
    --accent: #8080fb;
    --accent-hi: #9696fc;
    --shadow: 0 0 0 .5px rgba(0, 0, 0, .6), 0 2px 8px rgba(0, 0, 0, .25), 0 22px 60px rgba(0, 0, 0, .55);
  }
}

/* ---------- Liquid Glass material ---------- */
.glass {
  position: relative;
  background: var(--tint);
  -webkit-backdrop-filter: blur(30px) saturate(190%);
  backdrop-filter: blur(30px) saturate(190%);
  box-shadow: var(--shadow), inset 0 1px 0 var(--rim-hi), inset 0 -1px 0 var(--rim-lo);
}
/* Specular rim: bright where the light hits (top-left), fading around the edge. */
.glass::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  pointer-events: none;
  background: linear-gradient(155deg, var(--rim-hi), rgba(255, 255, 255, 0) 32%, rgba(255, 255, 255, 0) 68%, var(--rim-lo));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass { background: var(--tint-solid); }
}

/* ---------- panel ---------- */
.panel {
  position: fixed;
  top: 16px;
  right: 16px;
  width: 348px;
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  border-radius: 28px;
  pointer-events: auto;
  animation: panel-in .38s cubic-bezier(.2, .9, .25, 1.15);
  transform-origin: top right;
}
@keyframes panel-in { from { opacity: 0; transform: scale(.94) translateY(-6px); } }

.head { display: flex; align-items: center; gap: 9px; padding: 14px 14px 10px 16px; cursor: grab; user-select: none; }
.head:active { cursor: grabbing; }
.mark { width: 24px; height: 24px; border-radius: 7.5px; display: grid; place-items: center; color: #fff;
  background: linear-gradient(145deg, #8f8ffb, #5656e6); box-shadow: inset 0 1px 0 rgba(255,255,255,.45), 0 1px 3px rgba(86,86,230,.4); }
.head strong { font-size: 14px; font-weight: 650; letter-spacing: -.01em; }
.grow { flex: 1; }
.close { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--fill); color: var(--ink-2); transition: background .15s, transform .15s; }
.close:hover { background: var(--fill-2); color: var(--ink); }
.close:active { transform: scale(.92); }

/* Segmented tab bar with a sliding glass lens. */
.tabs { position: relative; display: grid; grid-template-columns: repeat(4, 1fr); margin: 0 12px; padding: 3px; border-radius: 999px; background: var(--fill); }
.lens {
  position: absolute; top: 3px; bottom: 3px; left: 3px; width: calc((100% - 6px) / 4);
  border-radius: 999px; background: var(--raised);
  box-shadow: 0 1px 4px rgba(0, 0, 0, .12), 0 0 0 .5px var(--hair), inset 0 1px 0 var(--rim-hi);
  transition: transform .5s cubic-bezier(.3, 1.4, .45, 1);
}
.tabs button { position: relative; z-index: 1; height: 46px; border-radius: 999px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
  font-size: 10.5px; font-weight: 600; color: var(--ink-2); transition: color .2s; }
.tabs button:hover { color: var(--ink); }
.tabs button[aria-selected="true"] { color: var(--ink); }
.tabs button[aria-selected="true"] svg { color: var(--accent); }

.body { overflow-y: auto; overscroll-behavior: contain; padding: 14px 16px 16px; min-height: 120px; }
.body::-webkit-scrollbar { width: 0; }

.label { display: flex; align-items: center; justify-content: space-between; margin: 18px 2px 8px; font-size: 11.5px; font-weight: 600; color: var(--ink-3); }
.label:first-child { margin-top: 2px; }
.note { margin: 10px 2px 0; font-size: 11.5px; color: var(--ink-3); }
.error { margin: 10px 2px 0; font-size: 12px; color: #ff453a; }
.fine { margin: 8px 0 0; font-size: 11px; color: var(--ink-3); }

/* ---------- buttons ---------- */
.btn { height: 34px; padding: 0 14px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  background: var(--fill); font-weight: 600; white-space: nowrap; transition: background .15s, transform .15s, box-shadow .15s; }
.btn:hover { background: var(--fill-2); }
.btn:active { transform: scale(.96); }
.btn.primary { color: #fff; background: linear-gradient(180deg, var(--accent-hi), var(--accent));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .35), 0 4px 14px color-mix(in srgb, var(--accent) 38%, transparent); }
.btn.primary:hover { filter: brightness(1.06); }
.btn.big { width: 100%; height: 48px; border-radius: 17px; font-size: 14px; }
.actions { display: flex; gap: 8px; margin-top: 12px; }
.actions .btn { flex: 1; }

.seg { display: inline-flex; padding: 2px; border-radius: 999px; background: var(--fill); }
.seg button { padding: 3px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 650; color: var(--ink-2); letter-spacing: .02em; }
.seg button[aria-pressed="true"] { background: var(--raised); color: var(--ink); box-shadow: 0 1px 2px rgba(0, 0, 0, .12), inset 0 1px 0 var(--rim-hi); }

.switch { width: 40px; height: 24px; border-radius: 999px; background: var(--fill-2); position: relative; transition: background .25s; flex: none; }
.switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; border-radius: 50%; background: #fff;
  box-shadow: 0 2px 5px rgba(0, 0, 0, .22); transition: transform .35s cubic-bezier(.3, 1.4, .45, 1); }
.switch[aria-checked="true"] { background: var(--good); }
.switch[aria-checked="true"]::after { transform: translateX(16px); }

/* ---------- Screenshot ---------- */
.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.tile { height: 96px; border-radius: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px;
  background: var(--fill); font-size: 12px; font-weight: 600; transition: background .15s, transform .2s cubic-bezier(.3, 1.4, .45, 1); }
.tile:hover { background: var(--fill-2); transform: translateY(-1px); }
.tile:active { transform: scale(.95); }
.tile.primary { color: #fff; background: linear-gradient(180deg, var(--accent-hi), var(--accent));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .35), 0 8px 20px color-mix(in srgb, var(--accent) 36%, transparent); }

.rows { border-radius: 20px; background: var(--fill); overflow: hidden; }
.row { width: 100%; display: flex; align-items: center; gap: 12px; padding: 11px 14px; transition: background .15s; }
.row:hover { background: var(--fill); }
.row + .row { border-top: .5px solid var(--hair); }
.row .ic { width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; background: var(--raised); box-shadow: inset 0 1px 0 var(--rim-hi), 0 0 0 .5px var(--hair); }
.row .t { flex: 1; min-width: 0; }
.row .t b { display: block; font-weight: 600; }
.row .t span { display: block; font-size: 11.5px; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .end { color: var(--ink-3); }

.card { margin-top: 10px; padding: 14px 14px 12px; border-radius: 20px; background: var(--raised); box-shadow: inset 0 1px 0 var(--rim-hi), 0 0 0 .5px var(--hair);
  animation: card-in .35s cubic-bezier(.2, .9, .25, 1.1); }
@keyframes card-in { from { opacity: 0; transform: translateY(-4px) scale(.98); } }
.card-head { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 650; }
.card-head svg { color: var(--accent); }
.card p { margin: 6px 0 0; color: var(--ink-2); font-size: 12px; line-height: 1.45; }
.card .actions { margin-top: 12px; }
.result { margin-top: 10px; }
.result pre { margin: 0; max-height: 160px; overflow: auto; padding: 10px 12px; border-radius: 14px; background: var(--fill); font: 12px/1.45 -apple-system, system-ui, sans-serif; white-space: pre-wrap; user-select: text; }

/* ---------- Font ---------- */
.fonts { border-radius: 20px; background: var(--fill); overflow: hidden; }
.font { padding: 11px 14px 10px; }
.font + .font { border-top: .5px solid var(--hair); }
.font .main { width: 100%; display: block; }
.font .sample { font-size: 21px; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.font .meta { display: flex; align-items: center; gap: 6px; margin-top: 3px; font-size: 11.5px; color: var(--ink-2); }
.font .meta b { color: var(--ink); font-weight: 600; }
.badge { font-size: 10px; font-weight: 650; padding: 2px 7px; border-radius: 999px; background: var(--fill-2); color: var(--ink-2); white-space: nowrap; }
.font .more { display: flex; gap: 6px; margin-top: 8px; }
.pill { height: 26px; padding: 0 10px; border-radius: 999px; background: var(--raised); font-size: 11.5px; font-weight: 600; box-shadow: 0 0 0 .5px var(--hair), inset 0 1px 0 var(--rim-hi); transition: transform .15s; }
.pill:active { transform: scale(.95); }
a.pill { display: inline-flex; align-items: center; }
.pill.go { color: var(--accent); margin-left: auto; }
.inspect-row { display: flex; align-items: center; gap: 10px; padding: 11px 14px; border-radius: 20px; background: var(--fill); margin-bottom: 10px; }
.inspect-row .t { flex: 1; }
.inspect-row b { display: block; font-weight: 600; }
.inspect-row span { font-size: 11.5px; color: var(--ink-2); }

/* ---------- Colour ---------- */
.brand { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.sw { border-radius: 20px; overflow: hidden; background: var(--fill); transition: transform .2s cubic-bezier(.3, 1.4, .45, 1); }
.sw:hover { transform: translateY(-2px); }
.sw:active { transform: scale(.96); }
.sw .chip { height: 76px; box-shadow: inset 0 -.5px 0 var(--hair); }
.sw .meta { padding: 7px 10px 9px; }
.sw .role { font-size: 10.5px; font-weight: 600; color: var(--ink-3); }
.sw .val { font: 600 11.5px/1.3 var(--mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dots { display: flex; flex-wrap: wrap; gap: 7px; }
.dot { width: 28px; height: 28px; border-radius: 50%; box-shadow: inset 0 0 0 .5px rgba(0, 0, 0, .18), 0 1px 3px rgba(0, 0, 0, .12); transition: transform .2s cubic-bezier(.3, 1.4, .45, 1); }
.dot:hover { transform: scale(1.12); }
.grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 7px; }
.grid .dot { width: 100%; height: auto; aspect-ratio: 1; }
.disclose { width: 100%; margin-top: 14px; display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-radius: 16px; background: var(--fill); font-weight: 600; }
.disclose svg { transition: transform .3s; color: var(--ink-3); }
.disclose[aria-expanded="true"] svg { transform: rotate(90deg); }
.vars { margin-top: 10px; border-radius: 16px; background: var(--fill); overflow: hidden; }
.var { width: 100%; display: flex; align-items: center; gap: 9px; padding: 7px 12px; }
.var + .var { border-top: .5px solid var(--hair); }
.var .dot { width: 18px; height: 18px; }
.var .name { flex: 1; min-width: 0; font: 11px/1.3 var(--mono); color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.var .val { font: 600 11px/1.3 var(--mono); }
.skeleton { border-radius: 20px; background: var(--fill); animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .5; } }

/* ---------- SVG ---------- */
.hint { text-align: center; padding: 18px 8px 8px; }
.hint .art { position: relative; width: 68px; height: 68px; margin: 0 auto 12px; border-radius: 22px; display: grid; place-items: center; background: var(--fill); color: var(--accent); }
.hint .art::after { content: ""; position: absolute; inset: -4px; border-radius: 26px; border: 2px solid var(--accent); opacity: 0; animation: ring 2s ease-out infinite; }
@keyframes ring { 0% { opacity: .5; transform: scale(.9); } 100% { opacity: 0; transform: scale(1.15); } }
.hint b { display: block; font-size: 14px; font-weight: 650; }
.hint span { display: block; margin-top: 3px; color: var(--ink-2); font-size: 12px; }
.checker { background-color: #fff; background-image: linear-gradient(45deg, #ececf0 25%, transparent 25%, transparent 75%, #ececf0 75%), linear-gradient(45deg, #ececf0 25%, transparent 25%, transparent 75%, #ececf0 75%);
  background-size: 14px 14px; background-position: 0 0, 7px 7px; }
.preview { height: 150px; border-radius: 20px; display: grid; place-items: center; padding: 18px; box-shadow: inset 0 0 0 .5px var(--hair); overflow: hidden; }
.preview svg, .preview .art-svg { max-width: 100%; max-height: 114px; width: auto; height: auto; }
.preview .art-svg { display: grid; place-items: center; width: 100%; height: 100%; }
.preview .art-svg > svg { width: 100%; height: 100%; }
.preview .none { color: #6b6b76; font-size: 12px; text-align: center; }
.pmeta { display: flex; align-items: baseline; gap: 8px; margin-top: 10px; padding: 0 2px; }
.pmeta b { font-weight: 650; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pmeta span { font-size: 11.5px; color: var(--ink-2); white-space: nowrap; }
.strip { display: flex; gap: 6px; flex-wrap: wrap; }
.thumb { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; padding: 7px; box-shadow: inset 0 0 0 .5px var(--hair); transition: transform .2s; }
.thumb:hover { transform: scale(1.06); }
.thumb .art-svg { width: 100%; height: 100%; display: grid; place-items: center; }
.thumb .art-svg > svg { width: 100%; height: 100%; }

/* ---------- footer ---------- */
.foot { display: flex; align-items: center; gap: 8px; padding: 11px 16px 13px; border-top: .5px solid var(--hair); font-size: 11.5px; color: var(--ink-2); }
.foot .dot-on { width: 7px; height: 7px; border-radius: 50%; background: var(--good); box-shadow: 0 0 0 3px color-mix(in srgb, var(--good) 22%, transparent); }
.foot a { margin-left: auto; color: var(--accent); font-weight: 600; white-space: nowrap; }
.foot a:hover { text-decoration: underline; }

/* ---------- on-page helpers ---------- */
.outline { position: fixed; pointer-events: none; border-radius: 8px; border: 2px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent); transition: left .08s, top .08s, width .08s, height .08s; }
.tag { position: fixed; pointer-events: none; padding: 5px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 600; white-space: nowrap; }
.tip { position: fixed; pointer-events: none; width: 260px; padding: 10px 12px 11px; border-radius: 18px; }
.tip b { display: block; font-size: 13.5px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tip .line { margin-top: 2px; font: 11.5px/1.35 var(--mono); color: var(--ink-2); }
.tip dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 8px 0 0; font-size: 11.5px; }
.tip dt { color: var(--ink-3); }
.tip dd { margin: 0; font-family: var(--mono); }
.tip .foot-hint { margin-top: 8px; font-size: 11px; color: var(--ink-3); }
.toast { position: fixed; left: 50%; bottom: 28px; transform: translate(-50%, 14px) scale(.96); opacity: 0; pointer-events: none;
  padding: 10px 18px; border-radius: 999px; font-size: 13px; font-weight: 600; white-space: nowrap;
  transition: opacity .2s, transform .35s cubic-bezier(.3, 1.4, .45, 1); }
.toast.show { opacity: 1; transform: translate(-50%, 0) scale(1); }
`;
})();
