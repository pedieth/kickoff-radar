// Thin wrappers around Polymarket's public, keyless APIs.

export const GAMMA = 'https://gamma-api.polymarket.com';
export const DATA = 'https://data-api.polymarket.com/v2';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getJson(url, { retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.status === 429 && attempt < retries) {
      const wait = Number(res.headers.get('retry-after')) || 2 ** attempt;
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }
}

const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();

/** Gamma /sports — cached for a day, it barely changes. */
export async function fetchSports(storage) {
  const k = 'kr:sports:v1';
  try {
    const c = storage && JSON.parse(storage.getItem(k) || 'null');
    if (c && Date.now() - c.t < 86400e3) return c.d;
  } catch { /* ignore */ }
  const d = await getJson(`${GAMMA}/sports`);
  const slim = d.map((s) => ({ sport: s.sport, tags: s.tags }));
  try { storage && storage.setItem(k, JSON.stringify({ t: Date.now(), d: slim })); } catch { /* full */ }
  return slim;
}

/** Open soccer events, highest 24h volume first (keyset pagination). */
export async function fetchSoccerEvents({ pages = 4, limit = 100 } = {}) {
  const out = [];
  let cursor = '';
  for (let i = 0; i < pages; i++) {
    const d = await getJson(`${GAMMA}/events/keyset?${qs({ tag_slug: 'soccer', closed: 'false', limit, order: 'volume24hr', ascending: 'false', after_cursor: cursor })}`);
    const ev = d.events || [];
    out.push(...ev);
    cursor = d.next_cursor;
    if (!cursor || ev.length < limit || (Number(ev[ev.length - 1]?.volume24hr) || 0) < 1000) break;
  }
  return out;
}

/** Recent trades on events (taker side), walking back until `sinceSec` or maxPages. */
export async function fetchEventTrades(eventIds, { sinceSec = 0, maxPages = 3, limit = 1000, minUsd } = {}) {
  const base = { event_id: [].concat(eventIds).join(','), limit };
  if (minUsd) Object.assign(base, { filter_type: 'CASH', filter_amount: minUsd });
  const out = [];
  let cursor = '', complete = false;
  for (let i = 0; i < maxPages; i++) {
    const d = await getJson(`${DATA}/trades?${qs({ ...base, cursor })}`);
    const rows = d.data || [];
    out.push(...rows);
    cursor = d.pagination?.next_cursor;
    const oldest = rows.length ? Number(rows[rows.length - 1].timestamp) : 0;
    if (!cursor || !d.pagination?.has_more || oldest < sinceSec) { complete = true; break; }
  }
  return { trades: out, complete };
}

/** Global trade feed with a USD floor. */
export async function fetchBigTrades(minUsd, limit = 500) {
  const d = await getJson(`${DATA}/trades?${qs({ limit, filter_type: 'CASH', filter_amount: minUsd })}`);
  return d.data || [];
}

/** Positions that can carry a result: CLOSED (most recent first) and REDEEMABLE (won or lost, not yet redeemed). */
export async function fetchWalletPositions(user, { closedPages = 2 } = {}) {
  const rows = [];
  let truncated = false;
  let cursor = '';
  for (let i = 0; i < closedPages; i++) {
    const d = await getJson(`${DATA}/positions?${qs({ user, status: 'CLOSED', sort_by: 'TIMESTAMP', limit: 1000, cursor })}`);
    rows.push(...(d.data || []));
    cursor = d.pagination?.next_cursor;
    if (!cursor || !d.pagination?.has_more) { cursor = ''; break; }
    await sleep(250);
  }
  if (cursor) truncated = true;
  const r = await getJson(`${DATA}/positions?${qs({ user, status: 'REDEEMABLE', limit: 1000 })}`);
  rows.push(...(r.data || []));
  if (r.pagination?.has_more) truncated = true;
  return { positions: rows, truncated };
}
