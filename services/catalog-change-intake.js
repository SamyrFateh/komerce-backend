/**
 * @komerce-arch
 * @role          catalog-change-intake-contract
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        catalog_change_envelope
 * @outputs       normalized_catalog_change
 * @depends       none
 * @used-by       tests/unit/catalog-change-intake.test.js (no runtime consumer yet)
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CATALOG_CHANGE_INTAKE.md
 * @impact-areas  catalog, supplier-import
 * @version       2026-09
 */
'use strict';

const METHODS = Object.freeze(new Set([
  'PULL_EXACT', 'CHANGE_FEED', 'WEBHOOK', 'FILE', 'MANUAL', 'API_PUSH',
]));
const FACTS = Object.freeze(new Set([
  'stock_available', 'purchase_price', 'currency', 'offer_status', 'is_active',
  'media', 'attributes', 'option_axes', 'sellable_units', 'description', 'title',
]));
const STATUS = Object.freeze({
  OBSERVED: 'OBSERVED',
  UNKNOWN: 'UNKNOWN',
  REMOVAL_CONFIRMED: 'REMOVAL_CONFIRMED',
});

function nonEmpty(value, name) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new TypeError(`${name} required`);
  return text;
}

function observedAt(value) {
  const text = nonEmpty(value, 'observed_at');
  const ms = Date.parse(text);
  if (!Number.isFinite(ms) || !/[zZ]|[+-]\d\d:\d\d$/.test(text)) {
    throw new TypeError('observed_at must be an offset-aware ISO timestamp');
  }
  return new Date(ms).toISOString();
}

function normalizeFact(name, fact) {
  if (!FACTS.has(name)) throw new TypeError(`unsupported catalog fact: ${name}`);
  if (!fact || typeof fact !== 'object' || Array.isArray(fact)) {
    throw new TypeError(`fact ${name} must be an object`);
  }
  const status = nonEmpty(fact.status, `facts.${name}.status`).toUpperCase();
  if (!Object.values(STATUS).includes(status)) {
    throw new TypeError(`facts.${name}.status unsupported`);
  }
  if (status === STATUS.UNKNOWN) {
    if (Object.prototype.hasOwnProperty.call(fact, 'value')) {
      throw new TypeError(`facts.${name}: UNKNOWN must not carry a value`);
    }
    return Object.freeze({ status, reason: nonEmpty(fact.reason, `facts.${name}.reason`) });
  }
  if (status === STATUS.REMOVAL_CONFIRMED && name !== 'offer_status' && name !== 'is_active') {
    throw new TypeError('REMOVAL_CONFIRMED only applies to offer_status/is_active');
  }
  if (!Object.prototype.hasOwnProperty.call(fact, 'value')) {
    throw new TypeError(`facts.${name}.value required for ${status}`);
  }
  if (name === 'stock_available') {
    if (!Number.isSafeInteger(fact.value) || fact.value < 0) {
      throw new TypeError('stock_available must be an integer >= 0');
    }
  }
  if (name === 'purchase_price'
      && (typeof fact.value !== 'number' || !Number.isFinite(fact.value) || fact.value <= 0)) {
    throw new TypeError('purchase_price must be a finite number > 0');
  }
  return Object.freeze({ status, value: fact.value });
}

function normalizeCatalogChangeEnvelope(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('catalog change envelope must be an object');
  }
  const method = nonEmpty(input.method, 'method').toUpperCase();
  if (!METHODS.has(method)) throw new TypeError(`unsupported catalog change method: ${method}`);
  const subject = input.subject;
  if (!subject || typeof subject !== 'object' || Array.isArray(subject)) {
    throw new TypeError('subject required');
  }
  const unitRef = typeof subject.unit_ref === 'string' && subject.unit_ref.trim()
    ? subject.unit_ref.trim() : null;
  const productRef = typeof subject.product_ref === 'string' && subject.product_ref.trim()
    ? subject.product_ref.trim() : null;
  if (!unitRef && !productRef) throw new TypeError('subject.product_ref or subject.unit_ref required');

  if (!input.facts || typeof input.facts !== 'object' || Array.isArray(input.facts)
      || Object.keys(input.facts).length === 0) {
    throw new TypeError('facts required');
  }
  const facts = {};
  for (const [name, fact] of Object.entries(input.facts)) {
    facts[name] = normalizeFact(name, fact);
  }

  return Object.freeze({
    schema_version: 1,
    source: Object.freeze({
      provider: nonEmpty(input.source?.provider, 'source.provider').toLowerCase(),
      account_scope: nonEmpty(input.source?.account_scope, 'source.account_scope'),
      source_ref: nonEmpty(input.source?.source_ref, 'source.source_ref'),
    }),
    method,
    event_id: input.event_id == null ? null : nonEmpty(input.event_id, 'event_id'),
    observed_at: observedAt(input.observed_at),
    subject: Object.freeze({ product_ref: productRef, unit_ref: unitRef }),
    facts: Object.freeze(facts),
    raw_ref: input.raw_ref == null ? null : nonEmpty(input.raw_ref, 'raw_ref'),
    authority: 'catalog_change_intake_only',
    application_status: 'NOT_EVALUATED',
  });
}

module.exports = {
  METHODS,
  FACTS,
  STATUS,
  normalizeCatalogChangeEnvelope,
};
