// Farcaster mini app glue. Loads the SDK in the background so a slow or
// blocked CDN never holds up the page, then tells the client we're ready.
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

const sdkReady = (async () => {
  try {
    const { sdk } = await withTimeout(import('https://esm.sh/@farcaster/miniapp-sdk@0.4.0'), 4000);
    if (await withTimeout(sdk.isInMiniApp(), 1500)) { await sdk.actions.ready(); return sdk; }
  } catch { /* plain browser or cdn unreachable */ }
  return null;
})();

/** Compose a cast: native composer inside a Farcaster client, web intent otherwise. */
export async function composeCast(text, embeds, webUrl) {
  const sdk = await sdkReady;
  if (sdk) {
    try { await sdk.actions.composeCast({ text, embeds: embeds.slice(0, 2) }); return; }
    catch { /* fall through to web */ }
  }
  window.open(webUrl, '_blank', 'noopener');
}
