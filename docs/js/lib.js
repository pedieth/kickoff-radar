// Pure helpers. No DOM, no fetch — so they can be tested with node --test.

const MONTHLESS = /^(?:[A-Za-z]{3}\s+)?(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\s*(?:\(UTC([+-])(\d{2}):(\d{2})\))?$/i;

/** Parse the date shapes Gamma returns (ISO, "2026-11-05 17:45:00+00", ...). Returns ms or NaN. */
export function parseDate(s) {
  if (s == null || s === '') return NaN;
  if (typeof s === 'number') return s < 1e12 ? s * 1000 : s;
  const str = String(s).trim();
  // "2026-11-05 17:45:00+00" -> ISO
  const short = str.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?([+-]\d{2})(?::?(\d{2}))?$/);
  if (short) return Date.parse(`${short[1]}T${short[2]}${short[3]}:${short[4] || '00'}`);
  const iso = Date.parse(str);
  if (!Number.isNaN(iso) && /\d{4}-\d{2}-\d{2}T/.test(str)) return iso;
  const m = str.match(MONTHLESS);
  if (m) {
    let h = Number(m[4]);
    if (m[7]) { const pm = m[7].toUpperCase() === 'PM'; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], h, +m[5], +(m[6] || 0));
    if (m[8]) { const off = (+m[9] * 60 + +m[10]) * 60000; return m[8] === '+' ? utc - off : utc + off; }
    return utc;
  }
  return iso;
}

/** League codes ("epl", "uel", ...) from Gamma /sports whose tags include the soccer tag. */
export const SOCCER_TAG_ID = '100350';
export function soccerLeagueCodes(sports) {
  const set = new Set();
  for (const s of sports || []) {
    const tags = String(s.tags || '').split(',').map((t) => t.trim());
    if (tags.includes(SOCCER_TAG_ID) && s.sport) set.add(String(s.sport).toLowerCase());
  }
  return set;
}

/** Football if the slug's league prefix is a soccer league, or the event slug is a known soccer event. */
export function isFootballSlug(slug, leagues, knownSlugs) {
  if (!slug) return false;
  const s = String(slug).toLowerCase();
  if (knownSlugs && knownSlugs.has(s)) return true;
  const prefix = s.split('-')[0];
  // game slugs look like "uel-spp-bou-2026-11-05"; require a date so "epl-top-scorer" style futures need knownSlugs
  return leagues.has(prefix) && /-\d{4}-\d{2}-\d{2}/.test(s);
}

export function isFootballTrade(t, leagues, knownSlugs) {
  return isFootballSlug(t.event_slug, leagues, knownSlugs) || isFootballSlug(t.slug, leagues, knownSlugs);
}

export const tradeUsd = (t) => (Number(t.size) || 0) * (Number(t.price) || 0);

const parseJsonArr = (v) => {
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v || '[]'); } catch { return []; }
};

/**
 * Outcomes to show for a match event.
 * 3-way (home/draw/away as three Yes/No markets): one row per market, its "Yes" side.
 * Otherwise: the outcomes of the first market.
 * Returns [{label, conditionId, outcomeIndex, price}]
 */
export function matchOutcomes(event) {
  const markets = (event.markets || []).filter((m) => !m.closed || m.closed === false);
  const ml = markets.filter((m) => m.sportsMarketType === 'moneyline');
  if (ml.length >= 2) {
    const teams = event.teams || [];
    const home = teams.find((t) => t.ordering === 'home')?.name;
    const away = teams.find((t) => t.ordering === 'away')?.name;
    const rank = (m) => {
      const g = m.groupItemTitle || '';
      if (/^draw/i.test(g)) return 1;
      if (home && g === home) return 0;
      if (away && g === away) return 2;
      return 3;
    };
    return ml.slice().sort((a, b) => rank(a) - rank(b)).map((m) => ({
      label: /^draw/i.test(m.groupItemTitle || '') ? 'Draw' : (m.groupItemTitle || m.question),
      conditionId: m.conditionId,
      outcomeIndex: 0,
      price: Number(parseJsonArr(m.outcomePrices)[0]),
    }));
  }
  const m = ml[0] || markets[0];
  if (!m) return [];
  const names = parseJsonArr(m.outcomes);
  const prices = parseJsonArr(m.outcomePrices);
  return names.map((n, i) => ({ label: n, conditionId: m.conditionId, outcomeIndex: i, price: Number(prices[i]) }));
}

const SUFFIX = /-(more-markets|exact-score|halftime-result|player-props|total-corners|.*-props)$/;

/**
 * Group Gamma soccer events into matches (main event + "more markets" siblings share a gameId).
 * Keeps matches kicking off between now-windowBack and now+windowAhead, ranked by summed 24h volume.
 */
export function groupMatches(events, nowMs, { backH = 4, aheadH = 24 } = {}) {
  const groups = new Map();
  for (const e of events || []) {
    const tags = (e.tags || []).map((t) => t.slug);
    const isGame = tags.includes('games') || e.gameId != null;
    if (!isGame) continue;
    const key = e.gameId != null ? `g${e.gameId}` : String(e.slug).replace(SUFFIX, '');
    const g = groups.get(key) || { key, events: [], vol24: 0, main: null };
    g.events.push(e);
    g.vol24 += Number(e.volume24hr) || 0;
    const hasMl = (e.markets || []).some((m) => m.sportsMarketType === 'moneyline');
    if (hasMl && (!g.main || !SUFFIX.test(e.slug))) g.main = e;
    groups.set(key, g);
  }
  const out = [];
  for (const g of groups.values()) {
    const main = g.main || g.events.find((e) => !SUFFIX.test(e.slug)) || g.events[0];
    const mkt = (main.markets || [])[0] || {};
    const kickoff = parseDate(mkt.gameStartTime) || parseDate(main.startTime) || parseDate(main.endDate);
    if (Number.isNaN(kickoff)) continue;
    if (kickoff < nowMs - backH * 3600e3 || kickoff > nowMs + aheadH * 3600e3) continue;
    out.push({
      key: g.key,
      id: main.id,
      eventIds: g.events.map((e) => e.id),
      slug: main.slug,
      title: (main.title || '').trim(),
      league: main.sport?.name || main.seriesSlug || String(main.slug).split('-')[0].toUpperCase(),
      kickoff,
      vol24: g.vol24,
      live: !!main.live && !main.ended,
      ended: !!main.ended,
      score: main.score || '',
      period: main.period || '',
      outcomes: matchOutcomes(main),
    });
  }
  return out.sort((a, b) => b.vol24 - a.vol24);
}

/**
 * Share of BUY volume (USD) and unique buying wallets per outcome, for trades at/after sinceSec.
 * outcomes: [{label, conditionId, outcomeIndex}]. Trades on other markets/sides are ignored.
 * Buys at <=3c or >=97c are skipped: those are near-settled lock-ins, not someone backing a side.
 */
export const SETTLED_LO = 0.03;
export const SETTLED_HI = 0.97;

export function sideShare(trades, outcomes, sinceSec = 0) {
  const rows = outcomes.map((o) => ({ label: o.label, usd: 0, wallets: new Set(), trades: 0 }));
  const idx = new Map(outcomes.map((o, i) => [`${String(o.conditionId).toLowerCase()}:${o.outcomeIndex}`, i]));
  for (const t of trades || []) {
    if (t.side !== 'BUY' || Number(t.timestamp) < sinceSec) continue;
    const px = Number(t.price);
    if (!(px > SETTLED_LO && px < SETTLED_HI)) continue;
    const i = idx.get(`${String(t.condition_id).toLowerCase()}:${Number(t.outcome_index)}`);
    if (i == null) continue;
    rows[i].usd += tradeUsd(t);
    rows[i].wallets.add(t.proxy_wallet);
    rows[i].trades += 1;
  }
  const total = rows.reduce((s, r) => s + r.usd, 0);
  return {
    total,
    rows: rows.map((r) => ({ label: r.label, usd: r.usd, share: total > 0 ? r.usd / total : null, wallets: r.wallets.size, trades: r.trades })),
  };
}

/** A position counts as resolved when its market price has settled at 0 or 1 and its end date has passed. */
export function isResolvedPosition(p, nowMs) {
  const px = Number(p.current_price);
  if (!Number.isFinite(px)) return false;
  if (!(px <= 0.0005 || px >= 0.9995)) return false;
  const end = parseDate(p.end_date ? `${p.end_date}T23:59:59Z` : '');
  return Number.isNaN(end) ? true : end - 86400e3 <= nowMs;
}

/**
 * Football record from a wallet's positions (CLOSED + REDEEMABLE rows of /v2/positions).
 * Bet = one outcome token. Win = positive total PnL on it.
 * Returns {resolved, wins, winRate, pnl} with winRate null when there is nothing to judge.
 */
export function walletScore(positions, leagues, knownSlugs, nowMs = Date.now()) {
  const seen = new Set();
  let resolved = 0, wins = 0, pnl = 0;
  for (const p of positions || []) {
    if (!p || seen.has(p.token_id)) continue;
    seen.add(p.token_id);
    if (!isFootballSlug(p.event_slug, leagues, knownSlugs) && !isFootballSlug(p.slug, leagues, knownSlugs)) continue;
    if (!isResolvedPosition(p, nowMs)) continue;
    const t = Number(p.total_pnl ?? p.realized_pnl);
    if (!Number.isFinite(t)) continue;
    resolved += 1;
    if (t > 0) wins += 1;
    pnl += t;
  }
  return { resolved, wins, winRate: resolved ? wins / resolved : null, pnl };
}

export const STRONG = { minResolved: 20, minWinRate: 0.6 };
export function isStrong(score) {
  return !!score && score.resolved >= STRONG.minResolved && score.winRate != null && score.winRate >= STRONG.minWinRate;
}

export function fmtUsd(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return `${s}$${a.toFixed(0)}`;
}

export function fmtPct(x) {
  return x == null || !Number.isFinite(x) ? '—' : `${Math.round(x * 100)}%`;
}

export function timeAgo(sec, nowMs = Date.now()) {
  const d = Math.max(0, Math.round(nowMs / 1000 - Number(sec)));
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export const tradeKey = (t) => `${t.transaction_hash}:${t.token_id}:${t.proxy_wallet}:${t.size}`;

/* ---------- share a fill on Farcaster ---------- */

export const RADAR_URL = 'https://kickoff-radar.pedieth.workers.dev/';

/** Polymarket event page for a trade, or the radar itself if the slug is missing. */
export function eventUrl(t) {
  const slug = t.event_slug || t.slug;
  return slug ? `https://polymarket.com/event/${encodeURIComponent(slug)}` : RADAR_URL;
}

/** One-or-two line cast body for a fill, with the wallet's record when it's a sharp one. */
export function castText(t, sc) {
  const side = t.side === 'SELL' ? 'SELL' : 'BUY';
  const price = Math.round(Number(t.price) * 100);
  const lines = [`🐋 ${fmtUsd(tradeUsd(t))} ${side} ${t.outcome} @ ${price}¢`];
  if (t.title) lines.push(t.title);
  if (isStrong(sc)) lines.push(`Sharp wallet: ${sc.resolved}${sc.truncated ? '+' : ''} football bets, ${fmtPct(sc.winRate)} won`);
  lines.push('via Kickoff Radar');
  return lines.join('\n');
}

/** Farcaster web compose intent with up to two embeds. */
export function composeUrl(text, embeds = []) {
  const p = new URLSearchParams({ text });
  const e = [...new Set(embeds.filter(Boolean))].slice(0, 2)
    .map((u) => `embeds[]=${encodeURIComponent(u)}`).join('&');
  return `https://farcaster.xyz/~/compose?${p.toString()}${e ? `&${e}` : ''}`;
}
