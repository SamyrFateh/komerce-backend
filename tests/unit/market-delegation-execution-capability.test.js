'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const delegation = require('../../services/market-delegation-service');
const ROOT = path.join(__dirname, '..', '..');

function executor(sequence) {
  return { query: jest.fn(async () => sequence.shift() || { rows: [] }) };
}

describe('market execution capability delegation', () => {
  test('team.grant peut déléguer EXECUTION LIVE du ceiling sans que le manager le possède', async () => {
    const db = executor([
      { rows: [{ capability: 'execution.parcel.ship', class: 'EXECUTION', status: 'LIVE' }] },
      { rows: [{ id: 'm1', assignment_id: 'a1', user_id: 'u1', status: 'ACTIVE' }] },
      { rows: [{ capability: 'team.grant' }] },
    ]);
    await expect(delegation.assertGrantAllowed(db, {
      assignmentId: 'a1', actorUserId: 'u1', capabilities: ['execution.parcel.ship'],
    })).resolves.toMatchObject({ requested: ['execution.parcel.ship'] });
  });

  test('team.grant ne permet pas de déléguer une capability DELEGATION non possédée', async () => {
    const db = executor([
      { rows: [{ capability: 'pricing.activate', class: 'DELEGATION', status: 'LIVE' }] },
      { rows: [{ id: 'm1', assignment_id: 'a1', user_id: 'u1', status: 'ACTIVE' }] },
      { rows: [{ capability: 'team.grant' }] },
    ]);
    await expect(delegation.assertGrantAllowed(db, {
      assignmentId: 'a1', actorUserId: 'u1', capabilities: ['pricing.activate'],
    })).rejects.toMatchObject({ code: 'MARKET_DELEGATION_GRANT_EXCEEDS_GRANTOR' });
  });

  test('migration 212 ouvre les 7 ceilings sans auto-grant membership ni users.role', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'migrations', '212_market_delegation_execution_ceiling.sql'), 'utf8');
    expect(sql).toContain("registry.class = 'EXECUTION'");
    expect(sql).toContain("registry.status = 'LIVE'");
    expect(sql).toContain('EXECUTION_CEILING_OPENED_BY_MIGRATION');
    expect(sql).not.toMatch(/INSERT INTO membership_capabilities/i);
    expect(sql).not.toMatch(/UPDATE users/i);
  });

  test('Workspace mappe chacune des 7 mutations à sa capability exacte', () => {
    const route = fs.readFileSync(path.join(ROOT, 'routes', 'admin-operations-workspace.js'), 'utf8');
    for (const cap of ["execution.order.mark_ordered","execution.distribution.run","execution.parcel.ship","execution.inventory.assign","execution.parcel.receive","execution.parcel.collect","execution.cash.confirm"]) expect(route).toContain(cap);
    expect(route).toContain('attachMarketExecutionRoleFor');
  });
});
