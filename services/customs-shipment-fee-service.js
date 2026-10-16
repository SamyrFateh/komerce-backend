/**
 * @komerce-arch
 * @role          customs-shipment-fee-service
 * @domain        customs
 * @layer         service
 * @criticality   high
 * @inputs        shipment_id, fee_payload, admin_user_id
 * @outputs       append_only_fee_fact, fee_summary_by_type, item_level_reallocation
 * @depends       services/cost-allocation (allocateShipmentRealCosts)
 * @used-by       routes/admin-customs-shipments.js
 * @db-read       customs_shipments, customs_shipment_parcels, customs_shipment_fees
 * @db-write      customs_shipment_fees
 * @db-write-via:cost-allocation order_item_real_cost_allocations
 * @db-txn        recordFee (FOR UPDATE sur l'expédition, ventilation dans la même transaction)
 * @doctrine      customs_unknown_is_not_zero, customs_allocation_conserved_and_atomic
 * @impact-areas  customs, economic-engine
 * @version       2026-10
 */

/**
 * KOMERCE — Frais douaniers typés (manutention, stockage, transitaire, taxe locale, exceptionnel, autre)
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * Seul endroit qui écrit customs_shipment_fees. Les droits/taxes douane globaux restent
 * customs_shipments.customs_paid_kmf (cost_type customs) et le fret freight_kmf : aucun double compte.
 * Inconnu (aucune ligne pour le type) ≠ zéro confirmé (charge à 0). Append-only : correction = credit/charge.
 * La saisie reventile l'expédition dans la même transaction (échec = rien d'écrit) ; le marché de
 * l'expédition fait foi (aucun champ marché dans le payload). Aucun taux de référence n'est utilisé.
 */

'use strict';

const FEE_TYPES = ['handling', 'storage', 'forwarder', 'local_tax', 'exceptional', 'other'];
const KINDS = ['charge', 'credit'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(status, code, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return Object.assign(err, extra);
}

function toUnits(value, scale) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(value).trim());
  if (!m) return null;
  const frac = m[2] || '';
  if (frac.length > scale && /[1-9]/.test(frac.slice(scale))) return null;
  return BigInt(m[1]) * 10n ** BigInt(scale) + BigInt((frac + '0'.repeat(scale)).slice(0, scale) || '0');
}
const cur = (v) => toUnits(v, 4);
const kmfU = (v) => toUnits(v, 2);
const fmt = (units, scale) => {
  const s = units.toString().padStart(scale + 1, '0');
  return `${s.slice(0, -scale)}.${s.slice(-scale)}`;
};

function normalizePayload(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const feeType = typeof p.fee_type === 'string' ? p.fee_type.trim() : '';
  if (!FEE_TYPES.includes(feeType)) throw fail(400, 'CUSTOMS_FEE_TYPE_INVALID', `fee_type doit être l'un de ${FEE_TYPES.join('|')}`);
  const kind = p.kind == null ? 'charge' : String(p.kind).trim();
  if (!KINDS.includes(kind)) throw fail(400, 'CUSTOMS_FEE_KIND_INVALID', `kind doit être ${KINDS.join('|')}`);
  const currency = typeof p.currency === 'string' ? p.currency.trim().toUpperCase() : 'KMF';
  if (!/^[A-Z]{3}$/.test(currency)) throw fail(400, 'CUSTOMS_FEE_CURRENCY_INVALID', 'currency ISO-3 requise');
  const amountKmf = kmfU(p.amount_kmf);
  if (amountKmf == null) throw fail(400, 'CUSTOMS_FEE_AMOUNT_KMF_INVALID', 'amount_kmf >= 0 fini (2 décimales max) requis ; 0 = zéro confirmé');
  if (kind === 'credit' && amountKmf <= 0n) throw fail(400, 'CUSTOMS_FEE_CREDIT_POSITIVE', 'un credit exige amount_kmf > 0');
  const amountCurrency = currency === 'KMF' && p.amount_currency == null ? amountKmf * 100n : cur(p.amount_currency);
  if (amountCurrency == null) throw fail(400, 'CUSTOMS_FEE_AMOUNT_CURRENCY_INVALID', 'amount_currency >= 0 fini (4 décimales max) requis');
  if (currency === 'KMF' && amountCurrency !== amountKmf * 100n) {
    throw fail(400, 'CUSTOMS_FEE_KMF_MISMATCH', 'en KMF, amount_currency doit égaler amount_kmf');
  }
  const proofRef = typeof p.proof_ref === 'string' ? p.proof_ref.trim() : '';
  if (!proofRef) throw fail(400, 'CUSTOMS_FEE_PROOF_REQUIRED', 'proof_ref non vide requis');
  const key = typeof p.idempotency_key === 'string' ? p.idempotency_key.trim() : '';
  if (!key || key.length > 200) throw fail(400, 'CUSTOMS_FEE_IDEMPOTENCY_KEY_REQUIRED', 'idempotency_key non vide (<= 200) requis');
  const notes = typeof p.notes === 'string' && p.notes.trim() ? p.notes.trim() : null;
  return { feeType, kind, currency, amountKmf, amountCurrency, proofRef, key, notes };
}

function sameContent(row, n) {
  return row.fee_type === n.feeType && row.kind === n.kind && row.currency === n.currency
    && kmfU(row.amount_kmf) === n.amountKmf && cur(row.amount_currency) === n.amountCurrency
    && row.proof_ref === n.proofRef && (row.notes || null) === n.notes;
}

const shape = (r) => ({
  id: r.id, shipment_id: r.shipment_id, fee_type: r.fee_type, kind: r.kind,
  amount_currency: String(r.amount_currency), currency: r.currency, amount_kmf: String(r.amount_kmf),
  proof_ref: r.proof_ref, idempotency_key: r.idempotency_key, notes: r.notes,
  recorded_by: r.recorded_by, recorded_at: r.recorded_at,
});

/** États par type : unknown (aucune ligne) | zero_confirmed | amount ; net en unités entières. */
function summarize(rows) {
  const net = new Map(FEE_TYPES.map((t) => [t, { rows: 0, units: 0n }]));
  for (const r of rows) {
    const e = net.get(r.fee_type);
    e.rows += 1;
    e.units += (r.kind === 'credit' ? -1n : 1n) * (kmfU(r.amount_kmf) || 0n);
  }
  const by_type = {};
  let total = 0n;
  for (const t of FEE_TYPES) {
    const e = net.get(t);
    by_type[t] = e.rows === 0
      ? { state: 'unknown', net_kmf: null }
      : { state: e.units === 0n ? 'zero_confirmed' : 'amount', net_kmf: fmt(e.units, 2) };
    total += e.units;
  }
  return { by_type, total_net_kmf: fmt(total, 2), recorded_types: FEE_TYPES.filter((t) => net.get(t).rows > 0) };
}

async function _rows(client, shipmentId) {
  const { rows } = await client.query(
    'SELECT * FROM customs_shipment_fees WHERE shipment_id = $1 ORDER BY recorded_at, id', [shipmentId]);
  return rows;
}

/**
 * @param {object} database module db (withTransaction) OU client dont l'appelant possède la transaction
 * @returns {Promise<{fee:object, summary:object, reallocation:object|null, idempotent_replay:boolean}>}
 */
async function recordFee(database, shipmentId, payload, userId) {
  if (!UUID_RE.test(String(shipmentId || ''))) throw fail(400, 'CUSTOMS_SHIPMENT_ID_INVALID', 'shipment_id (uuid) invalide');
  const n = normalizePayload(payload);
  const run = (fn) => (typeof database.withTransaction === 'function' ? database.withTransaction(fn) : fn(database));
  return run(async (client) => {
    const { rows: [ship] } = await client.query(
      'SELECT id, status, is_active, market_id FROM customs_shipments WHERE id = $1 FOR UPDATE', [shipmentId]);
    if (!ship) throw fail(404, 'CUSTOMS_SHIPMENT_NOT_FOUND', 'expédition introuvable');

    const { rows: [existing] } = await client.query(
      'SELECT * FROM customs_shipment_fees WHERE shipment_id = $1 AND idempotency_key = $2', [shipmentId, n.key]);
    if (existing) {
      if (!sameContent(existing, n)) throw fail(409, 'CUSTOMS_FEE_IDEMPOTENCY_CONFLICT', 'idempotency_key déjà utilisée avec un contenu différent');
      return { fee: shape(existing), summary: summarize(await _rows(client, shipmentId)), reallocation: null, idempotent_replay: true };
    }

    if (ship.is_active === false) throw fail(409, 'CUSTOMS_SHIPMENT_INACTIVE', 'expédition désactivée : aucun frais ne peut être ajouté');
    if (ship.status === 'pending') throw fail(409, 'CUSTOMS_SHIPMENT_NOT_DECLARED', 'déclarer l\'expédition avant d\'enregistrer des frais');
    const { rows: [pc] } = await client.query(
      'SELECT COUNT(*)::int AS n FROM customs_shipment_parcels WHERE shipment_id = $1', [shipmentId]);
    if (!pc.n) throw fail(409, 'CUSTOMS_SHIPMENT_WITHOUT_PARCELS', 'aucun colis rattaché : un frais ne peut être ventilé nulle part');

    const before = await _rows(client, shipmentId);
    const typeNet = before
      .filter((r) => r.fee_type === n.feeType)
      .reduce((s, r) => s + (r.kind === 'credit' ? -1n : 1n) * kmfU(r.amount_kmf), 0n);
    if (n.kind === 'credit' && n.amountKmf > typeNet) {
      throw fail(409, 'CUSTOMS_FEE_CREDIT_EXCEEDS_CHARGES', 'credit supérieur aux frais enregistrés pour ce type', {
        recorded_net_kmf: fmt(typeNet, 2),
      });
    }

    const { rows: [row] } = await client.query(
      `INSERT INTO customs_shipment_fees
         (shipment_id, fee_type, kind, amount_currency, currency, amount_kmf, proof_ref, idempotency_key, notes, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [shipmentId, n.feeType, n.kind, fmt(n.amountCurrency, 4), n.currency, fmt(n.amountKmf, 2),
        n.proofRef, n.key, n.notes, userId || null]);

    // Même transaction : la ventilation article échoue → le frais n'est pas écrit.
    const reallocation = await require('./cost-allocation').allocateShipmentRealCosts(shipmentId, client);
    return { fee: shape(row), summary: summarize([...before, row]), reallocation, idempotent_replay: false };
  });
}

async function listFees(database, shipmentId) {
  if (!UUID_RE.test(String(shipmentId || ''))) throw fail(400, 'CUSTOMS_SHIPMENT_ID_INVALID', 'shipment_id (uuid) invalide');
  const { rows: [ship] } = await database.query('SELECT id FROM customs_shipments WHERE id = $1', [shipmentId]);
  if (!ship) throw fail(404, 'CUSTOMS_SHIPMENT_NOT_FOUND', 'expédition introuvable');
  const rows = await _rows(database, shipmentId);
  return { shipment_id: shipmentId, fees: rows.map(shape), summary: summarize(rows) };
}

module.exports = { recordFee, listFees, summarize, FEE_TYPES, KINDS, _internals: { toUnits, normalizePayload } };
