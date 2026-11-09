import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDate, soccerLeagueCodes, isFootballSlug, isFootballTrade, matchOutcomes,
  groupMatches, sideShare, walletScore, isStrong, fmtUsd, timeAgo,
  castText, composeUrl, eventUrl, RADAR_URL,
} from '../docs/js/lib.js';

const sports = [
  { sport: 'epl', tags: '1,100639,100350' },
  { sport: 'uel', tags: '1,100639,101787,100350' },
  { sport: 'nba', tags: '1,745,100639' },
];
const leagues = soccerLeagueCodes(sports);

test('parseDate handles the shapes gamma returns', () => {
  const want = Date.UTC(2026, 10, 5, 17, 45);
  assert.equal(parseDate('2026-11-05T17:45:00Z'), want);
  assert.equal(parseDate('2026-11-05 17:45:00+00'), want);
  assert.equal(parseDate('Thu 2026-11-05 9:15 PM (UTC+03:30)'), want);
  assert.ok(Number.isNaN(parseDate('')));
});

test('soccer league codes come from the soccer tag', () => {
  assert.deepEqual([...leagues].sort(), ['epl', 'uel']);
});

test('football filtering', () => {
  assert.ok(isFootballSlug('uel-spp-bou-2026-11-05', leagues));
  assert.ok(isFootballSlug('epl-ars-che-2026-11-08-more-markets', leagues));
  assert.ok(!isFootballSlug('nba-cle-atl-2026-04-10', leagues));
  assert.ok(!isFootballSlug('atp-fils-fritz-2026-11-05', leagues));
  assert.ok(!isFootballSlug('epl-top-scorer', leagues), 'futures need a known slug');
  assert.ok(isFootballSlug('epl-top-scorer', leagues, new Set(['epl-top-scorer'])));
  assert.ok(isFootballTrade({ event_slug: 'uel-spp-bou-2026-11-05', slug: 'uel-spp-bou-2026-11-05-bou' }, leagues));
  assert.ok(!isFootballTrade({ event_slug: 'atp-x-y-2026-11-05', slug: 'atp-x-y-2026-11-05' }, leagues));
});

const event = {
  id: '1', slug: 'uel-spp-bou-2026-11-05', title: 'Sparta vs. Bournemouth', gameId: 9, volume24hr: 1000,
  tags: [{ slug: 'games' }, { slug: 'soccer' }], sport: { name: 'UEFA Europa League' },
  teams: [{ name: 'Sparta', ordering: 'home' }, { name: 'Bournemouth', ordering: 'away' }],
  markets: [
    { conditionId: '0xA', groupItemTitle: 'Bournemouth', sportsMarketType: 'moneyline', outcomes: '["Yes","No"]', outcomePrices: '["0.4","0.6"]', gameStartTime: '2026-11-05 17:45:00+00' },
    { conditionId: '0xH', groupItemTitle: 'Sparta', sportsMarketType: 'moneyline', outcomes: '["Yes","No"]', outcomePrices: '["0.3","0.7"]', gameStartTime: '2026-11-05 17:45:00+00' },
    { conditionId: '0xD', groupItemTitle: 'Draw (Sparta vs. Bournemouth)', sportsMarketType: 'moneyline', outcomes: '["Yes","No"]', outcomePrices: '["0.3","0.7"]', gameStartTime: '2026-11-05 17:45:00+00' },
  ],
};

test('matchOutcomes orders home / draw / away', () => {
  const o = matchOutcomes(event);
  assert.deepEqual(o.map((x) => x.label), ['Sparta', 'Draw', 'Bournemouth']);
  assert.deepEqual(o.map((x) => x.price), [0.3, 0.3, 0.4]);
});

test('groupMatches merges sibling events and filters by kickoff window', () => {
  const more = { ...event, id: '2', slug: 'uel-spp-bou-2026-11-05-more-markets', volume24hr: 500, markets: [{ sportsMarketType: 'totals', gameStartTime: '2026-11-05 17:45:00+00' }] };
  const old = { ...event, id: '3', gameId: 10, slug: 'uel-a-b-2026-10-01', markets: [{ ...event.markets[0], gameStartTime: '2026-10-01 17:00:00+00' }] };
  const now = Date.UTC(2026, 10, 5, 12);
  const m = groupMatches([more, event, old], now);
  assert.equal(m.length, 1);
  assert.equal(m[0].vol24, 1500);
  assert.equal(m[0].slug, 'uel-spp-bou-2026-11-05');
  assert.deepEqual(m[0].eventIds.sort(), ['1', '2']);
});

test('sideShare splits buy volume and counts unique wallets', () => {
  const outcomes = matchOutcomes(event);
  const trades = [
    { side: 'BUY', condition_id: '0xH', outcome_index: 0, size: 100, price: 0.3, proxy_wallet: 'a', timestamp: 100 },
    { side: 'BUY', condition_id: '0xH', outcome_index: 0, size: 100, price: 0.3, proxy_wallet: 'a', timestamp: 100 },
    { side: 'BUY', condition_id: '0xA', outcome_index: 0, size: 150, price: 0.4, proxy_wallet: 'b', timestamp: 100 },
    { side: 'SELL', condition_id: '0xA', outcome_index: 0, size: 999, price: 0.4, proxy_wallet: 'c', timestamp: 100 },
    { side: 'BUY', condition_id: '0xA', outcome_index: 1, size: 999, price: 0.6, proxy_wallet: 'c', timestamp: 100 },
    { side: 'BUY', condition_id: '0xD', outcome_index: 0, size: 999, price: 0.3, proxy_wallet: 'd', timestamp: 10 },
  ];
  const s = sideShare(trades, outcomes, 50);
  assert.equal(s.total, 120);
  assert.equal(s.rows[0].share, 0.5);
  assert.equal(s.rows[0].wallets, 1);
  assert.equal(s.rows[1].share, 0);
  assert.equal(s.rows[2].usd, 60);
  assert.equal(sideShare([], outcomes).rows[0].share, null);
});

test('walletScore uses resolved football positions only', () => {
  const now = Date.UTC(2026, 10, 5);
  const pos = [
    { token_id: '1', event_slug: 'uel-a-b-2026-10-01', current_price: 1, total_pnl: 50, end_date: '2026-10-01' },
    { token_id: '1', event_slug: 'uel-a-b-2026-10-01', current_price: 1, total_pnl: 50, end_date: '2026-10-01' }, // dup
    { token_id: '2', event_slug: 'epl-c-d-2026-10-02', current_price: 0, total_pnl: -20, end_date: '2026-10-02' },
    { token_id: '3', event_slug: 'nba-x-y-2026-10-02', current_price: 1, total_pnl: 500, end_date: '2026-10-02' }, // not football
    { token_id: '4', event_slug: 'epl-e-f-2026-11-20', current_price: 0.55, total_pnl: 5, end_date: '2026-11-20' }, // unresolved
  ];
  const s = walletScore(pos, leagues, null, now);
  assert.deepEqual(s, { resolved: 2, wins: 1, winRate: 0.5, pnl: 30 });
  assert.equal(walletScore([], leagues).winRate, null);
});

test('isStrong threshold', () => {
  assert.ok(isStrong({ resolved: 20, winRate: 0.6 }));
  assert.ok(!isStrong({ resolved: 19, winRate: 0.9 }));
  assert.ok(!isStrong({ resolved: 50, winRate: 0.59 }));
  assert.ok(!isStrong(null));
});

test('formatting', () => {
  assert.equal(fmtUsd(1234), '$1.2k');
  assert.equal(fmtUsd(2_500_000), '$2.50M');
  assert.equal(fmtUsd(-40), '-$40');
  assert.equal(fmtUsd(NaN), '—');
  assert.equal(timeAgo(100, 130_000), '30s ago');
});

test('sideShare skips near-settled buys at 97c+ or 3c-', () => {
  const outcomes = [{ label: 'A', conditionId: '0xa', outcomeIndex: 0 }, { label: 'Draw', conditionId: '0xb', outcomeIndex: 0 }];
  const trades = [
    { side: 'BUY', condition_id: '0xa', outcome_index: 0, price: 0.5, size: 100, proxy_wallet: 'w1', timestamp: 100 },
    { side: 'BUY', condition_id: '0xb', outcome_index: 0, price: 0.99, size: 5000, proxy_wallet: 'w2', timestamp: 100 },
    { side: 'BUY', condition_id: '0xb', outcome_index: 0, price: 0.02, size: 5000, proxy_wallet: 'w3', timestamp: 100 },
  ];
  const s = sideShare(trades, outcomes, 0);
  assert.equal(s.rows[0].share, 1);
  assert.equal(s.rows[1].usd, 0);
  assert.equal(s.rows[1].wallets, 0);
});

test('castText includes the fill and only names sharp records', () => {
  const t = { side: 'BUY', outcome: 'Arsenal', price: 0.63, size: 20000, title: 'Arsenal vs Chelsea', event_slug: 'epl-ars-che-2026-11-09' };
  const plain = castText(t, { resolved: 5, winRate: 0.8 });
  assert.match(plain, /^🐋 \$13k BUY Arsenal @ 63¢\nArsenal vs Chelsea\nvia Kickoff Radar$/);
  const sharp = castText(t, { resolved: 31, winRate: 0.68, truncated: true });
  assert.match(sharp, /Sharp wallet: 31\+ football bets, 68% won/);
  assert.equal(castText({ ...t, side: 'SELL' }, undefined).split('\n')[0], '🐋 $13k SELL Arsenal @ 63¢');
});

test('composeUrl encodes text and caps embeds at two', () => {
  const u = new URL(composeUrl('a & b\nc', ['https://x.io/1', 'https://x.io/1', 'https://x.io/2', 'https://x.io/3']));
  assert.equal(u.origin + u.pathname, 'https://farcaster.xyz/~/compose');
  assert.equal(u.searchParams.get('text'), 'a & b\nc');
  assert.deepEqual(u.searchParams.getAll('embeds[]'), ['https://x.io/1', 'https://x.io/2']);
  assert.equal(eventUrl({ slug: '' }), RADAR_URL);
  assert.equal(eventUrl({ event_slug: 'epl-a-b' }), 'https://polymarket.com/event/epl-a-b');
});
