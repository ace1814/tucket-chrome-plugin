// Markup for screenshots: arrow, box, highlight, text and blur. Marks are kept in the image's own
// pixels and drawn over a scaled view (captures can be 13,000px tall), then burned in only when the
// image leaves the page — saved, copied, sent or shared. Blur pixelates the area at that point, so
// the original pixels are gone from the file, not just covered.

export const COLOURS = ['#FF3B30', '#FFCC00', '#6C6CF8', '#111111', '#FFFFFF'];

const HIGHLIGHT = 'rgba(255, 214, 10, 0.38)';
const MIN_SIZE = 4;           // image px; smaller drags are treated as a stray click
const MAX_OVERLAY_PX = 16384; // canvas side limit, for very tall captures

export const strokeFor = (imageWidth) => Math.max(4, Math.round(imageWidth / 320));
const fontFor = (imageWidth) => strokeFor(imageWidth) * 6;
const blockFor = (imageWidth) => Math.max(10, strokeFor(imageWidth) * 3);

const norm = ({ x1, y1, x2, y2 }) => ({
  x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
});

// ---------- drawing (shared by the on-screen view and the export) ----------

function pixelate(ctx, source, mark, scale, imageWidth) {
  const r = norm(mark);
  if (r.w < 1 || r.h < 1) return;
  const block = blockFor(imageWidth);
  const small = new OffscreenCanvas(Math.max(1, Math.ceil(r.w / block)), Math.max(1, Math.ceil(r.h / block)));
  const sctx = small.getContext('2d');
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(source, r.x, r.y, r.w, r.h, 0, 0, small.width, small.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, small.width, small.height, r.x * scale, r.y * scale, r.w * scale, r.h * scale);
  ctx.restore();
}

function arrow(ctx, mark, scale, width) {
  const x1 = mark.x1 * scale, y1 = mark.y1 * scale, x2 = mark.x2 * scale, y2 = mark.y2 * scale;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = width * 4;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2 - Math.cos(angle) * head * 0.6, y2 - Math.sin(angle) * head * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

function text(ctx, mark, scale, imageWidth) {
  const size = fontFor(imageWidth) * scale;
  ctx.font = `650 ${size}px -apple-system, BlinkMacSystemFont, system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  // A contrasting outline keeps the words readable on any background.
  ctx.lineWidth = Math.max(2, size / 7);
  ctx.strokeStyle = mark.colour === '#FFFFFF' || mark.colour === '#FFCC00' ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.9)';
  ctx.lineJoin = 'round';
  ctx.strokeText(mark.text, mark.x1 * scale, mark.y1 * scale);
  ctx.fillStyle = mark.colour;
  ctx.fillText(mark.text, mark.x1 * scale, mark.y1 * scale);
}

/** Draw marks onto ctx. `source` is the full-size image; scale maps image px to ctx px. */
export function drawMarks(ctx, source, marks, scale, imageWidth) {
  // Blur first: everything else sits on top of it.
  for (const m of marks) if (m.type === 'blur') pixelate(ctx, source, m, scale, imageWidth);
  const width = strokeFor(imageWidth) * scale;
  for (const m of marks) {
    ctx.save();
    ctx.strokeStyle = m.colour;
    ctx.fillStyle = m.colour;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const r = norm(m);
    if (m.type === 'box') {
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.roundRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale, width * 1.5);
      ctx.stroke();
    } else if (m.type === 'highlight') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = HIGHLIGHT;
      ctx.fillRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
    } else if (m.type === 'arrow') {
      arrow(ctx, m, scale, width);
    } else if (m.type === 'text' && m.text) {
      text(ctx, m, scale, imageWidth);
    }
    ctx.restore();
  }
}

/** The part's image with its marks burned in, as a PNG. Unmarked parts come back untouched. */
export async function burnIn(blob, marks) {
  if (!marks.length) return blob;
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  drawMarks(ctx, bmp, marks, 1, bmp.width);
  bmp.close();
  return canvas.convertToBlob({ type: 'image/png' });
}

// ---------- the editor over one image ----------

export class Markup {
  /**
   * stage: the element wrapping the <img>. img: the displayed capture. tools(): { tool, colour }.
   * onCommit(markup, mark): a mark was added (for the shared undo history).
   */
  constructor({ stage, img, tools, onCommit }) {
    this.stage = stage;
    this.img = img;
    this.tools = tools;
    this.onCommit = onCommit;
    this.marks = [];
    this.draft = null;
    this.source = null;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'marks';
    stage.append(this.canvas);
    createImageBitmap(img).then((bmp) => { this.source = bmp; this.draw(); });

    new ResizeObserver(() => this.resize()).observe(img);
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', () => { this.draft = null; this.draw(); });
  }

  get width() { return this.img.naturalWidth; }

  resize() {
    const cssW = this.img.clientWidth;
    const cssH = this.img.clientHeight;
    if (!cssW || !cssH) return;
    const ratio = Math.min(devicePixelRatio || 1, MAX_OVERLAY_PX / cssW, MAX_OVERLAY_PX / cssH);
    this.canvas.width = Math.round(cssW * ratio);
    this.canvas.height = Math.round(cssH * ratio);
    this.scale = this.canvas.width / this.img.naturalWidth;
    this.draw();
  }

  draw() {
    if (!this.scale) return this.resize();
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.source) return;
    const marks = this.draft ? [...this.marks, this.draft] : this.marks;
    drawMarks(ctx, this.source, marks, this.scale, this.width);
  }

  point(e) {
    const r = this.canvas.getBoundingClientRect();
    const k = this.img.naturalWidth / r.width;
    return {
      x: Math.max(0, Math.min(this.img.naturalWidth, (e.clientX - r.left) * k)),
      y: Math.max(0, Math.min(this.img.naturalHeight, (e.clientY - r.top) * k)),
    };
  }

  down(e) {
    const { tool, colour } = this.tools();
    if (!tool) return;
    e.preventDefault();
    const p = this.point(e);
    if (tool === 'text') { this.ask(e, p, colour); return; }
    this.canvas.setPointerCapture(e.pointerId);
    this.draft = { type: tool, colour, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
  }

  move(e) {
    if (!this.draft) return;
    const p = this.point(e);
    this.draft.x2 = p.x;
    this.draft.y2 = p.y;
    this.draw();
  }

  up() {
    const mark = this.draft;
    this.draft = null;
    if (mark && Math.hypot(mark.x2 - mark.x1, mark.y2 - mark.y1) >= MIN_SIZE) this.add(mark);
    else this.draw();
  }

  // Text goes in through a real input placed where the click was, then becomes a mark.
  ask(e, p, colour) {
    const input = document.createElement('input');
    input.className = 'mark-text';
    input.placeholder = 'Type, then press Return';
    const stageBox = this.stage.getBoundingClientRect();
    input.style.left = `${e.clientX - stageBox.left}px`;
    input.style.top = `${e.clientY - stageBox.top}px`;
    input.style.color = colour;
    this.stage.append(input);
    input.focus();
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      input.remove();
      if (keep && value) this.add({ type: 'text', colour, text: value, x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') finish(true);
      if (ev.key === 'Escape') finish(false);
      ev.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
  }

  add(mark) {
    this.marks.push(mark);
    this.draw();
    this.onCommit(this, mark);
  }

  remove(mark) {
    const i = this.marks.lastIndexOf(mark);
    if (i >= 0) this.marks.splice(i, 1);
    this.draw();
  }

  clear() {
    this.marks = [];
    this.draw();
  }
}
