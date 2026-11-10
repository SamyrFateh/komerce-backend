/**
 * @komerce-arch
 * @role          market-transport-sale-rate-command
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        central admin actor, market code, rate key, positive local rate, currency, evidence, reason
 * @outputs       current and historical commercial transport sale rates, audited versioned write
 * @depends       services/market-delegation-service.js
 * @used-by       routes/admin-market-control-plane.js
 * @db-read       markets, market_transport_sale_rates
 * @db-write      market_transport_sale_rates, market_delegation_audit
 * @db-txn        caller-owned transaction for writes
 * @doctrine      transport_sale_price_not_freight_cost, local_currency_only, audit_required, fail_closed, no_country_branch
 * @impact-areas  checkout, transport, market, finance
 * @version       2026-11
 */
'use strict';

const delegation = require('./market-delegation-service');
const { RATE_KEYS } = require('./market-transport-sale-rates');

function refusal(code, message, status = 422) {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  return e;
}

function validMarketCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) throw refusal('MARKET_CODE_INVALID', 'Code marché invalide.');
  return code;
}

function validKey(value) {
  const key = String(value || '').trim().toUpperCase();
  if (!RATE_KEYS.includes(key)) throw refusal('TRANSPORT_SALE_RATE_KEY_INVALID', 'Type de transport inconnu.');
  return key;
}

function validRate(value) {
  // NUMERIC(14,4): never round silently; preserve the decimal string for PostgreSQL.
  const text = (typeof value === 'number' || typeof value === 'string') ? String(value).trim() : '';
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/.test(text) || !(Number(text) > 0) || Number(text) >= 1e10) {
    throw refusal('TRANSPORT_SALE_RATE_INVALID', 'Tarif local strictement positif, au maximum quatre décimales.');
  }
  return text;
}

function requiredText(value, code, maxLength = 200) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > maxLength) throw refusal(code, 'Justificatif ou motif obligatoire et de longueur limitée.');
  return text;
}

async function market(executor, marketCode, lock = false) {
  const code = validMarketCode(marketCode);
  const { rows } = await executor.query(
    `SELECT id, code, UPPER(btrim(currency)) AS currency, lifecycle_status
       FROM markets WHERE code = $1${lock ? ' FOR UPDATE' : ''}`,
    [code]
  );
  if (!rows[0]) throw refusal('MARKET_NOT_FOUND', 'Marché introuvable.', 404);
  return rows[0];
}

async function listSaleRates(executor, { marketCode, includeHistory = false }) {
  const m = await market(executor, marketCode);
  const { rows } = await executor.query(
    `SELECT id, rate_key, rate_per_kg::text, currency, evidence_ref, set_by,
            valid_from, revoked_at, created_at
       FROM market_transport_sale_rates
      WHERE market_id = $1 AND (${includeHistory ? 'TRUE' : 'revoked_at IS NULL AND valid_from <= NOW()'})
      ORDER BY rate_key, created_at DESC, id DESC
      ${includeHistory ? 'LIMIT 100' : ''}`,
    [m.id]
  );
  return { market: m.code, currency: m.currency, rates: rows, history_included: includeHistory };
}

async function setSaleRate(executor, { marketCode, rateKey, ratePerKg, currency, evidenceRef, reason, actorUserId, correlationId = null }) {
  const key = validKey(rateKey);
  const value = validRate(ratePerKg);
  const evidence = requiredText(evidenceRef, 'TRANSPORT_SALE_EVIDENCE_REQUIRED');
  const why = requiredText(reason, 'TRANSPORT_SALE_REASON_REQUIRED', 500);
  if (!actorUserId) throw refusal('TRANSPORT_SALE_ACTOR_REQUIRED', 'Auteur obligatoire.', 403);
  const m = await market(executor, marketCode, true);
  if (String(currency || '').trim().toUpperCase() !== m.currency) {
    throw refusal('TRANSPORT_SALE_CURRENCY_MISMATCH', 'Le tarif doit être exprimé dans la devise du marché.');
  }

  const { rows: oldRows } = await executor.query(
    `SELECT id, rate_key, rate_per_kg::text, currency, evidence_ref, set_by, created_at
       FROM market_transport_sale_rates
      WHERE market_id = $1 AND rate_key = $2 AND revoked_at IS NULL
      FOR UPDATE`, [m.id, key]
  );
  const old = oldRows[0] || null;
  if (old && Number(old.rate_per_kg) === Number(value) && old.evidence_ref === evidence) {
    return { market: m.code, currency: m.currency, rate: old, changed: false };
  }

  if (old) {
    await executor.query('UPDATE market_transport_sale_rates SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL', [old.id]);
  }
  const { rows: created } = await executor.query(
    `INSERT INTO market_transport_sale_rates
        (market_id, rate_key, rate_per_kg, currency, evidence_ref, set_by)
      VALUES ($1, $2, $3::numeric, $4, $5, $6::uuid)
      RETURNING id, rate_key, rate_per_kg::text, currency, evidence_ref, set_by, created_at`,
    [m.id, key, value, m.currency, evidence, actorUserId]
  );
  const next = created[0];
  await delegation.audit(executor, {
    actorUserId, marketId: m.id,
    action: 'MARKET_TRANSPORT_SALE_RATE_SET',
    before: old,
    after: { ...next, reason: why },
    correlationId: correlationId ? String(correlationId).slice(0, 200) : null,
  });
  return { market: m.code, currency: m.currency, rate: next, changed: true };
}

module.exports = { listSaleRates, setSaleRate, validRate, validKey, validMarketCode };
