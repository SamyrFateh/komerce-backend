'use strict';

/**
 * @test-kind e2e-api
 * @test-runner jest
 * @test-requires postgres
 * @feature markets
 * @brief L13 — matrice Q2 sur PostgreSQL réel : chaque opération gardée × chaque statut de marché
 * (ACTIVE / SUSPENDED / PROVISIONING / CLOSED), erreurs typées MARKET_SUSPENDED / MARKET_NOT_ACTIVE (409),
 * et nouvelle expédition douane (marché suspendu : colis de commandes existantes seulement).
 */
const { describeE2E, createCleanup } = require('../helpers/e2eDbKit');

jest.setTimeout(60000);

describeE2E('L13 — garde d’opérations par statut de marché', ({ db }) => {
  const { assertMarketOperationAllowed, OPERATION_STATUSES } = require('../../services/market-operation-guard');
  const customs = require('../../services/customs-shipment-service');
  const q = (sql, params) => db.query(sql, params);
  const CODES = { ACTIVE: 'QA', SUSPENDED: 'QB', PROVISIONING: 'QC', CLOSED: 'QD' };
  const ids = {};
  let cleanup;

  beforeAll(async () => {
    cleanup = createCleanup(db);
    cleanup.trackSql(`DELETE FROM customs_shipments WHERE market_id IN (SELECT id FROM markets WHERE code IN ('QA','QB','QC','QD')); DELETE FROM markets WHERE code IN ('QA','QB','QC','QD');`);
    await q(`DELETE FROM customs_shipments WHERE market_id IN (SELECT id FROM markets WHERE code IN ('QA','QB','QC','QD')); DELETE FROM markets WHERE code IN ('QA','QB','QC','QD')`);
    for (const [status, code] of Object.entries(CODES)) {
      const active = status === 'ACTIVE' || status === 'SUSPENDED';
      const { rows: [m] } = await q(
        `INSERT INTO markets (code, name, currency, minor_unit, is_active, lifecycle_status) VALUES ($1,$2,'KMF',0,$3,$4) RETURNING id`,
        [code, `E2E L13 ${status}`, active, status]);
      ids[status] = m.id;
    }
  });
  afterAll(async () => { if (cleanup) await cleanup.run(); });

  const MATRIX = {
    local_price_draft: { ACTIVE: true, SUSPENDED: false, PROVISIONING: true, CLOSED: false },
    local_price_activate: { ACTIVE: true, SUSPENDED: false, PROVISIONING: false, CLOSED: false },
    local_price_reset: { ACTIVE: true, SUSPENDED: true, PROVISIONING: true, CLOSED: false },
    catalog_exposure_enable: { ACTIVE: true, SUSPENDED: false, PROVISIONING: false, CLOSED: false },
    customs_shipment_create: { ACTIVE: true, SUSPENDED: true, PROVISIONING: false, CLOSED: false },
  };

  test('la table de statuts du garde est exactement la matrice Q2', () => {
    Object.entries(MATRIX).forEach(([op, cells]) => {
      expect([...OPERATION_STATUSES[op]].sort()).toEqual(Object.keys(cells).filter(s => cells[s]).sort());
    });
    expect(Object.keys(OPERATION_STATUSES).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  Object.entries(MATRIX).forEach(([operation, cells]) => {
    Object.entries(cells).forEach(([status, allowed]) => {
      test(`${operation} × ${status} → ${allowed ? 'autorisé' : 'refusé'}`, async () => {
        const run = () => assertMarketOperationAllowed(db, ids[status], operation, { carriesOnlyExistingOrders: true });
        if (allowed) {
          await expect(run()).resolves.toMatchObject({ code: CODES[status] });
        } else {
          await expect(run()).rejects.toMatchObject({
            status: 409,
            code: status === 'SUSPENDED' ? 'MARKET_SUSPENDED' : 'MARKET_NOT_ACTIVE',
          });
        }
      });
    });
  });

  test('le garde accepte aussi le code marché (route exposition) et ignore une opération sans marché', async () => {
    await expect(assertMarketOperationAllowed(db, 'qb', 'catalog_exposure_enable')).rejects.toMatchObject({ code: 'MARKET_SUSPENDED' });
    await expect(assertMarketOperationAllowed(db, 'QA', 'catalog_exposure_enable')).resolves.toMatchObject({ code: 'QA' });
    await expect(assertMarketOperationAllowed(db, null, 'customs_shipment_create')).resolves.toBeNull();
  });

  test('marché suspendu : expédition douane sans colis existants refusée, avec colis acceptée par le garde', async () => {
    await expect(assertMarketOperationAllowed(db, ids.SUSPENDED, 'customs_shipment_create', { carriesOnlyExistingOrders: false }))
      .rejects.toMatchObject({ status: 409, code: 'MARKET_SUSPENDED' });
    await expect(assertMarketOperationAllowed(db, ids.SUSPENDED, 'customs_shipment_create', { carriesOnlyExistingOrders: true }))
      .resolves.toMatchObject({ code: 'QB' });
  });

  test('createShipment réel : marché suspendu sans colis, marché en préparation et fermé → 409 typé, rien n’est créé', async () => {
    const body = { reference: 'L13-CS', shipment_date: '2026-10-23', cif_value_kmf: 1000 };
    await expect(customs.createShipment(db, { ...body, reference: 'L13-CS-S' }, null, { marketId: ids.SUSPENDED }))
      .rejects.toMatchObject({ status: 409, code: 'MARKET_SUSPENDED' });
    await expect(customs.createShipment(db, { ...body, reference: 'L13-CS-P' }, null, { marketId: ids.PROVISIONING }))
      .rejects.toMatchObject({ status: 409, code: 'MARKET_NOT_ACTIVE' });
    await expect(customs.createShipment(db, { ...body, reference: 'L13-CS-C' }, null, { marketId: ids.CLOSED }))
      .rejects.toMatchObject({ status: 409, code: 'MARKET_NOT_ACTIVE' });
    const { rows } = await q(`SELECT 1 FROM customs_shipments WHERE reference LIKE 'L13-CS-%'`);
    expect(rows).toHaveLength(0);
  });

  test('createShipment réel : marché actif accepté', async () => {
    const created = await customs.createShipment(db, { reference: 'L13-CS-A', shipment_date: '2026-10-23', cif_value_kmf: 1000 }, null, { marketId: ids.ACTIVE });
    expect(created).toBeTruthy();
    await q(`DELETE FROM customs_shipments WHERE reference = 'L13-CS-A'`);
  });
});
