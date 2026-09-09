'use strict';

const fs = require('fs');
const path = require('path');
const { CAPABILITIES, autonomyStats } = require('../../config/market-delegation-capabilities');
const { validateRegistry } = require('../../services/capability-registry');
const { runCheck } = require('../../scripts/capability-registry-check');

const ROOT = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('market-delegation P0', () => {
  test('registry baseline is exact and internally coherent', () => {
    expect(CAPABILITIES).toHaveLength(42);
    expect(autonomyStats(CAPABILITIES)).toEqual({ live: 15, total: 31, rate: 15 / 31 });
    expect(validateRegistry(CAPABILITIES)).toMatchObject({ ok: true, errors: [] });
    expect(runCheck({ root: ROOT, print: false }).ok).toBe(true);
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
    const migration = read('migrations/172_market_delegation_assignments.sql');
    expect(migration).toMatch(/uniq_active_market_assignment/);
    expect(migration).toMatch(/WHERE status = 'ACTIVE'/);
    expect(migration).toMatch(/enforce_assignment_ceiling_capability/);
    expect(migration).toMatch(/authority_scope <> 'MARKET'/);
    expect(migration).toMatch(/enforce_membership_capability_within_ceiling/);
    expect(migration).toMatch(/market-operator-default/);
  });

  test('legacy authorization table becomes an attributable projection without changing middleware', () => {
    const migration = read('migrations/173_operator_market_scopes_projection_marker.sql');
    const projector = read('services/market-scope-projector.js');
    const middleware = read('middleware/require-market-scope.js');
    expect(migration).toMatch(/projected_from_membership_id/);
    expect(projector).toMatch(/projected_from_membership_id/);
    expect(projector).toMatch(/CASE WHEN EXISTS/);
    expect(middleware).not.toMatch(/assignment_memberships/);
    expect(middleware).not.toMatch(/market_operating_assignments/);
  });
});
