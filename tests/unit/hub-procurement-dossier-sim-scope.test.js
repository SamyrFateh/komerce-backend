/**
 * G6 - simulation fournisseur : le dossier Hub ordonne les lignes de PO en FIFO
 * (commande la plus ancienne, puis ligne) et ne marque une PO simulee que si
 * toutes ses commandes sont G6-BUYER. Meme ordre que g6SupplierSimulation.
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const { getDossier } = require('../../services/hub-procurement-dossier');

const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const poRow = (line, ref, scope, created) => ({
  po_id: id(50), status: 'notified', supplier_id: id(60), supplier_name: 'F', created_at: new Date('2026-11-01'),
  line_id: id(line), order_item_id: id(line + 100), order_id: id(line + 200), order_ref: ref,
  simulation_scope: scope, product_name: 'P', product_sku_id: id(9), ordered: 1, effective: 1, received: 0,
  trigger_mode: 'manual', supplier_unit_price: null, supplier_currency: null, order_created_at: new Date(created),
});

async function dossierFor(rows) {
  const queries = [];
  const q = { query: jest.fn(async (sql) => {
    queries.push(sql);
    if (sql.includes('FROM purchase_orders po') && sql.includes('JOIN suppliers s')) return { rows };
    return { rows: [] };
  }) };
  const d = await getDossier({ marketId: id(1) }, q);
  return { d, queries };
}

describe('dossier Hub - portee de simulation et ordre FIFO des lignes de PO', () => {
  it('requete PO ordonnee par commande la plus ancienne puis ligne', async () => {
    const { queries } = await dossierFor([]);
    expect(queries.some(s => /ORDER BY po\.created_at DESC, po\.id, o\.created_at, pl\.id/.test(s))).toBe(true);
  });
  it('PO simulee seulement si toutes les lignes sont G6-BUYER', async () => {
    const all = await dossierFor([poRow(1, 'KA', 'G6-BUYER', '2026-11-01'), poRow(2, 'KB', 'G6-BUYER', '2026-11-02')]);
    expect(all.d.purchase_orders[0].simulation_scope).toBe('G6-BUYER');
    const mixed = await dossierFor([poRow(1, 'KA', 'G6-BUYER', '2026-11-01'), poRow(2, 'KB', null, '2026-11-02')]);
    expect(mixed.d.purchase_orders[0].simulation_scope).toBeNull();
  });
});
