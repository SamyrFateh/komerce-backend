'use strict';


/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * POST-O8 — Loyalty seams, REAL_DB half (mission §12, Étape 2 de la
 * classification des tests).
 *
 * Extrait de tests/unit/post-o8-loyalty-seams.test.js : ce fichier ne
 * contient que les deux preuves qui touchent réellement PostgreSQL
 * (LOYALTY-1 et LOYALTY-4). Les preuves purement mockées (LOYALTY-2,
 * LOYALTY-3) et l'inspection statique (LOYALTY-5) restent dans le fichier
 * unit d'origine — un même fichier ne peut pas honnêtement déclarer deux
 * contextes d'exécution incompatibles.
 *
 * Aucune assertion perdue dans la scission : diff pur, zéro changement de
 * comportement testé.
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('POST-O8 — Loyalty seams (REAL_DB half, needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  const loyaltyService = require('../../services/loyalty-service');
  const { getLoyaltyDiscount, recalculateLoyalty } = loyaltyService;
  const db = require('../../db');
  const { createUser, cleanup } = require('./test-harness/seed-helpers');

  describe('POST-O8 — Loyalty extraction seams (mission §12) — REAL_DB', () => {
    // ── LOYALTY-1 — no tier (real DB read, single deterministic query) ──────
    it('LOYALTY-1 — a user absent from v_loyalty_summary yields { discountPct: 0, discountLabel: null }', async () => {
      // A random UUID that cannot match any row in v_loyalty_summary.
      const result = await getLoyaltyDiscount(db, '00000000-0000-0000-0000-000000000000');
      expect(result).toEqual({ discountPct: 0, discountLabel: null });
    });

    // ── LOYALTY-4 — real DB recalc smoke ───────────────────────────────────
    describe('LOYALTY-4 — real DB recalc smoke', () => {
      const TIER_LABEL = `itest-post-o8-tier-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      let tierId;
      let tierMinOrders;
      let relaisId;
      let user;

      beforeAll(async () => {
        // Le dump de test contient déjà des paliers. recalculate_loyalty() trie
        // uniquement par min_orders DESC : deux paliers au même seuil rendent
        // le résultat indéterministe. On crée donc un seuil strictement supérieur
        // à tous les seuils existants et exactement le nombre de commandes requis.
        const { rows: [threshold] } = await db.query(
          `SELECT (COALESCE(MAX(min_orders), 0) + 1)::int AS min_orders
           FROM loyalty_tiers`
        );
        tierMinOrders = Number(threshold.min_orders);

        const { rows: [tier] } = await db.query(
          `INSERT INTO loyalty_tiers (label, badge, min_orders, discount_pct)
           VALUES ($1, '★', $2, 5.00) RETURNING id`,
          [TIER_LABEL, tierMinOrders]
        );
        tierId = tier.id;

        const { rows: [relais] } = await db.query(
          `INSERT INTO relais (name, agent_name, phone, address, island)
           VALUES ($1, 'ITest Loyalty', $2, 'Adresse test loyalty', 'Anjouan')
           RETURNING id`,
          [`ITest Loyalty ${Date.now()}`, `+2693${Math.floor(1000000 + Math.random() * 8999999)}`]
        );
        relaisId = relais.id;
        user = await createUser({ role: 'client' });

        // Une insertion ensembliste garde le test rapide même si plusieurs
        // commandes sont nécessaires pour dépasser le plus haut palier existant.
        await db.query(
          `INSERT INTO orders
             (reference, user_id, relais_id, total_kmf, total_eur,
              payment_mode, payment_status, status)
           SELECT
             'ITEST-LOYALTY-' || gen_random_uuid()::text,
             $1, $2, 10000, 20,
             'cash_relais', 'paid', 'collected'
           FROM generate_series(1, $3::int)`,
          [user.id, relaisId, tierMinOrders]
        );
      });

      afterAll(async () => {
        if (user?.id) await db.query(`DELETE FROM orders WHERE user_id = $1`, [user.id]).catch(() => {});
        await cleanup();
        if (relaisId) await db.query(`DELETE FROM relais WHERE id = $1`, [relaisId]).catch(() => {});
        if (tierId) await db.query(`DELETE FROM loyalty_tiers WHERE id = $1`, [tierId]).catch(() => {});
      });

      it('recalculateLoyalty(db, userId) assigns the tier and is reflected in v_loyalty_summary', async () => {
        await recalculateLoyalty(db, user.id);

        const { rows: [row] } = await db.query(
          `SELECT orders_count, loyalty_tier_id FROM users WHERE id = $1`, [user.id]
        );
        expect(row.orders_count).toBe(tierMinOrders);
        expect(row.loyalty_tier_id).toBe(tierId);

        const { discountPct, discountLabel } = await getLoyaltyDiscount(db, user.id);
        expect(discountPct).toBeCloseTo(5.0);
        expect(discountLabel).toBe(TIER_LABEL);
      });
    });
  });
}
