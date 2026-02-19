import { clipboard } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { getDefaultDbPath } from '@tasker/core';
import type { IPCRegisterFunction } from '../types.js';
import { CLIPBOARD_SAVE_IMAGE } from './channels.js';
import { log } from './utils.js';

function getMediaDir(): string {
  const dbPath = getDefaultDbPath();
  const dataDir = dbPath.substring(0, dbPath.lastIndexOf('/'));
  return join(dataDir, 'media');
}

export const clipboardRegister: IPCRegisterFunction = (ipcMain) => {
  ipcMain.handle(CLIPBOARD_SAVE_IMAGE, () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      log('no image in clipboard');
      return null;
    }

    const mediaDir = getMediaDir();
    mkdirSync(mediaDir, { recursive: true });

    const timestamp = Date.now();
    const filename = `paste-${timestamp}.png`;
    const fullPath = join(mediaDir, filename);

    const buffer = image.toPNG();
    writeFileSync(fullPath, buffer);
    log('saved', fullPath, `(${buffer.length} bytes)`);

    // Return path with ~/ prefix for portability, URL-encoded for markdown compatibility
    const home = homedir();
    const portablePath = fullPath.startsWith(home)
      ? '~' + fullPath.slice(home.length)
      : fullPath;

    // Encode spaces and special chars so markdown ![alt](url) parsing doesn't break
    return portablePath.replace(/ /g, '%20');
  });
};
