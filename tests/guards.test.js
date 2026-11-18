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
