'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../services/market-delegation-service', () => ({ audit: jest.fn(() => Promise.resolve()) }));

const svc = require('../../services/market-delivery-proof-service');
const { audit } = require('../../services/market-delegation-service');

const valid = () => ({
  actorUserId: 'admin-1', marketId: 'm-cm', carrierId: 'car-1', mode: 'SEA', originRef: 'DXB',
  freightRate: 3.2, rateCurrency: 'usd', rateUnit: 'PER_KG', transitDays: 35,
  evidenceRef: 'CONTRAT-2026-014', validUntil: new Date(Date.now() + 86400000 * 90).toISOString(),
});

function db(plan) {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql) => {
      calls.push(sql);
      const hit = plan.find(([needle]) => sql.includes(needle));
      return { rows: hit ? hit[1] : [] };
    }),
  };
}

describe('getDeliveryProof — fail-closed', () => {
  test('sans marché : non prouvé', async () => {
    expect(await svc.getDeliveryProof(db([]), null)).toMatchObject({ proven: false, basis: null });
  });

  test('aucune attestation, aucune livraison réelle : non prouvé (CM/CG)', async () => {
    const d = db([['FROM orders', [{ n: 0 }]]]);
    expect(await svc.getDeliveryProof(d, 'm-cm')).toMatchObject({ proven: false, basis: null, collected_orders: 0 });
  });

  test('attestation valide (non révoquée, non expirée, transporteur actif) : prouvé ATTESTATION', async () => {
    const d = db([['FROM market_delivery_attestations', [{ id: 'a1', freight_rate: '3.2' }]]]);
    const proof = await svc.getDeliveryProof(d, 'm-cm');
    expect(proof).toMatchObject({ proven: true, basis: 'ATTESTATION' });
    const sql = d.calls[0];
    expect(sql).toMatch(/revoked_at IS NULL/);
    expect(sql).toMatch(/valid_until > NOW\(\)/);
    expect(sql).toMatch(/c\.is_active = TRUE/);
  });

  test('livraisons réelles abouties (hors RCT1) : prouvé HISTORY, requête exclut la recette', async () => {
    const d = db([['FROM orders', [{ n: 12 }]]]);
    const proof = await svc.getDeliveryProof(d, 'm-km');
    expect(proof).toMatchObject({ proven: true, basis: 'HISTORY', collected_orders: 12 });
    expect(d.calls[1]).toMatch(/simulation_scope IS NULL/);
    expect(d.calls[1]).toMatch(/status = 'collected'/);
  });
});

describe('assertMarketDeliverable', () => {
  test('refus 409 MARKET_DELIVERY_NOT_PROVEN sans preuve', async () => {
    await expect(svc.assertMarketDeliverable(db([['FROM orders', [{ n: 0 }]]]), 'm-cm'))
      .rejects.toMatchObject({ code: 'MARKET_DELIVERY_NOT_PROVEN', status: 409 });
  });
});

describe('attestDelivery — pas de simple booléen', () => {
  const ok = () => db([
    ['FROM carriers', [{ id: 'car-1' }]],
    ['FROM markets', [{ id: 'm-cm' }]],
    ['INSERT INTO market_delivery_attestations', [{ id: 'att-1', market_id: 'm-cm' }]],
  ]);

  test('attestation complète : insérée + auditée', async () => {
    const row = await svc.attestDelivery(ok(), valid());
    expect(row.id).toBe('att-1');
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'MARKET_DELIVERY_ATTESTED', marketId: 'm-cm' }));
  });

  test.each([
    ['tarif nul', { freightRate: 0 }, 'ATTESTATION_RATE_INVALID'],
    ['tarif absent', { freightRate: undefined }, 'ATTESTATION_RATE_INVALID'],
    ['preuve documentaire absente', { evidenceRef: ' ' }, 'ATTESTATION_EVIDENCE_REQUIRED'],
    ['origine absente', { originRef: '' }, 'ATTESTATION_ORIGIN_REQUIRED'],
    ['mode inconnu', { mode: 'TELEPORT' }, 'ATTESTATION_MODE_INVALID'],
    ['validité passée', { validUntil: '2020-01-01T00:00:00Z' }, 'ATTESTATION_VALIDITY_INVALID'],
    ['transit invalide', { transitDays: 0 }, 'ATTESTATION_TRANSIT_INVALID'],
    ['acteur absent', { actorUserId: null }, 'ATTESTATION_ACTOR_REQUIRED'],
  ])('refus : %s', async (_label, patch, code) => {
    const d = ok();
    await expect(svc.attestDelivery(d, { ...valid(), ...patch })).rejects.toMatchObject({ code, status: 400 });
    expect(d.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT'), expect.anything());
  });

  test('transporteur inactif ou inconnu : 404', async () => {
    const d = db([['FROM carriers', []]]);
    await expect(svc.attestDelivery(d, valid())).rejects.toMatchObject({ code: 'ATTESTATION_CARRIER_NOT_FOUND', status: 404 });
  });
});

describe('revokeDeliveryAttestation', () => {
  test('motif obligatoire', async () => {
    await expect(svc.revokeDeliveryAttestation(db([]), { actorUserId: 'a', attestationId: 'x', reason: '' }))
      .rejects.toMatchObject({ code: 'ATTESTATION_REVOKE_REASON_REQUIRED' });
  });
  test('révocation auditée ; inconnue/déjà révoquée → 404', async () => {
    const d = db([['UPDATE market_delivery_attestations', [{ id: 'att-1', market_id: 'm-cm', revoked_at: 'now' }]]]);
    await svc.revokeDeliveryAttestation(d, { actorUserId: 'a', attestationId: 'att-1', reason: 'contrat résilié' });
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'MARKET_DELIVERY_ATTESTATION_REVOKED' }));
    await expect(svc.revokeDeliveryAttestation(db([]), { actorUserId: 'a', attestationId: 'zz', reason: 'motif ok' }))
      .rejects.toMatchObject({ code: 'ATTESTATION_NOT_FOUND', status: 404 });
  });
});
