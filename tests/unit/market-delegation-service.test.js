'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const delegation = require('../../services/market-delegation-service');

describe('market-delegation-service — provisioning writers', () => {
  test('exposes delegation-owned writers for central referent and amount limits', () => {
    expect(typeof delegation.setCentralReferent).toBe('function');
    expect(typeof delegation.setCeilingAmountLimits).toBe('function');
  });
});


test('explicit member limits are part of the grant writer contract', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'market-delegation-service.js'), 'utf8');
  expect(source).toMatch(/capabilityLimits = \{\}/);
  expect(source).toMatch(/membership_capabilities \(membership_id, capability, granted_by, limit_amount\)/);
});

describe('market-delegation-service — setAssignmentStatus (D2)', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  const fakeDb = () => {
    const calls = [];
    return {
      calls,
      async query(sql, params) {
        calls.push({ sql, params });
        if (/SELECT id, market_id, status/.test(sql)) return { rows: [{ id: ID, market_id: 'm1', status: 'ACTIVE' }] };
        if (/UPDATE market_operating_assignments/.test(sql)) return { rows: [{ id: ID, status: params[1] }] };
        return { rows: [] };
      },
    };
  };

  test('le motif est tracé dans l’audit quand il est fourni', async () => {
    const db = fakeDb();
    await delegation.setAssignmentStatus(db, { assignmentId: ID, status: 'SUSPENDED', reason: 'contrôle interne', actorUserId: 'u1' });
    const audit = db.calls.find(c => /market_delegation_audit/.test(c.sql));
    expect(JSON.stringify(audit.params)).toContain('contrôle interne');
  });

  test('sans motif, l’audit garde le format historique { status }', async () => {
    const db = fakeDb();
    await delegation.setAssignmentStatus(db, { assignmentId: ID, status: 'ACTIVE', actorUserId: 'u1' });
    const audit = db.calls.find(c => /market_delegation_audit/.test(c.sql));
    expect(JSON.stringify(audit.params)).not.toContain('reason');
  });
});
