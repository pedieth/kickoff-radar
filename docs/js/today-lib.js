// Pure helpers for the Today tab. No DOM, no fetch, so node --test can cover them.

/* ---------- competitions ---------- */

// ESPN league ids (the "l:" part of an event uid). Order = how the Today list is grouped.
export const LEAGUES = [
  [775, 'Champions League', 'UCL'],
  [700, 'Premier League', 'ENG'],
  [740, 'LaLiga', 'ESP'],
  [730, 'Serie A', 'ITA'],
  [720, 'Bundesliga', 'GER'],
  [710, 'Ligue 1', 'FRA'],
  [776, 'Europa League', 'UEL'],
  [20296, 'Conference League', 'UECL'],
  [3902, 'AFC Champions League Elite', 'ACL'],
  [725, 'Eredivisie', 'NED'],
  [715, 'Primeira Liga', 'POR'],
  [3946, 'Süper Lig', 'TUR'],
  [21231, 'Saudi Pro League', 'KSA'],
  [770, 'MLS', 'USA'],
  [630, 'Brasileirão', 'BRA'],
  [745, 'Liga Profesional', 'ARG'],
  [760, 'Liga MX', 'MEX'],
  [783, 'Copa Libertadores', 'LIB'],
  [5454, 'Copa Sudamericana', 'SUD'],
  [735, 'Scottish Premiership', 'SCO'],
  [3901, 'Belgian Pro League', 'BEL'],
  [3914, 'Championship', 'ENG2'],
  [3920, 'Carabao Cup', 'EFL'],
  [3952, 'Coupe de France', 'CDF'],
  [3956, 'Coppa Italia', 'CIT'],
  [20922, 'Taça de Portugal', 'TAÇA'],
  [2466, 'AFC Champions League Two', 'ACL2'],
  [3927, '2. Bundesliga', 'GER2'],
  [3926, 'Ligue 2', 'FRA2'],
  [3921, 'LaLiga 2', 'ESP2'],
  [3939, 'Russian Premier League', 'RUS'],
  [3907, 'Austrian Bundesliga', 'AUT'],
  [3955, 'Greek Super League', 'GRE'],
  [3913, 'Danish Superliga', 'DEN'],
  [3945, 'Allsvenskan', 'SWE'],
  [750, 'J1 League', 'JPN'],
  [3906, 'A-League', 'AUS'],
  [650, 'Primera A', 'COL'],
].map(([id, name, short], i) => ({ id, name, short, order: i }));

const BY_ID = new Map(LEAGUES.map((l) => [l.id, l]));
// the first block of LEAGUES is what "Top" shows by default
export const TOP_COUNT = 21;

export const leagueIdFromUid = (uid) => Number((String(uid || '').match(/~l:(\d+)/) || [])[1]) || 0;

/** "2026-27-english-premier-league" -> "English Premier League". Generic stage slugs return ''. */
export function prettySlug(slug) {
  const s = String(slug || '').replace(/^\d{4}(-\d{2})?-/, '');
  if (!s || /^(regular-season|group-stage|league-phase|league-stage|playoffs?|final|.*round.*|.*phase.*|apertura|clausura.*|torneo.*)$/.test(s)) return '';
  return s.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

export function leagueOf(uid, seasonSlug) {
  const id = leagueIdFromUid(uid);
  const l = BY_ID.get(id);
  if (l) return { ...l, top: l.order < TOP_COUNT };
  return { id, name: prettySlug(seasonSlug) || 'Other competitions', short: '', order: 999, top: false };
}

/* ---------- days ---------- */

/** Local midnight for `offsetDays` from now (0 = today). */
export function localDayStart(nowMs, offsetDays = 0) {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.getTime();
}

/** ESPN buckets games by US Eastern date: the YYYYMMDD keys that cover [startMs, endMs). */
export function espnDates(startMs, endMs) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  const out = new Set();
  for (let t = startMs; t < endMs; t += 3 * 3600e3) out.add(fmt.format(t).replaceAll('-', ''));
  out.add(fmt.format(endMs - 1).replaceAll('-', ''));
  return [...out];
}

/* ---------- ESPN scoreboard ---------- */

function side(c) {
  const t = c.team || {};
  return {
    id: String(t.id || ''),
    name: t.displayName || t.name || '',
    short: t.shortDisplayName || t.abbreviation || t.displayName || '',
    abbr: t.abbreviation || '',
    logo: t.logo || '',
    form: String(c.form || '').slice(-5),
    record: (c.records || [])[0]?.summary || '',
    score: c.score != null && c.score !== '' ? String(c.score) : '',
    winner: !!c.winner,
  };
}

/** One ESPN scoreboard event -> the match shape the Today tab renders. */
export function parseEspnEvent(e) {
  const comp = (e.competitions || [])[0] || {};
  const cs = comp.competitors || [];
  const home = cs.find((c) => c.homeAway === 'home') || cs[0] || {};
  const away = cs.find((c) => c.homeAway === 'away') || cs[1] || {};
  const st = (e.status || comp.status || {});
  const type = st.type || {};
  const h = side(home), a = side(away);
  const goals = (comp.details || []).filter((d) => d.scoringPlay).map((d) => ({
    teamId: String(d.team?.id || ''),
    minute: d.clock?.displayValue || '',
    who: d.athletesInvolved?.[0]?.shortName || d.athletesInvolved?.[0]?.displayName || '',
    pen: !!d.penaltyKick, og: !!d.ownGoal,
  }));
  const reds = (comp.details || []).filter((d) => d.redCard).map((d) => String(d.team?.id || ''));
  return {
    id: String(e.id),
    league: leagueOf(e.uid, e.season?.slug),
    kickoff: Date.parse(e.date),
    state: type.state || 'pre', // pre | in | post
    completed: !!type.completed,
    clock: st.displayClock || '',
    detail: type.shortDetail || type.detail || '',
    statusName: type.name || '',
    home: h,
    away: a,
    goals,
    reds,
    venue: comp.venue?.fullName || e.venue?.displayName || '',
    link: (e.links || []).find((l) => (l.rel || []).includes('summary'))?.href || '',
  };
}

export const isPostponed = (m) => /POSTPONED|CANCELED|CANCELLED|ABANDONED/.test(m.statusName);

/** Sort: live first, then by kickoff; finished games drop to the bottom. */
export function sortMatches(list) {
  const rank = (m) => (m.state === 'in' ? 0 : m.state === 'pre' ? 1 : 2);
  return list.slice().sort((x, y) => rank(x) - rank(y) || x.kickoff - y.kickoff || x.league.order - y.league.order);
}

/** Group into competitions in LEAGUES order, keeping each group's matches sorted. */
export function groupByLeague(list) {
  const g = new Map();
  for (const m of list) {
    const k = m.league.id ? `l${m.league.id}` : `n${m.league.name}`;
    if (!g.has(k)) g.set(k, { league: m.league, matches: [] });
    g.get(k).matches.push(m);
  }
  const out = [...g.values()];
  for (const x of out) x.matches = sortMatches(x.matches);
  const live = (x) => (x.matches.some((m) => m.state === 'in') ? 0 : 1);
  return out.sort((a, b) => live(a) - live(b) || a.league.order - b.league.order || a.league.name.localeCompare(b.league.name));
}

/* ---------- team names: ESPN <-> Polymarket ---------- */

const STOP = new Set(['fc', 'cf', 'afc', 'sc', 'ac', 'as', 'cd', 'ud', 'sd', 'rc', 'ca', 'cp', 'sk', 'fk', 'bk', 'if', 'sv', 'vfb', 'vfl', 'tsg', 'ssc', 'us', 'ss', 'club', 'de', 'del', 'la', 'le', 'the', 'calcio', 'futbol', 'football', 'and', 'clube', 'do', 'da', 'sco', 'ogc', 'osc', 'aj', 'rcd', 'real']);

export function teamTokens(name) {
  const s = String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bman utd\b/g, 'manchester united')
    .replace(/\butd\b/g, 'united')
    .replace(/\bst\b\.?/g, 'saint')
    .replace(/[^a-z0-9 ]+/g, ' ');
  const toks = s.split(/\s+/).filter((w) => w && !/^\d+$/.test(w));
  const keep = toks.filter((w) => !STOP.has(w));
  return keep.length ? keep : toks;
}

/** 0 = no overlap; higher = more tokens agree (a 5-letter prefix counts, so Hamburg ~ Hamburger). */
export function teamSim(a, b) {
  const A = teamTokens(a), B = teamTokens(b);
  let n = 0;
  for (const x of A) {
    if (B.some((y) => x === y || (x.length >= 5 && y.length >= 5 && x.slice(0, 5) === y.slice(0, 5)) || (x.length >= 4 && y.startsWith(x)) || (y.length >= 4 && x.startsWith(y)))) n++;
  }
  return n;
}

/** "Liverpool FC vs. Manchester United FC - More Markets" -> ["Liverpool FC", "Manchester United FC"] */
export function splitTitle(title) {
  const t = String(title || '').replace(/\s+-\s+.*$/, '');
  const p = t.split(/\s+vs\.?\s+/i);
  return p.length === 2 ? p.map((x) => x.trim()) : null;
}

/**
 * Pair each ESPN match with a Polymarket match (from lib.groupMatches): both teams must agree
 * and kickoffs must be within 3h. Returns Map(espnId -> pm match).
 */
export function pairMarkets(espn, pm, { maxGapMs = 3 * 3600e3 } = {}) {
  const out = new Map();
  const used = new Set();
  const cands = [];
  for (const m of espn) {
    for (const p of pm) {
      if (!Number.isFinite(p.kickoff) || Math.abs(p.kickoff - m.kickoff) > maxGapMs) continue;
      const names = splitTitle(p.title);
      if (!names) continue;
      const straight = Math.min(teamSim(m.home.name, names[0]), teamSim(m.away.name, names[1]));
      const swapped = Math.min(teamSim(m.home.name, names[1]), teamSim(m.away.name, names[0]));
      const s = Math.max(straight, swapped);
      if (s > 0) cands.push({ m, p, s: s * 10 - Math.abs(p.kickoff - m.kickoff) / 3600e3 });
    }
  }
  cands.sort((a, b) => b.s - a.s);
  for (const c of cands) {
    if (out.has(c.m.id) || used.has(c.p.key)) continue;
    out.set(c.m.id, c.p);
    used.add(c.p.key);
  }
  return out;
}

/**
 * Polymarket's moneyline outcomes in ESPN's home / draw / away order.
 * Returns {home, draw, away} each {price, label, conditionId, outcomeIndex} or null.
 */
export function orientOutcomes(outcomes, homeName, awayName) {
  const res = { home: null, draw: null, away: null };
  const teams = [];
  for (const o of outcomes || []) {
    if (/^draw/i.test(o.label)) res.draw = o; else teams.push(o);
  }
  if (teams.length === 2) {
    const straight = teamSim(homeName, teams[0].label) + teamSim(awayName, teams[1].label);
    const swapped = teamSim(homeName, teams[1].label) + teamSim(awayName, teams[0].label);
    [res.home, res.away] = swapped > straight ? [teams[1], teams[0]] : [teams[0], teams[1]];
  }
  return res;
}

/** Implied chances that add up to 100 (Polymarket prices carry a little overround). */
export function impliedShares(o) {
  const ps = [o.home, o.draw, o.away].map((x) => (x && Number.isFinite(x.price) ? x.price : null));
  const sum = ps.reduce((s, p) => s + (p || 0), 0);
  if (!(sum > 0)) return null;
  const raw = ps.map((p) => (p == null ? null : (p / sum) * 100));
  const r = raw.map((x) => (x == null ? null : Math.round(x)));
  const tot = r.reduce((s, x) => s + (x || 0), 0);
  if (tot !== 100) { // nudge the largest so the bar reads 100
    let iMax = 0;
    r.forEach((x, i) => { if ((x || 0) > (r[iMax] || 0)) iMax = i; });
    r[iMax] += 100 - tot;
  }
  return { home: r[0], draw: r[1], away: r[2] };
}

/* ---------- ESPN match summary ---------- */

const statOf = (entry, name) => (entry.stats || []).find((s) => s.name === name)?.displayValue ?? '';

/** Pull form, head-to-head, table rows, leaders and lineups out of /summary. */
export function parseSummary(d, homeId, awayId) {
  const ids = [String(homeId), String(awayId)];
  const out = { form: {}, h2h: [], h2hSummary: '', table: null, leaders: {}, lineups: {} };

  for (const blk of d?.lastFiveGames || []) {
    const tid = String(blk.team?.id || '');
    if (!ids.includes(tid)) continue;
    out.form[tid] = (blk.events || []).slice(0, 5).map((g) => ({
      date: Date.parse(g.gameDate),
      result: g.gameResult || '',
      opp: g.opponent?.displayName || '',
      oppAbbr: g.opponent?.abbreviation || '',
      oppLogo: g.opponent?.logo || '',
      home: String(g.homeTeamId) === tid,
      score: g.score || '',
      comp: g.competitionName || '',
    }));
  }

  const ss = (d?.seasonseries || []).find((s) => s.type === 'head-to-head') || (d?.seasonseries || [])[0];
  if (ss) {
    out.h2hSummary = ss.summary || '';
    out.h2h = (ss.events || []).filter((e) => e.statusType?.completed !== false).slice(0, 5).map((e) => {
      const c = e.competitors || [];
      const h = c.find((x) => x.homeAway === 'home') || c[0] || {};
      const a = c.find((x) => x.homeAway === 'away') || c[1] || {};
      return {
        date: Date.parse(e.date),
        home: h.team?.abbreviation || h.team?.displayName || '',
        homeId: String(h.team?.id || ''),
        away: a.team?.abbreviation || a.team?.displayName || '',
        awayId: String(a.team?.id || ''),
        hs: h.score ?? '', as: a.score ?? '',
        winnerId: h.winner ? String(h.team?.id) : a.winner ? String(a.team?.id) : '',
      };
    });
  }

  for (const g of d?.standings?.groups || []) {
    const entries = g.standings?.entries || [];
    const rows = entries.filter((e) => ids.includes(String(e.id)));
    if (!rows.length) continue;
    out.table = {
      title: g.header || d.standings?.header || '',
      size: entries.length,
      rows: rows.map((e) => ({
        id: String(e.id), team: e.team,
        rank: statOf(e, 'rank'), gp: statOf(e, 'gamesPlayed'),
        w: statOf(e, 'wins'), dr: statOf(e, 'ties'), l: statOf(e, 'losses'),
        gd: statOf(e, 'pointDifferential'), pts: statOf(e, 'points'),
      })).sort((x, y) => Number(x.rank) - Number(y.rank)),
    };
    break;
  }

  for (const blk of d?.leaders || []) {
    const tid = String(blk.team?.id || '');
    if (!ids.includes(tid)) continue;
    const pick = (n) => {
      const L = (blk.leaders || []).find((x) => x.name === n)?.leaders?.[0];
      if (!L) return null;
      const num = (String(L.displayValue || '').match(/(\d+)\s*$/) || [])[1] || L.displayValue || '';
      return { name: L.athlete?.displayName || '', value: num };
    };
    out.leaders[tid] = { goals: pick('goalsLeaders'), assists: pick('assistsLeaders') };
  }

  for (const r of d?.rosters || []) {
    const tid = String(r.team?.id || '');
    const xi = (r.roster || []).filter((p) => p.starter);
    if (!ids.includes(tid) || xi.length < 11) continue;
    out.lineups[tid] = { formation: r.formation || '', xi: xi.map((p) => ({ n: p.jersey || '', name: p.athlete?.shortName || p.athlete?.displayName || '' })) };
  }
  return out;
}

/** Form string like "WDLWW" -> counts, for the little summary next to the pills. */
export function formPoints(form) {
  let p = 0;
  for (const c of String(form || '')) p += c === 'W' ? 3 : c === 'D' ? 1 : 0;
  return p;
}
