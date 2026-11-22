// ESPN's public, keyless soccer endpoints (CORS open). Every call has a deadline.

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/all';

function fetchT(url, ms = 9000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return fetch(url, { signal: ac.signal }).finally(() => clearTimeout(t));
}

async function getJson(url, ms) {
  const res = await fetchT(url, ms);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/** All soccer events ESPN lists for the given Eastern dates (YYYYMMDD), de-duplicated. */
export async function fetchScoreboard(dates) {
  const pages = await Promise.allSettled(dates.map((d) => getJson(`${SITE}/scoreboard?dates=${d}&limit=400`)));
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
  const d = await getJson(`${SITE}/summary?event=${encodeURIComponent(eventId)}`, 10000);
  sumCache.set(eventId, { t: Date.now(), d });
  return d;
}
