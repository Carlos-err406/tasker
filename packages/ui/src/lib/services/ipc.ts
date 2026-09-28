import { getHost, type Operations } from '../../host.js';
export const IPC = new Proxy({} as Operations, { get: (_, key) => getHost().operations[key as keyof Operations] });
