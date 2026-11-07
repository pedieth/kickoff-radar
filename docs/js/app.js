import { fetchSports, fetchSoccerEvents, fetchBigTrades, fetchWalletPositions } from './api.js';
import {
  soccerLeagueCodes, isFootballTrade, tradeUsd, walletScore,
  isStrong, fmtUsd, fmtPct, timeAgo, tradeKey,
} from './lib.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POLL_MS = 30_000;
const SCORE_TTL = 4 * 3600e3;
const MAX_FEED = 150;

const state = {
  leagues: new Set(),
  known: new Set(),
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
    state.known = new Set(events.map((e) => String(e.slug).toLowerCase()));
  })();
  return ready;
}

/* ---------- Whales ---------- */

function tradeRow(t) {
  const usd = tradeUsd(t);
  const who = t.name && !/^0x[0-9a-f]{40}-/i.test(t.name) ? t.name : (t.pseudonym || `${t.proxy_wallet.slice(0, 6)}…${t.proxy_wallet.slice(-4)}`);
  const sc = cachedScore(t.proxy_wallet);
  const sharp = isStrong(sc);
  const side = t.side === 'SELL' ? 'SELL' : 'BUY';
  return `<li class="trade${sharp ? ' sharp' : ''}" data-wallet="${esc(t.proxy_wallet)}" data-key="${esc(tradeKey(t))}">
    <div class="row1">
      <span class="pick"><span class="side side-${side}">${side}</span><span class="outcome">${esc(t.outcome)}</span><span class="price">${Math.round(Number(t.price) * 100)}¢</span><span class="taker" title="Taker: this order crossed the spread and filled against resting orders, it did not sit in the book as a maker.">taker</span></span>
      <span class="amt">${fmtUsd(usd)}</span>
    </div>
    <div class="row2">
      <a class="title" href="https://polymarket.com/event/${encodeURIComponent(t.event_slug || t.slug)}" target="_blank" rel="noopener">${esc(t.title)}</a>
      <span class="ago" data-ts="${Number(t.timestamp)}">${timeAgo(t.timestamp)}</span>
    </div>
    <div class="who"><a href="https://polymarket.com/profile/${esc(t.proxy_wallet)}" target="_blank" rel="noopener">${esc(who)}</a><span class="rec">${scoreText(sc)}</span></div>
  </li>`;
}

function scoreText(sc) {
  if (sc === undefined) return '<span class="chip ghost">loading record</span>';
  if (!sc || sc.error) return '<span class="chip ghost">no record</span>';
  if (!sc.resolved) return '<span class="chip ghost">new to football</span>';
  const pnlCls = sc.pnl >= 0 ? 'pos' : 'neg';
  return `<span class="chip">${sc.resolved}${sc.truncated ? '+' : ''} bets</span><span class="chip">${fmtPct(sc.winRate)} won</span><span class="chip ${pnlCls}">${fmtUsd(sc.pnl)}</span>${isStrong(sc) ? '<span class="sharp-tag">sharp</span>' : ''}`;
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
    status.textContent = `${list.length} trades · updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch (err) {
    status.textContent = `Feed error (${err.message}), retrying…`;
  }
}

function renderWhales(added) {
  const ul = $('#whales');
  const seen = new Set([...ul.querySelectorAll('.trade')].map((el) => el.dataset.key));
  const list = [...state.trades.values()].sort((a, b) => b.timestamp - a.timestamp);
  ul.innerHTML = list.map(tradeRow).join('') || '<li class="empty">Listening for big football trades…</li>';
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

$('#whale-min').addEventListener('change', () => { state.trades.clear(); state.firstPoll = true; pollWhales(); });

document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  const sel = $('#whale-min');
  if (sel.value === b.dataset.v) return;
  sel.value = b.dataset.v;
  sel.dispatchEvent(new Event('change'));
}));

const nb = $('#notify');
if (!('Notification' in window)) nb.hidden = true;
else {
  const sync = () => {
    const on = Notification.permission === 'granted';
    nb.classList.toggle('on', on);
    nb.title = on ? 'Alerts on for sharp wallets' : Notification.permission === 'denied' ? 'Alerts blocked in this browser' : 'Alert me when a sharp wallet trades';
    nb.disabled = Notification.permission !== 'default';
  };
  sync();
  nb.addEventListener('click', async () => { await Notification.requestPermission(); sync(); });
}

setInterval(() => document.querySelectorAll('[data-ts]').forEach((el) => { el.textContent = timeAgo(el.dataset.ts); }), 10_000);

startPolling();
