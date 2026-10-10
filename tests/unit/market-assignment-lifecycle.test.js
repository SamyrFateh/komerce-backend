'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../services/market-scope-projector', () => ({ projectAssignment: jest.fn(async () => []) }));
const { projectAssignment } = require('../../services/market-scope-projector');
const { setAssignmentLifecycle } = require('../../services/market-provisioning-service');
const { getExitReadiness } = require('../../services/market-control-plane');
const fs = require('fs');
const path = require('path');

const ASSIGNMENT = '11111111-1111-4111-8111-111111111111';

function executor({ assignmentStatus = 'ACTIVE', noAssignment = false, settlements = [], members = 2, disputes = 1 } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM market_operating_assignments a\s+JOIN markets m/.test(sql)) {
        return { rows: noAssignment ? [] : [{ id: ASSIGNMENT, status: assignmentStatus }] };
      }
      if (/FROM markets WHERE code/.test(sql)) return { rows: [{ id: 'm-1', code: 'CM' }] };
      if (/FROM market_operating_assignments\s+WHERE market_id/.test(sql)) return { rows: noAssignment ? [] : [{ id: ASSIGNMENT, status: assignmentStatus }] };
      if (/FROM market_settlements/.test(sql)) return { rows: settlements };
      if (/FROM assignment_memberships/.test(sql)) return { rows: [{ n: members }] };
      if (/FROM disputes/.test(sql)) return { rows: [{ n: disputes }] };
      if (/SELECT id, market_id, status FROM market_operating_assignments/.test(sql)) return { rows: [{ id: ASSIGNMENT, market_id: 'm-1', status: assignmentStatus }] };
      if (/UPDATE market_operating_assignments/.test(sql)) return { rows: [{ id: ASSIGNMENT, status: params[1] }] };
      return { rows: [] };
    },
  };
}

beforeEach(() => projectAssignment.mockClear());

describe('cycle de vie du mandat (D2)', () => {
  test('suspendre un mandat actif : statut changé, trace avec motif, accès délégué reprojeté', async () => {
    const db = executor();
    const result = await setAssignmentLifecycle(db, { actorUserId: 'u1', marketCode: 'cm', targetStatus: 'suspended', reason: ' contrôle ' });
    expect(result).toMatchObject({ changed: true, status: 'SUSPENDED', previous_status: 'ACTIVE' });
    expect(db.calls.some(c => /UPDATE market_operating_assignments/.test(c.sql) && c.params[1] === 'SUSPENDED')).toBe(true);
    const audit = db.calls.find(c => /market_delegation_audit/.test(c.sql));
    expect(JSON.stringify(audit.params)).toContain('contrôle');
    expect(projectAssignment).toHaveBeenCalledWith(db, ASSIGNMENT);
  });

  test('reprendre un mandat suspendu est autorisé', async () => {
    const db = executor({ assignmentStatus: 'SUSPENDED' });
    await expect(setAssignmentLifecycle(db, { actorUserId: 'u1', marketCode: 'CM', targetStatus: 'ACTIVE' })).resolves.toMatchObject({ changed: true, status: 'ACTIVE' });
  });

  test('même statut : idempotent, aucune écriture ni reprojection', async () => {
    const db = executor();
    const result = await setAssignmentLifecycle(db, { actorUserId: 'u1', marketCode: 'CM', targetStatus: 'ACTIVE' });
    expect(result.changed).toBe(false);
    expect(db.calls.some(c => /UPDATE market_operating_assignments/.test(c.sql))).toBe(false);
    expect(projectAssignment).not.toHaveBeenCalled();
  });

  test('statut ou code invalide : 400 ; aucun mandat actif ou suspendu : 404', async () => {
    await expect(setAssignmentLifecycle(executor(), { marketCode: 'CM', targetStatus: 'DRAFT' })).rejects.toMatchObject({ code: 'ASSIGNMENT_STATUS_INVALID', status: 400 });
    await expect(setAssignmentLifecycle(executor(), { marketCode: '!!', targetStatus: 'ENDED' })).rejects.toMatchObject({ code: 'MARKET_CODE_INVALID', status: 400 });
    await expect(setAssignmentLifecycle(executor({ noAssignment: true }), { marketCode: 'CM', targetStatus: 'ENDED' })).rejects.toMatchObject({ code: 'ASSIGNMENT_NOT_FOUND', status: 404 });
  });

  test('terminer est refusé tant qu’un règlement reste non reçu (409), sans écriture', async () => {
    const db = executor({ settlements: [{ currency: 'XAF', n: 2, amount: '150000.000000' }] });
    await expect(setAssignmentLifecycle(db, { actorUserId: 'u1', marketCode: 'CM', targetStatus: 'ENDED' })).rejects.toMatchObject({ code: 'ASSIGNMENT_EXIT_BLOCKED', status: 409 });
    expect(db.calls.some(c => /UPDATE market_operating_assignments/.test(c.sql))).toBe(false);
    expect(projectAssignment).not.toHaveBeenCalled();
  });

  test('terminer sans règlement ouvert : ENDED et accès délégué révoqué par reprojection', async () => {
    const db = executor();
    await expect(setAssignmentLifecycle(db, { actorUserId: 'u1', marketCode: 'CM', targetStatus: 'ENDED' })).resolves.toMatchObject({ changed: true, status: 'ENDED' });
    expect(projectAssignment).toHaveBeenCalledTimes(1);
  });
});

describe('projection de sortie (D2, lecture seule)', () => {
  test('agrège règlements ouverts, membres et litiges ; déclare ce qui n’est pas couvert', async () => {
    const db = executor({ settlements: [{ currency: 'XAF', n: 2, amount: '150000.000000' }], members: 3, disputes: 4 });
    const view = await getExitReadiness(db, 'cm');
    expect(view).toMatchObject({
      market_code: 'CM', active_members: 3, open_disputes: 4, blockers: ['OPEN_SETTLEMENTS'], ready_to_end: false,
      open_settlements: { count: 2, by_currency: [{ currency: 'XAF', count: 2, amount: '150000.000000' }] },
      not_covered: ['field_cash_held'],
    });
    expect(db.calls.every(c => !/^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql))).toBe(true);
  });

  test('prêt à terminer sans règlement ouvert ; faux sans mandat', async () => {
    expect((await getExitReadiness(executor(), 'CM')).ready_to_end).toBe(true);
    expect((await getExitReadiness(executor({ noAssignment: true }), 'CM')).ready_to_end).toBe(false);
  });
});

describe('route centrale', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'admin-market-control-plane.js'), 'utf8');
  test('mutation et lecture réservées à l’admin central, sans SQL direct ni market_id du client', () => {
    expect(source).toMatch(/router\.post\('\/:marketCode\/assignment\/status', \.\.\.centralAdmin/);
    expect(source).toMatch(/router\.get\('\/:marketCode\/exit-readiness', \.\.\.centralAdmin/);
    expect(source).toMatch(/setAssignmentLifecycle/);
    expect(source).not.toMatch(/db\.query/);
  });
});
