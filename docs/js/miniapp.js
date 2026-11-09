// Farcaster mini app glue. Tells the client we're ready, and exposes a
// compose helper that uses the native composer when we're inside a client.
let sdk = null;
try {
  ({ sdk } = await import('https://esm.sh/@farcaster/miniapp-sdk@0.4.0'));
  if (await sdk.isInMiniApp()) await sdk.actions.ready();
  else sdk = null;
} catch { sdk = null; }

export const inMiniApp = !!sdk;

/** Compose a cast: native composer inside a Farcaster client, web intent otherwise. */
export async function composeCast(text, embeds, webUrl) {
  if (sdk) {
    try { await sdk.actions.composeCast({ text, embeds: embeds.slice(0, 2) }); return; }
    catch { /* fall through to web */ }
  }
  window.open(webUrl, '_blank', 'noopener');
}
