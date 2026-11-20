// Guards for the speed and "stuck loading record" fixes (2026-11-18). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const api = readFileSync(new URL('../docs/js/api.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../docs/js/app.js', import.meta.url), 'utf8');
test('every Polymarket request has a deadline', () => {
  assert.match(api, /function fetchT\(/);
  assert.doesNotMatch(api, /return await fetch\(url\)/);
  assert.match(api, /return fetchT\(relayUrl\(url\)/);
});
test('wallet records load in parallel', () => {
  assert.match(app, /SCORE_WORKERS = [4-9]/);
  assert.match(api, /const redeemP = getJson/);
});
// 2026-11-20: rows off screen stayed on "loading record"; every row is now queued at once
test('every wallet is queued without waiting to scroll into view', () => {
  assert.match(app, /requestScore\(el\.dataset\.wallet\);\s*\n\s*if \(io\) io\.observe\(el\);/);
  assert.doesNotMatch(app, /if \(io\) io\.observe\(el\); else requestScore/);
});
test('one slow wallet cannot hold a worker forever', () => {
  assert.match(app, /withDeadline\(fetchWalletPositions\(w\), WALLET_DEADLINE\)/);
  assert.match(app, /finally \{\s*\n\s*workers--;/);
});
test('failed records retry instead of sticking', () => {
  assert.match(app, /ERROR_RETRY/);
  assert.match(app, /record unavailable/);
});
// 2026-11-20: a while loop that started workers froze the page (an empty-queue worker exited synchronously)
test('starting score workers is bounded and cannot freeze the page', () => {
  assert.doesNotMatch(app, /while \(workers < SCORE_WORKERS\)/);
  assert.match(app, /for \(let n = SCORE_WORKERS - workers; n > 0; n--\)/);
  assert.match(app, /async function runScoreQueue\(\) \{\s*\n\s*await null;/);
});
