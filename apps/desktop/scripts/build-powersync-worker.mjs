/**
 * Post-build script: compile the custom PowerSync worker and copy the native extension.
 * The worker only imports better-sqlite3 (avoids node:sqlite which doesn't exist in Electron).
 */

import { build } from 'esbuild';
import { cpSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, '..');
const distElectron = resolve(desktopRoot, 'dist-electron');

// 1. Build the custom worker with esbuild
console.log('[powersync] Building custom worker...');
await build({
  entryPoints: [resolve(desktopRoot, 'electron/sync/powersync-worker.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: resolve(distElectron, 'powersync-worker.cjs'),
  external: ['better-sqlite3', '@powersync/node'],
});

// 2. Copy the native PowerSync extension (.dylib/.so/.dll)
console.log('[powersync] Copying native extension...');
const extDir = resolve(distElectron, 'powersync');
mkdirSync(extDir, { recursive: true });

// Find the extension in node_modules (check local first, then hoisted)
let psNodeLib = resolve(desktopRoot, 'node_modules/@powersync/node/lib');
if (!existsSync(psNodeLib)) psNodeLib = resolve(desktopRoot, '../../node_modules/@powersync/node/lib');
if (existsSync(psNodeLib)) {
  for (const f of readdirSync(psNodeLib)) {
    if (f.endsWith('.dylib') || f.endsWith('.so') || f.endsWith('.dll')) {
      cpSync(join(psNodeLib, f), join(extDir, f));
      console.log(`[powersync] Copied ${f}`);
    }
  }
} else {
  console.warn('[powersync] WARNING: @powersync/node/lib not found, native extension not copied');
}

console.log('[powersync] Done');
