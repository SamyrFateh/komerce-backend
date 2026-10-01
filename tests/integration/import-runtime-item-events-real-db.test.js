'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * Preuve REAL_DB de la télémétrie par produit d'un run d'import
 * (migration 258 + services/import-runtime-item-events.js + projection du run).
 * Même garde `DATABASE_URL` que les autres preuves REAL_DB : ignoré sans base.
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('IMPORT RUNTIME ITEM EVENTS — REAL_DB — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const db = require('../../db');
  const itemEvents = require('../../services/import-runtime-item-events');
  const runs = require('../../services/import-runtime-runs');

  jest.setTimeout(30000);

  const created = { runIds: [], importIds: [], candidateIds: [] };

  async function newRun({ withImport = false } = {}) {
    let importId = null;
    if (withImport) {
      const { rows: [imp] } = await db.query(
        `INSERT INTO supplier_catalog_imports (supplier_name) VALUES ('RealDbProof') RETURNING id`
      );
      importId = imp.id;
      created.importIds.push(importId);
    }
    const { rows: [run] } = await db.query(
      `INSERT INTO import_runtime_runs (provider, source_type, mode, import_id, source_total, status)
       VALUES ('RealDbProof', 'api', 'normal', $1, 3, 'RUNNING') RETURNING id, run_ref`,
      [importId]
    );
    created.runIds.push(run.id);
    return { ...run, importId };
  }

  async function newCandidate(importId, ref, name) {
    const { rows: [c] } = await db.query(
      `INSERT INTO sourcing_candidates
         (import_id, supplier_name, supplier_product_id, product_name, purchase_price, currency, state, scan_at)
       VALUES ($1, 'RealDbProof', $2, $3, 179.99, 'EUR', 'scanned', NOW()) RETURNING id`,
      [importId, ref, name]
    );
    created.candidateIds.push(c.id);
    return c.id;
  }

  afterAll(async () => {
    if (created.runIds.length) await db.query('DELETE FROM import_runtime_runs WHERE id = ANY($1::uuid[])', [created.runIds]).catch(() => {});
    if (created.candidateIds.length) await db.query('DELETE FROM sourcing_candidates WHERE id = ANY($1::uuid[])', [created.candidateIds]).catch(() => {});
    if (created.importIds.length) await db.query('DELETE FROM supplier_catalog_imports WHERE id = ANY($1::uuid[])', [created.importIds]).catch(() => {});
  });

  describe('import_runtime_item_events — cycle de vie', () => {
    it('start → finish → list : ordre décroissant, durée positive, issue enregistrée', async () => {
      const run = await newRun();
      const a = await itemEvents.startItem(run.id, { seq: 1, product: { supplier_product_id: 'P1', product_name: 'Un', purchase_price: 10, currency: 'EUR' } });
      await itemEvents.finishItem(a.id, { outcome: 'ready_for_refinery', changeKind: 'updated' });
      await itemEvents.startItem(run.id, { seq: 2, product: { supplier_product_id: 'P2', product_name: 'Deux' } });

      const rows = await itemEvents.listRunItems(run.id);
      expect(rows.map((r) => r.seq)).toEqual([2, 1]);
      expect(rows[0].finished_at).toBeNull();
      expect(rows[1].outcome).toBe('ready_for_refinery');
      expect(rows[1].change_kind).toBe('updated');
      expect(rows[0].change_kind).toBeNull();
      expect(new Date(rows[1].finished_at) - new Date(rows[1].started_at)).toBeGreaterThanOrEqual(0);
      expect(Number(rows[1].purchase_price)).toBe(10);
    });

    it('un seq déjà pris ne casse pas la boucle : conflit ignoré (null), pas d’exception', async () => {
      const run = await newRun();
      const first = await itemEvents.startItem(run.id, { seq: 1, product: { product_name: 'A' } });
      const second = await itemEvents.startItem(run.id, { seq: 1, product: { product_name: 'B' } });
      expect(first.id).toBeTruthy();
      expect(second).toBeNull();
      expect((await itemEvents.listRunItems(run.id))).toHaveLength(1);
    });

    it('supprimer le run supprime ses événements ; supprimer un candidat garde l’événement', async () => {
      const run = await newRun({ withImport: true });
      const candidateId = await newCandidate(run.importId, 'P9', 'Neuf');
      const ev = await itemEvents.startItem(run.id, { seq: 1, product: { supplier_product_id: 'P9', product_name: 'Neuf' } });
      await itemEvents.finishItem(ev.id, { outcome: 'ready_for_refinery', candidateId });

      await db.query('DELETE FROM sourcing_candidates WHERE id = $1', [candidateId]);
      const kept = await itemEvents.listRunItems(run.id);
      expect(kept).toHaveLength(1);

      await db.query('DELETE FROM import_runtime_runs WHERE id = $1', [run.id]);
      const { rows } = await db.query('SELECT 1 FROM import_runtime_item_events WHERE run_id = $1', [run.id]);
      expect(rows).toHaveLength(0);
    });
  });

  describe('projection du run avec événements par produit', () => {
    it('un ré-import du même candidat ne vide jamais la population d’un ancien KIR', async () => {
      const firstRun = await newRun({ withImport: true });
      const candidateId = await newCandidate(firstRun.importId, 'STABLE-1', 'Produit historique');
      const firstEvent = await itemEvents.startItem(firstRun.id, {
        seq: 1,
        product: { supplier_product_id: 'STABLE-1', product_name: 'Produit historique' },
      });
      await itemEvents.finishItem(firstEvent.id, {
        outcome: 'ready_for_refinery',
        candidateId,
        changeKind: 'created',
      });

      expect(await runs._loadRows(firstRun.id)).toHaveLength(1);

      const secondRun = await newRun({ withImport: true });
      await db.query(
        `UPDATE sourcing_candidates
            SET import_id = $1,
                product_name = 'Produit ré-observé',
                updated_at = NOW()
          WHERE id = $2`,
        [secondRun.importId, candidateId]
      );
      const secondEvent = await itemEvents.startItem(secondRun.id, {
        seq: 1,
        product: { supplier_product_id: 'STABLE-1', product_name: 'Produit ré-observé' },
      });
      await itemEvents.finishItem(secondEvent.id, {
        outcome: 'ready_for_refinery',
        candidateId,
        changeKind: 'updated',
      });

      const [oldRows, newRows] = await Promise.all([
        runs._loadRows(firstRun.id),
        runs._loadRows(secondRun.id),
      ]);
      expect(oldRows).toHaveLength(1);
      expect(newRows).toHaveLength(1);
      expect(oldRows[0].supplier_product_id).toBe('STABLE-1');
      expect(newRows[0].supplier_product_id).toBe('STABLE-1');
    });

    it('produit en cours réel + durée + prix + fil produit ; les anciens runs gardent le repli', async () => {
      const run = await newRun({ withImport: true });
      await newCandidate(run.importId, 'P1', 'Tefal OptiGrill+ XL');
      const done = await itemEvents.startItem(run.id, { seq: 1, product: { supplier_product_id: 'P1', product_name: 'Tefal OptiGrill+ XL', purchase_price: 179.99, currency: 'EUR' } });
      await itemEvents.finishItem(done.id, { outcome: 'ready_for_refinery' });
      await itemEvents.startItem(run.id, { seq: 2, product: { supplier_product_id: 'P2', product_name: 'Krups EA8', purchase_price: 420, currency: 'EUR' } });

      const live = await runs.getRun(run.run_ref);
      expect(live.item_events).toBe(true);
      expect(live.current_item_kind).toBe('in_progress');
      expect(live.current_item).toMatchObject({ seq: 2, product_name: 'Krups EA8', in_progress: true, purchase_price: 420, currency: 'EUR' });
      const first = live.recent_items.find((i) => i.seq === 1);
      expect(first).toMatchObject({ product_name: 'Tefal OptiGrill+ XL', in_progress: false, purchase_price: 179.99 });
      expect(first.duration_ms).toBeGreaterThanOrEqual(0);
      expect(live.events.some((e) => e.kind === 'ITEM_FINISHED' && e.product_name === 'Tefal OptiGrill+ XL')).toBe(true);

      const legacy = await newRun({ withImport: true });
      await newCandidate(legacy.importId, 'L1', 'Ancien produit');
      const old = await runs.getRun(legacy.run_ref);
      expect(old.item_events).toBe(false);
      expect(old.current_item_kind).toBe('last_updated');
      expect(old.current_item.product_name).toBe('Ancien produit');
      expect(old.current_item.purchase_price).toBe(179.99);
    });
  });
}
