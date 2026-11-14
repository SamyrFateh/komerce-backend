/**
 * @komerce-arch
 * @role          hub-bag-box
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        bag_scan, box_scan, canonical_parcel_id, trusted_market_scope
 * @outputs       immutable_physical_bag_containment, relay_scannable_bag
 * @depends       db.js
 * @used-by       routes/admin-operations-workspace.js
 * @db-read       hub_box_bags, hub_physical_units, hub_physical_unit_placements, hub_purchase_allocations, orders, parcels, parcel_items, international_shipment_hub_units, international_shipments, order_items, products
 * @db-write      hub_box_bags
 * @db-txn        service_owned
 * @doctrine      sealed_customer_bag_persists_inside_market_box; no_fake_repack_or_duplicate_allocation
 */
'use strict';
const db = require('../db');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refusal(status, code, message) {
  const error = new Error(message || code);
  error.status = status;
  error.code = code;
  return error;
}
function uuid(value, field) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw refusal(400, 'HUB_BAG_INVALID_ID', field);
  return value;
}
function textRef(value, field) {
  const text = String(value || '').trim();
  if (!text || text.length > 200) throw refusal(400, 'HUB_BAG_SCAN_REQUIRED', field);
  return text;
}
function translate(err) {
  const match = String(err.message || '').match(/HUB_BOX_[A-Z_]+/);
  if (match) return refusal(409, match[0], 'Le sac ou la KOM-BOX ne répond pas aux contrôles physiques');
  if (err.code === '23505') return refusal(409, 'HUB_BAG_ALREADY_BOXED');
  return err;
}

// Le sac fermé conserve ses placements ; il est physiquement contenu dans la
// KOM-BOX et ne passe jamais par un MOVE fictif ou SUPERSEDED.
async function attachBagToBox({
  bagUnitId, boxUnitId, parcelId, bagReferenceScan, boxReferenceScan,
  evidenceMethod, evidenceRef, expectedMarketId, actorId,
}) {
  const bagId = uuid(bagUnitId, 'bag_unit_id');
  const boxId = uuid(boxUnitId, 'box_unit_id');
  // Un colis import par commande : la sélection est dérivée côté serveur, jamais devinée par le navigateur.
  // Une sélection explicite reste permise pour les parcours de réparation/recette existants.
  const requestedParcel = parcelId == null || parcelId === '' ? null : uuid(parcelId, 'parcel_id');
  const marketId = uuid(expectedMarketId, 'market_id');
  const user = uuid(actorId, 'actor_id');
  const bagScan = textRef(bagReferenceScan, 'scan du sac');
  const boxScan = textRef(boxReferenceScan, 'scan de la KOM-BOX');
  // Même writer pour le scanner et la saisie clavier : la provenance est explicite, jamais présumée SCAN.
  const method = String(evidenceMethod || '').trim().toUpperCase();
  if (method !== 'SCAN' && method !== 'MANUAL') throw refusal(400, 'HUB_BAG_EVIDENCE_METHOD_REQUIRED', 'evidence_method');
  const proof = String(evidenceRef || '').trim();
  if (method === 'MANUAL' && (proof.length < 6 || proof.length > 500)) {
    throw refusal(400, 'HUB_BAG_MANUAL_EVIDENCE_REQUIRED', 'Mode manuel : justification de 6 à 500 caractères');
  }
  if (method === 'SCAN' && proof) throw refusal(400, 'HUB_BAG_SCAN_EVIDENCE_REF_FORBIDDEN', 'evidence_ref');
  const storedRef = method === 'MANUAL' ? proof : null;
  try {
    return await db.withTransaction(async client => {
      const { rows: [scope] } = await client.query(
        'SELECT b.id, b.order_id, o.market_id FROM hub_physical_units b ' +
        'JOIN orders o ON o.id=b.order_id WHERE b.id=$1 AND o.market_id=$2', [bagId, marketId]
      );
      if (!scope) throw refusal(403, 'HUB_BAG_MARKET_SCOPE_MISMATCH');
      let parcel = requestedParcel;
      if (!parcel) {
        // La vérité métier est la commande du sac. Le colis est unique uniquement
        // si une seule répartition import active existe. Aucun choix implicite ambigu.
        const { rows: candidates } = await client.query(
          "SELECT DISTINCT p.id FROM parcels p " +
          "JOIN parcel_items pi ON pi.parcel_id = p.id " +
          "JOIN order_items oi ON oi.id = pi.order_item_id " +
          "WHERE p.order_id = $1 AND oi.order_id = $1 " +
          "AND oi.fulfillment_source = 'IMPORT' AND p.status <> 'cancelled' " +
          "ORDER BY p.id LIMIT 2",
          [scope.order_id]
        );
        if (!candidates.length) throw refusal(409, 'HUB_BAG_PARCEL_NOT_READY',
          'Le colis client import n’est pas encore réparti pour cette commande');
        if (candidates.length > 1) throw refusal(409, 'HUB_BAG_PARCEL_AMBIGUOUS',
          'Plusieurs colis client existent : le rattachement nécessite un choix vérifié');
        parcel = uuid(candidates[0].id, 'derived_parcel_id');
      }
      const { rows: [previous] } = await client.query(
        'SELECT box_unit_id, parcel_id, bag_reference_scan, box_reference_scan, evidence_method, evidence_ref ' +
        'FROM hub_box_bags WHERE bag_unit_id=$1',
        [bagId]
      );
      if (previous) {
        if (String(previous.box_unit_id) === boxId && String(previous.parcel_id) === parcel &&
          previous.bag_reference_scan === bagScan && previous.box_reference_scan === boxScan &&
          previous.evidence_method === method && (previous.evidence_ref || null) === storedRef) {
          return { bag_unit_id: bagId, box_unit_id: boxId, parcel_id: parcel, evidence_method: method, already_linked: true };
        }
        throw refusal(409, 'HUB_BAG_ALREADY_BOXED');
      }
      const { rows: [linked] } = await client.query(
        'INSERT INTO hub_box_bags(' +
        'bag_unit_id, box_unit_id, parcel_id, linked_by, bag_reference_scan, box_reference_scan, ' +
        'evidence_method, evidence_ref' +
        ') VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ' +
        'RETURNING bag_unit_id, box_unit_id, parcel_id, evidence_method',
        [bagId, boxId, parcel, user, bagScan, boxScan, method, storedRef]
      );
      // Un doublon concurrent déclenche 23505, traduit en 409 par translate(); jamais ignoré.
      return { ...linked, already_linked: false };
    });
  } catch (error) { throw translate(error); }
}

// Scanne le sac au relais : identité client, colis et contenu courant de ce
// même sac, uniquement s'il voyage dans cette expédition et pour ce relais.
async function getBagAtRelay({ bagReference, shipmentReference, expectedMarketId, relaisId = null }, q = db) {
  const bagScan = textRef(bagReference, 'bag_reference');
  const shipmentRef = textRef(shipmentReference, 'shipment_reference');
  const market = uuid(expectedMarketId, 'market_id');
  const relay = relaisId ? uuid(relaisId, 'relais_id') : null;
  const { rows: [record] } = await q.query(
    'SELECT bag.id AS bag_unit_id, bag.reference AS bag_reference, ' +
    'b.id AS box_unit_id, b.reference AS box_reference, ' +
    'o.id AS order_id, o.reference AS order_reference, ' +
    'p.id AS parcel_id, p.reference AS parcel_reference, ' +
    's.id AS shipment_id, s.reference AS shipment_reference, s.stage, o.relais_id ' +
    'FROM hub_physical_units bag ' +
    'JOIN hub_box_bags l ON l.bag_unit_id=bag.id ' +
    'JOIN hub_physical_units b ON b.id=l.box_unit_id ' +
    'JOIN parcels p ON p.id=l.parcel_id AND p.order_id=bag.order_id ' +
    'JOIN orders o ON o.id=bag.order_id ' +
    'JOIN international_shipment_hub_units h ON h.physical_unit_id=b.id ' +
    'JOIN international_shipments s ON s.id=h.shipment_id ' +
    'WHERE bag.reference=$1 AND s.reference=$2 AND s.market_id=$3 AND o.market_id=$3 ' +
    'AND ($4::uuid IS NULL OR o.relais_id=$4) ' +
    "AND s.stage IN ('arrived','customs_released','local_delivery','relay_received') LIMIT 1",
    [bagScan, shipmentRef, market, relay]
  );
  if (!record) throw refusal(404,'RELAY_BAG_NOT_FOUND','Aucun sac de cette expédition pour ce relais');
  const { rows: contents } = await q.query(
    'SELECT a.order_item_id, a.product_sku_id, ' +
    "coalesce(pr.name,'Article') AS product_name, sum(pl.quantity)::integer AS quantity " +
    'FROM hub_physical_unit_placements pl ' +
    'JOIN hub_purchase_allocations a ON a.id=pl.allocation_id ' +
    'JOIN order_items oi ON oi.id=a.order_item_id ' +
    'LEFT JOIN products pr ON pr.id=oi.product_id ' +
    'WHERE pl.physical_unit_id=$1 AND pl.removed_at IS NULL ' +
    'GROUP BY a.order_item_id,a.product_sku_id,pr.name ORDER BY pr.name',
    [record.bag_unit_id]
  );
  return { ...record, contents };
}
module.exports = { attachBagToBox, getBagAtRelay };
