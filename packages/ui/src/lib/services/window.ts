import { getHost } from '../../host.js';
export function openExternal(url: string) { return getHost().openExternal(url); }
