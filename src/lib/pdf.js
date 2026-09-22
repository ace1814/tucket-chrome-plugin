// A tiny PDF writer: one page per image, each embedded as JPEG (DCTDecode), which every PDF
// reader understands without a library. Enough for screenshots, and nothing more.

const enc = new TextEncoder();
const PT_PER_PX = 0.75;          // CSS pixels are 96dpi; PDF points are 72dpi
export const MAX_PAGE_PT = 14400; // PDF's limit: 200 inches

const num = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * pages: [{ jpeg: Uint8Array, width, height, pageW, pageH }] — pixel size and page size in points.
 * Returns a PDF Blob.
 */
export function buildPdf(pages) {
  const parts = [];
  let size = 0;
  const out = (d) => {
    const bytes = typeof d === 'string' ? enc.encode(d) : d;
    parts.push(bytes);
    size += bytes.length;
  };

  const count = 2 + pages.length * 3;
  const offsets = new Array(count + 1).fill(0);
  const obj = (n, body, stream) => {
    offsets[n] = size;
    out(`${n} 0 obj\n${body}\n`);
    if (stream) {
      out('stream\n');
      out(stream);
      out('\nendstream\n');
    }
    out('endobj\n');
  };

  out('%PDF-1.7\n');
  out(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // marks the file as binary

  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>`);

  pages.forEach((page, i) => {
    const base = 3 + i * 3;
    const w = num(page.pageW);
    const h = num(page.pageH);
    obj(base, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}]`
      + ` /Resources << /XObject << /Im0 ${base + 2} 0 R >> >> /Contents ${base + 1} 0 R >>`);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    obj(base + 1, `<< /Length ${content.length} >>`, content);
    obj(base + 2, `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height}`
      + ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>`, page.jpeg);
  });

  const xref = size;
  let table = `xref\n0 ${count + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= count; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  out(table);
  out(`trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  return new Blob(parts, { type: 'application/pdf' });
}

/** Page size in points for an image, keeping it within PDF's maximum page height. */
export function pageSize(width, height, dpr = 1) {
  let pageW = (width / dpr) * PT_PER_PX;
  let pageH = (height / dpr) * PT_PER_PX;
  if (pageH > MAX_PAGE_PT || pageW > MAX_PAGE_PT) {
    const fit = MAX_PAGE_PT / Math.max(pageW, pageH);
    pageW *= fit;
    pageH *= fit;
  }
  return { pageW, pageH };
}
