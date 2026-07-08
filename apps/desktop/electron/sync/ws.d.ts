// `ws` ships no type declarations resolvable here (no @types/ws); we only use its
// default WebSocket constructor as a Realtime transport, so treat it as untyped.
declare module 'ws';
