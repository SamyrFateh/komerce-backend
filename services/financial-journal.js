/**
 * @komerce-arch
 * @role          financial-journal
 * @domain        finance
 * @layer         service
 * @criticality   critical
 * @inputs        source_fact, native_amount, currency, occurred_at, eur_snapshot, documents
 * @outputs       financial_movements, financial_movement_documents
 * @depends       db, services/fx-authority.js
 * @used-by       services/financial-journal-projectors.js
 * @db-read       financial_movements
 * @db-write      financial_movements, financial_movement_documents
 * @db-txn        caller_provided_client
 * @doctrine      eur_is_the_pivot, single_conversion_authority, idempotent_projection, native_amounts_preserved, historical_rates_frozen, not_double_entry
 * @impact-areas  finance, accounting, dashboards
 * @version       2026-11
 *
 * Journal financier canonique : un mouvement = un fait métier projeté (clé idempotente source_kind:source_id:facet).
 * Montants natifs, jambes FX historiques et EUR figés une fois posés (trigger SQL) ; l'état n'avance qu'en avant.
 * La conversion passe par l'unique autorité fx-authority (aucun taux du jour recalculé après coup).
 * Si l'EUR est indisponible (taux absent/périmé) le mouvement est quand même journalisé en fx_status 'unavailable'
 * et reste rattrapable (attachEur) : jamais d'agrégat EUR inventé.
 */
'use strict';

const fx = require('./fx-authority');

const STATE_RANK = Object.freeze({ planned: 0, committed: 1, observed: 2, settled: 3, reversed: 4 });
const LINK_COLUMNS = Object.freeze({
  marketId: 'market_id', orderId: 'order_id', purchaseOrderId: 'purchase_order_id', shipmentId: 'shipment_id',
  parcelId: 'parcel_id', supplierId: 'supplier_id', relaisId: 'relais_id',
});

function journalError(message, code) {
  return Object.assign(new Error(message), { code, status: 409 });
}

async function resolveEur(client, { amountNative, currency, occurredAt, eur }) {
  if (eur && eur.amount != null && Number(eur.amount) > 0) {
    return { status: 'snapshot', amount: String(eur.amount_text || eur.amount), legs: eur.legs || [], asOf: eur.as_of || occurredAt };
  }
  if (currency === 'EUR') return { status: 'native_eur', amount: String(amountNative), legs: [], asOf: occurredAt };
  try {
    const converted = await fx.convert({ amount: String(amountNative), from: currency, to: 'EUR', at: occurredAt, client });
    return { status: 'converted', amount: converted.amount_text, legs: converted.legs, asOf: occurredAt };
  } catch (error) {
    return { status: 'unavailable', amount: null, legs: [], asOf: null, reason: error.code || error.message };
  }
}

/**
 * Journalise (ou rejoue) un mouvement. Idempotent : même clé + mêmes montants natifs = no-op (état avancé si plus loin).
 * Même clé + montant/devise différents = conflit explicite (correction par mouvement 'reversed', jamais réécriture).
 */
async function recordMovement(client, input) {
  const {
    sourceKind, sourceId, facet = 'main', direction, category, state, links = {}, amountNative, currency,
    occurredAt, eur = null, provenance = {}, documents = [],
  } = input;
  if (!(Number(amountNative) > 0)) return { skipped: 'non_positive_amount' };
  if (!Object.prototype.hasOwnProperty.call(STATE_RANK, state)) throw journalError(`État inconnu : ${state}`, 'JOURNAL_STATE_INVALID');
  const key = `${sourceKind}:${sourceId}:${facet}`;

  const { rows: [existing] } = await client.query(
    'SELECT id, state, amount_native::text AS amount_native, currency, fx_status FROM financial_movements WHERE movement_key = $1 FOR UPDATE', [key]);

  let movementId;
  let outcome;
  if (existing) {
    if (Number(existing.amount_native) !== Number(amountNative) || existing.currency !== currency) {
      throw journalError(`Mouvement ${key} déjà journalisé avec un montant différent.`, 'JOURNAL_MOVEMENT_CONFLICT');
    }
    movementId = existing.id;
    outcome = 'replayed';
    const advance = STATE_RANK[state] > STATE_RANK[existing.state];
    const needEur = existing.fx_status === 'unavailable';
    const conv = needEur ? await resolveEur(client, { amountNative, currency, occurredAt, eur }) : null;
    if (advance || (conv && conv.status !== 'unavailable')) {
      await client.query(
        `UPDATE financial_movements SET state = $2,
                amount_eur = COALESCE($3::numeric, amount_eur), fx_status = COALESCE($4, fx_status),
                fx_legs = COALESCE($5::jsonb, fx_legs), fx_as_of = COALESCE($6::timestamptz, fx_as_of)
          WHERE id = $1`,
        [movementId, advance ? state : existing.state,
          conv && conv.status !== 'unavailable' ? conv.amount : null, conv && conv.status !== 'unavailable' ? conv.status : null,
          conv && conv.status !== 'unavailable' ? JSON.stringify(conv.legs) : null, conv && conv.status !== 'unavailable' ? conv.asOf : null]);
      outcome = conv && conv.status !== 'unavailable' ? 'eur_attached' : 'advanced';
    }
  } else {
    const conv = await resolveEur(client, { amountNative, currency, occurredAt, eur });
    const linkCols = Object.keys(links).filter(k => LINK_COLUMNS[k] && links[k]);
    const cols = ['movement_key', 'source_kind', 'source_id', 'facet', 'direction', 'category', 'state',
      'amount_native', 'currency', 'amount_eur', 'fx_status', 'fx_legs', 'fx_as_of', 'occurred_at', 'provenance',
      ...linkCols.map(k => LINK_COLUMNS[k])];
    const vals = [key, sourceKind, String(sourceId), facet, direction, category, state,
      String(amountNative), currency, conv.amount, conv.status, JSON.stringify(conv.legs), conv.asOf, occurredAt, JSON.stringify(provenance),
      ...linkCols.map(k => links[k])];
    const { rows: [row] } = await client.query(
      `INSERT INTO financial_movements (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
       ON CONFLICT (movement_key) DO NOTHING RETURNING id`, vals);
    if (!row) return recordMovement(client, input); // course concurrente : rejouer en mode « existant »
    movementId = row.id;
    outcome = 'created';
  }

  for (const doc of documents) {
    if (!doc || !doc.ref) continue;
    await client.query(
      `INSERT INTO financial_movement_documents (movement_id, doc_kind, doc_ref, doc_url) VALUES ($1, $2, $3, $4)
       ON CONFLICT (movement_id, doc_kind, doc_ref) DO NOTHING`, [movementId, doc.kind || 'proof', String(doc.ref), doc.url || null]);
  }
  return { id: movementId, key, outcome };
}

module.exports = { recordMovement, resolveEur, STATE_RANK, journalError };
