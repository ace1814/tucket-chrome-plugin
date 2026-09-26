// The bridge to Tucket for Mac (Tucket 1.3.9+), over Chrome native messaging.
// Tucket installs a host manifest named com.arpitchandak.tucket in each browser; if it isn't
// there, connectNative fails at once and Grab falls back to the clipboard. Protocol: docs/TUCKET_1.3.9_PRD.md §5.

const HOST = 'com.arpitchandak.tucket';
const STATUS_TTL_MS = 30_000;
const HELLO_TIMEOUT_MS = 8000; // the helper waits up to 5 s for a cold Tucket launch
const REQUEST_TIMEOUT_MS = 30_000;

let cached = null;
let seq = 0;

/**
 * { state: 'connected', version, features }
 * { state: 'missing', reason }      no host registered: Tucket isn't installed, is older than
 *                                   1.3.9, or its "Browser extension" switch is off
 * { state: 'unavailable', reason }  the host is there but didn't answer (Tucket still launching)
 */
export async function status({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.value;
  let value;
  try {
    const reply = await request('hello', {}, HELLO_TIMEOUT_MS);
    value = { state: 'connected', version: reply.version || '', features: reply.features || [] };
  } catch (err) {
    const reason = String(err?.message || err);
    value = { state: isMissing(reason) ? 'missing' : 'unavailable', reason };
  }
  cached = { at: Date.now(), value };
  return value;
}

// Chrome's own errors when no usable host manifest exists for this extension.
export const isMissing = (reason) => /host not found|forbidden|disabled/i.test(String(reason));

export function forget() {
  cached = null;
}

/** One request over its own port. Replies larger than 1MB arrive in chunks and are reassembled. */
export function request(op, payload = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = chrome.runtime.connectNative(HOST);
    } catch (err) {
      reject(err);
      return;
    }
    const id = `r${Date.now().toString(36)}${(++seq).toString(36)}`;
    const chunks = [];
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { port.disconnect(); } catch { /* already gone */ }
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('timeout')), timeoutMs);

    port.onMessage.addListener((msg) => {
      if (!msg || msg.id !== id) return;
      if (msg.chunk != null) {
        chunks[msg.index] = msg.chunk;
        if (chunks.filter((c) => c != null).length < msg.total) return;
        try { msg = { id, ...JSON.parse(chunks.join('')) }; } catch { finish(reject, new Error('bad-reply')); return; }
      }
      if (msg.error) finish(reject, new Error(msg.error));
      else finish(resolve, msg);
    });
    port.onDisconnect.addListener(() => {
      finish(reject, new Error(chrome.runtime.lastError?.message || 'disconnected'));
    });
    port.postMessage({ id, op, ...payload });
  });
}
