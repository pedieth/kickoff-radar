// Live check against the public APIs: node scripts/smoke.mjs
import { fetchSports, fetchSoccerEvents, fetchEventTrades, fetchBigTrades, fetchWalletPositions } from '../docs/js/api.js';
import { soccerLeagueCodes, groupMatches, sideShare, isFootballTrade, tradeUsd, walletScore, fmtUsd, fmtPct, timeAgo } from '../docs/js/lib.js';

const now = Date.now();
const leagues = soccerLeagueCodes(await fetchSports());
const events = await fetchSoccerEvents();
const known = new Set(events.map((e) => e.slug));
const matches = groupMatches(events, now);
console.log(`${leagues.size} soccer leagues, ${events.length} open soccer events, ${matches.length} matches in window\n`);

for (const m of matches.slice(0, 3)) {
  const { trades, complete } = await fetchEventTrades(m.id, { sinceSec: now / 1000 - 86400 });
  const s = sideShare(trades, m.outcomes, now / 1000 - 86400);
  console.log(`${m.title} | ${m.league} | ${new Date(m.kickoff).toISOString()} | 24h vol ${fmtUsd(m.vol24)}${m.live ? ` | LIVE ${m.score}` : ''}`);
  for (const [i, o] of m.outcomes.entries()) {
    const r = s.rows[i];
    console.log(`   ${o.label.padEnd(28)} ${fmtPct(o.price).padStart(4)}  backed ${fmtPct(r.share).padStart(4)} of ${fmtUsd(s.total)} buys, ${r.wallets} wallets`);
  }
  console.log(`   (${trades.length} trades${complete ? '' : ', not the full 24h'})`);
}

const big = (await fetchBigTrades(1000)).filter((t) => isFootballTrade(t, leagues, known));
console.log(`\n${big.length} football trades >= $1000 in latest global page`);
for (const t of big.slice(0, 3)) {
  const { positions, truncated } = await fetchWalletPositions(t.proxy_wallet);
  const sc = walletScore(positions, leagues, known);
  console.log(`${fmtUsd(tradeUsd(t))} ${t.side} ${t.outcome} @ ${t.price} | ${t.title} | ${timeAgo(t.timestamp)} | ${t.proxy_wallet}`);
  console.log(`   football: ${sc.resolved} resolved, win ${fmtPct(sc.winRate)}, pnl ${fmtUsd(sc.pnl)}${truncated ? ' (recent positions only)' : ''}`);
}
