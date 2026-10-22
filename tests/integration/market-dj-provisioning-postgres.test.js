'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * Lot 8 — Djibouti préparé UNIQUEMENT en PROVISIONING par mécanismes canoniques (INSERT, aucune branche pays).
 * Preuve : devise/unité, readiness incomplète, activation refusée, aucune attestation ni autorisation implicite.
 */
const dbUrl = process.env.DATABASE_URL || '';
const hasIntegrationEnv = /^postgres(ql)?:\/\//.test(dbUrl) && dbUrl.length > 20;

if (!hasIntegrationEnv) {
  describe.skip('Djibouti en PROVISIONING (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  let db, getMarketCurrency, formatAmountForMarket, getControlPlane, setMarketLifecycle, resolveAuthorizedMarkets, djId;

  beforeAll(async () => {
    db = require('../../db');
    ({ getMarketCurrency, formatAmountForMarket } = require('../../utils/currency'));
    ({ getControlPlane } = require('../../services/market-control-plane'));
    ({ setMarketLifecycle } = require('../../services/market-provisioning-service'));
    ({ resolveAuthorizedMarkets } = require('../../middleware/require-market-scope'));
    const { rows } = await db.query("SELECT id FROM markets WHERE code = 'DJ'");
    djId = rows[0] && rows[0].id;
  });

  describe('Djibouti (DJ / DJF) — préparé, jamais activé', () => {
    test('existe en PROVISIONING, inactif, DJF sans sous-unité', async () => {
      expect(djId).toBeDefined();
      const { rows: [dj] } = await db.query('SELECT currency, minor_unit, is_active, lifecycle_status FROM markets WHERE id = $1', [djId]);
      expect(dj).toEqual({ currency: 'DJF', minor_unit: 0, is_active: false, lifecycle_status: 'PROVISIONING' });
      await expect(getMarketCurrency(djId)).resolves.toEqual({ currency: 'DJF', minor_unit: 0 });
      await expect(formatAmountForMarket(15000, djId)).resolves.toMatch(/15.?000.*DJF/);
    });

    test('aucune parité DJF inventée : le peg est USD, pas EUR (currency_parities ne contient que des parités fixes vers EUR)', async () => {
      const { rows } = await db.query("SELECT 1 FROM currency_parities WHERE currency = 'DJF'");
      expect(rows).toHaveLength(0);
    });

    test('readiness : écarts explicites, jamais prêt à l’activation', async () => {
      const control = await getControlPlane(db, 'DJ');
      const codes = control.gaps.map(g => g.code);
      expect(codes).toEqual(expect.arrayContaining([
        'MARKET_INACTIVE', 'NO_CURRENCY_PARITY', 'NO_ASSIGNMENT', 'NO_PAYMENT_PROVIDER', 'NO_CASH_POLICY', 'NO_RELAIS', 'NO_DELIVERY_PROOF',
      ]));
      expect(control.readiness.ready_for_activation).toBe(false);
      expect(control.readiness.platform.blockers.map(g => g.code)).toContain('NO_CURRENCY_PARITY');
    });

    test('les marchés à parité canonique n’ont pas cet écart (KM, CM, CG)', async () => {
      for (const code of ['KM', 'CM', 'CG']) {
        const control = await getControlPlane(db, code);
        expect(control.gaps.map(g => g.code)).not.toContain('NO_CURRENCY_PARITY');
      }
    });

    test('l’activation est refusée par le serveur et DJ reste en PROVISIONING', async () => {
      await expect(setMarketLifecycle(db, { actorUserId: null, marketCode: 'DJ', targetStatus: 'ACTIVE' }))
        .rejects.toMatchObject({ code: 'MARKET_NOT_READY_FOR_ACTIVATION' });
      const { rows: [dj] } = await db.query("SELECT lifecycle_status, is_active FROM markets WHERE code = 'DJ'");
      expect(dj).toEqual({ lifecycle_status: 'PROVISIONING', is_active: false });
    });

    test('aucune attestation, aucun encaissement central, aucun relais, aucun droit hérité', async () => {
      const att = await db.query('SELECT 1 FROM market_delivery_attestations WHERE market_id = $1', [djId]);
      const central = await db.query('SELECT 1 FROM market_central_collection_modes WHERE market_id = $1', [djId]);
      const relais = await db.query('SELECT 1 FROM relais WHERE market_id = $1', [djId]);
      expect([att.rows.length, central.rows.length, relais.rows.length]).toEqual([0, 0, 0]);
      const scopes = await resolveAuthorizedMarkets('00000000-0000-0000-0000-000000000000');
      expect(scopes.has(djId)).toBe(false);
    });
  });
}
