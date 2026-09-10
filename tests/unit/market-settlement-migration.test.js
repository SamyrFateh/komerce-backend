'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const foundation = fs.readFileSync(path.join(ROOT, 'migrations', '208_market_settlement_foundation.sql'), 'utf8');
const cutover = fs.readFileSync(path.join(ROOT, 'migrations', '209_market_delegation_settlement_live.sql'), 'utf8');

describe('market settlement migrations', () => {
  test('foundation porte la machine READY -> REQUESTED -> PAID -> RECEIVED', () => {
    expect(foundation).toMatch(/CREATE TABLE IF NOT EXISTS market_settlements/);
    expect(foundation).toMatch(/'READY','REQUESTED','PAID','RECEIVED'/);
    expect(foundation).toMatch(/OLD\.status = 'READY' AND NEW\.status = 'REQUESTED'/);
    expect(foundation).toMatch(/OLD\.status = 'REQUESTED' AND NEW\.status = 'PAID'/);
    expect(foundation).toMatch(/OLD\.status = 'PAID' AND NEW\.status = 'RECEIVED'/);
  });

  test('amount/currency/market/assignment et provenance sont immuables au niveau DB', () => {
    for (const field of ['market_id', 'assignment_id', 'amount', 'currency', 'source', 'source_reference', 'attested_by']) {
      expect(foundation).toMatch(new RegExp(`NEW\\.${field} IS DISTINCT FROM OLD\\.${field}`));
    }
    expect(foundation).toMatch(/market_settlement_attestation_immutable/);
    expect(foundation).toMatch(/market_settlement_currency_mismatch/);
  });

  test('historique settlement non destructif et événements strictement append-only', () => {
    expect(foundation).toMatch(/trg_prevent_market_settlement_delete/);
    expect(foundation).toMatch(/BEFORE DELETE ON market_settlements/);
    expect(foundation).toMatch(/trg_prevent_market_settlement_event_mutation/);
    expect(foundation).toMatch(/BEFORE UPDATE OR DELETE ON market_settlement_events/);
    expect(foundation).toMatch(/market_settlement_events is append-only/);
  });

  test('cutover rend uniquement les deux capabilities settlement LIVE et les backfill', () => {
    expect(cutover).toMatch(/capability IN \('finance\.act', 'settlement\.receive'\)/);
    expect(cutover).toContain("('finance.act'), ('settlement.receive')");
    expect(cutover).toMatch(/mc\.capability = 'finance\.read'/);
    expect(cutover).toMatch(/CAPABILITY_GRANTED_BY_PROMOTION/);
    expect(cutover).toMatch(/SELECT NULL,/);
  });

  test('activation des droits ne crée aucune vérité financière', () => {
    expect(cutover).not.toMatch(/INSERT INTO market_settlements/i);
    expect(cutover).not.toMatch(/UPDATE market_settlements/i);
    expect(cutover).not.toMatch(/DELETE FROM market_settlements/i);
  });
});
