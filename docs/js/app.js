import { fetchSports, fetchSoccerEvents, fetchEventTrades, fetchBigTrades, fetchWalletPositions } from './api.js';
import {
  soccerLeagueCodes, groupMatches, sideShare, isFootballTrade, tradeUsd, walletScore,
  isStrong, fmtUsd, fmtPct, timeAgo, tradeKey,
} from './lib.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400;
const POLL_MS = 30_000;
const SCORE_TTL = 4 * 3600e3;
const MAX_FEED = 150;

const state = {
  leagues: new Set(),
  known: new Set(),
  matches: [],
  shares: new Map(),
  trades: new Map(),
  scores: new Map(),
  pollTimer: null,
  notified: new Set(),
  firstPoll: true,
};

/* ---------- shared bootstrap ---------- */

let ready;
function boot() {
  ready ||= (async () => {
    const [sports, events] = await Promise.all([fetchSports(localStorage), fetchSoccerEvents()]);
    state.leagues = soccerLeagueCodes(sports);
    state.events = events;
    state.known = new Set(events.map((e) => String(e.slug).toLowerCase()));
  })();
  return ready;
}

/* ---------- Today ---------- */

const kickoffFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

async function loadToday(force = false) {
  const status = $('#today-status');
  status.textContent = 'Loading matches…';
  try {
    if (force) { ready = null; state.shares.clear(); }
    await boot();
    state.matches = groupMatches(state.events, Date.now()).slice(0, 20);
    renderMatches();
    status.textContent = state.matches.length
      ? `${state.matches.length} matches · ranked by 24h volume · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : 'No football matches in the next 24h.';
    loadShares();
  } catch (err) {
    status.textContent = `Could not load matches (${err.message}).`;
  }
}

function renderMatches() {
  $('#matches').innerHTML = state.matches.map((m, i) => {
    const share = state.shares.get(m.key);
    const when = m.live ? `<span class="live">LIVE ${esc(m.score)} ${esc(m.period)}</span>`
      : m.ended ? 'Finished' : esc(kickoffFmt.format(m.kickoff));
    const rows = m.outcomes.map((o, j) => {
      const r = share?.rows?.[j];
      const backed = !share ? '<span>…</span>'
        : share.error || r?.share == null ? '<span>—</span>'
          : `<span>${fmtPct(r.share)} · ${fmtUsd(r.usd)} · ${r.wallets} wallet${r.wallets === 1 ? '' : 's'}</span>`;
      const w = r?.share != null ? Math.round(r.share * 100) : 0;
      return `<div class="oc">
        <span class="name">${esc(o.label)}</span><span class="pct">${fmtPct(o.price)}</span>
        <div class="backed"><div class="meter"><i style="width:${w}%"></i></div>${backed}</div>
      </div>`;
    }).join('');
    const note = share && !share.error
      ? `<div class="meta">Backed = money bought on each side at 4–96¢ in the last 24h: ${fmtUsd(share.total)}${share.complete ? '' : ' (latest trades only)'}</div>` : '';
    return `<li class="card" data-key="${esc(m.key)}" tabindex="0">
      <div class="head"><h2><span class="rank">${i + 1}</span>${esc(m.title)}</h2><span class="vol">${fmtUsd(m.vol24)}</span></div>
      <div class="meta">${esc(m.league)} · ${when} · 24h volume</div>
      <div class="outcomes">${rows}</div>${note}
    </li>`;
  }).join('') || '<li class="empty">Nothing here yet.</li>';
}

async function loadShares() {
  const since = Math.floor(Date.now() / 1000) - DAY;
  const queue = state.matches.filter((m) => !state.shares.has(m.key));
  const worker = async () => {
    while (queue.length) {
      const m = queue.shift();
      try {
        const { trades, complete } = await fetchEventTrades(m.id, { sinceSec: since });
        state.shares.set(m.key, { ...sideShare(trades, m.outcomes, since), complete });
      } catch {
        state.shares.set(m.key, { error: true });
      }
      renderMatches();
      await sleep(150);
    }
  };
  await Promise.all([worker(), worker()]);
}

async function openMatch(key) {
  const m = state.matches.find((x) => x.key === key);
  if (!m) return;
  const body = $('#detail-body');
  body.innerHTML = `<h3>${esc(m.title)}</h3><p class="muted">${esc(m.league)} · <a href="https://polymarket.com/event/${encodeURIComponent(m.slug)}" target="_blank" rel="noopener">open on Polymarket</a></p><p class="muted">Loading big trades…</p>`;
  $('#detail').showModal();
  try {
    const { trades } = await fetchEventTrades(m.eventIds.slice(0, 20), { minUsd: 500, maxPages: 1, limit: 60 });
    const rows = trades.map(tradeRow).join('');
    body.innerHTML = body.innerHTML.replace(/<p class="muted">Loading big trades…<\/p>/, '')
      + (rows ? `<p class="muted small">Trades of $500+ on this match, newest first.</p><ul class="feed">${rows}</ul>` : '<p class="empty">No trades of $500+ yet.</p>');
    observeRows(body);
  } catch (err) {
    body.insertAdjacentHTML('beforeend', `<p class="empty">Could not load trades (${esc(err.message)}).</p>`);
  }
}

/* ---------- Whales ---------- */

function tradeRow(t) {
  const usd = tradeUsd(t);
  const who = t.name && !/^0x[0-9a-f]{40}-/i.test(t.name) ? t.name : (t.pseudonym || `${t.proxy_wallet.slice(0, 6)}…${t.proxy_wallet.slice(-4)}`);
  const sc = cachedScore(t.proxy_wallet);
  const sharp = isStrong(sc);
  return `<li class="trade${sharp ? ' sharp' : ''}" data-wallet="${esc(t.proxy_wallet)}" data-key="${esc(tradeKey(t))}">
    <div class="row1"><span class="amt">${fmtUsd(usd)} <span class="side-${esc(t.side)}">${esc(t.side)}</span> ${esc(t.outcome)} @ ${Math.round(Number(t.price) * 100)}¢ <span class="taker" title="Taker: this order crossed the spread and filled against resting orders, it did not sit in the book as a maker.">taker</span></span>
      <span class="muted" data-ts="${Number(t.timestamp)}">${timeAgo(t.timestamp)}</span></div>
    <a class="title" href="https://polymarket.com/event/${encodeURIComponent(t.event_slug || t.slug)}" target="_blank" rel="noopener">${esc(t.title)}</a>
    <div class="score"><a href="https://polymarket.com/profile/${esc(t.proxy_wallet)}" target="_blank" rel="noopener">${esc(who)}</a>
      · <span class="rec">${scoreText(sc)}</span></div>
  </li>`;
}

function scoreText(sc) {
  if (sc === undefined) return 'football record …';
  if (!sc || sc.error) return 'football record —';
  if (!sc.resolved) return 'no resolved football bets';
  return `<b>${sc.resolved}</b> bets · <b>${fmtPct(sc.winRate)}</b> won · <b>${fmtUsd(sc.pnl)}</b> PnL${sc.truncated ? ' (recent)' : ''}${isStrong(sc) ? ' <span class="sharp-tag">sharp</span>' : ''}`;
}

function cachedScore(wallet) {
  if (state.scores.has(wallet)) return state.scores.get(wallet);
  try {
    const c = JSON.parse(localStorage.getItem(`kr:score:${wallet}`) || 'null');
    if (c && Date.now() - c.t < SCORE_TTL) { state.scores.set(wallet, c.s); return c.s; }
  } catch { /* ignore */ }
  return undefined;
}

const scoreQueue = [];
const inFlight = new Set();
const SCORE_WORKERS = 2;
let workers = 0;
function requestScore(wallet) {
  if (cachedScore(wallet) !== undefined || scoreQueue.includes(wallet) || inFlight.has(wallet)) return;
  scoreQueue.push(wallet);
  for (let n = SCORE_WORKERS - workers; n > 0; n--) { workers++; runScoreQueue(); }
}

async function runScoreQueue() {
  while (scoreQueue.length) {
    const w = scoreQueue.shift();
    if (state.scores.has(w) || inFlight.has(w)) continue;
    inFlight.add(w);
    let s;
    try {
      const { positions, truncated } = await fetchWalletPositions(w);
      s = { ...walletScore(positions, state.leagues, state.known), truncated };
      try { localStorage.setItem(`kr:score:${w}`, JSON.stringify({ t: Date.now(), s })); } catch { /* full */ }
    } catch {
      s = { error: true }; // not cached in storage, retried next session
    }
    state.scores.set(w, s);
    inFlight.delete(w);
    paintScore(w, s);
    await sleep(300);
  }
  workers--;
}

function paintScore(wallet, s) {
  document.querySelectorAll(`.trade[data-wallet="${wallet}"]`).forEach((el) => {
    el.querySelector('.rec').innerHTML = scoreText(s);
    el.classList.toggle('sharp', isStrong(s));
  });
  if (isStrong(s)) maybeNotify(wallet, s);
}

const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { requestScore(e.target.dataset.wallet); io.unobserve(e.target); }
}, { rootMargin: '200px' }) : null;

function observeRows(root) {
  root.querySelectorAll('.trade').forEach((el) => {
    if (cachedScore(el.dataset.wallet) !== undefined) return;
    if (io) io.observe(el); else requestScore(el.dataset.wallet);
  });
}

async function pollWhales() {
  const min = Number($('#whale-min').value);
  const status = $('#whale-status');
  try {
    await boot();
    const raw = await fetchBigTrades(min, 500);
    let added = 0;
    for (const t of raw) {
      if (tradeUsd(t) < min || !isFootballTrade(t, state.leagues, state.known)) continue;
      const k = tradeKey(t);
      if (!state.trades.has(k)) { state.trades.set(k, t); added++; }
    }
    const list = [...state.trades.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_FEED);
    state.trades = new Map(list.map((t) => [tradeKey(t), t]));
    renderWhales(added);
    status.textContent = `${list.length} football trades · updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  } catch (err) {
    status.textContent = `Feed error (${err.message}), retrying…`;
  }
}

function renderWhales(added) {
  const ul = $('#whales');
  const seen = new Set([...ul.querySelectorAll('.trade')].map((el) => el.dataset.key));
  const list = [...state.trades.values()].sort((a, b) => b.timestamp - a.timestamp);
  ul.innerHTML = list.map(tradeRow).join('') || '<li class="empty">Waiting for football trades…</li>';
  if (!state.firstPoll && added) ul.querySelectorAll('.trade').forEach((el) => { if (!seen.has(el.dataset.key)) el.classList.add('fresh'); });
  state.firstPoll = false;
  observeRows(ul);
  // a sharp wallet already scored and showing up again
  for (const t of list.slice(0, added)) { const s = cachedScore(t.proxy_wallet); if (isStrong(s)) maybeNotify(t.proxy_wallet, s, t); }
}

function maybeNotify(wallet, s, trade) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const t = trade || [...state.trades.values()].find((x) => x.proxy_wallet === wallet);
  if (!t || Date.now() / 1000 - t.timestamp > 300) return;
  const k = tradeKey(t);
  if (state.notified.has(k)) return;
  state.notified.add(k);
  new Notification(`Sharp wallet: ${fmtUsd(tradeUsd(t))} ${t.side} ${t.outcome}`, {
    body: `${t.title}\nFootball: ${s.resolved} bets, ${fmtPct(s.winRate)} won`,
    tag: k,
  });
}

function startPolling() {
  if (state.pollTimer) return;
  pollWhales();
  state.pollTimer = setInterval(() => { if (document.visibilityState === 'visible' || (typeof Notification !== 'undefined' && Notification.permission === 'granted')) pollWhales(); }, POLL_MS);
}

/* ---------- wiring ---------- */

function show(view) {
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.view === view));
  $('#view-today').hidden = view !== 'today';
  $('#view-whales').hidden = view !== 'whales';
  if (view === 'whales') startPolling();
  history.replaceState(null, '', view === 'whales' ? '#whales' : '#');
}

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
$('#today-refresh').addEventListener('click', () => loadToday(true));
$('#matches').addEventListener('click', (e) => { const c = e.target.closest('.card'); if (c) openMatch(c.dataset.key); });
$('#matches').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const c = e.target.closest('.card'); if (c) openMatch(c.dataset.key); } });
$('#whale-min').addEventListener('change', () => { state.trades.clear(); state.firstPoll = true; pollWhales(); });

const nb = $('#notify');
if (!('Notification' in window)) nb.hidden = true;
else {
  const sync = () => { nb.textContent = Notification.permission === 'granted' ? 'Alerts on' : 'Alert me on sharp wallets'; nb.disabled = Notification.permission !== 'default'; };
  sync();
  nb.addEventListener('click', async () => { await Notification.requestPermission(); sync(); });
}

setInterval(() => document.querySelectorAll('[data-ts]').forEach((el) => { el.textContent = timeAgo(el.dataset.ts); }), 10_000);

loadToday();
if (location.hash === '#whales') show('whales');
