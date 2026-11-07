/**
 * @komerce-arch
 * @role market-transport-sale-rate-writer
 * @domain logistics
 * @layer service
 * @criticality critical
 * @inputs central admin, market code, commercial rail key, rate, local currency, evidence
 * @outputs audited active tariff and previous tariff revocation
 * @depends market-delegation-service, fx-authority, db transaction supplied by caller
 * @db-read markets, market_transport_sale_rates, currency_parities
 * @db-write market_transport_sale_rates, market_delegation_audit
 * @db-txn caller
 * @doctrine sale_price_distinct_from_freight_cost, no_implicit_fx, fail_closed
 */
'use strict';

const delegation = require('./market-delegation-service');
const { RATE_KEYS, convertRateToKmfPerKg } = require('./market-transport-sale-rates');

function invalid(message, code = 'MARKET_TRANSPORT_RATE_INVALID', status = 422) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
function canonicalRate(value) {
  const raw = String(value ?? '').trim();
  if (!/^(?:[0-9]{1,10})(?:\.[0-9]{1,4})?$/.test(raw) || !(Number(raw) > 0)) {
    throw invalid('Tarif par kg positif avec au plus quatre décimales requis');
  }
  return raw;
}
function marketCode(value) {
  const code = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) throw invalid('Code marché invalide');
  return code;
}
function rateKey(value) {
  if (!RATE_KEYS.includes(value)) throw invalid('Rail commercial inconnu');
  return value;
}
function evidenceRef(value) {
  const ref = String(value ?? '').trim();
  if (!ref || ref.length > 200) throw invalid('Référence justificative obligatoire (200 caractères maximum)');
  return ref;
}
function reasonText(value) {
  const reason = String(value ?? '').trim();
  if (!reason || reason.length > 500) throw invalid('Motif de modification obligatoire (500 caractères maximum)');
  return reason;
}
function publicRow(row) {
  return row && {
    id: row.id, rate_key: row.rate_key, rate_per_kg: row.rate_per_kg,
    currency: row.currency, evidence_ref: row.evidence_ref,
    valid_from: row.valid_from, revoked_at: row.revoked_at,
    set_by: row.set_by,
  };
}
async function resolveMarket(client, code) {
  const { rows } = await client.query(
    'SELECT id, code, currency FROM markets WHERE code=$1 FOR SHARE', [marketCode(code)]
  );
  if (!rows.length) throw invalid('Marché introuvable', 'MARKET_NOT_FOUND', 404);
  return rows[0];
}
async function list(client, { code }) {
  const market = await resolveMarket(client, code);
  const { rows } = await client.query(
    'SELECT id, rate_key, rate_per_kg::text, currency, evidence_ref, valid_from, revoked_at, set_by FROM market_transport_sale_rates WHERE market_id=$1 AND revoked_at IS NULL ORDER BY rate_key',
    [market.id]
  );
  return { market: market.code, currency: market.currency, rates: rows.map(publicRow) };
}
async function set(client, { actorUserId, code, key, ratePerKg, currency, evidence, reason, correlationId = null }) {
  const selectedKey = rateKey(key);
  const amount = canonicalRate(ratePerKg);
  const proof = evidenceRef(evidence);
  const why = reasonText(reason);
  const market = await resolveMarket(client, code);
  const ccy = String(currency ?? '').trim().toUpperCase();
  if (ccy !== String(market.currency).trim().toUpperCase()) {
    throw invalid('La devise du tarif doit être celle du marché', 'MARKET_TRANSPORT_CURRENCY_MISMATCH');
  }
  // Une devise sans conversion autorisée ne peut pas servir à établir un prix.
  await convertRateToKmfPerKg(amount, ccy, { client });
  // Serialise les remplacements concurrents d'un même tarif par marché.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [String(market.id), selectedKey]);
  const { rows: oldRows } = await client.query(
    'SELECT id, rate_key, rate_per_kg::text, currency, evidence_ref, valid_from, revoked_at, set_by FROM market_transport_sale_rates WHERE market_id=$1 AND rate_key=$2 AND revoked_at IS NULL FOR UPDATE',
    [market.id, selectedKey]
  );
  const previous = oldRows[0] || null;
  if (previous && String(previous.rate_per_kg) === amount &&
      previous.currency === ccy && previous.evidence_ref === proof) {
    return { market: market.code, unchanged: true, rate: publicRow(previous) };
  }
  if (previous) {
    await client.query('UPDATE market_transport_sale_rates SET revoked_at=now() WHERE id=$1', [previous.id]);
  }
  const { rows } = await client.query(
    `INSERT INTO market_transport_sale_rates
       (market_id,rate_key,rate_per_kg,currency,evidence_ref,set_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id,rate_key,rate_per_kg::text,currency,evidence_ref,valid_from,revoked_at,set_by`,
    [market.id, selectedKey, amount, ccy, proof, actorUserId]
  );
  const next = rows[0];
  await delegation.audit(client, {
    actorUserId, marketId: market.id, action: 'MARKET_TRANSPORT_SALE_RATE_SET',
    before: previous && publicRow(previous),
    after: { ...publicRow(next), reason: why },
    correlationId: correlationId ? String(correlationId).slice(0, 200) : null,
  });
  return { market: market.code, unchanged: false, rate: publicRow(next) };
}
module.exports = { list, set, canonicalRate, rateKey, marketCode, evidenceRef, reasonText };
