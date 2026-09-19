'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * tests/integration/market-local-price-state-transition-real-db.test.js
 *
 * Feature propriétaire : market-autonomy
 *
 * Contexte : services/market-local-price-state-transition.js (criticality
 * CRITICAL) n'avait AUCUN test — ni mocké, ni réel. C'est la seule fonction
 * qui bascule un prix local de LOCAL_AUTHORIZED_PENDING_CUTOVER (autorisé
 * économiquement) à LOCAL_ACTIVE (effectif acheteur), avec la doctrine
 * activation_only_from_authorized_state, activation_is_audited,
 * amount_and_currency_are_frozen_across_cutover.
 *
 * Invariants prouvés ici, jamais vérifiés avant :
 *   1. Activation refusée si le draft n'est pas au statut AUTHORIZED
 *      (ex. encore DRAFT_PENDING_GATE) — pas de saut d'étape.
 *   2. Preuve de fraîcheur (activationSnapshot) : si le montant/devise
 *      fournis ne correspondent plus EXACTEMENT à l'état courant en base,
 *      l'activation est refusée — anti-race-condition (un opérateur ne
 *      peut pas activer un prix sur la base d'une preuve périmée si le
 *      montant a changé entre-temps).
 *   3. activation_allowed doit être explicitement true dans la preuve —
 *      pas de contournement silencieux.
 *   4. Idempotence : réactiver un prix déjà LOCAL_ACTIVE renvoie
 *      already_active:true sans réécrire ni dupliquer d'événement.
 *   5. Succès : transaction atomique — product_market_price_drafts passe
 *      à LOCAL_ACTIVE avec active_at posé, ET un événement ACTIVATE est
 *      journalisé dans product_market_price_draft_events, les deux relus
 *      après COMMIT.
 *   6. La vraie contrainte CHECK de cohérence état/timestamps
 *      (authorized_at/authorization_snapshot/active_at requis selon le
 *      statut) est respectée par le code, pas seulement supposée.
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('MARKET LOCAL PRICE ACTIVATION — REAL_DB proofs — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const { activateMarketPriceDecision } = require('../../services/market-local-price-state-transition');

  jest.setTimeout(20000);

  const RUN_TAG = `e2e_test_localprice_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
  const productIds = [];
  const actorId = crypto.randomUUID();
  let seedCounter = 0;
  let market;

  async function seedProduct() {
    seedCounter += 1;
    const id = crypto.randomUUID();
    productIds.push(id);
    const productRef = `${RUN_TAG}-${seedCounter}`;
    await db.query(
      `INSERT INTO products (id, product_ref, name, category, price_kmf, stock, is_active)
       VALUES ($1, $2, $3, 'autre', 20000, 50, TRUE)`,
      [id, productRef, `E2E LocalPrice Produit ${productRef}`]
    );
    return { id, productRef };
  }

  async function seedDraft(productId, { status, amount = 15000, currency = 'KMF' }) {
    const authorized = status === 'LOCAL_AUTHORIZED_PENDING_CUTOVER' || status === 'LOCAL_ACTIVE';
    const active = status === 'LOCAL_ACTIVE';
    const snapshot = authorized ? { local_price: amount, currency, activation_allowed: true } : null;
    await db.query(
      `INSERT INTO product_market_price_drafts
         (market_id, product_id, amount, currency, status, reason, decided_by,
          authorized_at, authorization_snapshot, active_at)
       VALUES ($1, $2, $3, $4, $5, 'E2E seed', $6,
               ${authorized ? 'NOW()' : 'NULL'}, ${authorized ? '$7::jsonb' : 'NULL'}, ${active ? 'NOW()' : 'NULL'})`,
      authorized
        ? [market.id, productId, amount, currency, status, actorId, JSON.stringify(snapshot)]
        : [market.id, productId, amount, currency, status, actorId]
    );
  }

  async function draftRow(productId) {
    const { rows: [row] } = await db.query(
      `SELECT status, amount, currency, active_at FROM product_market_price_drafts WHERE market_id = $1 AND product_id = $2`,
      [market.id, productId]
    );
    return row;
  }

  async function eventsFor(productId) {
    const { rows } = await db.query(
      `SELECT action, old_status, new_status FROM product_market_price_draft_events WHERE market_id = $1 AND product_id = $2 ORDER BY created_at`,
      [market.id, productId]
    );
    return rows;
  }

  afterAll(async () => {
    if (productIds.length) {
      await db.query('DELETE FROM product_market_price_draft_events WHERE product_id = ANY($1::uuid[])', [productIds]).catch(() => {});
      await db.query('DELETE FROM product_market_price_drafts WHERE product_id = ANY($1::uuid[])', [productIds]).catch(() => {});
      await db.query('DELETE FROM products WHERE id = ANY($1::uuid[])', [productIds]).catch(() => {});
    }
    await db.query('DELETE FROM users WHERE id = $1', [actorId]).catch(() => {});
  });

  beforeAll(async () => {
    const { rows: [row] } = await db.query(`SELECT id, code, currency FROM markets WHERE code = 'KM'`);
    market = row;
    await db.query(
      `INSERT INTO users (id, full_name, email, phone, role) VALUES ($1, $2, $3, $4, 'admin')`,
      [actorId, `E2E LocalPrice Actor ${RUN_TAG}`, `${RUN_TAG}_actor@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`]
    );
  });

  describe('services/market-local-price-state-transition.js — activation LOCAL_ACTIVE (REAL_DB)', () => {
    it("1 — REFUS si le draft n'est pas AUTHORIZED (encore DRAFT_PENDING_GATE)", async () => {
      const { id: productId, productRef } = await seedProduct();
      await seedDraft(productId, { status: 'DRAFT_PENDING_GATE' });

      await expect(activateMarketPriceDecision({
        market, productRef,
        activationSnapshot: { local_price: 15000, currency: 'KMF', activation_allowed: true },
        actorId,
      })).rejects.toMatchObject({ code: 'market_price_not_authorized' });

      const row = await draftRow(productId);
      expect(row.status).toBe('DRAFT_PENDING_GATE');
      expect(row.active_at).toBeNull();
    });

    it('2 — REFUS si la preuve de fraîcheur ne correspond plus au montant courant', async () => {
      const { id: productId, productRef } = await seedProduct();
      await seedDraft(productId, { status: 'LOCAL_AUTHORIZED_PENDING_CUTOVER', amount: 15000 });

      await expect(activateMarketPriceDecision({
        market, productRef,
        // Preuve périmée : montant différent du draft réellement en base.
        activationSnapshot: { local_price: 9999, currency: 'KMF', activation_allowed: true },
        actorId,
      })).rejects.toMatchObject({ code: 'market_price_activation_snapshot_stale' });

      const row = await draftRow(productId);
      expect(row.status).toBe('LOCAL_AUTHORIZED_PENDING_CUTOVER');
    });

    it("3 — REFUS si activation_allowed n'est pas explicitement true", async () => {
      const { id: productId, productRef } = await seedProduct();
      await seedDraft(productId, { status: 'LOCAL_AUTHORIZED_PENDING_CUTOVER', amount: 15000 });

      await expect(activateMarketPriceDecision({
        market, productRef,
        activationSnapshot: { local_price: 15000, currency: 'KMF', activation_allowed: false },
        actorId,
      })).rejects.toMatchObject({ code: 'market_price_activation_not_allowed' });
    });

    it('4 — SUCCÈS : transaction atomique — draft LOCAL_ACTIVE + événement ACTIVATE journalisé', async () => {
      const { id: productId, productRef } = await seedProduct();
      await seedDraft(productId, { status: 'LOCAL_AUTHORIZED_PENDING_CUTOVER', amount: 15000 });

      const result = await activateMarketPriceDecision({
        market, productRef,
        activationSnapshot: { local_price: 15000, currency: 'KMF', activation_allowed: true },
        actorId,
      });
      expect(result.decision_status).toBe('LOCAL_ACTIVE');
      expect(result.buyer_effective).toBe(true);
      expect(result.already_active).toBe(false);

      const row = await draftRow(productId);
      expect(row.status).toBe('LOCAL_ACTIVE');
      expect(row.active_at).not.toBeNull();
      expect(Number(row.amount)).toBe(15000);

      const events = await eventsFor(productId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: 'ACTIVATE',
        old_status: 'LOCAL_AUTHORIZED_PENDING_CUTOVER',
        new_status: 'LOCAL_ACTIVE',
      });
    });

    it('5 — IDEMPOTENCE : réactiver un prix déjà LOCAL_ACTIVE renvoie already_active, aucun nouvel événement', async () => {
      const { id: productId, productRef } = await seedProduct();
      await seedDraft(productId, { status: 'LOCAL_ACTIVE', amount: 15000 });

      const result = await activateMarketPriceDecision({
        market, productRef,
        activationSnapshot: { local_price: 15000, currency: 'KMF', activation_allowed: true },
        actorId,
      });
      expect(result.already_active).toBe(true);
      expect(result.decision_status).toBe('LOCAL_ACTIVE');

      const events = await eventsFor(productId);
      expect(events).toHaveLength(0); // aucun événement créé par ce second appel
    });

    it("6 — REFUS produit inactif ou introuvable", async () => {
      await expect(activateMarketPriceDecision({
        market, productRef: `${RUN_TAG}-never-existed`,
        activationSnapshot: { local_price: 15000, currency: 'KMF', activation_allowed: true },
        actorId,
      })).rejects.toMatchObject({ code: 'market_price_product_not_found' });
    });
  });
}
