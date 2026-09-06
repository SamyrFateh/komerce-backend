'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(
  path.join(__dirname, '../../migrations/165_pricing_maturity_disposition_events.sql'),
  'utf8'
);

describe('migration 165 — maturity disposition events', () => {
  it('crée un journal append-only rattaché à commande, marché et décideur', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS pricing_maturity_disposition_events');
    expect(migration).toContain('order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT');
    expect(migration).toContain('market_id UUID NOT NULL REFERENCES markets(id) ON DELETE RESTRICT');
    expect(migration).toContain('decided_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT');
    expect(migration).toContain('decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
    expect(migration).not.toMatch(/\bUPDATE\s+pricing_maturity_disposition_events\b/i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\s+pricing_maturity_disposition_events\b/i);
  });

  it('ferme explicitement les états et exige motif, justification et preuve', () => {
    expect(migration).toContain("state IN ('RECONCILIABLE', 'IRRECONCILABLE_DISPOSED')");
    expect(migration).toContain("reason_code TEXT NOT NULL");
    expect(migration).toContain('rationale TEXT NOT NULL');
    expect(migration).toContain('evidence_ref TEXT NOT NULL');
    expect(migration).toContain('char_length(btrim(rationale)) BETWEEN 10 AND 2000');
    expect(migration).toContain('char_length(btrim(evidence_ref)) BETWEEN 3 AND 1000');
  });

  it('indexe la lecture du dernier événement par commande et par marché', () => {
    expect(migration).toContain('idx_pricing_maturity_disposition_order_time');
    expect(migration).toContain('(order_id, decided_at DESC, id DESC)');
    expect(migration).toContain('idx_pricing_maturity_disposition_market_time');
    expect(migration).toContain('(market_id, decided_at DESC, id DESC)');
  });
});
