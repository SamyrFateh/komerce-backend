'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * tests/integration/customs-effective-rates-real-db.test.js
 *
 * Feature propriétaire : economic-engine
 *
 * DOUANE-2C sur vraie base : la vue customs_effective_rates (migration 298) ne calcule le taux que
 * sur les envois dont les droits sont renseignés. Inconnu (NULL) != zéro confirmé (0) ; un taux
 * observé reste une estimation de projection et n'écrit aucun coût réel.
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('CUSTOMS EFFECTIVE RATES — REAL_DB proofs — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const crypto = require('crypto');
  const db = require('../../db');

  jest.setTimeout(20000);

  const RUN_TAG = `e2e_test_effrate_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
  const shipmentIds = [];

  async function insertShipment({ cif, paid, active = true, daysAgo = 1, marketCode = 'KM' }) {
    const { rows: [market] } = await db.query('SELECT id FROM markets WHERE code = $1', [marketCode]);
    const id = crypto.randomUUID();
    shipmentIds.push(id);
    await db.query(
      `INSERT INTO customs_shipments
         (id, reference, shipment_date, transport_mode, cif_value_kmf, customs_paid_kmf, allocation_method, status, is_active, market_id)
       VALUES ($1, $2, CURRENT_DATE - $3::int, 'sea', $4, $5, 'by_cif_value', 'pending', $6, $7)`,
      [id, `${RUN_TAG}-${shipmentIds.length}`, daysAgo, cif, paid, active, market.id]
    );
    return id;
  }

  async function rate30() {
    const { rows } = await db.query(`SELECT * FROM customs_effective_rates WHERE period = 'last_30d'`);
    return rows[0];
  }
  const n = (v) => Number(v);

  afterAll(async () => {
    if (shipmentIds.length) {
      await db.query('DELETE FROM customs_shipments WHERE id = ANY($1::uuid[])', [shipmentIds]);
    }
    await db.end?.();
  });

  describe('customs_effective_rates — observé uniquement', () => {
    it('conserve les 3 périodes et les colonnes historiques, avec les compteurs ajoutés', async () => {
      const { rows } = await db.query('SELECT * FROM customs_effective_rates ORDER BY period');
      expect(rows.map(r => r.period)).toEqual(['last_30d', 'last_365d', 'last_90d']);
      for (const col of ['nb_shipments', 'total_cif_kmf', 'total_customs_kmf', 'rate_pct', 'nb_observed', 'nb_unknown']) {
        expect(rows[0]).toHaveProperty(col);
      }
    });

    it('un envoi aux droits inconnus (NULL) ne tire pas le taux vers zéro', async () => {
      const before = await rate30();
      await insertShipment({ cif: 100000, paid: 20000 });
      await insertShipment({ cif: 900000, paid: null });
      const after = await rate30();

      expect(n(after.nb_unknown) - n(before.nb_unknown)).toBe(1);
      expect(n(after.nb_observed) - n(before.nb_observed)).toBe(1);
      expect(n(after.nb_shipments) - n(before.nb_shipments)).toBe(2);
      // le CIF de l'inconnu n'entre pas au dénominateur
      expect(n(after.total_cif_kmf) - n(before.total_cif_kmf)).toBe(100000);
      expect(n(after.total_customs_kmf) - n(before.total_customs_kmf)).toBe(20000);
    });

    it('zéro confirmé (0) est une observation ; envoi inactif exclu', async () => {
      const before = await rate30();
      await insertShipment({ cif: 50000, paid: 0 });
      await insertShipment({ cif: 70000, paid: 7000, active: false });
      const after = await rate30();

      expect(n(after.nb_observed) - n(before.nb_observed)).toBe(1);
      expect(n(after.total_cif_kmf) - n(before.total_cif_kmf)).toBe(50000);
      expect(n(after.total_customs_kmf) - n(before.total_customs_kmf)).toBe(0);
    });

    it('rate_pct = sum(droits observés) / sum(CIF observé), NULL sans aucune observation', async () => {
      const r = await rate30();
      if (n(r.total_cif_kmf) > 0) {
        expect(n(r.rate_pct)).toBeCloseTo(n(r.total_customs_kmf) / n(r.total_cif_kmf) * 100, 1);
      } else {
        expect(r.rate_pct).toBeNull();
      }
    });

    it('la vue est en lecture seule : aucune allocation réelle ni imputation créée', async () => {
      const { rows: [c] } = await db.query(
        `SELECT COUNT(*)::int AS n FROM order_item_real_cost_allocations a
           JOIN customs_shipments s ON s.id = a.shipment_id WHERE s.reference LIKE $1`, [`${RUN_TAG}%`]);
      expect(c.n).toBe(0);
    });
  });
}
