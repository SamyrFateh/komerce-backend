'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * tests/integration/parcel-transition-guard-real-db.test.js
 *
 * Feature propriétaire : logistics
 * Feature traversée     : incident-management (garde F2)
 *
 * Contexte : logistics ("faire transiter un colis du scan initial au
 * retrait final") est en production avec 47+ tests unitaires mais 0
 * preuve E2E du cycle de vie complet. Le point le plus critique de ce
 * cycle — services/parcel-transition-guard.js, la garde F2 — n'avait
 * qu'un test entièrement mocké (tests/unit/parcel-transition-guard.test.js).
 *
 * Ce que la garde F2 protège (doctrine F2_INCIDENT_GOVERNANCE_CONTRACT) :
 * transitionParcelStatus (services/parcel-operations.js), le SEUL point
 * d'écriture autorisé sur parcels.status, appelle assertParcelTransition
 * Allowed() avant TOUTE transition. Pour la transition irréversible
 * 'shipped' spécifiquement, cette garde interroge la vraie table
 * `incidents` : si un incident ouvert d'origine LOGISTICS bloque cette
 * transition (ex. missing_item, damaged_item, quantity_mismatch...), le
 * colis ne peut PAS être expédié tant que l'incident n'est pas résolu —
 * empêchant d'envoyer physiquement un colis dont on sait déjà qu'il a un
 * problème.
 *
 * Ce que les mocks ne peuvent pas prouver :
 *   1. Que la requête SQL réelle (JOIN parcels/incidents sur parcel_id
 *      OU order_id en repli) trouve bien l'incident, avec les vraies
 *      colonnes et le vrai statut 'open'/'investigating'.
 *   2. Qu'un incident RÉSOLU (status != open/investigating) ne bloque
 *      plus rien — la requête filtre sur le statut réel, pas un mock qui
 *      pourrait avoir été mal câblé.
 *   3. Qu'un incident d'un type qui ne bloque PAS 'shipped' (ex. delay)
 *      n'empêche pas la transition, même s'il est ouvert et d'origine
 *      LOGISTICS — preuve que le blocage est bien scopé par type, pas
 *      juste par présence d'un incident.
 *   4. Que transitionParcelStatus() lui-même — pas juste la garde isolée
 *      — refuse réellement l'UPDATE et laisse parcels.status inchangé.
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('PARCEL TRANSITION GUARD (F2) — REAL_DB proofs — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const { transitionParcelStatus } = require('../../services/parcel-operations');

  jest.setTimeout(20000);

  const RUN_TAG = `e2e_test_f2guard_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
  const orderIds = [];
  const parcelIds = [];
  const incidentIds = [];
  const relaisIds = [];
  const productIds = [];

  let seedCounter = 0;

  async function seedParcelInPreparation(label) {
    seedCounter += 1;
    const { rows: [market] } = await db.query(`SELECT id FROM markets WHERE code = 'KM'`);
    const relaisId = crypto.randomUUID();
    relaisIds.push(relaisId);
    await db.query(
      `INSERT INTO relais (id, name, agent_name, phone, address, island, market_id)
       VALUES ($1, $2, 'E2E Agent', '+269000111', 'Moroni Test', 'Ngazidja', $3)`,
      [relaisId, `E2E F2Guard Relais ${RUN_TAG}-${seedCounter}`, market.id]
    );

    const productId = crypto.randomUUID();
    productIds.push(productId);
    await db.query(
      `INSERT INTO products (id, name, price_kmf, stock) VALUES ($1, $2, 10000, 100)`,
      [productId, `E2E F2Guard Produit ${RUN_TAG}-${seedCounter}`]
    );

    const orderId = crypto.randomUUID();
    orderIds.push(orderId);
    await db.query(
      `INSERT INTO orders (id, reference, relais_id, market_id, total_kmf, payment_mode, payment_status, status)
       VALUES ($1, $2, $3, $4, 10000, 'cash_relais', 'paid', 'confirmed')`,
      [orderId, `${RUN_TAG}-order-${seedCounter}`, relaisId, market.id]
    );

    const parcelId = crypto.randomUUID();
    parcelIds.push(parcelId);
    await db.query(
      `INSERT INTO parcels (id, order_id, reference, status)
       VALUES ($1, $2, $3, 'preparation')`,
      [parcelId, orderId, `${RUN_TAG}-parcel-${seedCounter}`]
    );

    return { parcelId, orderId };
  }

  async function seedOpenIncident({ parcelId, orderId, incidentType }) {
    const id = crypto.randomUUID();
    incidentIds.push(id);
    await db.query(
      `INSERT INTO incidents (id, parcel_id, order_id, incident_type, status, title)
       VALUES ($1, $2, $3, $4, 'open', $5)`,
      [id, parcelId, orderId, incidentType, `E2E F2 guard test — ${incidentType}`]
    );
    return id;
  }

  async function parcelStatus(parcelId) {
    const { rows: [row] } = await db.query('SELECT status, shipped_at FROM parcels WHERE id = $1', [parcelId]);
    return row;
  }

  afterAll(async () => {
    if (incidentIds.length) {
      await db.query('DELETE FROM incidents WHERE id = ANY($1::uuid[])', [incidentIds]).catch(() => {});
    }
    if (parcelIds.length) {
      await db.query('SET session_replication_role = replica').catch(() => {});
      await db.query('DELETE FROM parcels WHERE id = ANY($1::uuid[])', [parcelIds]).catch(() => {});
      await db.query('SET session_replication_role = origin').catch(() => {});
    }
    if (orderIds.length) {
      await db.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [orderIds]).catch(() => {});
    }
    if (productIds.length) {
      await db.query('DELETE FROM products WHERE id = ANY($1::uuid[])', [productIds]).catch(() => {});
    }
    if (relaisIds.length) {
      await db.query('DELETE FROM relais WHERE id = ANY($1::uuid[])', [relaisIds]).catch(() => {});
    }
  });

  describe('services/parcel-transition-guard.js (F2) — via transitionParcelStatus réel (REAL_DB)', () => {
    it("1 — SANS incident : la transition preparation → shipped réussit, shipped_at posé", async () => {
      const { parcelId } = await seedParcelInPreparation('nominal');

      const result = await transitionParcelStatus(db, parcelId, 'shipped');
      expect(result.ok).toBe(true);

      const after = await parcelStatus(parcelId);
      expect(after.status).toBe('shipped');
      expect(after.shipped_at).not.toBeNull();
    });

    it("2 — GARDE F2 : un incident ouvert missing_item (LOGISTICS, bloque 'shipped') empêche l'expédition", async () => {
      const { parcelId, orderId } = await seedParcelInPreparation('blocked');
      await seedOpenIncident({ parcelId, orderId, incidentType: 'missing_item' });

      await expect(transitionParcelStatus(db, parcelId, 'shipped')).rejects.toMatchObject({
        code: 'OPEN_HUB_RELEVANT_INCIDENT',
      });

      // Le statut n'a PAS changé — la garde a bloqué avant l'UPDATE.
      const after = await parcelStatus(parcelId);
      expect(after.status).toBe('preparation');
      expect(after.shipped_at).toBeNull();
    });

    it("3 — CONTRÔLE NÉGATIF : un incident LOGISTICS ouvert d'un type qui ne bloque PAS 'shipped' (delay) laisse passer", async () => {
      const { parcelId, orderId } = await seedParcelInPreparation('delay_not_blocking');
      await seedOpenIncident({ parcelId, orderId, incidentType: 'delay' });

      const result = await transitionParcelStatus(db, parcelId, 'shipped');
      expect(result.ok).toBe(true);

      const after = await parcelStatus(parcelId);
      expect(after.status).toBe('shipped');
    });

    it("4 — INCIDENT RÉSOLU : un missing_item déjà résolu ne bloque plus rien", async () => {
      const { parcelId, orderId } = await seedParcelInPreparation('resolved');
      const incidentId = await seedOpenIncident({ parcelId, orderId, incidentType: 'missing_item' });

      await db.query(
        `UPDATE incidents SET status = 'resolved', resolved_at = NOW() WHERE id = $1`,
        [incidentId]
      );

      const result = await transitionParcelStatus(db, parcelId, 'shipped');
      expect(result.ok).toBe(true);

      const after = await parcelStatus(parcelId);
      expect(after.status).toBe('shipped');
    });

    it("5 — REPLI order_id : un incident rattaché seulement à la commande (parcel_id NULL) bloque quand même", async () => {
      const { parcelId, orderId } = await seedParcelInPreparation('order_level_incident');
      // parcel_id explicitement NULL — l'incident ne référence que la commande.
      const id = crypto.randomUUID();
      incidentIds.push(id);
      await db.query(
        `INSERT INTO incidents (id, parcel_id, order_id, incident_type, status, title)
         VALUES ($1, NULL, $2, 'damaged_item', 'open', $3)`,
        [id, orderId, `E2E F2 guard test — repli order_id`]
      );

      await expect(transitionParcelStatus(db, parcelId, 'shipped')).rejects.toMatchObject({
        code: 'OPEN_HUB_RELEVANT_INCIDENT',
      });
    });

    it("6 — TRANSITIONS RÉVERSIBLES non concernées : la garde F2 ne bloque jamais preparation → cancelled même avec incident ouvert", async () => {
      const { parcelId, orderId } = await seedParcelInPreparation('cancel_with_incident');
      await seedOpenIncident({ parcelId, orderId, incidentType: 'missing_item' });

      // 'cancelled' n'est pas dans IRREVERSIBLE_HUB_TRANSITIONS (seul
      // 'shipped' l'est) — la garde F2 n'a rien à évaluer ici.
      const result = await transitionParcelStatus(db, parcelId, 'cancelled');
      expect(result.ok).toBe(true);

      const after = await parcelStatus(parcelId);
      expect(after.status).toBe('cancelled');
    });

    it("7 — IDEMPOTENCE DU TIMESTAMP : rejouer une transition déjà appliquée ne réinitialise pas shipped_at", async () => {
      const { parcelId } = await seedParcelInPreparation('idempotent_timestamp');

      await transitionParcelStatus(db, parcelId, 'shipped');
      const first = await parcelStatus(parcelId);

      await new Promise(resolve => setTimeout(resolve, 20));

      // Rejouer 'shipped' sans passer par le graphe légal (skipValidation)
      // simule un appel redondant côté appelant — COALESCE doit préserver
      // le premier timestamp.
      await transitionParcelStatus(db, parcelId, 'shipped', { skipValidation: true });
      const second = await parcelStatus(parcelId);

      expect(second.shipped_at.getTime()).toBe(first.shipped_at.getTime());
    });
  });
}
