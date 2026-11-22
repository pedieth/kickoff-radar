// ESPN's public, keyless soccer endpoints. Every call has a deadline.
// 2026-11-22: site.api.espn.com sends no CORS header to real browsers, so the tab never loaded.
// site.web.api.espn.com serves the same JSON with CORS open; the old host is only a fallback.
const HOSTS = ['https://site.web.api.espn.com', 'https://site.api.espn.com'];
const PATH = '/apis/site/v2/sports/soccer/all';
let hostIdx = 0;

function fetchT(url, ms = 9000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return fetch(url, { signal: ac.signal }).finally(() => clearTimeout(t));
}

async function getJson(path, ms) {
  let lastErr;
  for (let i = 0; i < HOSTS.length; i++) {
    const h = (hostIdx + i) % HOSTS.length;
    try {
      const res = await fetchT(HOSTS[h] + PATH + path, ms);
      if (!res.ok) throw new Error(`${res.status}`);
      const d = await res.json();
      hostIdx = h;
      return d;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/** All soccer events ESPN lists for the given Eastern dates (YYYYMMDD), de-duplicated. */
export async function fetchScoreboard(dates) {
  const pages = await Promise.allSettled(dates.map((d) => getJson(`/scoreboard?dates=${d}&limit=400`)));
  if (pages.every((p) => p.status === 'rejected')) throw new Error(pages[0].reason?.message || 'scores unavailable');
  const seen = new Map();
  for (const p of pages) if (p.status === 'fulfilled') for (const e of p.value.events || []) seen.set(String(e.id), e);
  return [...seen.values()];
}

const sumCache = new Map();
/** Match summary (form, head-to-head, table, leaders, lineups). Cached 2 min, 10 min once finished. */
export async function fetchSummary(eventId, finished = false) {
  const c = sumCache.get(eventId);
  if (c && Date.now() - c.t < (finished ? 600e3 : 120e3)) return c.d;
  const d = await getJson(`/summary?event=${encodeURIComponent(eventId)}`, 10000);
  sumCache.set(eventId, { t: Date.now(), d });
  return d;
}
