'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * Gouvernance → owner → mutation manuelle réelle → reimports → états SQL réels.
 * Reproduction DIAGNOSTIQUE sur PostgreSQL jetable dans CI seulement.
 * Aucune mutation d'environnement Railway, aucun appel fournisseur ou paiement.
 * Toute écriture test est dans une transaction annulée (ROLLBACK).
 */
const isolated = process.env.GITHUB_ACTIONS === 'true'
  && process.env.NODE_ENV === 'test'
  && process.env.KOMERCE_DISABLE_CRONS === 'true'
  && process.env.DATABASE_URL === 'postgresql://komerce:komerce@localhost:5432/komerce_test';

if (!isolated) {
  describe.skip('Gouvernance → réimport fournisseur : DB CI jetable requise', () => {
    test('No external database allowed', () => {});
  });
} else {
  const { randomUUID } = require('node:crypto');
  const fs = require('node:fs');
  const path = require('node:path');
  const db = require('../../db');
  const feature = require('../../features/sourcing.feature');
  const { upsertCandidateFromCatalogImport } = require('../../services/sourcing-candidate-import-service');
  const { updateCandidate } = require('../../services/sourcing-candidate-actions');
  const root = path.resolve(__dirname, '../..');
  jest.setTimeout(25000);

  function candidateInput(supplierName, margin, round) {
    return {
      importId: null,
      supplierName,
      product: {
        supplier_product_id: 'same-supplier-offer-1',
        product_name: 'Synthetic lamp / never publish',
        supplier_category: 'Maison',
        purchase_price: 20,
        currency: 'KMF',
        stock_available: 5,
        min_order_qty: 1,
        raw_payload: { supplier_round: round, purchase_price: 20, currency: 'KMF' },
      },
      normalized: {
        komerce_category: 'maison',
        purchase_price_kmf: 20,
        target_margin_pct: margin,
        data_sources: { target_margin: 'supplier', purchase_price: 'supplier' },
        confidence: 'high',
      },
      normalizedSourceContract: null,
      scan: {
        scan_result: { scored_target_margin_pct: margin, provider_round: round },
        sourcing_decision: 'WATCH',
        reason: 'synthetic-test-only',
        recommended_action: 'review',
        confidence: 'high',
      },
      verdict: { layer: 'none', label: 'Candidate only' },
      autoState: 'scanned',
      autoRejectedReason: null,
      userId: null,
    };
  }

  async function snapshot(client, id, label) {
    const { rows: [r] } = await client.query(
      `SELECT id, supplier_product_id, target_margin_pct, data_sources, scan_result,
              raw_payload, state
         FROM sourcing_candidates WHERE id = $1`, [id]
    );
    const { rows: events } = await client.query(
      `SELECT event_type, changes FROM sourcing_candidate_events
         WHERE candidate_id = $1 ORDER BY created_at, id`, [id]
    );
    return {
      label, id: String(r.id), margin: Number(r.target_margin_pct),
      marginProvenance: r.data_sources.target_margin,
      scanMargin: r.scan_result?.scored_target_margin_pct ?? null,
      supplierRound: r.raw_payload?.supplier_round ?? null,
      state: r.state, events: events.map(x=>({
        type: x.event_type, changes: x.changes,
      })),
    };
  }

  test('la gouvernance identifie le propriétaire de la table et la couture d import', () => {
    expect(feature.name).toBe('sourcing');
    expect(feature.db.tables).toContain('sourcing_candidates: RW!');
    expect(feature.db.tables).toContain('sourcing_candidate_events: RW!');
    expect(feature.contract.internalApi).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fn: 'upsertCandidateFromCatalogImport',
        file: 'services/sourcing-candidate-import-service.js',
      }),
    ]));
    const src = fs.readFileSync(path.join(root, 'services/sourcing-candidate-import-service.js'), 'utf8');
    expect(src).toMatch(/@role\s+sourcing-candidate-import-owner/);
    expect(src).toMatch(/@domain\s+sourcing/);
    expect(src).toMatch(/@db-write\s+sourcing_candidates, sourcing_candidate_events/);
    expect(src).toContain('ON CONFLICT (supplier_name, supplier_product_id)');
  });

  test('cas positif témoin : sans intervention manuelle, le prix de marge fournisseur est actualisé', async () => {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const supplier = 'GOV-POC-NORMAL-' + randomUUID();
      const first = await upsertCandidateFromCatalogImport(client, candidateInput(supplier, 30, 1));
      const last = await upsertCandidateFromCatalogImport(client, candidateInput(supplier, 32, 2));
      const row = await snapshot(client, last.row.id, 'normal-reimport');
      expect(last.row.id).toBe(first.row.id);
      expect(row).toMatchObject({
        margin: 32, marginProvenance: 'supplier', scanMargin: 32,
        supplierRound: 2, state: 'scanned',
      });
      console.log('GOV_POC_CONTROL', JSON.stringify(row));
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  test('contre-exemple réel : une correction manuelle se perd après DEUX réimports', async () => {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const supplier = 'GOV-POC-MANUAL-' + randomUUID();
      const initial = await upsertCandidateFromCatalogImport(client, candidateInput(supplier, 30, 1));
      const id = initial.row.id;
      const before = await snapshot(client, id, 'supplier_initial');
      await updateCandidate(id, { target_margin_pct: 55 }, null, client);
      const manual = await snapshot(client, id, 'human_override');

      const reimport1 = await upsertCandidateFromCatalogImport(client, candidateInput(supplier, 32, 2));
      const afterFirst = await snapshot(client, id, 'first_reimport');

      const reimport2 = await upsertCandidateFromCatalogImport(client, candidateInput(supplier, 33, 3));
      const afterSecond = await snapshot(client, id, 'second_reimport');

      expect(reimport1.row.id).toBe(id);
      expect(reimport2.row.id).toBe(id);
      expect(before).toMatchObject({ margin: 30, marginProvenance: 'supplier' });
      expect(manual).toMatchObject({ margin: 55, marginProvenance: 'manual' });
      // Diagnostic : code actuel conservait bien 55 au premier replay, mais
      // écrase la provenance et perd la décision humaine au second.
      expect(afterFirst).toMatchObject({
        margin: 55, marginProvenance: 'supplier', scanMargin: 32,
        supplierRound: 2, state: 'scanned',
      });
      expect(afterSecond).toMatchObject({
        margin: 33, marginProvenance: 'supplier', scanMargin: 33,
        supplierRound: 3, state: 'scanned',
      });
      // Exige que le fournisseur livre encore sa donnée fraîche en raw_payload ;
      // la protection humaine ne doit jamais geler cette preuve brute.
      expect(afterFirst.events.some(e=>e.type==='data_correction')).toBe(true);
      console.log('GOV_POC_COUNTEREXAMPLE', JSON.stringify({
        before, manual, afterFirst, afterSecond,
        desired: {margin:55,marginProvenance:'manual',rawRound:3},
        actual: {margin:afterSecond.margin,marginProvenance:afterSecond.marginProvenance},
        invariantBroken:afterSecond.margin!==55,
      }));
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  afterAll(async () => db.pool.end());
}
