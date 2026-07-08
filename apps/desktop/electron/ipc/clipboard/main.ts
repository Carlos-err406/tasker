import { clipboard } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { getDefaultDbPath } from '@tasker/core';
import type { IPCRegisterFunction } from '../types.js';
import { CLIPBOARD_SAVE_IMAGE } from './channels.js';
import { log } from './utils.js';
import { uploadImage } from '../../sync/storage.js';

function getMediaDir(): string {
  const dbPath = getDefaultDbPath();
  const dataDir = dbPath.substring(0, dbPath.lastIndexOf('/'));
  return join(dataDir, 'media');
}

export const clipboardRegister: IPCRegisterFunction = (ipcMain) => {
  ipcMain.handle(CLIPBOARD_SAVE_IMAGE, async () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      log('no image in clipboard');
      return null;
    }

    const timestamp = Date.now();
    const filename = `paste-${timestamp}.png`;
    const buffer = image.toPNG();

    // Prefer Supabase Storage → public URL renders on desktop AND mobile.
    const publicUrl = await uploadImage(buffer, filename);
    if (publicUrl) {
      log('uploaded to storage', publicUrl, `(${buffer.length} bytes)`);
      return publicUrl;
    }

    // Fallback (sync disabled / offline): save locally, desktop-only rendering.
    const mediaDir = getMediaDir();
    mkdirSync(mediaDir, { recursive: true });
    const fullPath = join(mediaDir, filename);
    writeFileSync(fullPath, buffer);
    log('saved locally (offline)', fullPath, `(${buffer.length} bytes)`);

    // Return path with ~/ prefix for portability, URL-encoded for markdown compatibility
    const home = homedir();
    const portablePath = fullPath.startsWith(home)
      ? '~' + fullPath.slice(home.length)
      : fullPath;

    // Encode spaces and special chars so markdown ![alt](url) parsing doesn't break
    return portablePath.replace(/ /g, '%20');
  });
};
