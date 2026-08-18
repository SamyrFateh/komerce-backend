'use strict';

/**
 * LOT 1B-1 — façade CDR canonique transport.
 *
 * Le moteur historique reste conservé dans pricing-cdr-legacy.js pour rendre
 * la correction auditable. Cette façade remplace uniquement l'autorité fret :
 * la quantité taxable vient de transport-valuation (W/M), les composants
 * génériques freight/transit sont exclus, puis le reste du calcul CDR est
 * laissé strictement identique.
 */

const db = require('../db');
const legacy = require('./pricing-cdr-legacy');
const { resolveFxRates } = require('../utils/rates');
const { quoteTransportCost } = require('./transport-valuation');

const TRANSPORT_RULE_KEYS = Object.freeze([
  'SEA_WM_KG_PER_M3',
  'SEA_EUR_PER_M3_COST',
  'SEA_KMF_PER_KG_COMMERCIAL',
  'AIR_KMF_PER_KG_TAXABLE',
  'AIR_VOLUMETRIC_DIVISOR',
  'AIR_KMF_PER_KG_COST',
]);

function scalarRuleValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') {
    const n = Number(raw.value);
    return Number.isFinite(n) ? n : null;
  }
  try {
    const parsed = JSON.parse(String(raw));
    const n = Number(parsed?.value);
    return Number.isFinite(n) ? n : null;
  } catch (_) {
    return null;
  }
}

function canonicalTransportPoliciesFromRows(rows, finance) {
  const policies = {};
  for (const row of rows || []) {
    const value = scalarRuleValue(row.value);
    if (value !== null) policies[row.key] = value;
  }
  const fx = resolveFxRates(finance || {});
  if (Number(fx.eur_kmf) > 0) policies.EUR_KMF = Number(fx.eur_kmf);
  return policies;
}

async function loadGlobalConfig() {
  const config = await legacy.loadGlobalConfig();
  const { rows } = await db.query(`
    SELECT key, value
      FROM business_rules
     WHERE key = ANY($1::text[])
       AND is_active = TRUE
  `, [TRANSPORT_RULE_KEYS]);

  config.transport_policies = canonicalTransportPoliciesFromRows(rows, config.finance);
  config.transport_policy_sources = Object.fromEntries(
    Object.keys(config.transport_policies).map(key => [
      key,
      key === 'EUR_KMF' ? 'finance_config.taux_change_eur_kmf' : `business_rules.${key}`,
    ])
  );
  return config;
}

function hasCanonicalSeaPolicies(config) {
  const p = config?.transport_policies || {};
  return Number(p.SEA_WM_KG_PER_M3) > 0
    && Number(p.SEA_EUR_PER_M3_COST) > 0
    && Number(p.EUR_KMF) > 0;
}

function withoutGenericFreightComponents(config) {
  return (config?.components || []).filter(c => {
    const category = String(c.category || '').toLowerCase();
    return category !== 'freight' && category !== 'transit';
  });
}

function computeCDR(product, ctx = {}) {
  const config = ctx.config;

  // Compatibilité des fixtures/direct-call historiques : le runtime chargé par
  // loadGlobalConfig() est, lui, obligatoirement canonique après migration 124.
  if (!hasCanonicalSeaPolicies(config)) {
    return legacy.computeCDR(product, ctx);
  }

  const weightKg = Number(product?.weight_kg) || 1;
  const volumeM3 = Number(ctx.volume_m3) || 0.005;
  const quote = quoteTransportCost({
    railCode: 'SEA_STANDARD',
    weightKg,
    volumeCm3: volumeM3 * 1_000_000,
    quantity: 1,
    policies: config.transport_policies,
  });

  const targetConfig = {
    ...config,
    finance: {
      ...(config.finance || {}),
      fret_eur_per_m3: config.transport_policies.SEA_EUR_PER_M3_COST,
      taux_change_eur_kmf: config.transport_policies.EUR_KMF,
    },
    components: withoutGenericFreightComponents(config),
  };

  const out = legacy.computeCDR(product, {
    ...ctx,
    config: targetConfig,
    // Le moteur historique reçoit la quantité W/M déjà résolue par la boundary.
    volume_m3: quote.chargeable_quantity,
  });

  out._meta = {
    ...(out._meta || {}),
    freight_authority: 'transport-rails',
    freight_rail: 'SEA_STANDARD',
    freight_chargeable_quantity: quote.chargeable_quantity,
    freight_chargeable_unit: quote.chargeable_unit,
    freight_dominant_measure: quote.dominant_measure,
    freight_cost_rate_key: quote.cost_rate_key,
    freight_cost_rate: quote.cost_rate,
    freight_cost_kmf_boundary: quote.cost_kmf,
    freight_wm_policy_key: quote.wm_policy_key,
    freight_wm_policy_value: quote.wm_policy_value,
  };

  return out;
}

module.exports = {
  ...legacy,
  TRANSPORT_RULE_KEYS,
  scalarRuleValue,
  canonicalTransportPoliciesFromRows,
  hasCanonicalSeaPolicies,
  withoutGenericFreightComponents,
  loadGlobalConfig,
  computeCDR,
};
