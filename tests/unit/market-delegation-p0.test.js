'use strict';

const fs = require('fs');
const path = require('path');
const { CAPABILITIES, autonomyStats } = require('../../config/market-delegation-capabilities');
const { validateRegistry } = require('../../services/capability-registry');
const { runCheck } = require('../../scripts/capability-registry-check');

const ROOT = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('market-delegation P0 invariants + current autonomy checkpoint', () => {
  test('registry remains exact and LOT 2C+2A advance autonomy to 23/31', () => {
    expect(CAPABILITIES).toHaveLength(42);
    expect(autonomyStats(CAPABILITIES)).toEqual({ live: 23, total: 31, rate: 23 / 31 });
    expect(validateRegistry(CAPABILITIES)).toMatchObject({ ok: true, errors: [] });
    expect(runCheck({ root: ROOT, print: false })).toMatchObject({
      ok: true,
      checkpoint: { lot: '2C-cash+2A-network', p0_live: 15, live: 23, delegation: 31 },
    });
    for (const capability of ['team.read', 'team.grant', 'team.revoke', 'team.invite']) {
      expect(CAPABILITIES.find(row => row.capability === capability)?.status).toBe('LIVE');
    }
    for (const capability of ['network.create', 'network.update', 'network.suspend']) {
      expect(CAPABILITIES.find(row => row.capability === capability)?.status).toBe('LIVE');
    }
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
});
