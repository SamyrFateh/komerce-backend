'use strict';
/** @test-kind unit @test-runner jest @test-requires none
 * HB-02 : l'exception de rupture terminale exige toujours la preuve physique
 * et l'incident ; aucun contournement de la préparation sans vraie réception.
 */
const { getOrderPhysicalCoverage } = require('../../services/order-physical-coverage-service');

const ORDER = '00000000-0000-4000-8000-000000000001';
const ITEM = '00000000-0000-4000-8000-000000000002';

function executor(physical, exceptions = []) {
  return {
    query: jest.fn()
      .mockResolvedValueOnce({ rows: physical })
      .mockResolvedValueOnce({ rows: exceptions }),
  };
}

test('commande intégralement reçue : couverture normale, sans recherche d exception', async () => {
  const q = executor([{ order_item_id: ITEM, needed: 2, usable: 2 }]);
  const r = await getOrderPhysicalCoverage(q, ORDER);
  expect(r.covered).toBe(true);
  expect(r.uncovered).toHaveLength(0);
  expect(q.query).toHaveBeenCalledTimes(1);
});

test('réception 1/2 sans incident admissible : reste bloquée', async () => {
  const q = executor([{ order_item_id: ITEM, needed: 2, usable: 1 }]);
  const r = await getOrderPhysicalCoverage(q, ORDER);
  expect(r.covered).toBe(false);
  expect(r.uncovered).toMatchObject([{ needed: 2, usable: 1, missing: 1 }]);
  const sql = q.query.mock.calls[1][0];
  expect(sql).toContain("pl.settled_at IS NOT NULL");
  expect(sql).toContain("supplier_shortage");
  expect(sql).toContain("remnant.parent_line_id=pl.id");
  expect(sql).toContain("v.received_qty >= v.effective_qty");
});

test('rupture terminale prouvée 1/2 : le reçu 1 est le besoin physique, le manque est tracé', async () => {
  const q = executor(
    [{ order_item_id: ITEM, needed: 2, usable: 1 }],
    [{ order_item_id: ITEM, effective_qty: 1 }]
  );
  const r = await getOrderPhysicalCoverage(q, ORDER);
  expect(r.covered).toBe(true);
  expect(r.uncovered).toHaveLength(0);
  expect(r.lines[0]).toMatchObject({
    needed: 1, usable: 1, original_needed: 2, terminal_supplier_shortage: 1, missing: 0,
  });
});

test('sans quantité physique reçue, même une rupture ne crée pas de marchandise', async () => {
  const q = executor([{ order_item_id: ITEM, needed: 2, usable: 0 }]);
  const r = await getOrderPhysicalCoverage(q, ORDER);
  expect(r.covered).toBe(false);
  expect(r.uncovered[0].missing).toBe(2);
});

test('plusieurs lignes : exception ciblée ne dispense pas un second article non reçu', async () => {
  const OTHER = '00000000-0000-4000-8000-000000000003';
  const q = executor(
    [{ order_item_id: ITEM, needed: 2, usable: 1 }, { order_item_id: OTHER, needed: 3, usable: 0 }],
    [{ order_item_id: ITEM, effective_qty: 1 }]
  );
  const r = await getOrderPhysicalCoverage(q, ORDER);
  expect(r.covered).toBe(false);
  expect(r.uncovered).toMatchObject([{ order_item_id: OTHER, missing: 3 }]);
});
