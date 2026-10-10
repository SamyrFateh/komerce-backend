'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../services/market-delegation-team-service', () => ({ resolveAuthorization: jest.fn() }));
const { resolveAuthorization } = require('../../services/market-delegation-team-service');
const { listMarketCustomsShipments, MAX_SHIPMENTS } = require('../../services/market-delegation-customs-service');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const routeSource = fs.readFileSync(path.join(ROOT, 'routes', 'market-delegation-customs.js'), 'utf8');
const serviceSource = fs.readFileSync(path.join(ROOT, 'services', 'market-delegation-customs-service.js'), 'utf8');

const dbWith = rows => ({ calls: [], async query(sql, params) { this.calls.push({ sql, params }); return { rows }; } });
const shipment = () => ({ id: 's-' + Math.random(), reference: 'EXP-1', shipment_date: '2026-09-10', status: 'draft', is_active: true, parcels_linked: 3 });

beforeEach(() => {
  resolveAuthorization.mockReset();
  resolveAuthorization.mockResolvedValue({ market_id: 'm-cm', market_code: 'CM' });
});

describe('douane du marché en lecture (D6a)', () => {
  test('exige operations.read et filtre sur le marché du mandat, jamais celui du client', async () => {
    const db = dbWith([shipment()]);
    const view = await listMarketCustomsShipments(db, { marketCode: 'cm', actorUserId: 'u1' });
    expect(resolveAuthorization).toHaveBeenCalledWith(db, { userId: 'u1', marketCode: 'cm', requiredCapability: 'operations.read' });
    expect(db.calls[0].params[0]).toBe('m-cm');
    expect(db.calls[0].sql).toMatch(/WHERE s\.market_id = \$1/);
    expect(view).toMatchObject({ market_code: 'CM', read_only: true, truncated: false });
    expect(view.shipments).toHaveLength(1);
  });

  test('refus d’autorisation : aucune requête de données', async () => {
    resolveAuthorization.mockRejectedValue(Object.assign(new Error('refus'), { code: 'MARKET_DELEGATION_FORBIDDEN', status: 403 }));
    const db = dbWith([]);
    await expect(listMarketCustomsShipments(db, { marketCode: 'CM', actorUserId: 'u1' })).rejects.toMatchObject({ status: 403 });
    expect(db.calls).toHaveLength(0);
  });

  test('plafonne à MAX_SHIPMENTS et signale la troncature', async () => {
    const rows = Array.from({ length: MAX_SHIPMENTS + 1 }, shipment);
    const view = await listMarketCustomsShipments(dbWith(rows), { marketCode: 'CM', actorUserId: 'u1' });
    expect(view.shipments).toHaveLength(MAX_SHIPMENTS);
    expect(view.truncated).toBe(true);
  });

  test('période AAAA-MM-JJ transmise au SQL ; format invalide ou inversé → 400 avant toute autorisation', async () => {
    const db = dbWith([]);
    await listMarketCustomsShipments(db, { marketCode: 'CM', actorUserId: 'u1', from: '2026-09-01', to: '2026-09-30' });
    expect(db.calls[0].params.slice(1)).toEqual(['2026-09-01', '2026-09-30']);
    await expect(listMarketCustomsShipments(dbWith([]), { marketCode: 'CM', actorUserId: 'u1', from: '01/09/2026' })).rejects.toMatchObject({ code: 'MARKET_CUSTOMS_PERIOD_INVALID', status: 400 });
    await expect(listMarketCustomsShipments(dbWith([]), { marketCode: 'CM', actorUserId: 'u1', from: '2026-10-01', to: '2026-09-01' })).rejects.toMatchObject({ status: 400 });
    expect(resolveAuthorization).toHaveBeenCalledTimes(1);
  });

  test('exécuteur invalide : TypeError explicite', async () => {
    await expect(listMarketCustomsShipments(null, { marketCode: 'CM', actorUserId: 'u1' })).rejects.toThrow(TypeError);
  });

  test('lecture seule : aucune écriture, et la configuration de ventilation du siège n’est pas sélectionnée', () => {
    const code = serviceSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(code).not.toMatch(/allocation_config|s\.\*/);
  });
});

describe('route', () => {
  test('GET seul, authentifiée, marché pris du chemin', () => {
    expect(routeSource).toMatch(/router\.get\('\/markets\/:marketCode\/customs-shipments', authenticate/);
    expect(routeSource).not.toMatch(/router\.(post|put|patch|delete)\(/);
    expect(routeSource).not.toMatch(/req\.(body|query)\.(market_id|marketId)/);
  });
});
