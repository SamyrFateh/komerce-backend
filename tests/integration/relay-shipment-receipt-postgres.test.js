'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration relay-shipment-receipt-postgres.test.js
 * @brief HUB lot 3 — Relais live : contenu réellement expédié (expédition → KOM-BOX → commandes → articles), réception attestée par le relais article par article, écart → incident, étape relay_received jamais posée par Hub/admin.
 */

jest.setTimeout(60000);

if (!process.env.DATABASE_URL) {
  describe.skip('relay-shipment-receipt (needs DATABASE_URL)', () => { test('skipped', () => {}); });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const relay = require('../../services/relay-shipment-receipt');
  const journey = require('../../services/international-shipment-journey');

  const id = () => crypto.randomUUID();
  const q = (sql, params) => db.query(sql, params);
  const tag = `RSR-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  let km; let market; let admin; let relaisA; let relaisB; let agentA; let agentB; let shipmentId; let ref;
  const items = {};

  async function fixture(fn) {
    const client = await db.getClient();
    try { await client.query("SET session_replication_role='replica'"); await fn(client); }
    finally { await client.query("SET session_replication_role='origin'"); client.release(); }
  }

  async function makeOrderWithItem(label, relais, qty) {
    const orderId = id(); const itemId = id(); const productId = id(); const skuId = id(); const supplier = id(); const allocId = id();
    await q(`INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur)
             VALUES($1,$2,$3,$4,$5,'ordered','paid','stripe_eur',10000,20)`, [orderId, admin, relais, km, `${tag}-${label}`]);
    await q(`INSERT INTO products(id,name,price_kmf,cost_kmf,volume_cm3,stock,price_aed,inventory_model) VALUES($1,$2,10000,3000,1000,0,100,'SKU')`, [productId, `Prod ${label} ${tag}`]);
    await q("INSERT INTO suppliers(id,name,platform,is_active) VALUES($1,$2,'local',true)", [supplier, `S ${label} ${tag}`]);
    const identity = { provider: 'local', version: 1, payload: { supplier_sku: `${tag}-${label}` } };
    await q(`INSERT INTO product_skus(id,product_id,sku,stock,is_active,source,supplier_sku,supplier_unit_ref,supplier_order_identity)
             VALUES($1,$2,$3,0,true,'SUPPLIER',$4,$5,$6::jsonb)`, [skuId, productId, `${tag}-SKU-${label}`, `${tag}-${label}`, `${tag}-${label}-U`, JSON.stringify(identity)]);
    await q(`INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,sku_id,fulfillment_source) VALUES($1,$2,$3,$4,10000,$5,'IMPORT')`, [itemId, orderId, productId, qty, skuId]);
    const poId = id();
    await fixture(async (c) => {
      await c.query(`INSERT INTO purchase_orders(id,order_id,supplier_id,status,trigger_mode,procurement_hub_ref,market_id,qty,supplier_sku)
                     VALUES($1,NULL,$2,'hub_received','manual','DXB',$3,NULL,NULL)`, [poId, supplier, km]);
      await c.query(`INSERT INTO hub_purchase_allocations(id,purchase_order_id,order_id,order_item_id,product_sku_id,supplier_id,supplier_unit_ref,supplier_order_identity,quantity,market_id,destination_ref)
                     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,'KM')`, [allocId, poId, orderId, itemId, skuId, supplier, `${tag}-${label}-U`, JSON.stringify(identity), qty, km]);
    });
    return { orderId, itemId, allocId, productId };
  }

  beforeAll(async () => {
    km = (await q("SELECT id FROM markets WHERE code='KM'")).rows[0].id;
    market = { id: km, code: 'KM' };
    admin = id();
    await q("INSERT INTO users(id,full_name,email,phone,role) VALUES($1,'RSR Admin',$2,$3,'admin')", [admin, `${tag.toLowerCase()}@komerce.test`, `+2693${String(Date.now()).slice(-7)}`]);
    relaisA = id(); relaisB = id();
    await q("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'A','+2693000011','R',$3)", [relaisA, `RA-${tag}`, km]);
    await q("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'B','+2693000012','R',$3)", [relaisB, `RB-${tag}`, km]);
    agentA = { id: admin, role: 'agent_relais', relais_id: relaisA };
    agentB = { id: admin, role: 'agent_relais', relais_id: relaisB };
    items.a = await makeOrderWithItem('A', relaisA, 4);
    items.b = await makeOrderWithItem('B', relaisB, 2);
    shipmentId = id(); ref = `${tag}-SHIP`;
    await q(`INSERT INTO international_shipments(id,market_id,reference,forwarder_name,transport_mode,stage,created_by)
             VALUES($1,$2,$3,'Transitaire','sea','local_delivery',$4)`, [shipmentId, km, ref, admin]);
    const box = id();
    await fixture(async (c) => {
      await c.query(`INSERT INTO hub_physical_units(id,reference,unit_type,state,market_id) VALUES($1,$2,'MARKET_PARCEL','DISPATCHED',$3)`, [box, `${tag}-BOX`, km]);
      // A : 3 expédiés sur 4 commandés (reliquat 1) ; B : 2 sur 2.
      await c.query('INSERT INTO hub_physical_unit_placements(physical_unit_id,allocation_id,quantity,operation_type) VALUES($1,$2,3,$3)', [box, items.a.allocId, 'REPACK']);
      await c.query('INSERT INTO hub_physical_unit_placements(physical_unit_id,allocation_id,quantity,operation_type) VALUES($1,$2,2,$3)', [box, items.b.allocId, 'REPACK']);

      await c.query('INSERT INTO international_shipment_hub_units(shipment_id,physical_unit_id) VALUES($1,$2)', [shipmentId, box]);
      // Réceptions fournisseur distinctes des REPACK dans KOM-BOX : matérialité complète.
      const inbound = id();
      await c.query(`INSERT INTO hub_physical_units(id,reference,unit_type,state,market_id)
                     VALUES($1,$2,'SUPPLIER_PACKAGE','RECEIVED',$3)`, [inbound, `${tag}-IN`, km]);
      await c.query('INSERT INTO hub_physical_unit_placements(physical_unit_id,allocation_id,quantity,operation_type) VALUES($1,$2,3,$3)', [inbound, items.a.allocId, 'RECEIVE']);
      await c.query('INSERT INTO hub_physical_unit_placements(physical_unit_id,allocation_id,quantity,operation_type) VALUES($1,$2,2,$3)', [inbound, items.b.allocId, 'RECEIVE']);
    });
    // Colis clients distincts de la KOM-BOX ; le trigger 363 les alimente depuis les preuves du Hub.
    for (const [key, count] of [['a', 4], ['b', 2]]) {
      const source = items[key];
      const parcelId = id();
      await q(`INSERT INTO parcels(id,order_id,reference,type,status,relais_id)
               VALUES($1,$2,$3,'standard','preparation',$4)`,
        [parcelId, source.orderId, `${tag}-CLIENT-${key}`, key === 'a' ? relaisA : relaisB]);
      await q(`INSERT INTO parcel_items(id,parcel_id,order_item_id,product_id,quantity)
               VALUES($1,$2,$3,$4,$5)`, [id(), parcelId, source.itemId, source.productId, count]);
    }
  });
  afterAll(async () => { await db.pool.end().catch(() => {}); });

  test('lecture : expédition → KOM-BOX → commandes → articles avec attendu, manquant, reçu (non attesté), remis ; filtrée par relais', async () => {
    const all = await relay.listRelayShipments({ market });
    const ship = all.shipments.find((s) => s.reference === ref);
    expect(ship.receivable).toBe(true);
    expect(ship.boxes).toHaveLength(1);
    const flat = ship.boxes[0].orders.flatMap((o) => o.items);
    const a = flat.find((i) => i.order_item_id === items.a.itemId);
    expect(a).toMatchObject({ ordered: 4, expected: 3, shipped: 3, missing: 1, received: null, handed: 0 });
    const mine = await relay.listRelayShipments({ market, relaisId: relaisB });
    const only = mine.shipments.find((s) => s.reference === ref).boxes[0].orders;
    expect(only).toHaveLength(1);
    expect(only[0].items[0].order_item_id).toBe(items.b.itemId);
  });

  test('ni admin ni Hub ne posent relay_received', async () => {
    await expect(journey.transition(market, { id: admin, role: 'admin' }, ref, { to_stage: 'relay_received', proof_ref: 'X' }))
      .rejects.toMatchObject({ status: 409, code: 'JOURNEY_RELAY_ATTESTATION_REQUIRED' });
    await expect(relay.receiveShipment({ market, actor: { id: admin, role: 'admin', relais_id: relaisA }, reference: ref, body: { proof_ref: 'P', lines: [{ order_item_id: items.a.itemId, received_qty: 3 }] } }))
      .rejects.toMatchObject({ status: 403, code: 'RELAY_RECEIPT_ROLE_FORBIDDEN' });
    expect((await q('SELECT stage FROM international_shipments WHERE id=$1', [shipmentId])).rows[0].stage).toBe('local_delivery');
  });

  test('un relais ne peut attester que ses propres articles ; sans preuve ou quantité invalide : refusé', async () => {
    await expect(relay.receiveShipment({ market, actor: agentA, reference: ref, body: { proof_ref: 'P', lines: [{ order_item_id: items.b.itemId, received_qty: 2 }] } }))
      .rejects.toMatchObject({ status: 409, code: 'RELAY_RECEIPT_ITEM_NOT_EXPECTED' });
    await expect(relay.receiveShipment({ market, actor: agentA, reference: ref, body: { lines: [{ order_item_id: items.a.itemId, received_qty: 3 }] } }))
      .rejects.toMatchObject({ status: 400, code: 'RELAY_RECEIPT_PROOF_REQUIRED' });
    await expect(relay.receiveShipment({ market, actor: agentA, reference: ref, body: { proof_ref: 'P', lines: [{ order_item_id: items.a.itemId, received_qty: -1 }] } }))
      .rejects.toMatchObject({ status: 400 });
    // #3900 R6 : reçu > expédié refusé côté serveur, aucune attestation écrite.
    await expect(relay.receiveShipment({ market, actor: agentA, reference: ref, body: { proof_ref: 'P', lines: [{ order_item_id: items.a.itemId, received_qty: 4 }] } }))
      .rejects.toMatchObject({ status: 409, code: 'RELAY_RECEIPT_EXCEEDS_SHIPPED' });
  });

  test('réception avec écart : attestation immuable + incident traçable ; l\'expédition n\'est pas reçue tant qu\'un relais n\'a pas attesté', async () => {
    const out = await relay.receiveShipment({ market, actor: agentA, reference: ref, body: { proof_ref: 'BORD-A', lines: [{ order_item_id: items.a.itemId, received_qty: 2 }] } });
    expect(out.complete).toBe(false);
    expect(out.stage).toBe('local_delivery');
    expect(out.receipts[0]).toMatchObject({ expected: 3, received: 2 });
    const inc = (await q('SELECT incident_type, detected_source, details, order_item_id FROM incidents WHERE id=$1', [out.receipts[0].incident_id])).rows[0];
    expect(inc).toMatchObject({ incident_type: 'missing_item', detected_source: 'relay_agent', order_item_id: items.a.itemId });
    expect(inc.details).toMatchObject({ expected: 3, received: 2, shipment_reference: ref });
    const parcelA = (await q('SELECT qty_allocated,qty_packed,qty_shipped,qty_received FROM parcel_items WHERE order_item_id=$1', [items.a.itemId])).rows[0];
    expect(parcelA).toMatchObject({ qty_allocated: 3, qty_packed: 3, qty_shipped: 3, qty_received: 2 });

    await expect(relay.receiveShipment({ market, actor: agentA, reference: ref, body: { proof_ref: 'BORD-A2', lines: [{ order_item_id: items.a.itemId, received_qty: 3 }] } }))
      .rejects.toMatchObject({ status: 409, code: 'RELAY_RECEIPT_ALREADY_ATTESTED' });
    await expect(q('UPDATE international_shipment_relay_receipts SET received_qty = 3 WHERE shipment_id=$1', [shipmentId])).rejects.toThrow(/shipment_relay_receipt_immutable/);
    await expect(q('DELETE FROM international_shipment_relay_receipts WHERE shipment_id=$1', [shipmentId])).rejects.toThrow(/shipment_relay_receipt_immutable/);

    const view = await relay.listRelayShipments({ market, relaisId: relaisA });
    const item = view.shipments.find((s) => s.reference === ref).boxes[0].orders[0].items[0];
    expect(item).toMatchObject({ expected: 3, received: 2, received_gap: 1 });
    expect(item.incident_id).toBe(out.receipts[0].incident_id);
  });

  test('tous les relais ont attesté → relay_received, avec événement de preuve ; réception conforme sans incident', async () => {
    const out = await relay.receiveShipment({ market, actor: agentB, reference: ref, body: { proof_ref: 'BORD-B', lines: [{ order_item_id: items.b.itemId, received_qty: 2 }] } });
    expect(out.receipts[0].incident_id).toBeNull();
    const parcelB = (await q('SELECT qty_shipped,qty_received FROM parcel_items WHERE order_item_id=$1', [items.b.itemId])).rows[0];
    expect(parcelB).toMatchObject({ qty_shipped: 2, qty_received: 2 });
    expect(out).toMatchObject({ complete: true, stage: 'relay_received' });
    expect((await q('SELECT stage FROM international_shipments WHERE id=$1', [shipmentId])).rows[0].stage).toBe('relay_received');
    const ev = (await q("SELECT to_stage, proof_ref, payload FROM international_shipment_events WHERE shipment_id=$1 AND to_stage='relay_received'", [shipmentId])).rows[0];
    expect(ev).toMatchObject({ to_stage: 'relay_received', proof_ref: 'BORD-B' });
    expect(ev.payload.attested_by).toBe('relay');
    await expect(relay.receiveShipment({ market, actor: agentB, reference: ref, body: { proof_ref: 'Z', lines: [{ order_item_id: items.b.itemId, received_qty: 2 }] } }))
      .rejects.toMatchObject({ status: 409, code: 'RELAY_SHIPMENT_NOT_AT_RELAY' });
  });

  test('P0-1 · l\'attestation est effective : colis et commande disponibles pour les quantités attestées, code de retrait émis, écart jamais écrasé', async () => {
    const o = (await q('SELECT status, pickup_secret_hash FROM orders WHERE id=$1', [items.a.orderId])).rows[0];
    expect(o.status).toBe('available');
    expect(o.pickup_secret_hash).toBeTruthy();
    const p = (await q('SELECT p.status, pi.quantity, pi.qty_shipped, pi.qty_received FROM parcels p JOIN parcel_items pi ON pi.parcel_id=p.id WHERE pi.order_item_id=$1', [items.a.itemId])).rows[0];
    expect(p).toMatchObject({ status: 'available', quantity: 4, qty_shipped: 3, qty_received: 2 });
    expect((await q("SELECT count(*)::int AS n FROM scans WHERE parcel_id IN (SELECT parcel_id FROM parcel_items WHERE order_item_id=$1) AND step='relais_received'", [items.a.itemId])).rows[0].n).toBe(1);
  });

  test('P0-1 · aucun scan ni écriture directe ne peut réceptionner ou compléter une quantité import à la place du relais', async () => {
    const scanEngine = require('../../services/scan-engine');
    const parcelA = (await q('SELECT parcel_id FROM parcel_items WHERE order_item_id=$1', [items.a.itemId])).rows[0].parcel_id;
    const refused = await scanEngine.processScan({ parcel_id: parcelA, event_type: 'relais_received', scanned_by: admin, actor_role: 'admin' });
    expect(refused.success).toBe(false);
    expect(refused.error).toMatchObject({ code: 'IMPORT_RECEIPT_REQUIRES_RELAY_ATTESTATION' });
    await expect(q('UPDATE parcel_items SET qty_received = 4 WHERE order_item_id=$1', [items.a.itemId])).rejects.toThrow();
    await expect(q('UPDATE parcel_items SET qty_received = 3 WHERE order_item_id=$1', [items.a.itemId])).rejects.toThrow(/parcel_item_not_relay_attested/);
    expect((await q('SELECT qty_received FROM parcel_items WHERE order_item_id=$1', [items.a.itemId])).rows[0].qty_received).toBe(2);
  });

  test('P0-1 · retrait borné à la quantité reçue : 2 remis sur 4, la commande n\'est pas clôturée et le reliquat reste visible', async () => {
    const scanEngine = require('../../services/scan-engine');
    const parcelA = (await q('SELECT parcel_id FROM parcel_items WHERE order_item_id=$1', [items.a.itemId])).rows[0].parcel_id;
    await q('UPDATE orders SET relais_id=$2 WHERE id=$1', [items.a.orderId, relaisA]);
    const out = await scanEngine.processScan({ parcel_id: parcelA, event_type: 'customer_collected', scanned_by: admin, actor_role: 'admin' });
    const pi = (await q('SELECT quantity, qty_received, qty_collected FROM parcel_items WHERE order_item_id=$1', [items.a.itemId])).rows[0];
    expect(out.success).toBe(true);
    expect(pi.qty_collected).toBe(2);
    expect(pi.quantity).toBe(4);
    expect((await q('SELECT status FROM orders WHERE id=$1', [items.a.orderId])).rows[0].status).not.toBe('collected');
  });

  test('L11 · confirmation manuelle : même moteur, mêmes gates, trace dégradée avec motif', async () => {
    const workspace = require('../../services/operations-workspace');
    const refOf = async (itemId) => (await q('SELECT p.id, p.reference FROM parcels p JOIN parcel_items pi ON pi.parcel_id=p.id WHERE pi.order_item_id=$1', [itemId])).rows[0];
    const pa = await refOf(items.a.itemId);
    // gate : un colis déjà disponible ne peut pas être « expédié », même confirmé à la main — rien n'est appliqué
    const statusBefore = (await q('SELECT status FROM parcels WHERE id=$1', [pa.id])).rows[0].status;
    await expect(workspace.scanParcel(pa.reference, 'ship', market, { id: admin, role: 'admin' }, { reason: 'scanner_unavailable' })).rejects.toBeTruthy();
    expect((await q('SELECT status FROM parcels WHERE id=$1', [pa.id])).rows[0].status).toBe(statusBefore);
    expect((await q("SELECT count(*)::int AS n FROM scan_events WHERE parcel_id=$1 AND event_type='shipped' AND status='applied' AND entry_mode='manual_confirmation'", [pa.id])).rows[0].n).toBe(0);
    // P0 #3900 : aucun mode manuel (y compris label_unreadable) ne peut
    // contourner le code de retrait client dans ce workspace logistique.
    const pb = await refOf(items.b.itemId);
    await q('UPDATE orders SET relais_id=$2 WHERE id=$1', [items.b.orderId, relaisB]);
    await expect(workspace.scanParcel(pb.reference, 'collect', market, { id: admin, role: 'admin' }, { reason: 'label_unreadable', note: 'QR abîmé' }))
      .rejects.toMatchObject({ code: 'PICKUP_CODE_REQUIRED', status: 409 });
    const applied = (await q("SELECT count(*)::int AS n FROM scan_events WHERE parcel_id=$1 AND event_type='customer_collected' AND status='applied'", [pb.id])).rows[0];
    expect(applied.n).toBe(0);
    // sans motif : aucun appel moteur, aucune ligne
    const before = (await q('SELECT count(*)::int AS n FROM scan_events WHERE parcel_id=$1', [pa.id])).rows[0].n;
    await expect(workspace.scanParcel(pa.reference, 'ship', market, { id: admin, role: 'admin' })).rejects.toMatchObject({ code: 'manual_reason_required' });
    expect((await q('SELECT count(*)::int AS n FROM scan_events WHERE parcel_id=$1', [pa.id])).rows[0].n).toBe(before);
    // la réception import reste réservée à l'attestation relais, même en mode manuel
    const scanEngine = require('../../services/scan-engine');
    const viaEngine = await scanEngine.processScan({ parcel_id: pa.id, event_type: 'relais_received', scanned_by: admin, actor_role: 'admin', metadata: { entry_mode: 'manual_confirmation', manual_reason: 'offline' } });
    expect(viaEngine.success).toBe(false);
    expect(viaEngine.error).toMatchObject({ code: 'IMPORT_RECEIPT_REQUIRES_RELAY_ATTESTATION' });
  });

  test('L11 · contraintes base : motif obligatoire et modes fermés sur scan_events', async () => {
    const pa = (await q('SELECT parcel_id FROM parcel_items WHERE order_item_id=$1', [items.a.itemId])).rows[0].parcel_id;
    const ins = (meta) => q("INSERT INTO scan_events(parcel_id,event_type,actor_role,metadata) VALUES($1,'shipped','admin',$2::jsonb)", [pa, JSON.stringify(meta)]);
    await expect(ins({ entry_mode: 'manual_confirmation' })).rejects.toThrow(/scan_events_manual_reason_check/);
    await expect(ins({ entry_mode: 'magic', manual_reason: 'x' })).rejects.toThrow(/scan_events_entry_mode_check/);
    await expect(ins({ entry_mode: 'manual_confirmation', manual_reason: 'offline' })).resolves.toBeTruthy();
    expect((await q("SELECT entry_mode FROM scan_events WHERE parcel_id=$1 AND metadata->>'manual_reason'='offline' LIMIT 1", [pa])).rows[0].entry_mode).toBe('manual_confirmation');
  });
}
