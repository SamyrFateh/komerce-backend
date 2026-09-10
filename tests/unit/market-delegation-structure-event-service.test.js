'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../services/pricing-period-structure', () => ({
  SCOPE_KINDS: { GROUP: 'GROUP', MARKET_DIRECT: 'MARKET_DIRECT' },
  recordStructureCostEvent: jest.fn(),
  listStructureCostEvents: jest.fn(),
}));

const pricingPeriodStructure = require('../../services/pricing-period-structure');
const structureEvent = require('../../services/market-delegation-structure-event-service');

function executor() {
  return { query: jest.fn() };
}

function mockAuthz(db, { marketId = 'mkt-cm', marketCode = 'CM', assignmentId = 'a-cm', membershipId = 'm1', capabilities = ['structure.event.record'] } = {}) {
  db.query
    .mockResolvedValueOnce({ rows: [{ market_id: marketId, market_code: marketCode, market_name: 'Cameroun', currency: 'XAF', assignment_id: assignmentId, assignment_status: 'ACTIVE' }] })
    .mockResolvedValueOnce({ rows: [{ id: membershipId, assignment_id: assignmentId, user_id: 'u1', status: 'ACTIVE' }] })
    .mockResolvedValueOnce({ rows: capabilities.map(capability => ({ capability })) })
    .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('market-delegation structure-event service — recordStructureEvent', () => {
  test('force scope_kind=MARKET_DIRECT et market_id résolu serveur, quel que soit le payload', async () => {
    const db = executor();
    mockAuthz(db);
    pricingPeriodStructure.recordStructureCostEvent.mockResolvedValueOnce({ id: 'evt-1', scope_kind: 'MARKET_DIRECT', market_id: 'mkt-cm' });
    db.query.mockImplementationOnce(async (sql, params) => {
      expect(sql).toMatch(/INSERT INTO market_delegation_audit/);
      expect(params[4]).toBe('STRUCTURE_EVENT_RECORDED');
      return { rows: [] };
    });

    const event = await structureEvent.recordStructureEvent(db, {
      marketCode: 'CM', actorUserId: 'u1', payload: { charge_id: 'c1', event_kind: 'ACCRUAL' },
    });

    expect(pricingPeriodStructure.recordStructureCostEvent).toHaveBeenCalledWith(
      expect.objectContaining({ scope_kind: 'MARKET_DIRECT', market_id: 'mkt-cm', charge_id: 'c1' }),
      'u1'
    );
    expect(event.id).toBe('evt-1');
  });

  test('scope_kind=GROUP dans le payload est refusé explicitement (403), jamais silencieusement corrigé', async () => {
    const db = executor();
    mockAuthz(db);

    await expect(structureEvent.recordStructureEvent(db, {
      marketCode: 'CM', actorUserId: 'u1', payload: { charge_id: 'c1', scope_kind: 'GROUP' },
    })).rejects.toMatchObject({ code: 'STRUCTURE_EVENT_SCOPE_FORBIDDEN', status: 403 });

    expect(pricingPeriodStructure.recordStructureCostEvent).not.toHaveBeenCalled();
  });

  test('market_id/marketId dans le payload est refusé (400), avant tout appel au writer', async () => {
    const db = executor();
    mockAuthz(db);

    await expect(structureEvent.recordStructureEvent(db, {
      marketCode: 'CM', actorUserId: 'u1', payload: { charge_id: 'c1', market_id: 'mkt-cg' },
    })).rejects.toMatchObject({ code: 'MARKET_ID_FORBIDDEN', status: 400 });

    expect(pricingPeriodStructure.recordStructureCostEvent).not.toHaveBeenCalled();
  });

  test('capability structure.event.record absente → 403, aucun appel au writer', async () => {
    const db = executor();
    mockAuthz(db, { capabilities: [] });

    await expect(structureEvent.recordStructureEvent(db, {
      marketCode: 'CM', actorUserId: 'u1', payload: { charge_id: 'c1' },
    })).rejects.toMatchObject({ code: 'MARKET_CAPABILITY_REQUIRED', status: 403 });

    expect(pricingPeriodStructure.recordStructureCostEvent).not.toHaveBeenCalled();
  });

  test('une erreur de validation du writer canonique (ex. "currency must be...") est traduite en 400 avec un code stable', async () => {
    const db = executor();
    mockAuthz(db);
    pricingPeriodStructure.recordStructureCostEvent.mockRejectedValueOnce(new Error('currency must be a 3-letter uppercase code'));

    await expect(structureEvent.recordStructureEvent(db, {
      marketCode: 'CM', actorUserId: 'u1', payload: { charge_id: 'c1', currency: 'xx' },
    })).rejects.toMatchObject({ code: 'STRUCTURE_EVENT_VALIDATION_FAILED', status: 400 });
  });

  test('"charge not found" est traduit en 404 STRUCTURE_EVENT_CHARGE_NOT_FOUND', async () => {
    const db = executor();
    mockAuthz(db);
    pricingPeriodStructure.recordStructureCostEvent.mockRejectedValueOnce(new Error('charge not found'));

    await expect(structureEvent.recordStructureEvent(db, {
      marketCode: 'CM', actorUserId: 'u1', payload: { charge_id: 'ghost' },
    })).rejects.toMatchObject({ code: 'STRUCTURE_EVENT_CHARGE_NOT_FOUND', status: 404 });
  });
});

describe('market-delegation structure-event service — listStructureEvents', () => {
  test('scope toujours MARKET_DIRECT + market_id résolu serveur, capability pricing.read', async () => {
    const db = executor();
    mockAuthz(db, { capabilities: ['pricing.read'] });
    pricingPeriodStructure.listStructureCostEvents.mockResolvedValueOnce([{ id: 'evt-1' }]);

    const result = await structureEvent.listStructureEvents(db, { marketCode: 'CM', actorUserId: 'u1' });

    expect(pricingPeriodStructure.listStructureCostEvents).toHaveBeenCalledWith(
      expect.objectContaining({ scopeKind: 'MARKET_DIRECT', marketId: 'mkt-cm' })
    );
    expect(result.events).toEqual([{ id: 'evt-1' }]);
  });
});

describe('market-delegation structure-event service — hygiène', () => {
  test('aucun SQL direct sur economic_structure_cost_events, aucune écriture GROUP', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'market-delegation-structure-event-service.js'), 'utf8');
    expect(source).not.toMatch(/INSERT INTO economic_structure_cost_events/i);
    expect(source).not.toMatch(/UPDATE economic_structure_cost_events/i);
    expect(source).not.toMatch(/users\.role/);
  });
});
