/**
 * @komerce-arch
 * @role          market-lifecycle-writer
 * @domain        market
 * @layer         service
 * @criticality   high
 * @inputs        central provisioning payload, caller-owned transaction
 * @outputs       canonical market row in PROVISIONING, audited lifecycle transitions
 * @depends       services/fx-authority.js
 * @used-by       services/market-provisioning-service.js
 * @db-read       markets, market_operating_assignments
 * @db-write      markets
 * @db-txn        caller-owned
 * @doctrine      market_owns_market_lifecycle, lifecycle_never_grants_user_authority
 * @impact-areas  market, market-control-plane, authorization
 * @version       2026-10-v1
 */
'use strict';

const { MINOR_UNITS } = require('./fx-authority');

function lifecycleError(code, message, status = 400) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeMarketCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('market-lifecycle-service: executor.query requis');
  }
  return executor;
}

function normalizeCurrency(value) {
  const currency = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function validateProvisioningCurrency(currency, minorUnit) {
  const code = normalizeCurrency(currency);
  if (!code || !Object.prototype.hasOwnProperty.call(MINOR_UNITS,code)) throw lifecycleError('MARKET_CURRENCY_UNSUPPORTED','Devise non prise en charge par le moteur de change canonique.',400);
  if (minorUnit != null && (String(minorUnit).trim() === '' || Number(minorUnit) !== MINOR_UNITS[code])) throw lifecycleError('MARKET_MINOR_UNIT_INVALID','Nombre de décimales incompatible avec la devise canonique.',400);
  return MINOR_UNITS[code];
}

function validateBusinessTimezone(value, {required=false}={}) {
  if (value == null || value === '') {
    if (!required) return null;
    throw lifecycleError('MARKET_TIMEZONE_REQUIRED','Fuseau horaire IANA du marché requis.',400);
  }
  if (typeof value !== 'string' || value.length > 100 || !/^(?:UTC|[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+)$/.test(value)) {
    throw lifecycleError('MARKET_TIMEZONE_INVALID','Fuseau horaire IANA invalide.',400);
  }
  try { new Intl.DateTimeFormat('fr-FR',{timeZone:value}); }
  catch (_) { throw lifecycleError('MARKET_TIMEZONE_INVALID','Fuseau horaire IANA inconnu.',400); }
  return value;
}

async function createProvisioningMarket(executor, {
  code, name, currency, minorUnit = 0, businessTimezone = null, storefrontTexts = {}, actorUserId = null, correlationId = null,
}) {
  const db = requireExecutor(executor);
  const marketCode = normalizeMarketCode(code);
  const marketCurrency = normalizeCurrency(currency);
  const marketName = String(name || '').trim();
  const unit = Number(minorUnit);
  const timezone = validateBusinessTimezone(businessTimezone);

  if (!marketCode) throw lifecycleError('MARKET_CODE_INVALID', 'Code marché invalide.', 400);
  if (!marketName) throw lifecycleError('MARKET_NAME_REQUIRED', 'Nom marché requis.', 400);
  if (!marketCurrency) throw lifecycleError('MARKET_CURRENCY_INVALID', 'Devise marché invalide.', 400);
  if (!Number.isInteger(unit) || unit < 0 || unit > 4) {
    throw lifecycleError('MARKET_MINOR_UNIT_INVALID', 'minor_unit invalide.', 400);
  }
  if (!storefrontTexts || typeof storefrontTexts !== 'object' || Array.isArray(storefrontTexts)) {
    throw lifecycleError('MARKET_STOREFRONT_TEXTS_INVALID', 'storefront_texts doit être un objet JSON.', 400);
  }

  const { rows: existing } = await db.query('SELECT id FROM markets WHERE code=$1 LIMIT 1', [marketCode]);
  if (existing[0]) throw lifecycleError('MARKET_ALREADY_EXISTS', `Marché ${marketCode} déjà existant.`, 409);

  const { rows } = await db.query(
    `INSERT INTO markets (code,name,currency,minor_unit,is_active,lifecycle_status,storefront_texts,business_timezone)
     VALUES ($1,$2,$3,$4,FALSE,'PROVISIONING',$5::jsonb,$6)
     RETURNING id,code,name,currency,minor_unit,is_active,lifecycle_status,storefront_texts,created_at,business_timezone`,
    [marketCode, marketName, marketCurrency, unit, JSON.stringify(storefrontTexts), timezone]
  );
  return rows[0];
}


const ALLOWED_TRANSITIONS = Object.freeze({
  PROVISIONING: Object.freeze(['ACTIVE','CLOSED']),
  ACTIVE: Object.freeze(['SUSPENDED','CLOSED']),
  SUSPENDED: Object.freeze(['ACTIVE','CLOSED']),
  CLOSED: Object.freeze([]),
});

async function transitionMarketLifecycle(executor, { marketCode, targetStatus }) {
  const db = requireExecutor(executor);
  const code = normalizeMarketCode(marketCode);
  const target = String(targetStatus || '').trim().toUpperCase();
  if (!code) throw lifecycleError('MARKET_CODE_INVALID', 'Code marché invalide.', 400);
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_TRANSITIONS, target)) {
    throw lifecycleError('MARKET_LIFECYCLE_STATUS_INVALID', 'Statut lifecycle invalide.', 400);
  }

  const { rows } = await db.query(
    `SELECT id,code,lifecycle_status,is_active
       FROM markets
      WHERE code=$1
      LIMIT 1
      FOR UPDATE`,
    [code]
  );
  const current = rows[0];
  if (!current) throw lifecycleError('MARKET_NOT_FOUND', 'Marché introuvable.', 404);
  if (current.lifecycle_status === target) return { before: current, after: current, changed: false };

  const allowed = ALLOWED_TRANSITIONS[current.lifecycle_status] || [];
  if (!allowed.includes(target)) {
    throw lifecycleError(
      'MARKET_LIFECYCLE_TRANSITION_FORBIDDEN',
      `Transition ${current.lifecycle_status} -> ${target} interdite.`,
      409
    );
  }

  const isActive = target === 'ACTIVE' || target === 'SUSPENDED';
  const { rows: updated } = await db.query(
    `UPDATE markets
        SET lifecycle_status=$2,
            is_active=$3
      WHERE id=$1::uuid
      RETURNING id,code,lifecycle_status,is_active`,
    [current.id, target, isActive]
  );
  return { before: current, after: updated[0], changed: true };
}


async function loadProvisioningMarket(executor, { marketCode }) {
  const db = requireExecutor(executor);
  const code = normalizeMarketCode(marketCode);
  if (!code) throw lifecycleError('MARKET_CODE_INVALID', 'Code marché invalide.', 400);
  const { rows } = await db.query(
    `SELECT id,code,name,currency,minor_unit,is_active,lifecycle_status,storefront_texts,created_at,business_timezone
       FROM markets
      WHERE code=$1
      LIMIT 1
      FOR UPDATE`,
    [code]
  );
  const market = rows[0];
  if (!market) throw lifecycleError('MARKET_NOT_FOUND', 'Marché introuvable.', 404);
  if (market.lifecycle_status !== 'PROVISIONING' || market.is_active) {
    throw lifecycleError(
      'MARKET_REPROVISION_REQUIRES_PROVISIONING',
      'Le reprovisioning exige un marché PROVISIONING et inactif.',
      409
    );
  }
  const { rows: activeAssignments } = await db.query(
    `SELECT id FROM market_operating_assignments
      WHERE market_id=$1::uuid AND status='ACTIVE'
      LIMIT 1`,
    [market.id]
  );
  if (activeAssignments[0]) {
    throw lifecycleError(
      'MARKET_REPROVISION_ACTIVE_ASSIGNMENT',
      'Un assignment ACTIVE existe encore pour ce marché.',
      409
    );
  }
  return market;
}

// A missing timezone may be completed on the original market, without
// touching its assignment, members, financial configuration or other metadata.
async function completeProvisioningTimezone(executor, {marketCode,businessTimezone}) {
  const db=requireExecutor(executor);
  const code=normalizeMarketCode(marketCode);
  if(!code)throw lifecycleError('MARKET_CODE_INVALID','Code marché invalide.',400);
  const timezone=validateBusinessTimezone(businessTimezone,{required:true});
  const {rows:[before]}=await db.query(
    'SELECT id,code,is_active,lifecycle_status,business_timezone FROM markets WHERE code=$1 FOR UPDATE',[code]);
  if(!before)throw lifecycleError('MARKET_NOT_FOUND','Marché introuvable.',404);
  if(before.lifecycle_status!=='PROVISIONING'||before.is_active)throw lifecycleError('MARKET_TIMEZONE_PREPARATION_ONLY','Complément du fuseau réservé à la préparation.',409);
  if(before.business_timezone===timezone)return {before,after:before,changed:false};
  if(before.business_timezone!=null)throw lifecycleError('MARKET_TIMEZONE_ALREADY_SET','Fuseau déjà arrêté : modification soumise à un arbitrage distinct.',409);
  const {rows:[after]}=await db.query(
    'UPDATE markets SET business_timezone=$2 WHERE id=$1::uuid RETURNING id,code,is_active,lifecycle_status,business_timezone',[before.id,timezone]);
  return {before,after,changed:true};
}

// The market feature is the sole runtime writer of its editorial metadata.
// This is never a financial, payment or market-authorization write.
const { PUBLIC_TEXT_KEYS } = require('./public-market-storefront');
const PUBLIC_KEY_SET = new Set(PUBLIC_TEXT_KEYS);

function validateStorefrontTexts(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw lifecycleError('MARKET_STOREFRONT_TEXTS_INVALID', 'Paramètres boutique invalides.', 400);
  }
  const clean = {};
  for (const [key, value] of Object.entries(input)) {
    if (!PUBLIC_KEY_SET.has(key)) {
      throw lifecycleError('MARKET_STOREFRONT_FIELD_UNKNOWN', 'Champ boutique non autorisé.', 400);
    }
    if (value === null && key === 'relay_default_zone') {
      clean[key] = null;
      continue;
    }
    if (typeof value !== 'string' || value.length > 500) {
      throw lifecycleError('MARKET_STOREFRONT_VALUE_INVALID', 'Texte boutique invalide (500 caractères maximum).', 400);
    }
    clean[key] = value.trim();
  }
  return clean;
}

async function updateMarketStorefront(executor, { marketCode, storefrontTexts }) {
  const db = requireExecutor(executor);
  const code = normalizeMarketCode(marketCode);
  if (!code) throw lifecycleError('MARKET_CODE_INVALID', 'Code marché invalide.', 400);
  const texts = validateStorefrontTexts(storefrontTexts);
  const { rows } = await db.query(
    'SELECT id,code,lifecycle_status,storefront_texts FROM markets WHERE code=$1 FOR UPDATE',
    [code]
  );
  if (!rows[0]) throw lifecycleError('MARKET_NOT_FOUND', 'Marché introuvable.', 404);
  if (rows[0].lifecycle_status === 'CLOSED') {
    throw lifecycleError('MARKET_CLOSED', 'Marché fermé : édition interdite.', 409);
  }
  // Preserve historical/future non-public metadata; only caller-supplied
  // whitelisted display fields may be modified through this command.
  const merged = { ...(rows[0].storefront_texts || {}), ...texts };
  const { rows: edited } = await db.query(
    `UPDATE markets SET storefront_texts=$2::jsonb WHERE id=$1::uuid
        AND storefront_texts IS DISTINCT FROM $2::jsonb
      RETURNING id,code,storefront_texts`,
    [rows[0].id, JSON.stringify(merged)]
  );
  return { changed: edited.length > 0, before: rows[0], after: edited[0] || rows[0] };
}

module.exports = {
  completeProvisioningTimezone, validateBusinessTimezone, validateProvisioningCurrency, ALLOWED_TRANSITIONS, createProvisioningMarket, loadProvisioningMarket, normalizeCurrency, transitionMarketLifecycle, validateStorefrontTexts, updateMarketStorefront };
