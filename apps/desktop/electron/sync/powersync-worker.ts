/**
 * Custom PowerSync worker for Electron.
 * Only imports better-sqlite3 (avoids node:sqlite which doesn't exist in Electron).
 */

import Database from 'better-sqlite3';
import * as path from 'node:path';
import { getPowerSyncExtensionFilename, startPowerSyncWorker } from '@powersync/node/worker.js';

function resolvePowerSyncCoreExtension() {
  const extensionFilename = getPowerSyncExtensionFilename();
  let libraryPath = path.resolve(__dirname, 'powersync', extensionFilename);

  // When packaged with electron-builder, resolve from app.asar.unpacked
  if (__dirname.includes('app.asar')) {
    libraryPath = libraryPath.replace('app.asar', 'app.asar.unpacked');
  }
  return libraryPath;
}

async function resolveBetterSqlite3() {
  return Database;
}

startPowerSyncWorker({
  extensionPath: resolvePowerSyncCoreExtension,
  loadBetterSqlite3: resolveBetterSqlite3,
});
