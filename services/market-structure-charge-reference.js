/**
 * @komerce-arch
 * @role market-owned-structure-charge-reference-writer
 * @domain economic-engine
 * @layer service
 * @db-read charges, markets
 * @db-write charges
 * @db-write-via:pricing-period-structure economic_structure_cost_events
 * @db-txn create_reference_and_period_fact_atomic
 * @doctrine market_scope_from_resolved_route, accounting_truth_is_append_only, zero_reference_is_not_a_fact
 */
'use strict';

const db = require('../db');
const periodStructure = require('./pricing-period-structure');

const FAMILIES = new Set(['demarrage','croisiere','operationnelle','exceptionnelle','incident']);
const RECURRENCES = new Set(['monthly','weekly','quarterly','yearly','annual','one_time']);

function referenceInput(raw = {}) {
  const name = String(raw.name || '').trim();
  const description = String(raw.description || '').trim();
  const family = String(raw.family || 'operationnelle').trim();
  const recurrence = String(raw.recurrence_period || 'monthly').trim();
  if (name.length < 3 || name.length > 120) throw Object.assign(new Error('Nom du poste : 3 à 120 caractères'),{status:400,code:'charge_reference_invalid'});
  if (description.length > 500) throw Object.assign(new Error('Description : 500 caractères maximum'),{status:400,code:'charge_reference_invalid'});
  if (!FAMILIES.has(family) || !RECURRENCES.has(recurrence)) throw Object.assign(new Error('Famille ou fréquence non autorisée'),{status:400,code:'charge_reference_invalid'});
  return {name,description,family,recurrence};
}

async function createMarketChargeAndFact(market, input, actorId, options = {}) {
  if (!market?.id || !actorId) throw new TypeError('Resolved market and actor required');
  const reference = referenceInput(input.reference || {});
  const event = input.event || {};
  // This operation is atomic: no orphan charge reference when evidence is invalid.
  // It never touches charges.amount_kmf with the reported amount.
  const client = options.executor || await db.getClient();
  const ownsTx = !options.executor;
  try {
    if (ownsTx) await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO charges (family, name, amount_kmf, is_recurring,
                            recurrence_period, notes, market_owner_id)
       VALUES ($1, $2, 0, $3, $4, $5, $6)
       RETURNING id, family, name, recurrence_period, notes, market_owner_id`,
      [reference.family,reference.name,reference.recurrence !== 'one_time',
        reference.recurrence,reference.description || null,market.id]
    );
    const charge = inserted.rows[0];
    const fact = await periodStructure.recordStructureCostEvent({
      ...event, charge_id:charge.id, scope_kind:'MARKET_DIRECT', market_id:market.id,
      event_kind:'ACCRUAL', adjusts_event_id:null,
    },actorId,{executor:client});
    if (ownsTx) await client.query('COMMIT');
    return {charge,fact};
  } catch(error) {
    if (ownsTx) await client.query('ROLLBACK');
    if (error.code === '23505') throw Object.assign(new Error('Ce poste fixe existe déjà pour ce marché'),{status:409,code:'charge_reference_conflict'});
    throw error;
  } finally {
    if (ownsTx) client.release();
  }
}

async function updateMarketChargeDescription(market, chargeId, description, options = {}) {
  if (!market?.id) throw new TypeError('Resolved market required');
  const note = String(description || '').trim();
  if (note.length > 500) throw Object.assign(new Error('Description : 500 caractères maximum'),{status:400,code:'charge_reference_invalid'});
  const dbExecutor = options.executor || db;
  const result = await dbExecutor.query(
    `UPDATE charges SET notes=$1,updated_at=NOW()
       WHERE id=$2 AND market_owner_id=$3 AND is_active=TRUE
       RETURNING id,notes`,
    [note || null,chargeId,market.id]
  );
  if (!result.rows.length) throw Object.assign(new Error('Poste de ce marché introuvable'),{status:404,code:'charge_reference_not_found'});
  return result.rows[0];
}

module.exports={referenceInput,createMarketChargeAndFact,updateMarketChargeDescription};
