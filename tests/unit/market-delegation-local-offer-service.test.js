'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const localOffer = require('../../services/market-delegation-local-offer-service');

function executor() {
  return { query: jest.fn() };
}

function mockAuthz(db, { marketId = 'mkt-cm', marketCode = 'CM', assignmentId = 'a-cm', membershipId = 'm1', capabilities = ['local_offer.manage'] } = {}) {
  db.query
    .mockResolvedValueOnce({ rows: [{ market_id: marketId, market_code: marketCode, market_name: 'Cameroun', currency: 'XAF', assignment_id: assignmentId, assignment_status: 'ACTIVE' }] })
    .mockResolvedValueOnce({ rows: [{ id: membershipId, assignment_id: assignmentId, user_id: 'u1', status: 'ACTIVE' }] })
    .mockResolvedValueOnce({ rows: capabilities.map(capability => ({ capability })) })
    .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
}

describe('market-delegation local-offer service — services', () => {
  test('exposer un service appelle providers-service avec le marché résolu serveur et audite LOCAL_SERVICE_EXPOSED', async () => {
    const db = executor();
    mockAuthz(db);
    db.query.mockResolvedValueOnce({ rows: [{ id: 's1', market_id: 'mkt-cm', commercial_exposure: 'DISABLED' }] });
    db.query.mockImplementationOnce(async (sql, params) => {
      expect(sql).toMatch(/UPDATE services SET commercial_exposure/);
      expect(params[2]).toBe('mkt-cm'); // market_id résolu serveur, dans le WHERE
      return { rows: [{ id: 's1', market_id: 'mkt-cm', commercial_exposure: 'ENABLED' }] };
    });
    db.query.mockImplementationOnce(async (sql, params) => {
      expect(sql).toMatch(/INSERT INTO market_delegation_audit/);
      expect(params[4]).toBe('LOCAL_SERVICE_EXPOSED');
      return { rows: [] };
    });

    const result = await localOffer.setServiceExposure(db, {
      marketCode: 'CM', actorUserId: 'u1', serviceId: 's1', exposure: 'ENABLED',
    });
    expect(result.commercial_exposure).toBe('ENABLED');
  });

  test('capability absente → 403, aucune écriture tentée', async () => {
    const db = executor();
    mockAuthz(db, { capabilities: [] });

    await expect(localOffer.setServiceExposure(db, {
      marketCode: 'CM', actorUserId: 'u1', serviceId: 's1', exposure: 'ENABLED',
    })).rejects.toMatchObject({ code: 'MARKET_CAPABILITY_REQUIRED', status: 403 });

    expect(db.query).toHaveBeenCalledTimes(3);
  });

  test('CM ne peut jamais masquer un service appartenant à CG (404, pas de fuite d’existence)', async () => {
    const db = executor();
    mockAuthz(db);
    db.query.mockResolvedValueOnce({ rows: [{ id: 's-cg', market_id: 'mkt-cg' }] });

    await expect(localOffer.setServiceExposure(db, {
      marketCode: 'CM', actorUserId: 'u1', serviceId: 's-cg', exposure: 'DISABLED',
    })).rejects.toMatchObject({ code: 'LOCAL_OFFER_NOT_FOUND', status: 404 });
  });

  test('exposition invalide renvoie 400 avec le code LOCAL_OFFER_EXPOSURE_INVALID', async () => {
    const db = executor();
    mockAuthz(db);

    await expect(localOffer.setServiceExposure(db, {
      marketCode: 'CM', actorUserId: 'u1', serviceId: 's1', exposure: 'MAYBE',
    })).rejects.toMatchObject({ code: 'LOCAL_OFFER_EXPOSURE_INVALID', status: 400 });
  });

  test('idempotence : déjà dans l’état demandé, aucun audit', async () => {
    const db = executor();
    mockAuthz(db);
    db.query.mockResolvedValueOnce({ rows: [{ id: 's1', market_id: 'mkt-cm', commercial_exposure: 'ENABLED' }] });

    const result = await localOffer.setServiceExposure(db, {
      marketCode: 'CM', actorUserId: 'u1', serviceId: 's1', exposure: 'ENABLED',
    });
    expect(result.commercial_exposure).toBe('ENABLED');
    expect(db.query).toHaveBeenCalledTimes(5); // authz(4) + lecture, pas d'UPDATE ni d'audit
  });
});

describe('market-delegation local-offer service — physical offers', () => {
  test('masquer une offre physique audite LOCAL_PHYSICAL_OFFER_HIDDEN', async () => {
    const db = executor();
    mockAuthz(db);
    db.query.mockResolvedValueOnce({ rows: [{ id: 'po1', market_id: 'mkt-cm', commercial_exposure: 'ENABLED' }] });
    db.query.mockResolvedValueOnce({ rows: [{ id: 'po1', market_id: 'mkt-cm', commercial_exposure: 'DISABLED' }] });
    db.query.mockImplementationOnce(async (sql, params) => {
      expect(params[4]).toBe('LOCAL_PHYSICAL_OFFER_HIDDEN');
      return { rows: [] };
    });

    const result = await localOffer.setPhysicalOfferExposure(db, {
      marketCode: 'CM', actorUserId: 'u1', physicalOfferId: 'po1', exposure: 'DISABLED',
    });
    expect(result.commercial_exposure).toBe('DISABLED');
  });

  test('offre physique introuvable sur ce marché renvoie 404', async () => {
    const db = executor();
    mockAuthz(db);
    db.query.mockResolvedValueOnce({ rows: [] });

    await expect(localOffer.setPhysicalOfferExposure(db, {
      marketCode: 'CM', actorUserId: 'u1', physicalOfferId: 'ghost', exposure: 'ENABLED',
    })).rejects.toMatchObject({ code: 'LOCAL_OFFER_NOT_FOUND', status: 404 });
  });
});

describe('market-delegation local-offer service — hygiène', () => {
  test('aucune promotion de users.role, aucun SQL direct sur services/physical_offers', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'market-delegation-local-offer-service.js'), 'utf8');
    expect(source).not.toMatch(/users\.role/);
    expect(source).not.toMatch(/UPDATE services/i);
    expect(source).not.toMatch(/UPDATE physical_offers/i);
  });
});
