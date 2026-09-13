// Screenshots are too big for chrome.storage, so the service worker hands them to the capture
// page through IndexedDB. Local only, and pruned: a capture lives until it is a day old or
// five newer ones exist.

const DB_NAME = 'tucket-grab';
const STORE = 'captures';
const KEEP = 5;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

export const putCapture = (capture) => withStore('readwrite', (s) => s.put(capture));
export const getCapture = (id) => withStore('readonly', (s) => s.get(id));
export const deleteCapture = (id) => withStore('readwrite', (s) => s.delete(id));

export async function pruneCaptures() {
  const all = (await withStore('readonly', (s) => s.getAll())) || [];
  all.sort((a, b) => b.createdAt - a.createdAt);
  const now = Date.now();
  const stale = all.filter((c, i) => i >= KEEP - 1 || now - c.createdAt > MAX_AGE_MS);
  for (const c of stale) await deleteCapture(c.id);
}
