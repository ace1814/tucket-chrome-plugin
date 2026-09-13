// Builds dist/tucket-grab-<version>.zip for the Chrome Web Store.
// The store assigns the item's key itself and rejects uploads that carry one, so the dev `key`
// is stripped from the packaged manifest. Put the store's public key back into manifest.json
// afterwards so local builds share the store ID (and Tucket's native host trusts both).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'manifest.json'), 'utf8'));
const stage = path.join(ROOT, 'dist/stage');
const zip = path.join(ROOT, `dist/tucket-grab-${manifest.version}.zip`);

await fs.rm(stage, { recursive: true, force: true });
await fs.rm(zip, { force: true });
await fs.mkdir(stage, { recursive: true });
for (const p of ['src', 'icons', 'LICENSE']) await fs.cp(path.join(ROOT, p), path.join(stage, p), { recursive: true });
delete manifest.key;
await fs.writeFile(path.join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

execFileSync('zip', ['-rqX', zip, '.', '-x', '*.DS_Store'], { cwd: stage, stdio: 'inherit' });
await fs.rm(stage, { recursive: true, force: true });
console.log(path.relative(ROOT, zip));
