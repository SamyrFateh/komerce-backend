/**
 * Hub L8 — A paid imported order never disappears when the purchasing trigger
 * cannot source its items. Read-model only: no order, PO, or money mutation.
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const { getDossier } = require('../../services/hub-procurement-dossier');

const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const marketId = id(1);
const orderId = id(2);

function makeReader(itemRows, needRows = []) {
  const queries = [];
  const client = {
    query: jest.fn(async (sql, parameters) => {
      queries.push({ sql, parameters });
      if (sql.includes('FROM orders o') &&
          sql.includes('JOIN order_items oi ON oi.order_id = o.id')) {
        return { rows: itemRows };
      }
      if (sql.includes('pl.purchase_order_id IS NULL') && sql.includes('AS api_eligible')) return { rows: needRows };
      return { rows: [] };
    }),
  };
  return { client, queries };
}

function item(rowId, { ordered, covered = 0, mapped = false } = {}) {
  return {
    order_id: orderId, order_ref: 'KRGNX5O', order_status: 'ordered',
    order_item_id: id(rowId), product_id: id(rowId + 100),
    sku_id: id(rowId + 200), product_name: 'Article ' + rowId,
    fulfillment_source: 'IMPORT', ordered,
    purchase_covered: covered, supplier_mapping_present: mapped,
  };
}

describe('Hub dossier — commandes import payées sans achats', () => {
  test('une commande payée à zéro ligne est un dossier actionnable et un KPI à traiter', async () => {
    const rows = [item(3, { ordered: 2 }), item(4, { ordered: 1 })];
    const { client, queries } = makeReader(rows);
    const dossier = await getDossier({ marketId }, client);

    expect(dossier.orders).toHaveLength(1);
    expect(dossier.orders[0].reference).toBe('KRGNX5O');
    expect(dossier.kpis.orders_waiting).toBe(1);
    expect(dossier.kpis.items_sourcing_required).toBe(2);
    expect(dossier.kpis.units_sourcing_required).toBe(3);
    expect(dossier.orders[0].items.map(i => i.purchasing_missing)).toEqual([2, 1]);
    expect(dossier.orders[0].items.map(i => i.sourcing_required)).toEqual([true, true]);
    expect(dossier.to_handle.filter(x => x.kind === 'ORDER_SOURCING_REQUIRED')).toHaveLength(2);
    expect(dossier.to_handle[0]).toMatchObject({
      order_ref: 'KRGNX5O', order_item_id: id(3), missing_quantity: 2,
      supplier_mapping_present: false,
    });
    expect(queries[0].sql).toContain('v_purchase_line_progress');
    expect(queries[0].sql).toContain('product_suppliers');
    expect(queries[0].parameters[0]).toBe(marketId);
  });

  test('ne signale que le reste à acheter, sans confondre achats couverts et réceptions', async () => {
    const rows = [
      item(3, { ordered: 2, covered: 1, mapped: true }),
      item(4, { ordered: 1, covered: 1, mapped: true }),
    ];
    const dossier = await getDossier({ marketId }, makeReader(rows).client);

    expect(dossier.kpis.orders_waiting).toBe(1);
    expect(dossier.kpis.items_sourcing_required).toBe(1);
    expect(dossier.kpis.units_sourcing_required).toBe(1);
    expect(dossier.to_handle.filter(x => x.kind === 'ORDER_SOURCING_REQUIRED'))
      .toEqual([expect.objectContaining({
        order_item_id: id(3), missing_quantity: 1, supplier_mapping_present: true,
      })]);
    expect(dossier.orders[0].items[1]).toMatchObject({
      purchasing_covered: 1, purchasing_missing: 0, sourcing_required: false,
    });
    expect(dossier.kpis.qty_missing).toBe(0); // non reçu ≠ non sourcé
  });

  test('une commande entièrement couverte ne génère pas de faux incident sourcing', async () => {
    const dossier = await getDossier({ marketId },
      makeReader([item(3, { ordered: 2, covered: 2, mapped: true })]).client);
    expect(dossier.kpis.orders_waiting).toBe(0);
    expect(dossier.kpis.items_sourcing_required).toBe(0);
    expect(dossier.kpis.units_sourcing_required).toBe(0);
    expect(dossier.to_handle).toHaveLength(0);
  });
});

test('Hub achats : canal API et devise proviennent de la projection fournisseur, pas du navigateur',async()=>{
 const authority=require('../../services/suppliers/provider-authority');
 const platform=['allegro','aliexpress','cj','noon','amazon_uae','local','whatsapp'].find(p=>
  authority.remotePreflightRequirement(p)===authority.PREFLIGHT_REQUIREMENT.REQUIRED);
 expect(platform).toBeTruthy();
 const row=item(3,{ordered:2,covered:2,mapped:true});
 const line={line_id:id(90),supplier_id:id(91),supplier_name:'Fournisseur test',supplier_platform:platform,
  procurement_hub_ref:'DXB',product_sku_id:row.sku_id,product_name:row.product_name,
  order_id:orderId,order_ref:row.order_ref,order_item_id:row.order_item_id,quantity:2,supplier_currency:'AED',api_eligible:true};
 const a=makeReader([row],[line]);
 const dossier=await getDossier({marketId},a.client);
 expect(dossier.cockpit.need_batches[0]).toMatchObject({api_available:true,groups:[{lines:[{line_id:line.line_id,supplier_currency:'AED',api_eligible:true}]}]});
 expect(a.queries.some(q=>q.sql.includes('pl.supplier_order_identity IS NOT NULL')&&q.parameters[0]===marketId)).toBe(true);
 const b=makeReader([row],[{...line,supplier_platform:'whatsapp',api_eligible:false,supplier_currency:null}]);
 const manual=await getDossier({marketId},b.client);
 expect(manual.cockpit.need_batches[0]).toMatchObject({api_available:false,groups:[{lines:[{api_eligible:false,supplier_currency:null}]}]});
});
