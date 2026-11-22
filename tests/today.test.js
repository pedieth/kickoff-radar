// Today tab (2026-11-22): fixtures from ESPN paired with Polymarket matches. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  leagueOf, prettySlug, espnDates, localDayStart, parseEspnEvent, sortMatches, groupByLeague,
  teamSim, splitTitle, pairMarkets, orientOutcomes, impliedShares, parseSummary,
} from '../docs/js/today-lib.js';

const ev = (id, home, away, iso, extra = {}) => ({
  id, uid: `s:600~l:700~e:${id}`, date: iso, season: { slug: '2026-27-english-premier-league' },
  status: { displayClock: "0'", type: { state: 'pre', name: 'STATUS_SCHEDULED', shortDetail: 'Sched' } },
  competitions: [{ competitors: [
    { homeAway: 'home', form: 'WWDLW', score: '0', team: { id: '364', displayName: home, shortDisplayName: home, logo: 'h.png' } },
    { homeAway: 'away', form: 'LLDWW', score: '0', team: { id: '360', displayName: away, shortDisplayName: away, logo: 'a.png' } },
  ], details: [] }],
  ...extra,
});

test('league names come from the ESPN uid, with a readable fallback', () => {
  assert.equal(leagueOf('s:600~l:700~e:1').name, 'Premier League');
  assert.ok(leagueOf('s:600~l:700~e:1').top);
  assert.equal(leagueOf('s:600~l:3902~e:1').name, 'AFC Champions League Elite');
  assert.equal(leagueOf('s:600~l:99999~e:1', '2026-27-english-womens-super-league').name, 'English Womens Super League');
  assert.equal(prettySlug('regular-season'), '');
  assert.equal(leagueOf('s:600~l:99999~e:1', 'group-stage').name, 'Other competitions');
});

test('espn dates cover the whole local day', () => {
  const start = Date.UTC(2026, 10, 21, 20, 30); // 00:00 Tehran on Nov 22
  const ds = espnDates(start, start + 86400e3);
  assert.deepEqual(ds, ['20261121', '20261122']);
  assert.equal(localDayStart(start + 5 * 3600e3, 1) - localDayStart(start + 5 * 3600e3, 0), 86400e3);
});

test('scoreboard event parses into home/away with form and goals', () => {
  const m = parseEspnEvent(ev('1', 'Liverpool', 'Manchester United', '2026-11-22T16:30Z', {
    status: { displayClock: "63'", type: { state: 'in', name: 'STATUS_SECOND_HALF' } },
  }));
  assert.equal(m.home.name, 'Liverpool');
  assert.equal(m.away.form, 'LLDWW');
  assert.equal(m.state, 'in');
  assert.equal(m.clock, "63'");
  assert.equal(m.kickoff, Date.UTC(2026, 10, 22, 16, 30));
  assert.equal(m.league.name, 'Premier League');
});

test('live games sort first and finished games last', () => {
  const a = { ...parseEspnEvent(ev('1', 'A', 'B', '2026-11-22T12:00Z')), state: 'post' };
  const b = { ...parseEspnEvent(ev('2', 'C', 'D', '2026-11-22T18:00Z')), state: 'in' };
  const c = parseEspnEvent(ev('3', 'E', 'F', '2026-11-22T15:00Z'));
  assert.deepEqual(sortMatches([a, b, c]).map((x) => x.id), ['2', '3', '1']);
  assert.equal(groupByLeague([a, b, c]).length, 1);
});

test('team names line up across ESPN and Polymarket', () => {
  assert.ok(teamSim('Manchester United', 'Manchester United FC') > 0);
  assert.ok(teamSim('Atlético Madrid', 'Club Atlético de Madrid') > 0);
  assert.ok(teamSim('Hamburg SV', 'Hamburger SV') > 0);
  assert.ok(teamSim('Barcelona', 'FC Barcelona') > 0);
  assert.ok(teamSim('Internazionale', 'FC Internazionale Milano') > 0);
  assert.equal(teamSim('Liverpool', 'Chelsea FC'), 0);
  assert.deepEqual(splitTitle('Liverpool FC vs. Manchester United FC - More Markets'), ['Liverpool FC', 'Manchester United FC']);
});

test('a match pairs only with the same fixture at the same time', () => {
  const m = parseEspnEvent(ev('1', 'Liverpool', 'Manchester United', '2026-11-22T16:30Z'));
  const pm = [
    { key: 'x', title: 'Liverpool FC vs. Chelsea FC', kickoff: Date.UTC(2026, 10, 22, 16, 30) },
    { key: 'y', title: 'Liverpool FC vs. Manchester United FC', kickoff: Date.UTC(2026, 11, 22, 16, 30) },
    { key: 'z', title: 'Liverpool FC vs. Manchester United FC', kickoff: Date.UTC(2026, 10, 22, 16, 30) },
  ];
  assert.equal(pairMarkets([m], pm).get('1').key, 'z');
  assert.equal(pairMarkets([m], pm.slice(0, 2)).size, 0);
});

test('prices are shown in ESPN home / draw / away order and add up to 100', () => {
  const outs = [
    { label: 'Manchester United FC', price: 0.2 },
    { label: 'Draw', price: 0.25 },
    { label: 'Liverpool FC', price: 0.57 },
  ];
  const o = orientOutcomes(outs, 'Liverpool', 'Manchester United');
  assert.equal(o.home.label, 'Liverpool FC');
  assert.equal(o.away.label, 'Manchester United FC');
  const s = impliedShares(o);
  assert.equal(s.home + s.draw + s.away, 100);
  assert.ok(s.home > s.away);
});

test('summary gives form, head-to-head, table and leaders', () => {
  const d = JSON.parse(readFileSync(new URL('./fixtures/summary-liv-mun.json', import.meta.url), 'utf8'));
  const s = parseSummary(d, '364', '360');
  assert.equal(s.form['364'].length, 5);
  assert.ok(['W', 'D', 'L'].includes(s.form['364'][0].result));
  assert.ok(s.h2h.length > 0);
  assert.equal(s.table.rows.length, 2);
  assert.ok(s.table.rows.every((r) => r.pts !== ''));
  assert.ok(s.leaders['364'].goals.name);
});

// Pedi's rule: the Trades feed stays exactly as it was; Today is added beside it
test('Trades feed is untouched and Today has no betting picks', () => {
  const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../docs/js/app.js', import.meta.url), 'utf8');
  const today = readFileSync(new URL('../docs/js/today.js', import.meta.url), 'utf8');
  assert.match(html, /<ul id="whales" class="feed"><\/ul>/);
  assert.match(html, /data-tab="trades"[^>]*>Trades</);
  assert.match(html, /data-tab="today"[^>]*>Today</);
  assert.match(app, /startPolling\(\);/);
  assert.match(app, /function tradeRow\(t\)/);
  assert.doesNotMatch(today, /safest|sure bet|lock of the day|best bet|prediction/i);
});

test('Today requests always carry a deadline', () => {
  const espn = readFileSync(new URL('../docs/js/espn.js', import.meta.url), 'utf8');
  assert.match(espn, /function fetchT\(/);
  assert.doesNotMatch(espn, /await fetch\(/);
});
