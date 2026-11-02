/**
 * @komerce-arch
 * @role          relay-shipment-receipt-owner
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        authenticated_relay_actor, server_resolved_market, shipment_reference, per_item_received_quantities
 * @outputs       shipment_content_tree, immutable_relay_receipts, traceable_incidents
 * @depends       db, services/incident-write-service.js
 * @used-by       routes/admin-operations-workspace.js
 * @db-read       international_shipments, international_shipment_hub_units, international_shipment_relay_receipts, hub_physical_units, hub_physical_unit_placements, hub_purchase_allocations, order_items, orders, products, relais, parcel_items, parcels
 * @db-write      international_shipment_relay_receipts, international_shipments, international_shipment_events, incidents, parcel_items
 * @db-txn        withTransaction
 * @doctrine      relay_reception_attested_by_relay, no_status_deduced_from_hub_or_admin, market_scope_server_owned
 * @impact-areas  logistics, relay
 * @version       2026-11
 *
 * Contenu réellement expédié (Expédition → KOM-BOX → commandes → articles → quantités) et réception relais.
 * Attendu = ce qui est placé (actif) dans les KOM-BOX rattachées à l'expédition. Le reçu n'existe que par attestation
 * du relais (une ligne immuable par expédition et article) ; un écart ouvre un incident. L'étape relay_received découle
 * des attestations de tous les articles attendus : ni Hub ni admin ne la posent.
 */
'use strict';
const db = require('../db');
const { createScanIncident } = require('./incident-write-service');

class RelayReceiptError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new RelayReceiptError(status, code, message); };

const RELAY_VISIBLE_STAGES = ['arrived', 'customs_released', 'local_delivery', 'relay_received'];

/** Lignes attendues par KOM-BOX et article pour une expédition (lecture). */
async function loadExpected(q, shipmentId, relaisId = null) {
  const { rows } = await q.query(`
    SELECT u.id AS unit_id, u.reference AS unit_ref, u.state AS unit_state,
           a.order_id, o.reference AS order_ref, o.relais_id, a.order_item_id,
           COALESCE(p.name, 'Article') AS product_name, oi.quantity AS ordered,
           SUM(pl.quantity)::int AS in_box
      FROM international_shipment_hub_units h
      JOIN hub_physical_units u ON u.id = h.physical_unit_id AND u.unit_type = 'MARKET_PARCEL'
      JOIN hub_physical_unit_placements pl ON pl.physical_unit_id = u.id AND pl.removed_at IS NULL
      JOIN hub_purchase_allocations a ON a.id = pl.allocation_id
      JOIN order_items oi ON oi.id = a.order_item_id
      JOIN orders o ON o.id = a.order_id
      LEFT JOIN products p ON p.id = oi.product_id
     WHERE h.shipment_id = $1 AND ($2::uuid IS NULL OR o.relais_id = $2::uuid)
     GROUP BY u.id, u.reference, u.state, a.order_id, o.reference, o.relais_id, a.order_item_id, p.name, oi.quantity
     ORDER BY u.reference, o.reference, p.name`, [shipmentId, relaisId]);
  return rows;
}

/** Arbre lisible : expéditions → KOM-BOX → commandes → articles, avec attendu / manquant / reçu / remis par article. */
async function listRelayShipments({ market, relaisId = null }, q = db) {
  if (!market || !market.id) fail(400, 'RELAY_MARKET_REQUIRED', 'Marché serveur requis');
  const { rows: shipments } = await q.query(
    `SELECT id, reference, stage, forwarder_name, transport_mode, arrived_at
       FROM international_shipments WHERE market_id = $1 AND stage = ANY($2::text[]) ORDER BY updated_at DESC LIMIT 50`,
    [market.id, RELAY_VISIBLE_STAGES]);
  const out = [];
  for (const s of shipments) {
    const expected = await loadExpected(q, s.id, relaisId);
    if (relaisId && !expected.length) continue;
    const itemIds = [...new Set(expected.map((e) => e.order_item_id))];
    const { rows: receipts } = itemIds.length ? await q.query(
      `SELECT order_item_id, expected_qty, received_qty, proof_ref, received_at, incident_id
         FROM international_shipment_relay_receipts WHERE shipment_id = $1 AND order_item_id = ANY($2::uuid[])`,
      [s.id, itemIds]) : { rows: [] };
    const { rows: handed } = itemIds.length ? await q.query(
      `SELECT pi.order_item_id, COALESCE(SUM(pi.qty_collected), 0)::int AS handed
         FROM parcel_items pi JOIN parcels pa ON pa.id = pi.parcel_id
        WHERE pi.order_item_id = ANY($1::uuid[]) AND pa.cancelled_at IS NULL GROUP BY pi.order_item_id`, [itemIds]) : { rows: [] };
    const receiptBy = new Map(receipts.map((r) => [r.order_item_id, r]));
    const handedBy = new Map(handed.map((r) => [r.order_item_id, Number(r.handed)]));
    const shippedBy = new Map();
    expected.forEach((e) => shippedBy.set(e.order_item_id, (shippedBy.get(e.order_item_id) || 0) + Number(e.in_box)));

    const boxes = new Map();
    for (const e of expected) {
      if (!boxes.has(e.unit_id)) boxes.set(e.unit_id, { unit_id: e.unit_id, reference: e.unit_ref, state: e.unit_state, orders: new Map() });
      const box = boxes.get(e.unit_id);
      if (!box.orders.has(e.order_id)) box.orders.set(e.order_id, { order_id: e.order_id, reference: e.order_ref, items: [] });
      const receipt = receiptBy.get(e.order_item_id);
      const shipped = shippedBy.get(e.order_item_id);
      box.orders.get(e.order_id).items.push({
        order_item_id: e.order_item_id, product: e.product_name, ordered: Number(e.ordered),
        expected: Number(e.in_box), shipped,
        missing: Math.max(0, Number(e.ordered) - shipped),            // reliquat : commandé non expédié dans ce dossier
        received: receipt ? Number(receipt.received_qty) : null,       // null = non encore attesté par le relais
        received_gap: receipt ? Number(receipt.expected_qty) - Number(receipt.received_qty) : null,
        incident_id: receipt ? receipt.incident_id : null,
        handed: handedBy.get(e.order_item_id) || 0,
      });
    }
    out.push({
      reference: s.reference, stage: s.stage, forwarder_name: s.forwarder_name, transport_mode: s.transport_mode,
      receivable: s.stage === 'local_delivery',
      boxes: [...boxes.values()].map((b) => ({ ...b, orders: [...b.orders.values()] })),
    });
  }
  return { market: { id: market.id, code: market.code }, shipments: out };
}

/**
 * Synchronise la projection du colis client depuis les deux faits physiques :
 *  - quantité expédiée : KOM-BOX effectivement remises au transitaire ;
 *  - quantité reçue : attestations immuables des agents relais.
 * Ne crée jamais de quantité fictive et n'abaisse pas une preuve déjà inscrite.
 * Le verrou de l'expédition puis les FOR UPDATE des parcel_items sérialisent la réconciliation.
 */
async function projectRelayReceiptToClientParcels(client, orderItemId) {
  // Verrou commun aux expéditions concurrentes touchant le même article client.
  await client.query('SELECT id FROM order_items WHERE id = $1 FOR UPDATE', [orderItemId]);
  const { rows: [totals] } = await client.query(`
    SELECT
      (SELECT COALESCE(SUM(placement.quantity), 0)::int
         FROM international_shipment_hub_units ship_box
         JOIN international_shipments ship ON ship.id = ship_box.shipment_id AND ship.stage <> 'hub_ready'
         JOIN hub_physical_unit_placements placement
           ON placement.physical_unit_id = ship_box.physical_unit_id AND placement.removed_at IS NULL
         JOIN hub_purchase_allocations alloc ON alloc.id = placement.allocation_id
        WHERE alloc.order_item_id = $1) AS physically_shipped,
      (SELECT COALESCE(SUM(receipt.received_qty), 0)::int
         FROM international_shipment_relay_receipts receipt
        WHERE receipt.order_item_id = $1) AS attested_received
  `, [orderItemId]);
  let shipped = Number(totals.physically_shipped || 0);
  let received = Math.min(shipped, Number(totals.attested_received || 0));
  const { rows: parcels } = await client.query(`
    SELECT pi.id, pi.quantity, pi.qty_packed, pi.qty_shipped, pi.qty_received
      FROM parcel_items pi JOIN parcels p ON p.id = pi.parcel_id
     WHERE pi.order_item_id = $1 AND p.cancelled_at IS NULL
     ORDER BY pi.created_at, pi.id
     FOR UPDATE OF pi
  `, [orderItemId]);
  let projected = 0;
  for (const pi of parcels) {
    const targetShipped = Math.min(Number(pi.quantity), shipped);
    const targetReceived = Math.min(targetShipped, received);
    if (targetShipped > Number(pi.qty_packed)) {
      fail(409, 'RELAY_PARCEL_PACKING_PROOF_MISSING',
        'Colis client non rapproché de sa preuve KOM-BOX : expédition non enregistrable comme réception client.');
    }
    if (targetShipped < Number(pi.qty_shipped) || targetReceived < Number(pi.qty_received)) {
      fail(409, 'RELAY_PARCEL_RECEIPT_REGRESSION',
        'La réception ne peut réduire une quantité précédemment attestée sur le colis client.');
    }
    if (targetShipped !== Number(pi.qty_shipped) || targetReceived !== Number(pi.qty_received)) {
      await client.query(
        'UPDATE parcel_items SET qty_shipped = $2, qty_received = $3 WHERE id = $1',
        [pi.id, targetShipped, targetReceived]
      );
    }
    projected += targetReceived;
    shipped -= targetShipped;
    received -= targetReceived;
  }
  if (shipped > 0) {
    fail(409, 'RELAY_CLIENT_PARCEL_COVERAGE_MISSING',
      'Une partie des articles expédiés ne figure dans aucun colis client actif.');
  }
  return { projected_received: projected, parcels_updated: parcels.length };
}

function parseLines(body) {
  const raw = body && body.lines;
  if (!Array.isArray(raw) || !raw.length) fail(400, 'RELAY_RECEIPT_LINES_REQUIRED', 'lines[] obligatoire (une entrée par article reçu)');
  const seen = new Set();
  return raw.map((l) => {
    const itemId = l && l.order_item_id;
    const qty = l && l.received_qty;
    if (typeof itemId !== 'string' || !/^[0-9a-f-]{36}$/i.test(itemId)) fail(400, 'RELAY_RECEIPT_INVALID', 'order_item_id invalide');
    if (!Number.isSafeInteger(qty) || qty < 0) fail(400, 'RELAY_RECEIPT_INVALID', 'received_qty doit être un entier >= 0');
    if (seen.has(itemId)) fail(400, 'RELAY_RECEIPT_INVALID', 'article dupliqué');
    seen.add(itemId);
    return { itemId, qty };
  });
}

/** Attestation de réception par le relais (agent_relais rattaché à un relais) pour une expédition arrivée en local. */
async function receiveShipment({ market, actor, reference, body = {} }, database = db) {
  if (!market || !market.id) fail(400, 'RELAY_MARKET_REQUIRED', 'Marché serveur requis');
  if (!actor || !actor.id || actor.role !== 'agent_relais' || !actor.relais_id) {
    fail(403, 'RELAY_RECEIPT_ROLE_FORBIDDEN', 'Seul un agent relais rattaché à un relais atteste une réception');
  }
  const proof = typeof body.proof_ref === 'string' ? body.proof_ref.trim() : '';
  if (!proof || proof.length > 240) fail(400, 'RELAY_RECEIPT_PROOF_REQUIRED', 'proof_ref obligatoire (bordereau, photo, référence)');
  const lines = parseLines(body);

  return database.withTransaction(async (client) => {
    const { rows: [s] } = await client.query(
      'SELECT id, reference, stage FROM international_shipments WHERE market_id = $1 AND reference = $2 FOR UPDATE',
      [market.id, String(reference || '')]);
    if (!s) fail(404, 'RELAY_SHIPMENT_NOT_FOUND', 'Expédition introuvable sur ce marché');
    if (s.stage !== 'local_delivery') fail(409, 'RELAY_SHIPMENT_NOT_AT_RELAY', `Expédition à l'étape "${s.stage}" : la réception relais s'atteste au transport local`);

    const mine = await loadExpected(client, s.id, actor.relais_id);
    const expectedByItem = new Map();
    mine.forEach((e) => expectedByItem.set(e.order_item_id, (expectedByItem.get(e.order_item_id) || 0) + Number(e.in_box)));
    const results = [];
    for (const l of lines) {
      if (!expectedByItem.has(l.itemId)) fail(409, 'RELAY_RECEIPT_ITEM_NOT_EXPECTED', 'Article non attendu par ce relais dans cette expédition');
      const expected = expectedByItem.get(l.itemId);
      const info = mine.find((e) => e.order_item_id === l.itemId);
      let incidentId = null;
      if (l.qty !== expected) {
        const missing = l.qty < expected;
        const inc = await createScanIncident(client, {
          order_id: info.order_id, order_item_id: l.itemId,
          incident_type: missing ? 'missing_item' : 'quantity_mismatch', severity: missing && l.qty === 0 ? 'high' : 'medium',
          title: `Écart de réception relais · ${info.order_ref} · ${info.product_name}`,
          description: `Expédition ${s.reference} : attendu ${expected}, reçu ${l.qty}.`,
          details: { shipment_reference: s.reference, expected, received: l.qty, relais_id: actor.relais_id, proof_ref: proof },
          client_impact: missing ? 'partial_delivery' : 'delayed', detected_by: actor.id, detected_source: 'relay_agent',
        });
        incidentId = inc.id;
      }
      try {
        await client.query(`
          INSERT INTO international_shipment_relay_receipts (shipment_id, order_item_id, relais_id, expected_qty, received_qty, received_by, proof_ref, incident_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [s.id, l.itemId, actor.relais_id, expected, l.qty, actor.id, proof, incidentId]);
      } catch (error) {
        if (error && error.code === '23505') fail(409, 'RELAY_RECEIPT_ALREADY_ATTESTED', 'Réception déjà attestée pour cet article');
        throw error;
      }
      const projection = await projectRelayReceiptToClientParcels(client, l.itemId);
      results.push({ order_item_id: l.itemId, expected, received: l.qty, incident_id: incidentId, ...projection });
    }

    // L'étape relay_received découle des attestations : tous les articles attendus (tous relais) ont une attestation.
    const all = await loadExpected(client, s.id, null);
    const allItems = [...new Set(all.map((e) => e.order_item_id))];
    const { rows: [{ n }] } = await client.query(
      'SELECT count(*)::int AS n FROM international_shipment_relay_receipts WHERE shipment_id = $1 AND order_item_id = ANY($2::uuid[])',
      [s.id, allItems]);
    const complete = allItems.length > 0 && n === allItems.length;
    if (complete) {
      await client.query("UPDATE international_shipments SET stage = 'relay_received', updated_at = now() WHERE id = $1", [s.id]);
      await client.query(
        `INSERT INTO international_shipment_events (shipment_id, event_type, from_stage, to_stage, proof_ref, actor_id, payload)
         VALUES ($1,'stage_changed','local_delivery','relay_received',$2,$3,$4::jsonb)`,
        [s.id, proof, String(actor.id), JSON.stringify({ physical_step: 'relay_received', attested_by: 'relay', receipts: n })]);
    }
    return { reference: s.reference, receipts: results, stage: complete ? 'relay_received' : s.stage, complete };
  });
}

module.exports = { listRelayShipments, receiveShipment, projectRelayReceiptToClientParcels, RelayReceiptError, RELAY_VISIBLE_STAGES };
