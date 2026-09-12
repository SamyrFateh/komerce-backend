/**
 * @komerce-arch
 * @role          aliexpress-fulfillment-adapter
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        persisted Supplier Order Identity + destination + quantity
 * @outputs       exact live unit observation + freight preflight verdict
 * @depends       services/suppliers/connectors/aliexpress-connected-connector.js, services/suppliers/aliexpress-purchase-preflight.js, services/suppliers/supplier-order-identity.js
 * @used-by       services/suppliers/supplier-fulfillment-readiness.js callers
 * @db-read       supplier_oauth_connections (via connected connector)
 * @db-write      supplier_oauth_connections (token refresh only, via connected connector)
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
 * @impact-areas  purchasing,supplier-integration,catalog
 * @version       2026-09-v1
 */
'use strict';

const { isDeepStrictEqual } = require('node:util');
const connected = require('../connectors/aliexpress-connected-connector');
const preflight = require('../aliexpress-purchase-preflight');
const { blockedSupplierIdentity } = require('../supplier-order-identity');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function countryCode(destination = {}) {
  const code = clean(destination.country_code || destination.countryCode).toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(code)) throw new Error('destination.country_code requis pour le preflight AliExpress');
  return code;
}

function exactUnitByPersistedRef(contract, mapping) {
  const matches = (contract?.sellable_units || []).filter((unit) => (
    clean(unit?.supplier_unit_ref) === mapping.supplier_unit_ref
  ));
  if (matches.length !== 1) {
    throw blockedSupplierIdentity(
      `supplier_unit_ref doit résoudre exactement une unité live: ${mapping.supplier_unit_ref} (${matches.length} trouvée(s))`,
      {
        supplier_product_ref: mapping.supplier_product_ref,
        supplier_unit_ref: mapping.supplier_unit_ref,
        matches: matches.length,
      }
    );
  }
  return matches[0];
}

function assertStableIdentity(mapping, liveResolved) {
  if (clean(liveResolved.supplier_product_id) !== mapping.supplier_product_ref) {
    throw blockedSupplierIdentity('supplier_product_ref live divergent', {
      persisted: mapping.supplier_product_ref,
      live: liveResolved.supplier_product_id || null,
    });
  }
  if (clean(liveResolved.supplier_unit_ref) !== mapping.supplier_unit_ref) {
    throw blockedSupplierIdentity('supplier_unit_ref live divergent', {
      persisted: mapping.supplier_unit_ref,
      live: liveResolved.supplier_unit_ref || null,
    });
  }
  if (!isDeepStrictEqual(liveResolved.supplier_order_identity, mapping.supplier_order_identity)) {
    throw blockedSupplierIdentity('supplier_order_identity live divergente', {
      supplier_product_ref: mapping.supplier_product_ref,
      supplier_unit_ref: mapping.supplier_unit_ref,
    });
  }
}

function createAliExpressFulfillmentAdapter({
  connectedImpl = connected,
  preflightImpl = preflight,
} = {}) {
  return {
    provider: 'aliexpress',

    async refresh(mapping, context = {}) {
      const qty = context.quantity;
      const destination = context.destination || {};
      const code = countryCode(destination);
      const providerEnv = await connectedImpl.managedRuntimeEnv(context.options || {});
      const fetched = await connectedImpl.fetchProducts({
        ...(context.options || {}),
        env: providerEnv,
        productIds: [mapping.supplier_product_ref],
        countryCode: code,
      });
      const contracts = fetched?.products || [];
      const liveContract = contracts.find((item) => (
        clean(item?.supplier_product_id) === mapping.supplier_product_ref
      ));
      if (!liveContract) {
        throw new Error(`AliExpress n'a pas renvoyé le produit ${mapping.supplier_product_ref}`);
      }

      const exactUnit = exactUnitByPersistedRef(liveContract, mapping);
      const liveResolved = preflightImpl.resolveOrderableUnit(
        liveContract,
        exactUnit.supplier_sku,
        qty,
        { requireOrderIdentity: true }
      );
      assertStableIdentity(mapping, liveResolved);

      return {
        available: true,
        stock_available: liveResolved.stock_available,
        unit_price: liveResolved.unit_price,
        currency: liveResolved.currency,
        observed_at: new Date().toISOString(),
        adapter_context: {
          provider_env: providerEnv,
          resolved: liveResolved,
        },
      };
    },

    async preflight(_mapping, live, context = {}) {
      const resolved = live?.adapter_context?.resolved;
      const providerEnv = live?.adapter_context?.provider_env;
      if (!resolved || !providerEnv) throw new Error('contexte AliExpress live absent avant preflight');

      const params = preflightImpl.buildFreightBusinessParams(resolved, context.destination || {});
      let payload;
      try {
        payload = await connectedImpl.invokeTop(preflightImpl.METHODS.FREIGHT, params, { env: providerEnv });
      } catch (error) {
        error.error_class = preflightImpl.classifyApiError(error);
        throw error;
      }
      const summary = preflightImpl.summarizeFreightResponse(payload);
      if (summary.success === false) {
        return {
          ready: false,
          shippable: null,
          freight_available: null,
          method: preflightImpl.METHODS.FREIGHT,
          summary,
        };
      }
      if (!summary.has_options) {
        return {
          ready: false,
          shippable: null,
          freight_available: false,
          method: preflightImpl.METHODS.FREIGHT,
          summary,
        };
      }
      return {
        ready: true,
        shippable: true,
        freight_available: true,
        method: preflightImpl.METHODS.FREIGHT,
        summary,
      };
    },
  };
}

const adapter = createAliExpressFulfillmentAdapter();

module.exports = {
  countryCode,
  exactUnitByPersistedRef,
  assertStableIdentity,
  createAliExpressFulfillmentAdapter,
  adapter,
};
