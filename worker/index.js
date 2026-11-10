// serves kickoff radar from github pages at a domain root, plus the farcaster manifest
const ORIGIN = 'https://pedieth.github.io/kickoff-radar';
const HOST = 'https://kickoff-radar.pedieth.workers.dev';

// signed by @pk for this domain
const ACCOUNT_ASSOCIATION = {
  header: 'eyJmaWQiOjE2NDQ3LCJ0eXBlIjoiY3VzdG9keSIsImtleSI6IjB4RWJDNTU1MTA4OTdhOTMyQjk1N2U5YzExNjlhQzQwN2FGOTFFNmI0RCJ9',
  payload: 'eyJkb21haW4iOiJraWNrb2ZmLXJhZGFyLnBlZGlldGgud29ya2Vycy5kZXYifQ',
  signature: 'eT5Fvcu6VOfM7RFdXbpxg/sWE557crsJLMtGkN2TCG4iWGprs1kqepjKZSm/n+V5bkQPYCNzM7Mh6qktxUW2khs=',
};

const manifest = () => ({
  ...(ACCOUNT_ASSOCIATION ? { accountAssociation: ACCOUNT_ASSOCIATION } : {}),
  miniapp: {
    version: '1',
    name: 'Kickoff Radar',
    iconUrl: `${HOST}/img/icon.png`,
    homeUrl: `${HOST}/`,
    imageUrl: `${HOST}/img/embed.png`,
    buttonTitle: 'Open Radar',
    splashImageUrl: `${HOST}/img/splash.png`,
    splashBackgroundColor: '#0b0f14',
    subtitle: 'Big football trades, live',
    description: "Big Polymarket football trades as they happen, with each wallet's football track record. Market activity, not betting advice.",
    primaryCategory: 'sports',
    tags: ['football', 'soccer', 'polymarket', 'whales'],
  },
});

export default {
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/.well-known/farcaster.json') {
      return Response.json(manifest(), { headers: { 'access-control-allow-origin': '*', 'cache-control': 'max-age=300' } });
    }
    // polymarket api relay, for networks that block polymarket directly
    const pm = url.pathname.match(/^\/pm\/(gamma|data)(\/.*)$/);
    if (pm) {
      if (req.method !== 'GET') return new Response('method not allowed', { status: 405 });
      const base = pm[1] === 'gamma' ? 'https://gamma-api.polymarket.com' : 'https://data-api.polymarket.com';
      const up = await fetch(base + pm[2] + url.search, { headers: { accept: 'application/json' }, cf: { cacheTtl: 5 } });
      const out = new Response(up.body, { status: up.status, headers: { 'content-type': up.headers.get('content-type') || 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' } });
      const ra = up.headers.get('retry-after');
      if (ra) { out.headers.set('retry-after', ra); out.headers.set('access-control-expose-headers', 'retry-after'); }
      return out;
    }
    const res = await fetch(ORIGIN + url.pathname + url.search, { cf: { cacheTtl: 300 } });
    const out = new Response(res.body, res);
    out.headers.delete('x-frame-options');
    out.headers.set('access-control-allow-origin', '*');
    return out;
  },
};
