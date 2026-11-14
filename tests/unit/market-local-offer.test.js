'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'market-local-offer.js'), 'utf8');

describe('market-local-offer.js — stock local (W3)', () => {
  test('liste, réception avec Idempotency-Key et exposition passent par les routes canoniques', () => {
    expect(src).toMatch(/\/api\/markets\/\$\{encodeURIComponent\(marketCode\)\}\/local-stock/);
    expect(src).toMatch(/\$\{base\}\/receipts/);
    expect(src).toMatch(/'Idempotency-Key': key/);
    expect(src).toMatch(/\/exposure/);
  });
  test('403 = section absente ; aucun market_id client dans le corps', () => {
    expect(src).toMatch(/error\.status !== 403/);
    expect(src).not.toMatch(/body: \{[^}]*market_id/);
  });
});
