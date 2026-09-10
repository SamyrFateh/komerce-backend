/**
 * @komerce-arch
 * @role          mobile-money-provider-registry
 * @domain        payment
 * @layer         service
 * @criticality   high
 * @inputs        provider_key
 * @outputs       provider_adapter, public_provider_config
 * @depends       services/mobile-money/orange-money-cm.js, services/mobile-money/mtn-momo-cg.js,
 *                services/mobile-money/kartapay-km.js
 * @used-by       services/payment-mobile-money.js, routes/payments-mobile-money.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      market_selects_provider, runtime_registry_only, no_credentials
 * @impact-areas  payment, checkout
 * @version       2026-09
 */
'use strict';

/**
 * Mobile Money provider registry.
 *
 * La DB décide quel provider est autorisé pour un marché ; ce registre ne
 * contient que les implémentations techniques disponibles dans ce build.
 */

const orangeMoneyCm = require('./orange-money-cm');
const mtnMomoCg     = require('./mtn-momo-cg');
const kartapayKm    = require('./kartapay-km');

const ADAPTERS = new Map([
  [orangeMoneyCm.name, orangeMoneyCm],
  [mtnMomoCg.name, mtnMomoCg],
  [kartapayKm.name, kartapayKm],
]);

function getAdapter(provider) {
  const adapter = ADAPTERS.get(String(provider || '').trim());
  if (!adapter) {
    const err = new Error(`Provider Mobile Money inconnu: ${provider}`);
    err.code = 'mobile_money_provider_unknown';
    throw err;
  }
  return adapter;
}

function getPublicAdapterConfig(provider) {
  return getAdapter(provider).publicConfig();
}

function listAdapters() {
  return [...ADAPTERS.values()];
}

module.exports = {
  getAdapter,
  getPublicAdapterConfig,
  listAdapters,
};
