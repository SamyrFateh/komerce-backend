/**
 * @komerce-arch
 * @role          hub-box-shipment
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        physical_unit_id, shipment_reference, actor
 * @outputs       box_shipment_link
 * @depends       db
 * @used-by       routes/hub.js
 * @db-read       hub_physical_units, international_shipments, international_shipment_hub_units
 * @db-write      international_shipment_hub_units
 * @db-txn        service_owned
 * @doctrine      HUB-001 Physical Identity, Allocation & Custody; une KOM-BOX appartient à au plus une expédition du même marché
 * @impact-areas  logistics
 * @version       2026-11
 */

'use strict';

const db = require('../db');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Les garde-fous vivent en base (migration 358) ; ce service ne fait que traduire leurs refus.
const PG_REFUSALS = Object.freeze({
  hub_box_shipment_requires_market_parcel: [409, 'HUB_BOX_NOT_MARKET_PARCEL', 'Seul un carton marché (KOM-BOX) peut rejoindre une expédition'],
  hub_box_shipment_requires_packed_box: [409, 'HUB_BOX_NOT_PACKED', 'Le carton doit être emballé et rattaché à un marché'],
  hub_box_shipment_market_mismatch: [409, 'HUB_BOX_SHIPMENT_MARKET_MISMATCH', 'Le carton et l’expédition appartiennent à des marchés différents'],
  hub_box_shipment_closed: [409, 'HUB_SHIPMENT_CLOSED', 'L’expédition est déjà remise au transitaire'],
  hub_box_shipment_detach_after_handover: [409, 'HUB_SHIPMENT_CLOSED', 'Détachement impossible après la remise au transitaire'],
  uq_international_shipment_hub_unit: [409, 'HUB_BOX_ALREADY_ATTACHED', 'Ce carton est déjà rattaché à une expédition'],
});

function failure(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function translate(error) {
  const text = `${error && error.message || ''} ${error && error.constraint || ''}`;
  for (const [needle, [status, code, message]] of Object.entries(PG_REFUSALS)) {
    if (text.includes(needle)) return failure(status, code, message);
  }
  return error;
}

function requireUuid(value, name) {
  if (!value || !UUID_RE.test(String(value))) throw failure(400, 'HUB_OPERATOR_UUID_INVALID', `${name} doit être un UUID valide`);
  return String(value);
}

// Contrôles serveur communs à la création d'un dossier depuis des KOM-BOX et au rattachement ultérieur :
// existence, carton marché, même marché que le dossier, au moins emballé, jamais déjà dans un autre dossier.
const ATTACHABLE_STATES = Object.freeze(['PACKED', 'DISPATCHED']);

async function lockAttachableBoxes(client, { marketId, unitIds }) {
  const ids = [...new Set((unitIds || []).map((value) => requireUuid(value, 'hub_unit_ids[]')))];
  if (!ids.length) return [];
  const { rows } = await client.query(
    'SELECT id, reference, unit_type, state, market_id FROM hub_physical_units WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
    [ids]
  );
  if (rows.length !== ids.length) throw failure(404, 'HUB_BOX_NOT_FOUND', 'Carton introuvable');
  for (const unit of rows) {
    if (unit.unit_type !== 'MARKET_PARCEL') throw failure(409, 'HUB_BOX_NOT_MARKET_PARCEL', `${unit.reference} n’est pas un carton marché (KOM-BOX)`);
    if (!ATTACHABLE_STATES.includes(unit.state)) throw failure(409, 'HUB_BOX_NOT_PACKED', `${unit.reference} n’est pas emballé (état ${unit.state})`);
    if (String(unit.market_id || '') !== String(marketId)) throw failure(409, 'HUB_BOX_SHIPMENT_MARKET_MISMATCH', `${unit.reference} n’appartient pas au marché du dossier`);
  }
  const { rows: taken } = await client.query(
    'SELECT physical_unit_id FROM international_shipment_hub_units WHERE physical_unit_id = ANY($1::uuid[]) LIMIT 1', [ids]
  );
  if (taken.length) throw failure(409, 'HUB_BOX_ALREADY_ATTACHED', 'Un carton est déjà rattaché à une expédition');
  return rows;
}

async function insertBoxLinks(client, { shipmentId, units, actor = null }) {
  for (const unit of units) {
    await client.query(
      'INSERT INTO international_shipment_hub_units(shipment_id, physical_unit_id, attached_by) VALUES ($1, $2, $3)',
      [shipmentId, unit.id, actor && actor.id ? actor.id : null]
    );
  }
}

async function attachBoxToShipment({ unitId, shipmentReference, expectedMarketId = null, actor = null }) {
  const unit = requireUuid(unitId, 'unit_id');
  const reference = String(shipmentReference || '').trim();
  if (!reference) throw failure(400, 'HUB_OPERATOR_TEXT_INVALID', 'shipment_reference est requis');
  try {
    return await db.withTransaction(async (client) => {
      if (expectedMarketId) {
        const { rows: [box] } = await client.query('SELECT market_id FROM hub_physical_units WHERE id = $1', [unit]);
        if (!box) throw failure(404, 'HUB_BOX_NOT_FOUND', 'Carton introuvable');
        if (String(box.market_id || '') !== String(expectedMarketId)) {
          throw failure(409, 'HUB_BOX_SHIPMENT_MARKET_MISMATCH', 'Ce carton n’appartient pas au marché de cette surface');
        }
      }
      const { rows: [shipment] } = await client.query(
        'SELECT id, market_id, stage FROM international_shipments WHERE reference = $1', [reference]
      );
      if (!shipment) throw failure(404, 'INTERNATIONAL_SHIPMENT_NOT_FOUND', 'Expédition introuvable');
      const { rows: [existing] } = await client.query(
        'SELECT shipment_id FROM international_shipment_hub_units WHERE physical_unit_id = $1', [unit]
      );
      if (existing && String(existing.shipment_id) === String(shipment.id)) {
        return { unit_id: unit, shipment_id: shipment.id, shipment_reference: reference, already_attached: true };
      }
      await client.query(
        'INSERT INTO international_shipment_hub_units(shipment_id, physical_unit_id, attached_by) VALUES ($1, $2, $3)',
        [shipment.id, unit, actor && actor.id ? actor.id : null]
      );
      return { unit_id: unit, shipment_id: shipment.id, shipment_reference: reference, already_attached: false };
    });
  } catch (error) {
    throw translate(error);
  }
}

async function detachBoxFromShipment({ unitId }) {
  const unit = requireUuid(unitId, 'unit_id');
  try {
    return await db.withTransaction(async (client) => {
      const { rowCount } = await client.query('DELETE FROM international_shipment_hub_units WHERE physical_unit_id = $1', [unit]);
      if (!rowCount) throw failure(404, 'HUB_BOX_NOT_ATTACHED', 'Ce carton n’est rattaché à aucune expédition');
      return { unit_id: unit, detached: true };
    });
  } catch (error) {
    throw translate(error);
  }
}

module.exports = { attachBoxToShipment, detachBoxFromShipment, lockAttachableBoxes, insertBoxLinks, translate };
