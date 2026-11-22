// Today tab: every big match of the day with form, table, head-to-head, lineups,
// the Polymarket price and the big trades on it. Insight only, never picks.
import { fetchSoccerEvents, fetchEventTrades } from './api.js?v=6';
import { groupMatches, sideShare, fmtUsd, fmtPct, tradeUsd, tradeKey, SETTLED_LO, SETTLED_HI } from './lib.js?v=4';
import { fetchScoreboard, fetchSummary } from './espn.js?v=2';
import {
  parseEspnEvent, isPostponed, groupByLeague, localDayStart, espnDates,
  pairMarkets, orientOutcomes, impliedShares, parseSummary,
} from './today-lib.js?v=1';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hm = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dshort = (ms) => new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: '2-digit' });
const SCORE_MS = 60_000;
const MARKET_MS = 120_000;

let ctx;
const st = {
  day: 0,               // 0 today, 1 tomorrow
  filter: 'top',        // top | all | live
  matches: [],
  pm: new Map(),        // espnId -> polymarket match
  pmEvents: new Map(),  // gamma event id -> raw event
  pmAt: 0,
  pmList: [],
  open: new Set(),
  bodies: new Map(),    // espnId -> rendered body html
  trades: new Map(),    // tradeKey -> trade, for the cast button
  bigCount: new Map(),  // espnId -> big trades count
  timer: null,
  loading: false,
  loadedDay: null,
};

const $ = (s) => ctx.root.querySelector(s);

/* ---------- data ---------- */

async function loadMarkets(force = false) {
  if (!force && Date.now() - st.pmAt < MARKET_MS && st.pmList.length) return;
  const events = await fetchSoccerEvents({ pages: 4 });
  st.pmEvents = new Map(events.map((e) => [String(e.id), e]));
  st.pmList = groupMatches(events, Date.now(), { backH: 30, aheadH: 60 });
  st.pmAt = Date.now();
}

async function load({ quiet = false } = {}) {
  if (st.loading) return;
  st.loading = true;
  const status = $('#today-status');
  if (!quiet) status.textContent = 'Loading matches…';
  try {
    const start = localDayStart(Date.now(), st.day);
    const end = localDayStart(Date.now(), st.day + 1);
    const [raw] = await Promise.all([
      fetchScoreboard(espnDates(start, end)),
      loadMarkets().catch(() => null), // prices are a bonus; the fixtures still show without them
    ]);
    st.matches = raw.map(parseEspnEvent).filter((m) => m.kickoff >= start && m.kickoff < end && !isPostponed(m));
    st.pm = pairMarkets(st.matches, st.pmList);
    for (const m of st.matches) {
      const p = st.pm.get(m.id);
      if (p && m.league.order === 999 && m.league.name === 'Other competitions' && p.league) m.league = { ...m.league, id: 0, name: String(p.league).toUpperCase() };
    }
    st.loadedDay = st.day;
    render();
    const withMkt = st.matches.filter((m) => st.pm.has(m.id) && shown(m)).length;
    const n = st.matches.filter(shown).length;
    status.textContent = `${n} match${n === 1 ? '' : 'es'} · ${withMkt} on Polymarket · updated ${hm(Date.now())}`;
  } catch (err) {
    status.textContent = `Couldn't load matches (${err.message}), retrying…`;
  } finally {
    st.loading = false;
  }
}

function shown(m) {
  if (st.filter === 'live') return m.state === 'in';
  if (st.filter === 'top') return m.league.top || st.pm.has(m.id);
  return true;
}

/* ---------- list ---------- */

function formPills(form) {
  if (!form) return '';
  return `<span class="form" aria-label="Last five: ${esc(form)}">${[...form].map((c) => `<i class="f-${c}">${c}</i>`).join('')}</span>`;
}

function statusCell(m) {
  if (m.state === 'in') return `<span class="m-live"><i></i>${esc(m.clock || 'LIVE')}</span>`;
  if (m.state === 'post') return `<span class="m-ft">${esc(m.detail || 'FT')}</span>`;
  return `<span class="m-ko">${hm(m.kickoff)}</span>`;
}

function teamLine(t, m, isHome) {
  const red = m.reds.filter((id) => id === t.id).length;
  const lost = m.state === 'post' && !t.winner && (m.home.winner || m.away.winner);
  return `<div class="m-team${lost ? ' lost' : ''}">
    ${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy" width="22" height="22">` : '<span class="nologo"></span>'}
    <span class="nm">${esc(t.short || t.name)}</span>${red ? `<span class="red" title="${red} red card${red > 1 ? 's' : ''}"></span>` : ''}
    ${formPills(t.form)}
    <span class="sc">${m.state === 'pre' ? '' : esc(t.score)}</span>
  </div>`;
}

function probBar(m, big = false) {
  const p = st.pm.get(m.id);
  if (!p) return '';
  const o = orientOutcomes(p.outcomes, m.home.name, m.away.name);
  const s = impliedShares(o);
  if (!s) return '';
  const seg = (k, label, cls) => (s[k] == null ? '' : `<span class="pb-${cls}" style="flex:${Math.max(s[k], 3)}">${s[k] >= (big ? 12 : 8) ? `<b>${s[k]}%</b>${big && s[k] >= 22 ? ` ${esc(label)}` : ''}` : ''}</span>`);
  return `<div class="pbar${big ? ' big' : ''}" title="Polymarket implied chance">
      ${seg('home', m.home.short, 'h')}${seg('draw', 'Draw', 'd')}${seg('away', m.away.short, 'a')}
    </div>`;
}

function mktLine(m) {
  const p = st.pm.get(m.id);
  if (!p) return '';
  const bc = st.bigCount.get(m.id);
  return `<div class="m-mkt">${probBar(m)}<span class="m-vol">${fmtUsd(p.vol24)} 24h${bc ? ` · 🐋 ${bc}` : ''}</span></div>`;
}

function card(m) {
  const open = st.open.has(m.id);
  return `<article class="match${m.state === 'in' ? ' is-live' : ''}${open ? ' open' : ''}" data-id="${esc(m.id)}">
    <button type="button" class="m-head" aria-expanded="${open}">
      <div class="m-status">${statusCell(m)}</div>
      <div class="m-teams">${teamLine(m.home, m, true)}${teamLine(m.away, m, false)}</div>
      <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
    </button>
    ${mktLine(m)}
    <div class="m-body"${open ? '' : ' hidden'}>${open ? (st.bodies.get(m.id) || '<p class="muted small pad">Loading match details…</p>') : ''}</div>
  </article>`;
}

function render() {
  const list = $('#today-list');
  const vis = st.matches.filter(shown);
  const liveN = st.matches.filter((m) => m.state === 'in').length;
  const liveChip = ctx.root.querySelector('.lg-chips [data-f="live"]');
  if (liveChip) liveChip.innerHTML = `<i class="dotlive"></i>Live${liveN ? ` ${liveN}` : ''}`;
  if (!vis.length) {
    list.innerHTML = `<p class="empty">${st.filter === 'live' ? 'No games live right now.' : st.filter === 'top' && st.matches.length ? 'No big-league games this day. Try All.' : 'No games found for this day.'}</p>`;
    return;
  }
  list.innerHTML = groupByLeague(vis).map((g) => `<section class="lg">
      <h3 class="lg-h"><span>${esc(g.league.name)}</span>${g.league.short ? `<em>${esc(g.league.short)}</em>` : ''}</h3>
      ${g.matches.map(card).join('')}
    </section>`).join('');
  list.querySelectorAll('.match.open .m-body').forEach((b) => ctx.observeRows(b));
}

/* ---------- details ---------- */

function formCol(t, rows) {
  if (!rows?.length) return '';
  return `<div class="fcol"><div class="fcol-h">${t.logo ? `<img src="${esc(t.logo)}" alt="" width="16" height="16">` : ''}${esc(t.short)}</div>
    ${rows.map((g) => `<div class="frow"><i class="f-${esc(g.result)}">${esc(g.result || '·')}</i><span class="fo">${g.home ? 'vs' : '@'} ${esc(g.oppAbbr || g.opp)}</span><span class="fs">${esc(g.score)}</span></div>`).join('')}
  </div>`;
}

function section(title, html, extra = '') {
  return html ? `<div class="sec"><div class="sec-h">${esc(title)}${extra}</div>${html}</div>` : '';
}

function goalsHtml(m) {
  if (!m.goals.length) return '';
  return `<div class="goals">${m.goals.map((g) => {
    const home = g.teamId === m.home.id;
    return `<div class="goal ${home ? 'gh' : 'ga'}"><span class="gm">${esc(g.minute)}</span><span>⚽ ${esc(g.who)}${g.pen ? ' (pen)' : ''}${g.og ? ' (og)' : ''}</span></div>`;
  }).join('')}</div>`;
}

function moneyHtml(m, flow) {
  if (!flow || !(flow.total > 0)) return '';
  const p = st.pm.get(m.id);
  const o = orientOutcomes(p.outcomes, m.home.name, m.away.name);
  const label = (r) => (/^draw/i.test(r.label) ? 'Draw' : r.label === o.home?.label ? m.home.short : r.label === o.away?.label ? m.away.short : r.label);
  return `<div class="flow">${flow.rows.filter((r) => r.usd > 0).sort((a, b) => b.usd - a.usd).map((r) => `
    <div class="fl"><span class="fl-l">${esc(label(r))}</span><span class="fl-bar"><i style="width:${Math.round((r.share || 0) * 100)}%"></i></span><span class="fl-v">${fmtPct(r.share)} · ${fmtUsd(r.usd)} · ${r.wallets} wallet${r.wallets === 1 ? '' : 's'}</span></div>`).join('')}
    <p class="muted small">Buys in the last 24h${flow.partial ? ' (latest trades only)' : ''}. Near-settled buys skipped.</p></div>`;
}

function moveHtml(m) {
  const p = st.pm.get(m.id);
  const ev = p && st.pmEvents.get(String(p.id));
  if (!ev) return '';
  const o = orientOutcomes(p.outcomes, m.home.name, m.away.name);
  const mk = new Map((ev.markets || []).map((x) => [x.conditionId, x]));
  const cell = (x, label) => {
    if (!x) return '';
    const ch = Number(mk.get(x.conditionId)?.oneDayPriceChange);
    const pts = Number.isFinite(ch) ? Math.round(ch * 100) : 0;
    return `<span class="mv"><b>${esc(label)}</b> ${Math.round(x.price * 100)}¢ ${pts ? `<em class="${pts > 0 ? 'pos' : 'neg'}">${pts > 0 ? '▲' : '▼'}${Math.abs(pts)}</em>` : '<em>·</em>'}</span>`;
  };
  return `<div class="moves">${cell(o.home, m.home.short)}${cell(o.draw, 'Draw')}${cell(o.away, m.away.short)}</div>`;
}

async function buildBody(m) {
  const p = st.pm.get(m.id);
  const min = ctx.getMin();
  const sinceSec = Math.floor(Date.now() / 1000) - 86400;
  const [sumR, bigR, allR] = await Promise.allSettled([
    fetchSummary(m.id, m.state === 'post'),
    p ? fetchEventTrades(p.eventIds, { minUsd: min, maxPages: 1, limit: 200 }) : Promise.resolve(null),
    p ? fetchEventTrades(p.id, { sinceSec, maxPages: 2 }) : Promise.resolve(null),
  ]);
  const S = sumR.status === 'fulfilled' ? parseSummary(sumR.value, m.home.id, m.away.id) : null;

  let tradesHtml = '';
  if (p) {
    const big = bigR.status === 'fulfilled' && bigR.value ? bigR.value.trades.filter((t) => tradeUsd(t) >= min && Number(t.price) > SETTLED_LO && Number(t.price) < SETTLED_HI) : null;
    if (big) {
      big.sort((a, b) => tradeUsd(b) - tradeUsd(a));
      const top = big.slice(0, 8);
      top.forEach((t) => st.trades.set(tradeKey(t), t));
      st.bigCount.set(m.id, big.length);
      tradesHtml = top.length
        ? `<ul class="feed mini">${top.map(ctx.tradeRow).join('')}</ul>${big.length > top.length ? `<p class="muted small">Biggest ${top.length} of ${big.length}.</p>` : ''}<p class="muted small">Near-settled fills (97¢+ or 3¢ and under) skipped.</p>`
        : `<p class="muted small">No trades of ${fmtUsd(min)}+ on this match yet.</p>`;
    } else tradesHtml = '<p class="muted small">Trades unavailable right now.</p>';
  }
  let flow = null;
  if (p && allR.status === 'fulfilled' && allR.value) {
    flow = sideShare(allR.value.trades, p.outcomes, sinceSec);
    flow.partial = !allR.value.complete;
  }

  const L = S?.leaders || {};
  const leadRow = (t) => {
    const x = L[t.id];
    if (!x || (!x.goals && !x.assists)) return '';
    return `<div class="lead"><span class="lead-t">${esc(t.short)}</span>${x.goals ? `<span>⚽ ${esc(x.goals.name)} <b>${esc(x.goals.value)}</b></span>` : ''}${x.assists ? `<span>🅰️ ${esc(x.assists.name)} <b>${esc(x.assists.value)}</b></span>` : ''}</div>`;
  };
  const lineup = (t) => {
    const x = S?.lineups?.[t.id];
    if (!x) return '';
    return `<div class="xi"><div class="fcol-h">${esc(t.short)}${x.formation ? ` <em>${esc(x.formation)}</em>` : ''}</div><ol>${x.xi.map((pl) => `<li><b>${esc(pl.n)}</b> ${esc(pl.name)}</li>`).join('')}</ol></div>`;
  };
  const tbl = S?.table ? `<table class="mt"><thead><tr><th>#</th><th class="l">Team</th><th>P</th><th>W-D-L</th><th>GD</th><th>Pts</th></tr></thead><tbody>${S.table.rows.map((r) => `<tr><td>${esc(r.rank)}</td><td class="l">${esc(r.team)}</td><td>${esc(r.gp)}</td><td>${esc(r.w)}-${esc(r.dr)}-${esc(r.l)}</td><td>${esc(r.gd)}</td><td><b>${esc(r.pts)}</b></td></tr>`).join('')}</tbody></table><p class="muted small">${esc(S.table.title)}${S.table.size ? ` · ${S.table.size} teams` : ''}</p>` : '';
  const h2h = S?.h2h?.length ? `${S.h2h.map((g) => `<div class="h2h"><span class="hd">${dshort(g.date)}</span><span class="${g.winnerId === g.homeId ? 'w' : ''}">${esc(g.home)}</span><b>${esc(g.hs)}–${esc(g.as)}</b><span class="${g.winnerId === g.awayId ? 'w' : ''}">${esc(g.away)}</span></div>`).join('')}` : '';

  const parts = [
    goalsHtml(m),
    p ? section('Polymarket', `${probBar(m, true)}${moveHtml(m)}`, ` <a class="sec-a" href="https://polymarket.com/event/${encodeURIComponent(p.slug)}" target="_blank" rel="noopener">Open ↗</a>`) : '',
    p ? section('Where the money went', moneyHtml(m, flow)) : '',
    p ? section(`Big trades (${fmtUsd(min)}+)`, tradesHtml) : '',
    S ? section('Form, last 5', `<div class="fgrid">${formCol(m.home, S.form[m.home.id])}${formCol(m.away, S.form[m.away.id])}</div>`) : '',
    S ? section('Table', tbl) : '',
    S ? section('Head to head', h2h, S.h2hSummary ? ` <span class="muted">${esc(S.h2hSummary)}</span>` : '') : '',
    S ? section('Top scorers', `${leadRow(m.home)}${leadRow(m.away)}`) : '',
    S ? section('Lineups', (lineup(m.home) || lineup(m.away)) ? `<div class="fgrid">${lineup(m.home)}${lineup(m.away)}</div>` : '') : '',
  ].filter(Boolean);
  if (!S && sumR.status === 'rejected') parts.push('<p class="muted small pad">Match stats unavailable right now.</p>');
  parts.push(`<div class="m-foot">${m.venue ? `<span class="muted">${esc(m.venue)}</span>` : '<span></span>'}${m.link ? `<a href="${esc(m.link)}" target="_blank" rel="noopener">Match centre ↗</a>` : ''}</div>`);
  return parts.join('');
}

async function openMatch(el, id) {
  const m = st.matches.find((x) => x.id === id);
  if (!m) return;
  const body = el.querySelector('.m-body');
  const head = el.querySelector('.m-head');
  if (st.open.has(id)) {
    st.open.delete(id);
    el.classList.remove('open'); head.setAttribute('aria-expanded', 'false'); body.hidden = true;
    return;
  }
  st.open.add(id);
  el.classList.add('open'); head.setAttribute('aria-expanded', 'true'); body.hidden = false;
  if (!st.bodies.has(id)) body.innerHTML = '<p class="muted small pad">Loading match details…</p>';
  else body.innerHTML = st.bodies.get(id);
  try {
    const html = await buildBody(m);
    st.bodies.set(id, html);
    if (st.open.has(id)) {
      const cur = ctx.root.querySelector(`.match[data-id="${CSS.escape(id)}"]`);
      if (cur) {
        cur.querySelector('.m-body').innerHTML = html;
        ctx.observeRows(cur.querySelector('.m-body'));
        const mk = cur.querySelector('.m-mkt'); // whale count appears once trades are in
        if (mk) mk.outerHTML = mktLine(m);
      }
    }
  } catch {
    body.innerHTML = '<p class="muted small pad">Couldn\'t load this match. Tap again to retry.</p>';
    st.open.delete(id);
  }
  if (window.goatcounter?.count) window.goatcounter.count({ path: 'today-open', title: 'Open match', event: true });
}

/* ---------- refresh ---------- */

async function refreshOpen() {
  for (const id of [...st.open]) {
    const m = st.matches.find((x) => x.id === id);
    if (!m || m.state === 'post') continue;
    try {
      const html = await buildBody(m);
      st.bodies.set(id, html);
      const cur = ctx.root.querySelector(`.match[data-id="${CSS.escape(id)}"] .m-body`);
      if (cur && st.open.has(id)) { cur.innerHTML = html; ctx.observeRows(cur); }
    } catch { /* keep the last good body */ }
  }
}

function tick() {
  if (document.visibilityState !== 'visible' || ctx.root.hidden) return;
  load({ quiet: true }).then(refreshOpen);
}

/** Called by the tab switcher. */
export function showToday() {
  if (st.loadedDay !== st.day) load(); else tick();
  if (!st.timer) st.timer = setInterval(tick, SCORE_MS);
}

export function hideToday() {
  clearInterval(st.timer); st.timer = null;
}

/** The trade-size filter changed: drop cached trade sections so they rebuild at the new floor. */
export function onMinChange() {
  st.bodies.clear(); st.bigCount.clear();
  if (!ctx.root.hidden) refreshOpen().then(render);
}

export function initToday(c) {
  ctx = c;
  ctx.root.querySelectorAll('.day-seg button').forEach((b) => b.addEventListener('click', () => {
    ctx.root.querySelectorAll('.day-seg button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    const d = Number(b.dataset.day);
    if (d === st.day) return;
    st.day = d; st.open.clear(); st.bodies.clear(); st.bigCount.clear();
    load();
  }));
  ctx.root.querySelectorAll('.lg-chips button').forEach((b) => b.addEventListener('click', () => {
    ctx.root.querySelectorAll('.lg-chips button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    st.filter = b.dataset.f;
    render();
    const n = st.matches.filter(shown).length;
    const withMkt = st.matches.filter((m) => st.pm.has(m.id) && shown(m)).length;
    $('#today-status').textContent = `${n} match${n === 1 ? '' : 'es'} · ${withMkt} on Polymarket · updated ${hm(Date.now())}`;
  }));
  $('#today-list').addEventListener('click', (e) => {
    const cast = e.target.closest('.cast');
    if (cast) {
      const t = st.trades.get(cast.closest('.trade')?.dataset.key);
      if (t) ctx.castTrade(t);
      return;
    }
    if (e.target.closest('a')) return;
    const head = e.target.closest('.m-head, .m-mkt');
    if (!head) return;
    const el = head.closest('.match');
    openMatch(el, el.dataset.id);
  });
}
