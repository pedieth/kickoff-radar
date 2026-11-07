// tell farcaster clients the app is ready; no-op in a normal browser
try {
  const { sdk } = await import('https://esm.sh/@farcaster/miniapp-sdk@0.4.0');
  if (await sdk.isInMiniApp()) await sdk.actions.ready();
} catch {}
