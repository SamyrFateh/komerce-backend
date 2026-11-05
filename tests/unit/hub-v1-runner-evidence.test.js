'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const http = require('http');
const https = require('https');
const { allTriggerStatuses, summarizeExternalEffects, installNetworkTripwire } = require('../../scripts/recette/hub-v1-certification-runner');
const TABLES = [
  'cash_collections', 'notification_log_attempts', 'outbox_events', 'loyalty_rewards',
  'supplier_execution_payments', 'supplier_execution_payment_proofs', 'supplier_payment_settlements',
];
const zero = () => Object.fromEntries(TABLES.map((name) => [name, 0]));

test('KOM-103 et LOCAL : une liste de résultats vide ou inattendue ne vaut pas une preuve', () => {
  expect(allTriggerStatuses([], 'no_supplier')).toBe(false);
  expect(allTriggerStatuses(null, 'no_supplier')).toBe(false);
  expect(allTriggerStatuses(['already_exists'], 'no_supplier')).toBe(false);
  expect(allTriggerStatuses(['no_supplier', 'no_supplier'], 'no_supplier')).toBe(true);
  expect(allTriggerStatuses([], 'local_stock_no_purchase')).toBe(false);
});

test('verdict externe : une table illisible AVANT ou APRÈS refuse le PASS, même si les autres sont à zéro', () => {
  const before = zero();
  const after = zero();
  expect(summarizeExternalEffects(before, after).zero_external_effects).toBe(true);
  delete before.outbox_events;
  const unknownBefore = summarizeExternalEffects(before, after);
  expect(unknownBefore.evidence_complete).toBe(false);
  expect(unknownBefore.table_delta.outbox_events).toBeNull();
  expect(unknownBefore.zero_external_effects).toBe(false);
  before.outbox_events = 0;
  after.notification_log_attempts = null;
  const unknownAfter = summarizeExternalEffects(before, after);
  expect(unknownAfter.evidence_complete).toBe(false);
  expect(unknownAfter.zero_external_effects).toBe(false);
});

test('verdict externe : rejet d\'une écriture, d\'un débit ou d\'une tentative réseau', () => {
  const before = zero();
  const after = zero();
  after.cash_collections = 1;
  expect(summarizeExternalEffects(before, after).zero_external_effects).toBe(false);
  after.cash_collections = 0;
  expect(summarizeExternalEffects(before, after, [{ kind: 'https.request' }]).zero_external_effects).toBe(false);
});

test('tripwire rétablit request/get HTTP et HTTPS après une tentative refusée', () => {
  const saved = [http.request, http.get, https.request, https.get];
  const guard = installNetworkTripwire();
  try {
    expect(() => http.get('http://example.invalid')).toThrow('HUB_V1_RUNNER_NETWORK_TRIPWIRE');
    expect(() => https.get('https://example.invalid')).toThrow('HUB_V1_RUNNER_NETWORK_TRIPWIRE');
    expect(guard.attempts).toHaveLength(2);
  } finally { guard.restore(); }
  expect([http.request, http.get, https.request, https.get]).toEqual(saved);
});
