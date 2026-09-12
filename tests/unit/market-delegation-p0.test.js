'use strict';

const fs = require('fs');
const path = require('path');
const { CAPABILITIES, autonomyStats } = require('../../config/market-delegation-capabilities');
const { validateRegistry } = require('../../services/capability-registry');
const { runCheck, CHECKPOINT } = require('../../scripts/capability-registry-check');

const ROOT = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('market-delegation P0 invariants + current autonomy checkpoint', () => {
  // Le cliquet d'autonomie vit à UN seul endroit : CHECKPOINT dans
  // scripts/capability-registry-check.js. Le recopier ici en dur créait une
  // seconde source de vérité — sur sept lots consécutifs, il a fallu corriger
  // le même chiffre dans trois fichiers à chaque fois, ce qui transforme un
  // garde-fou utile en corvée mécanique (et en occasion d'oubli).
  //
  // On garde l'intention du cliquet — faire échouer la CI dès que le compte
  // bouge, pour qu'une bascule LIVE soit toujours un acte délibéré — mais une
  // seule valeur à bumper.
  test('registry remains exact and matches the declared autonomy checkpoint', () => {
    expect(CAPABILITIES).toHaveLength(CHECKPOINT.total);
    expect(autonomyStats(CAPABILITIES)).toEqual({
      live: CHECKPOINT.live,
      total: CHECKPOINT.delegation,
      rate: CHECKPOINT.live / CHECKPOINT.delegation,
    });
    expect(validateRegistry(CAPABILITIES)).toMatchObject({ ok: true, errors: [] });
    expect(runCheck({ root: ROOT, print: false })).toMatchObject({ ok: true, checkpoint: CHECKPOINT });
    for (const capability of ['team.read', 'team.grant', 'team.revoke', 'team.invite']) {
      expect(CAPABILITIES.find(row => row.capability === capability)?.status).toBe('LIVE');
    }
    for (const capability of ['network.create', 'network.update', 'network.suspend', 'provider.manage']) {
      expect(CAPABILITIES.find(row => row.capability === capability)?.status).toBe('LIVE');
    }
    for (const capability of ['local_offer.manage', 'client.case.handle', 'catalog.expose', 'finance.act', 'settlement.receive', 'structure.event.record']) {
      expect(CAPABILITIES.find(row => row.capability === capability)?.status).toBe('LIVE');
    }
    expect(CAPABILITIES.find(row => row.capability === 'market_config.update')?.status).toBe('MISSING');
  });

  test('GROUP is structurally outside market delegation', () => {
    const group = CAPABILITIES.filter(row => row.authority_scope === 'GROUP');
    expect(group).toHaveLength(4);
    expect(group.every(row => row.class === 'BOUNDARY' && row.delegation_mode === 'CENTRAL_ONLY')).toBe(true);
  });

  test('cash policy belongs to partner delegation while cash confirmation stays field execution', () => {
    expect(CAPABILITIES.find(row => row.capability === 'cash_control.policy.manage')).toMatchObject({ class: 'DELEGATION', authority_scope: 'MARKET', delegation_mode: 'DELEGABLE', requires_audit: true });
    expect(CAPABILITIES.find(row => row.capability === 'execution.cash.confirm')).toMatchObject({ class: 'EXECUTION', authority_scope: 'MARKET', requires_audit: true });
  });

  test('assignment schema enforces one ACTIVE mandate per Market ID and subset guards', () => {
    const migration = read('migrations/194_market_delegation_assignments.sql');
    expect(migration).toMatch(/uniq_active_market_assignment/);
    expect(migration).toMatch(/WHERE status = 'ACTIVE'/);
    expect(migration).toMatch(/enforce_assignment_ceiling_capability/);
    expect(migration).toMatch(/v_scope <> 'MARKET'/);
    expect(migration).toMatch(/enforce_membership_capability_within_ceiling/);
    expect(migration).toMatch(/prevent_ceiling_removal_with_active_member_grants/);
    expect(migration).toMatch(/market-operator-default/);
  });

  test('legacy authorization table becomes an attributable market-owned projection without changing middleware', () => {
    const migration = read('migrations/195_operator_market_scopes_projection_marker.sql');
    const projector = read('services/market-scope-projector.js');
    const marketBoundary = read('services/market-scope-admin-service.js');
    const middleware = read('middleware/require-market-scope.js');
    expect(migration).toMatch(/projected_from_membership_id/);
    expect(projector).toMatch(/upsertProjectedMarketScope/);
    expect(projector).toMatch(/revokeProjectedMarketScopes/);
    expect(projector).toMatch(/CASE WHEN EXISTS/);
    expect(projector).not.toMatch(/INSERT INTO operator_market_scopes/);
    expect(projector).not.toMatch(/UPDATE operator_market_scopes/);
    expect(marketBoundary).toMatch(/INSERT INTO operator_market_scopes/);
    expect(marketBoundary).toMatch(/projected_from_membership_id/);
    expect(middleware).not.toMatch(/assignment_memberships/);
    expect(middleware).not.toMatch(/market_operating_assignments/);
  });

  test('promotion network LIVE aligne ceiling et responsables pays sans élargir les viewers', () => {
    const migration = read('migrations/201_market_network_promotion_agent_optional.sql');
    expect(migration).toMatch(/registry\.capability IN \('network\.create','network\.update','network\.suspend'\)/);
    expect(migration).toMatch(/INSERT INTO assignment_capability_ceiling/);
    expect(migration).toMatch(/mc\.capability = 'team\.grant'/);
    expect(migration).toMatch(/mc\.capability = 'team\.revoke'/);
    expect(migration).toMatch(/mc\.capability = 'network\.read'/);
    expect(migration).toMatch(/INSERT INTO membership_capabilities/);
    expect(migration).toMatch(/CAPABILITY_GRANTED_BY_PROMOTION/);
    expect(migration).toMatch(/correlation_id[\s\S]*migration-201/);
    expect(migration).not.toMatch(/legacy_role\s*=\s*'viewer'/);
  });

  test('promotion provider.manage LIVE aligne ceiling et responsables pays sans élargir les viewers', () => {
    const migration = read('migrations/203_market_delegation_provider_manage_live.sql');
    expect(migration).toMatch(/provider\.manage/);
    expect(migration).toMatch(/INSERT INTO assignment_capability_ceiling/);
    expect(migration).toMatch(/mc\.capability = 'team\.grant'/);
    expect(migration).toMatch(/mc\.capability = 'team\.revoke'/);
    expect(migration).toMatch(/mc\.capability = 'network\.read'/);
    expect(migration).toMatch(/INSERT INTO membership_capabilities/);
    expect(migration).toMatch(/CAPABILITY_GRANTED_BY_PROMOTION/);
    expect(migration).toMatch(/migration-203/);
    expect(migration).toMatch(/SELECT NULL,[\s\S]*am\.assignment_id/);
    expect(migration).not.toMatch(/UPDATE users/i);
  });

  test('promotion local_offer.manage LIVE aligne ceiling et responsables pays sans élargir les viewers', () => {
    const migration = read('migrations/204_market_delegation_local_offer_manage_live.sql');
    expect(migration).toMatch(/local_offer\.manage/);
    expect(migration).toMatch(/INSERT INTO assignment_capability_ceiling/);
    expect(migration).toMatch(/mc\.capability = 'team\.grant'/);
    expect(migration).toMatch(/mc\.capability = 'team\.revoke'/);
    expect(migration).toMatch(/mc\.capability = 'network\.read'/);
    expect(migration).toMatch(/INSERT INTO membership_capabilities/);
    expect(migration).toMatch(/CAPABILITY_GRANTED_BY_PROMOTION/);
    expect(migration).toMatch(/migration-204/);
    expect(migration).toMatch(/SELECT NULL,[\s\S]*am\.assignment_id/);
    expect(migration).not.toMatch(/UPDATE users/i);
  });

  test('promotion client.case.handle LIVE aligne ceiling et responsables pays sans élargir les viewers, et n’écrit jamais refund_kmf/refund_eur', () => {
    const migration = read('migrations/205_market_delegation_client_case_handle_live.sql');
    expect(migration).toMatch(/client\.case\.handle/);
    expect(migration).toMatch(/INSERT INTO assignment_capability_ceiling/);
    expect(migration).toMatch(/mc\.capability = 'team\.grant'/);
    expect(migration).toMatch(/mc\.capability = 'team\.revoke'/);
    expect(migration).toMatch(/mc\.capability = 'network\.read'/);
    expect(migration).toMatch(/INSERT INTO membership_capabilities/);
    expect(migration).toMatch(/CAPABILITY_GRANTED_BY_PROMOTION/);
    expect(migration).toMatch(/migration-205/);
    expect(migration).toMatch(/SELECT NULL,[\s\S]*am\.assignment_id/);
    expect(migration).not.toMatch(/UPDATE users/i);
    expect(migration).not.toMatch(/UPDATE disputes/i);
    expect(migration).not.toMatch(/refund_kmf\s*=/);
    expect(migration).not.toMatch(/refund_eur\s*=/);
  });

  test('promotion catalog.expose LIVE aligne ceiling et responsables pays sans élargir les viewers', () => {
    const migration = read('migrations/207_market_delegation_catalog_expose_live.sql');
    expect(migration).toMatch(/catalog\.expose/);
    expect(migration).toMatch(/INSERT INTO assignment_capability_ceiling/);
    expect(migration).toMatch(/mc\.capability = 'team\.grant'/);
    expect(migration).toMatch(/mc\.capability = 'team\.revoke'/);
    expect(migration).toMatch(/mc\.capability = 'network\.read'/);
    expect(migration).toMatch(/INSERT INTO membership_capabilities/);
    expect(migration).toMatch(/CAPABILITY_GRANTED_BY_PROMOTION/);
    expect(migration).toMatch(/migration-207/);
    expect(migration).toMatch(/SELECT NULL,[\s\S]*am\.assignment_id/);
    expect(migration).not.toMatch(/UPDATE users/i);
  });

  test('promotion settlement LIVE aligne ceiling et managers finance sans créer de vérité financière', () => {
    const migration = read('migrations/209_market_delegation_settlement_live.sql');
    expect(migration).toMatch(/finance\.act/);
    expect(migration).toMatch(/settlement\.receive/);
    expect(migration).toMatch(/INSERT INTO assignment_capability_ceiling/);
    expect(migration).toMatch(/mc\.capability = 'team\.grant'/);
    expect(migration).toMatch(/mc\.capability = 'team\.revoke'/);
    expect(migration).toMatch(/mc\.capability = 'finance\.read'/);
    expect(migration).toMatch(/INSERT INTO membership_capabilities/);
    expect(migration).toMatch(/CAPABILITY_GRANTED_BY_PROMOTION/);
    expect(migration).toMatch(/migration-209/);
    expect(migration).toMatch(/SELECT NULL,[\s\S]*am\.assignment_id/);
    expect(migration).not.toMatch(/INSERT INTO market_settlements/i);
    expect(migration).not.toMatch(/UPDATE market_settlements/i);
  });

  test('la migration 207 (activation catalog.expose) ne touche jamais product_market_exposure — séparation stricte d\'avec le snapshot 206', () => {
    const migration = read('migrations/207_market_delegation_catalog_expose_live.sql');
    expect(migration).not.toMatch(/INSERT INTO product_market_exposure/i);
    expect(migration).not.toMatch(/UPDATE product_market_exposure/i);
  });

  test('la migration 206 (snapshot de compatibilité) ne touche jamais capability_registry — séparation stricte d\'avec l\'activation 207', () => {
    const migration = read('migrations/206_catalog_product_market_exposure_snapshot.sql');
    expect(migration).not.toMatch(/UPDATE capability_registry/i);
    expect(migration).not.toMatch(/assignment_capability_ceiling/i);
    expect(migration).not.toMatch(/membership_capabilities/i);
  });

  test('promotion structure.event.record LIVE aligne ceiling et responsables pays sans élargir les viewers, et ne crée jamais d\'événement économique', () => {
    const migration = read('migrations/210_market_delegation_structure_event_record_live.sql');
    expect(migration).toMatch(/structure\.event\.record/);
    expect(migration).toMatch(/INSERT INTO assignment_capability_ceiling/);
    expect(migration).toMatch(/mc\.capability = 'team\.grant'/);
    expect(migration).toMatch(/mc\.capability = 'team\.revoke'/);
    expect(migration).toMatch(/mc\.capability = 'network\.read'/);
    expect(migration).toMatch(/INSERT INTO membership_capabilities/);
    expect(migration).toMatch(/CAPABILITY_GRANTED_BY_PROMOTION/);
    expect(migration).toMatch(/migration-210/);
    expect(migration).toMatch(/SELECT NULL,[\s\S]*am\.assignment_id/);
    expect(migration).not.toMatch(/UPDATE users/i);
    expect(migration).not.toMatch(/INSERT INTO economic_structure_cost_events/i);
    expect(migration).not.toMatch(/UPDATE economic_structure_cost_events/i);
  });
});
