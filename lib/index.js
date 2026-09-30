/**
 * Host half of dsh-glass-effect (玻璃效果).
 *
 * Client-only plugin: the glass lives in `./client.js` as an injected
 * stylesheet plus one theme-token layer. The Host row exists because the
 * browser module graph is composed from live Loader entries — a package with
 * no importable `main` never reaches the browser. It does nothing on the Host.
 */

/** Cordis plugin name (Host side only; the client bundle carries its own). */
export const name = 'glassEffect'

/** No Host-side behaviour. */
export function apply() {}
