// serves kickoff radar from github pages at a domain root, plus the farcaster manifest
const ORIGIN = 'https://pedieth.github.io/kickoff-radar';
const HOST = 'https://kickoff-radar.pedieth.workers.dev';

// fill in after signing the domain in the farcaster manifest tool
const ACCOUNT_ASSOCIATION = null;

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
    const res = await fetch(ORIGIN + url.pathname + url.search, { cf: { cacheTtl: 300 } });
    const out = new Response(res.body, res);
    out.headers.delete('x-frame-options');
    out.headers.set('access-control-allow-origin', '*');
    return out;
  },
};
