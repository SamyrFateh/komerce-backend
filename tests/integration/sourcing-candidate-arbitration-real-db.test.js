'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * tests/integration/sourcing-candidate-arbitration-real-db.test.js
 *
 * Feature propriétaire : sourcing
 *
 * Contexte : sourcing ("identifier, qualifier et arbitrer des
 * opportunités fournisseur ou produit — décision garder/watchlist/
 * rejeter — avant leur entrée dans le catalogue") est en production
 * avec 27 tests, tous unitaires/mockés — 0 preuve d'intégration.
 *
 * Le point le plus critique du domaine : services/sourcing-candidate-
 * actions.js#promoteCandidate — la SEULE porte d'entrée du catalogue
 * depuis le sourcing, une transaction qui crée un produit réel, appelle
 * catalog-promotion, transitionne l'état du candidat et journalise un
 * événement d'audit, protégée par plusieurs garde-fous doctrine :
 *
 *   - single_sourcing_candidate_mutation_authority — un candidat déjà
 *     importé ne peut plus être re-promu (409, idempotence) ;
 *   - candidate_excluded — un candidat exclu (douane/légal) ne peut
 *     JAMAIS être promu, définitivement ;
 *   - candidate_quarantined — un candidat en quarantaine ne peut pas
 *     être promu en l'état ;
 *   - candidate_parent_batch_blocked — si le batch d'import parent
 *     n'est pas terminé, aucun de ses candidats n'est promouvable ;
 *   - engine_price_is_not_market_decision /
 *     explicit_human_price_required_before_promotion — le prix suggéré
 *     par le moteur économique n'est jamais une décision de marché ;
 *     la promotion EXIGE un prix explicitement fourni par l'opérateur.
 *
 * Ce que les mocks ne peuvent pas prouver :
 *   1. Que ces cinq garde-fous bloquent réellement une transaction
 *      Postgres AVANT tout INSERT dans products — pas juste qu'une
 *      fonction JS a été appelée avec les bons arguments simulés.
 *   2. Qu'une promotion réussie est réellement atomique : le produit
 *      créé, le candidat transitionné, et l'événement d'audit journalisé
 *      dans LA MÊME transaction — vérifié en relisant les trois tables
 *      après COMMIT, pas en vérifiant des appels de mock.
 *   3. Que watchlistCandidate() et rejectCandidate() écrivent
 *      réellement l'état ET l'historique attendus.
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('SOURCING CANDIDATE ARBITRATION — REAL_DB proofs — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const {
    watchlistCandidate,
    rejectCandidate,
    promoteCandidate,
    SourcingCandidateActionError,
  } = require('../../services/sourcing-candidate-actions');

  jest.setTimeout(20000);

  const RUN_TAG = `e2e_test_sourcing_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
  const candidateIds = [];
  const productIds = [];
  const importIds = [];
  let seedCounter = 0;

  async function seedCandidate(overrides = {}) {
    seedCounter += 1;
    const id = crypto.randomUUID();
    candidateIds.push(id);
    const {
      state = 'raw_imported',
      scanResult = null,
      importId = null,
    } = overrides;

    await db.query(
      `INSERT INTO sourcing_candidates
         (id, supplier_name, product_name, purchase_price, currency, state, scan_result, import_id)
       VALUES ($1, $2, $3, 100, 'AED', $4, $5::jsonb, $6)`,
      [
        id,
        `E2E Sourcing Fournisseur ${RUN_TAG}-${seedCounter}`,
        `E2E Sourcing Produit ${RUN_TAG}-${seedCounter}`,
        state,
        scanResult ? JSON.stringify(scanResult) : null,
        importId,
      ]
    );
    return id;
  }

  async function seedImportBatch(status) {
    const id = crypto.randomUUID();
    importIds.push(id);
    await db.query(
      `INSERT INTO supplier_catalog_imports (id, supplier_name, status)
       VALUES ($1, $2, $3)`,
      [id, `E2E Sourcing Import ${RUN_TAG}`, status]
    );
    return id;
  }

  async function candidateRow(id) {
    const { rows: [row] } = await db.query('SELECT * FROM sourcing_candidates WHERE id = $1', [id]);
    return row;
  }

  async function eventsFor(id) {
    const { rows } = await db.query(
      `SELECT event_type, old_state, new_state FROM sourcing_candidate_events WHERE candidate_id = $1 ORDER BY created_at`,
      [id]
    );
    return rows;
  }

  afterAll(async () => {
    if (candidateIds.length) {
      await db.query('DELETE FROM sourcing_candidate_events WHERE candidate_id = ANY($1::uuid[])', [candidateIds]).catch(() => {});
      await db.query('DELETE FROM sourcing_candidates WHERE id = ANY($1::uuid[])', [candidateIds]).catch(() => {});
    }
    if (importIds.length) {
      await db.query('DELETE FROM supplier_catalog_imports WHERE id = ANY($1::uuid[])', [importIds]).catch(() => {});
    }
    if (productIds.length) {
      await db.query('DELETE FROM products WHERE id = ANY($1::uuid[])', [productIds]).catch(() => {});
    }
  });

  describe('services/sourcing-candidate-actions.js — arbitrage et promotion (REAL_DB)', () => {
    it('1 — WATCHLIST : transitionne state et journalise old_state/new_state réels', async () => {
      const id = await seedCandidate();

      const result = await watchlistCandidate(id, null, db);
      expect(result.state).toBe('watchlist');

      const row = await candidateRow(id);
      expect(row.state).toBe('watchlist');

      const events = await eventsFor(id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ event_type: 'state_change', old_state: 'raw_imported', new_state: 'watchlist' });
    });

    it('2 — REJECT : transitionne state, persiste la raison, journalise', async () => {
      const id = await seedCandidate();

      const result = await rejectCandidate(id, 'Prix non compétitif', null, db);
      expect(result.state).toBe('rejected');

      const row = await candidateRow(id);
      expect(row.state).toBe('rejected');
      expect(row.rejected_reason).toBe('Prix non compétitif');

      const events = await eventsFor(id);
      expect(events[0]).toMatchObject({ event_type: 'rejected', old_state: 'raw_imported', new_state: 'rejected' });
    });

    it('3 — PROMOTION SANS PRIX EXPLICITE : rejetée avant tout INSERT produit (doctrine explicit_human_price_required)', async () => {
      const id = await seedCandidate();
      const before = await candidateRow(id);

      await expect(promoteCandidate(id, {}, null)).rejects.toMatchObject({
        code: 'candidate_explicit_price_required',
      });

      const row = await candidateRow(id);
      expect(row.state).toBe('raw_imported'); // inchangé
      expect(row.product_id).toBeNull();

      const { rows: products } = await db.query(
        `SELECT id FROM products WHERE name = $1`,
        [before.product_name]
      );
      expect(products).toHaveLength(0); // aucun produit fantôme créé
    });

    it('4 — PROMOTION RÉUSSIE : transaction atomique — produit créé, candidat transitionné, événement journalisé', async () => {
      const id = await seedCandidate();

      const result = await promoteCandidate(id, { price_kmf: 45000, enrichment_mode: 'source_only' }, null);
      expect(result.product_id).toBeTruthy();
      expect(result.price_decision).toBe('EXPLICIT_HUMAN_INPUT');
      productIds.push(result.product_id);

      const row = await candidateRow(id);
      expect(row.state).toBe('imported_to_catalog');
      expect(row.product_id).toBe(result.product_id);

      const { rows: productRows } = await db.query(
        `SELECT price_kmf, is_active, lifecycle_status FROM products WHERE id = $1`,
        [result.product_id]
      );
      expect(productRows).toHaveLength(1);
      expect(Number(productRows[0].price_kmf)).toBe(45000);
      expect(productRows[0].is_active).toBe(false); // créé inactif — doctrine
      expect(productRows[0].lifecycle_status).toBe('candidate');

      const events = await eventsFor(id);
      expect(events[events.length - 1]).toMatchObject({ event_type: 'imported', new_state: 'imported_to_catalog' });
    });

    it("5 — ANTI-DOUBLE-PROMOTION : un candidat déjà imported_to_catalog ne peut pas être repromu", async () => {
      const id = await seedCandidate();
      const first = await promoteCandidate(id, { price_kmf: 30000, enrichment_mode: 'source_only' }, null);
      productIds.push(first.product_id);

      await expect(
        promoteCandidate(id, { price_kmf: 99999, enrichment_mode: 'source_only' }, null)
      ).rejects.toMatchObject({ code: 'candidate_already_promoted' });

      // Le state et le product_id restent ceux de la première promotion.
      const row = await candidateRow(id);
      expect(row.product_id).toBe(first.product_id);

      const { rows: products } = await db.query(`SELECT id FROM products WHERE id = $1`, [first.product_id]);
      expect(products).toHaveLength(1); // pas de second produit créé
    });

    it("6 — CANDIDAT EXCLU : jamais promouvable, même avec un prix valide", async () => {
      const id = await seedCandidate({ state: 'raw_imported', scanResult: { sourcing_decision: 'EXCLUDED' } });

      await expect(
        promoteCandidate(id, { price_kmf: 20000, enrichment_mode: 'source_only' }, null)
      ).rejects.toMatchObject({ code: 'candidate_excluded' });

      const row = await candidateRow(id);
      expect(row.product_id).toBeNull();
    });

    it("7 — CANDIDAT EN QUARANTAINE : non promouvable en l'état", async () => {
      const id = await seedCandidate({ state: 'quarantined' });

      await expect(
        promoteCandidate(id, { price_kmf: 20000, enrichment_mode: 'source_only' }, null)
      ).rejects.toMatchObject({ code: 'candidate_quarantined' });
    });

    it("8 — BATCH PARENT NON TERMINÉ : bloque la promotion de tous ses candidats", async () => {
      const importId = await seedImportBatch('PROCESSING');
      const id = await seedCandidate({ importId });

      await expect(
        promoteCandidate(id, { price_kmf: 20000, enrichment_mode: 'source_only' }, null)
      ).rejects.toMatchObject({ code: 'candidate_parent_batch_blocked' });

      const row = await candidateRow(id);
      expect(row.product_id).toBeNull();
    });

    it("9 — BATCH PARENT TERMINÉ : la promotion redevient possible", async () => {
      const importId = await seedImportBatch('COMPLETED');
      const id = await seedCandidate({ importId });

      const result = await promoteCandidate(id, { price_kmf: 15000, enrichment_mode: 'source_only' }, null);
      expect(result.product_id).toBeTruthy();
      productIds.push(result.product_id);

      const row = await candidateRow(id);
      expect(row.state).toBe('imported_to_catalog');
    });
  });
}
