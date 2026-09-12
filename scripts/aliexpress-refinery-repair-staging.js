#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-refinery-staging-repair
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        DATABASE_URL, KOMERCE_ENV=staging, KOMERCE_ALLOW_ALIEXPRESS_REFINERY_REPAIR=1
 * @outputs       corrected AliExpress candidate categories + rescanned economics
 * @depends       db.js, services/pricing-engine.js, services/supplier-catalog-scanner.js
 * @used-by       bounded GitHub staging operator workflow
 * @db-read       cost_components, finance_config, sourcing_candidates
 * @db-write      cost_components, cost_component_events, sourcing_candidates, sourcing_candidate_events
 * @db-txn        freight repair transaction + atomic 500-candidate rescan transaction
 * @doctrine      observe_before_behavior_change, no_silent_double_count, refinery_is_filter_not_bypass
 * @impact-areas  sourcing, pricing, catalog, staging
 * @version       2026-09-v1
 */
'use strict';

const db = require('../db');
const pricingEngine = require('../services/pricing-engine');
const scanner = require('../services/supplier-catalog-scanner');

const SUPPLIER = 'AliExpress';
const EXPECTED_CLEAN = 500;
const FLAG = 'KOMERCE_ALLOW_ALIEXPRESS_REFINERY_REPAIR';
const FREIGHT_COMPONENT_KEY = 'fret_maritime_eur_m3';
const LOCK_NAMESPACE = 'komerce';
const LOCK_KEY = 'aliexpress-refinery-repair-staging';

const CATEGORY_HINT_LABELS = Object.freeze({
  phones: 'smartphone',
  vetements: 'clothing fashion',
  tissus: 'fabric textile',
  cosmetiques: 'cosmetics beauty',
  enfants: 'kids toys',
  accessoires: 'accessories bag',
  maison: 'home kitchen',
  electronique: 'electronics gadget',
  autre: 'unknown category',
});

function isTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function runtimeEnvironment(env = process.env) {
  return String(env.KOMERCE_ENV || '').trim().toLowerCase();
}

function parseMode(argv = process.argv.slice(2)) {
  const execute = argv.includes('--execute');
  const dryRun = argv.includes('--dry-run');
  if (execute && dryRun) throw new Error('Choisir soit --dry-run soit --execute, pas les deux');
  const unknown = argv.filter(arg => !['--execute', '--dry-run'].includes(arg));
  if (unknown.length) throw new Error(`Argument inconnu: ${unknown[0]}`);
  return execute ? 'execute' : 'dry-run';
}

function assertRuntime(mode, env = process.env) {
  const runtime = runtimeEnvironment(env);
  if (runtime !== 'staging') {
    throw new Error(`REFUS: KOMERCE_ENV=staging requis (reçu: ${runtime || '<vide>'})`);
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  if (mode === 'execute' && !isTruthy(env[FLAG])) throw new Error(`REFUS: ${FLAG}=1 requis pour --execute`);
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function customsCategoryFromDiscovery(discovery = {}) {
  const target = normalizeText(discovery.target_category);
  const sub = normalizeText(discovery.target_subcategory);
  const keyword = normalizeText(discovery.keyword);
  const segment = normalizeText(discovery.segment_id);
  const hay = `${target} ${sub} ${keyword} ${segment}`;

  if (target.includes('mode')) {
    if (/beaute|makeup|cosmetic|skin care|hair/.test(hay)) return 'cosmetiques';
    if (/accessoire|handbag|wallet|sunglass|earring/.test(hay)) return 'accessoires';
    return 'vetements';
  }
  if (target === 'maison') {
    if (/enfant|baby|school|stationery/.test(hay)) return 'enfants';
    return 'maison';
  }
  if (target === 'tech') {
    if (/phone|mobile|smartphone/.test(hay)) return 'phones';
    return 'electronique';
  }
  if (target === 'bricolage') {
    if (/electric|securite|security|lock/.test(hay)) return 'electronique';
    return 'autre';
  }
  if (target.includes('creation')) {
    if (/ceremonie|evening dress|formal suit/.test(hay)) return 'vetements';
    return 'accessoires';
  }
  if (target === 'auto') {
    if (/eclairage|light|led|charger|vacuum|inflator/.test(hay)) return 'electronique';
    return 'accessoires';
  }

  // Feed/category discovery has target_category="AliExpress feed". Infer only
  // from its feed/category labels; unknown remains `autre`, never cats[0].
  if (/phone|mobile|smartphone/.test(hay)) return 'phones';
  if (/beauty|cosmetic|makeup|skin|hair/.test(hay)) return 'cosmetiques';
  if (/women|men|dress|clothing|fashion|shoe|sandals/.test(hay)) return 'vetements';
  if (/kid|baby|school|toy|stationery/.test(hay)) return 'enfants';
  if (/home|kitchen|furniture|household|decor|summer product/.test(hay)) return 'maison';
  if (/computer|electronic|audio|watch|keyboard|mouse|light|tool/.test(hay)) return 'electronique';
  if (/accessor|gift|jewelry|car|motor|filter|brake|bag/.test(hay)) return 'accessoires';
  return 'autre';
}

function categoryHintLabel(categoryKey) {
  return CATEGORY_HINT_LABELS[categoryKey] || CATEGORY_HINT_LABELS.autre;
}

function cleanStockSql(alias = 'sc') {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`Alias SQL invalide: ${alias}`);
  return `(
    ${alias}.normalized_source_contract ? 'stock_available'
    AND (${alias}.normalized_source_contract->>'stock_available') ~ '^[0-9]+([.][0-9]+)?$'
    AND (${alias}.normalized_source_contract->>'stock_available')::numeric > 0
  )`;
}

async function loadCleanRows(queryable = db) {
  const { rows } = await queryable.query(
    `SELECT sc.*
       FROM sourcing_candidates sc
      WHERE sc.supplier_name = $1
        AND sc.supplier_product_id IS NOT NULL
        AND sc.state = 'scanned'
        AND sc.product_id IS NULL
        AND COALESCE(sc.product_name, '') <> ''
        AND sc.image_url ~ '^https://'
        AND sc.purchase_price IS NOT NULL
        AND sc.purchase_price > 0
        AND ${cleanStockSql('sc')}
      ORDER BY sc.created_at, sc.id`,
    [SUPPLIER]
  );
  return rows;
}

function sourceProductFromRow(row, categoryKey) {
  const rawPayload = row.raw_payload && typeof row.raw_payload === 'object'
    ? JSON.parse(JSON.stringify(row.raw_payload))
    : {};
  rawPayload.discovery = {
    ...(rawPayload.discovery || {}),
    target_customs_category: categoryKey,
  };

  return {
    supplier_name: row.supplier_name,
    supplier_product_id: row.supplier_product_id,
    product_name: row.product_name,
    // Do not rewrite the supplier fact in DB. This synthetic category label is
    // only an adapter into the current generic scanner mapping contract.
    supplier_category: categoryHintLabel(categoryKey),
    purchase_price: row.purchase_price,
    currency: row.currency,
    image_url: row.image_url,
    product_url: row.product_url,
    description: row.description,
    stock_available: row.stock_available,
    min_order_qty: row.min_order_qty,
    supplier_delay_days: row.supplier_delay_days,
    weight_kg: row.weight_kg,
    dimensions: {
      l_cm: row.dim_l_cm,
      w_cm: row.dim_w_cm,
      h_cm: row.dim_h_cm,
    },
    raw_payload: rawPayload,
  };
}

function preserveManualFields(row, normalized) {
  const oldSources = row.data_sources || {};
  const result = { ...normalized, data_sources: { ...normalized.data_sources } };
  const mapping = {
    category: ['komerce_category'],
    purchase_price: ['purchase_price_kmf'],
    weight: ['estimated_weight_kg'],
    volume: ['estimated_volume_m3'],
    target_margin: ['target_margin_pct'],
  };
  for (const [sourceKey, fields] of Object.entries(mapping)) {
    if (oldSources[sourceKey] !== 'manual') continue;
    result.data_sources[sourceKey] = 'manual';
    for (const field of fields) result[field] = row[field];
  }
  return result;
}

async function inspectFreightComponent(queryable = db) {
  const { rows: [component] } = await queryable.query(
    `SELECT id, key, category, unit, default_value, allocation_method, is_active, notes
       FROM cost_components
      WHERE key = $1
      LIMIT 1`,
    [FREIGHT_COMPONENT_KEY]
  );
  const { rows: [finance] } = await queryable.query(
    'SELECT fret_eur_per_m3 FROM finance_config WHERE id = 1'
  );
  return { component: component || null, finance_rate_eur_m3: Number(finance?.fret_eur_per_m3 || 0) };
}

function assertFreightRepairable(state) {
  const c = state.component;
  if (!c) throw new Error(`REFUS: composant ${FREIGHT_COMPONENT_KEY} introuvable`);
  if (c.category !== 'freight') throw new Error(`REFUS: catégorie fret inattendue ${c.category}`);
  if (!(state.finance_rate_eur_m3 > 0)) throw new Error('REFUS: finance_config.fret_eur_per_m3 absent ou nul');
  if (c.is_active && c.unit !== 'eur') {
    throw new Error(`REFUS: ${FREIGHT_COMPONENT_KEY} actif mais unit=${c.unit}; réparation automatique interdite`);
  }
}

async function deactivateDuplicateFreight() {
  const before = await inspectFreightComponent();
  assertFreightRepairable(before);
  if (!before.component.is_active) return { changed: false, before };

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows: [locked] } = await client.query(
      `SELECT id, key, category, unit, default_value, allocation_method, is_active, notes
         FROM cost_components
        WHERE key = $1
        FOR UPDATE`,
      [FREIGHT_COMPONENT_KEY]
    );
    const live = { component: locked || null, finance_rate_eur_m3: before.finance_rate_eur_m3 };
    assertFreightRepairable(live);
    if (locked.is_active) {
      await client.query(
        `UPDATE cost_components
            SET is_active = FALSE,
                notes = concat_ws(E'\n', NULLIF(notes, ''), $2),
                updated_at = NOW()
          WHERE id = $1`,
        [locked.id, '2026-09 staging repair: flat EUR freight disabled; finance_config.fret_eur_per_m3 remains canonical.']
      );
      await client.query(
        `INSERT INTO cost_component_events
           (component_id, component_key, event_type, old_value, new_value, notes)
         VALUES ($1, $2, 'deactivated', $3::jsonb, $4::jsonb, $5)`,
        [
          locked.id,
          locked.key,
          JSON.stringify({ is_active: true, unit: locked.unit, default_value: locked.default_value }),
          JSON.stringify({ is_active: false, canonical_source: 'finance_config.fret_eur_per_m3' }),
          'AliExpress refinery staging repair — double comptage fret confirmé par audit live.',
        ]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const after = await inspectFreightComponent();
  if (after.component?.is_active) throw new Error('REFUS: composant fret doublon encore actif après réparation');
  return { changed: true, before, after };
}

async function computeRepairs(rows, config) {
  const repairs = [];
  for (const row of rows) {
    const discovery = row.raw_payload?.discovery || {};
    const categoryKey = row.data_sources?.category === 'manual'
      ? row.komerce_category
      : customsCategoryFromDiscovery(discovery);
    const product = sourceProductFromRow(row, categoryKey);
    // eslint-disable-next-line no-await-in-loop
    const normalizedRaw = await scanner.normalizeCandidate(product, { config });
    const normalized = preserveManualFields(row, normalizedRaw);
    // eslint-disable-next-line no-await-in-loop
    const scan = await scanner.scanCandidate(normalized, { config });
    const scanResult = {
      ...(scan.scan_result || {}),
      sourcing_decision: scan.sourcing_decision,
      reason: scan.reason,
      recommended_action: scan.recommended_action,
      eligibility: row.scan_result?.eligibility || null,
      refinery_repaired_at: new Date().toISOString(),
    };
    repairs.push({ row, product, normalized, scan, scanResult, categoryKey });
  }
  return repairs;
}

function summarizeRepairs(repairs) {
  const categories = {};
  const decisions = {};
  let maxVariableOutsidePurchase = 0;
  let maxTestPrice = 0;
  let minTestPrice = null;
  for (const item of repairs) {
    categories[item.categoryKey] = (categories[item.categoryKey] || 0) + 1;
    const decision = item.scan.sourcing_decision || 'UNKNOWN';
    decisions[decision] = (decisions[decision] || 0) + 1;
    const outside = Number(item.scanResult.variable_cost_outside_purchase_kmf || 0);
    const testPrice = Number(item.scanResult.test_price_kmf || 0);
    maxVariableOutsidePurchase = Math.max(maxVariableOutsidePurchase, outside);
    if (testPrice > 0) {
      maxTestPrice = Math.max(maxTestPrice, testPrice);
      minTestPrice = minTestPrice == null ? testPrice : Math.min(minTestPrice, testPrice);
    }
  }
  return {
    count: repairs.length,
    categories,
    decisions,
    variable_cost_outside_purchase_max_kmf: maxVariableOutsidePurchase,
    test_price_kmf: { min: minTestPrice, max: maxTestPrice },
  };
}

async function persistRepairs(repairs) {
  const client = await db.getClient();
  let locked = false;
  try {
    const { rows: [lock] } = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked',
      [LOCK_NAMESPACE, LOCK_KEY]
    );
    if (!lock?.locked) throw new Error('REFUS: une autre réparation Raffinerie AliExpress est active');
    locked = true;
    await client.query('BEGIN');

    for (const item of repairs) {
      const { row, product, normalized, scanResult } = item;
      // eslint-disable-next-line no-await-in-loop
      const update = await client.query(
        `UPDATE sourcing_candidates
            SET komerce_category = $2,
                purchase_price_kmf = $3,
                estimated_weight_kg = $4,
                estimated_volume_m3 = $5,
                target_margin_pct = $6,
                data_sources = $7::jsonb,
                scan_result = $8::jsonb,
                scan_at = NOW(),
                confidence = $9,
                raw_payload = $10::jsonb
          WHERE id = $1
            AND supplier_name = $11
            AND state = 'scanned'
            AND product_id IS NULL
          RETURNING id`,
        [
          row.id,
          normalized.komerce_category,
          normalized.purchase_price_kmf,
          normalized.estimated_weight_kg,
          normalized.estimated_volume_m3,
          normalized.target_margin_pct,
          JSON.stringify(normalized.data_sources),
          JSON.stringify(scanResult),
          scanResult.confidence || item.scan.confidence || normalized.confidence,
          JSON.stringify(product.raw_payload),
          SUPPLIER,
        ]
      );
      if (update.rowCount !== 1) throw new Error(`REFUS: candidat ${row.id} modifié concurremment`);
      // eslint-disable-next-line no-await-in-loop
      await client.query(
        `INSERT INTO sourcing_candidate_events
           (candidate_id, event_type, changes, notes)
         VALUES ($1, 'data_correction', $2::jsonb, $3)`,
        [
          row.id,
          JSON.stringify({
            refinery_repair: true,
            old_category: row.komerce_category,
            new_category: normalized.komerce_category,
            freight_duplicate_disabled: true,
          }),
          'Raffinerie staging: catégorie restaurée depuis provenance discovery + rescan après suppression du doublon fret.',
        ]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (locked) {
      await client.query(
        'SELECT pg_advisory_unlock(hashtext($1), hashtext($2))',
        [LOCK_NAMESPACE, LOCK_KEY]
      ).catch(() => {});
    }
    client.release();
  }
}

async function main() {
  const mode = parseMode();
  assertRuntime(mode);

  const rows = await loadCleanRows();
  if (rows.length !== EXPECTED_CLEAN) {
    throw new Error(`REFUS: ${EXPECTED_CLEAN} candidats AliExpress scanned attendus, trouvé ${rows.length}`);
  }

  const freightBefore = await inspectFreightComponent();
  assertFreightRepairable(freightBefore);

  if (mode === 'dry-run') {
    console.log(`[aliexpress-refinery-repair] DRY_RUN ${JSON.stringify({
      runtime: runtimeEnvironment(),
      candidates: rows.length,
      freight: freightBefore,
      note: 'Le rescan économique n’est calculé qu’après désactivation effective du doublon fret.',
    }, null, 2)}`);
    return { mode, freightBefore, count: rows.length };
  }

  const freight = await deactivateDuplicateFreight();
  const config = await pricingEngine.loadGlobalConfig();
  const repairs = await computeRepairs(rows, config);
  if (repairs.length !== EXPECTED_CLEAN) throw new Error(`REFUS: repairs=${repairs.length}/${EXPECTED_CLEAN}`);
  const summary = summarizeRepairs(repairs);

  // The historical bug added ~88.5k KMF/article. After removing it, an
  // unexplained outside-purchase floor near 100k must never silently survive.
  if (summary.variable_cost_outside_purchase_max_kmf >= 100000) {
    throw new Error(`REFUS: coût variable hors achat reste anormalement élevé: max=${summary.variable_cost_outside_purchase_max_kmf}`);
  }

  await persistRepairs(repairs);

  const afterRows = await loadCleanRows();
  if (afterRows.length !== EXPECTED_CLEAN) throw new Error(`REFUS final: clean=${afterRows.length}/${EXPECTED_CLEAN}`);
  const afterFreight = await inspectFreightComponent();
  if (afterFreight.component?.is_active) throw new Error('REFUS final: fret doublon actif');

  console.log(`[aliexpress-refinery-repair] EXECUTED ${JSON.stringify({
    runtime: runtimeEnvironment(),
    freight,
    summary,
    clean_after: afterRows.length,
  }, null, 2)}`);
  return { mode, freight, summary, cleanAfter: afterRows.length };
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`[aliexpress-refinery-repair] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  SUPPLIER,
  EXPECTED_CLEAN,
  FLAG,
  FREIGHT_COMPONENT_KEY,
  CATEGORY_HINT_LABELS,
  parseMode,
  assertRuntime,
  normalizeText,
  customsCategoryFromDiscovery,
  categoryHintLabel,
  cleanStockSql,
  sourceProductFromRow,
  preserveManualFields,
  assertFreightRepairable,
  summarizeRepairs,
  main,
};