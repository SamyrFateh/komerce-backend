'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '../../migrations/227_sourcing_resolution_foundation.sql'
);

function sql() {
  return fs.readFileSync(migrationPath, 'utf8');
}

describe('migration 227 — sourcing resolution foundation', () => {
  test('creates the shadow resolution entities', () => {
    const text = sql();
    for (const table of [
      'sourcing_commercial_principals',
      'sourcing_source_principal_refs',
      'sourcing_canonical_entities',
      'sourcing_canonical_entity_refs',
      'sourcing_match_proposals',
      'sourcing_resolution_decisions',
      'sourcing_resolution_bindings',
      'sourcing_identity_constraints',
      'sourcing_merge_policies',
    ]) {
      expect(text).toMatch(new RegExp(`CREATE TABLE public\\.${table}\\b`, 'i'));
    }
  });

  test('keeps external identity namespace source-scoped, not principal-scoped', () => {
    const text = sql();
    expect(text).toMatch(/PRIMARY KEY \(source_id, ref_kind, ref_value\)/i);
    expect(text).toMatch(/CREATE TABLE public\.sourcing_source_principal_refs/i);
    expect(text).toMatch(/PRIMARY KEY \(source_id, principal_ref\)/i);
  });

  test('models one canonical supertype with strict Product -> Offer -> Unit hierarchy', () => {
    const text = sql();
    expect(text).toMatch(/grain\s+public\.sourcing_observation_grain NOT NULL/i);
    expect(text).toMatch(/CREATE CONSTRAINT TRIGGER sourcing_canonical_entities_hierarchy_guard/i);
    expect(text).toMatch(/NEW\.grain = 'offer'.*parent.*product/is);
    expect(text).toMatch(/NEW\.grain = 'unit'.*parent.*offer/is);
    expect(text).toMatch(/superseded_same_grain_fk/i);
  });

  test('keeps proposal confidence decomposed and bounded', () => {
    const text = sql();
    for (const score of ['support_score', 'contradiction_score', 'coverage_score']) {
      expect(text).toMatch(new RegExp(`${score}\\s+numeric\\(6,5\\) NOT NULL`, 'i'));
      expect(text).toMatch(new RegExp(`${score} >= 0 AND ${score} <= 1`, 'i'));
    }
    expect(text).toMatch(/proposal_run_id\s+uuid NOT NULL/i);
  });

  test('makes resolution decisions sovereign append-only facts', () => {
    const text = sql();
    expect(text).toMatch(/decision_type IN \('LINK', 'DISTINCT', 'REVIEW_REQUIRED', 'MERGE', 'SPLIT'\)/i);
    expect(text).toMatch(/CREATE TRIGGER sourcing_resolution_decisions_append_only/i);
    expect(text).toMatch(/BEFORE UPDATE OR DELETE ON public\.sourcing_resolution_decisions/i);
    expect(text).toMatch(/CREATE TRIGGER sourcing_match_proposals_append_only/i);
  });

  test('materializes at most one active binding per observation', () => {
    const text = sql();
    expect(text).toMatch(/CREATE UNIQUE INDEX sourcing_resolution_bindings_one_active_observation/i);
    expect(text).toMatch(/ON public\.sourcing_resolution_bindings \(observation_id\)\s+WHERE ended_at IS NULL/i);
    expect(text).toMatch(/CREATE CONSTRAINT TRIGGER sourcing_resolution_bindings_grain_guard/i);
  });

  test('supports reversible MUST_LINK and CANNOT_LINK without contradictory active pair', () => {
    const text = sql();
    expect(text).toMatch(/constraint_type IN \('MUST_LINK', 'CANNOT_LINK'\)/i);
    expect(text).toMatch(/CHECK \(left_entity_id < right_entity_id\)/i);
    expect(text).toMatch(/CREATE UNIQUE INDEX sourcing_identity_constraints_one_active_pair/i);
    expect(text).toMatch(/WHERE active = true/i);
    expect(text).toMatch(/revoked_by_decision_id/i);
  });

  test('scopes merge policy by grain and never embeds supplier selection', () => {
    const text = sql();
    expect(text).toMatch(/CREATE UNIQUE INDEX sourcing_merge_policies_one_active_field/i);
    expect(text).toMatch(/ON public\.sourcing_merge_policies \(grain, field_key\)/i);
    expect(text).not.toMatch(/winning_supplier|selected_supplier|best_offer/i);
  });

  test('contains no backfill and no current catalog authority switch', () => {
    const text = sql();
    expect(text).toMatch(/Pas de backfill/i);
    expect(text).toMatch(/Pas de writer runtime/i);
    expect(text).not.toMatch(/UPDATE\s+public\.(?:products|product_skus|sourcing_candidates)/i);
    expect(text).not.toMatch(/ALTER TABLE\s+public\.(?:products|product_skus|sourcing_candidates)/i);
  });
});
