// A stand-in for Tucket's bridge helper (Tucket.app/Contents/MacOS/tucket-bridge), for tests.
// Speaks Chrome native messaging on stdin/stdout exactly as the real one does: a 4-byte
// little-endian length, then UTF-8 JSON. Protocol: docs/TUCKET_1.3.9_PRD.md §5.
//
// FAKE_HOST_DIR (set by the wrapper script the tests write) holds:
//   mode      optional: "ok" (default), or an error code every request gets, e.g. "app-not-running"
//   log.jsonl one line per request, with the image fields replaced by their size and dimensions
//   ocr.txt   optional: the text the ocr op returns
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.FAKE_HOST_DIR || '.';
const CHUNK = 64_000; // well under the real 1 MB, so tests exercise reassembly on ordinary captures

const mode = () => { try { return fs.readFileSync(path.join(DIR, 'mode'), 'utf8').trim() || 'ok'; } catch { return 'ok'; } };

function write(obj) {
  const body = Buffer.from(JSON.stringify(obj));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([head, body]));
}

// Replies too big for one message go as chunks of the full reply's JSON, each carrying the id.
function reply(id, result) {
  const json = JSON.stringify({ id, ...result });
  if (json.length <= CHUNK) { write(JSON.parse(json)); return; }
  const total = Math.ceil(json.length / CHUNK);
  for (let i = 0; i < total; i++) write({ id, chunk: json.slice(i * CHUNK, (i + 1) * CHUNK), index: i, total });
}

// PNG width and height from the IHDR chunk; JPEG isn't sent by Grab.
function pngSize(b64) {
  const b = Buffer.from(b64, 'base64');
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), bytes: b.length };
}

function log(entry) {
  fs.appendFileSync(path.join(DIR, 'log.jsonl'), `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
}

function handle(msg) {
  const { id, op } = msg;
  if (!id || !op) { write({ id, error: 'bad-request' }); return; }
  const m = mode();
  const { data, image, ...rest } = msg;
  log({ ...rest, ...(data != null ? { data: msg.kind === 'image' ? pngSize(data) : data } : {}), ...(image ? { image: pngSize(image) } : {}) });
  if (m !== 'ok') { reply(id, { error: m }); return; }
  switch (op) {
    case 'hello':
      reply(id, { app: 'Tucket', version: '1.3.9', features: ['ingest', 'ocr', 'removeBackground'] });
      return;
    case 'ingest':
      reply(id, { ok: true, clipId: `fake-${Date.now()}` });
      return;
    case 'ocr': {
      const size = pngSize(image || '');
      if (!size) { reply(id, { error: 'failed' }); return; }
      // ocr.txt, when present, is the text to "find" (store screenshots); otherwise a checkable stub.
      let text = `Fake OCR of a ${size.width}×${size.height} image\nfrom ${msg.pageTitle || 'a page'}`;
      try { text = fs.readFileSync(path.join(DIR, 'ocr.txt'), 'utf8'); } catch { /* keep the stub */ }
      reply(id, { text });
      return;
    }
    case 'removeBackground':
      // Hands the image straight back: big enough to arrive in chunks, and easy to verify.
      if (!pngSize(image || '')) { reply(id, { error: 'failed' }); return; }
      reply(id, { image });
      return;
    case 'share':
      reply(id, { error: 'unsupported' });
      return;
    default:
      reply(id, { error: 'bad-request' });
  }
}

let buf = Buffer.alloc(0);
process.stdin.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  while (buf.length >= 4) {
    const n = buf.readUInt32LE(0);
    if (buf.length < 4 + n) break;
    const raw = buf.subarray(4, 4 + n);
    buf = buf.subarray(4 + n);
    let msg;
    try { msg = JSON.parse(raw); } catch { write({ error: 'bad-request' }); continue; }
    handle(msg);
  }
});
process.stdin.on('end', () => process.exit(0));
