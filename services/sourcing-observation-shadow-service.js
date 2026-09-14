'use strict';

/**
 * @komerce-arch
 * @role          sourcing-observation-shadow-owner
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        normalized_supplier_product_v2_batch, catalog_import_context
 * @outputs       sourcing_source, capture, immutable_observations, shadow_summary
 * @depends       db.js, node:crypto, services/sourcing-observation-shadow-plan.js
 * @used-by       services/suppliers/catalog-import-orchestrator.js
 * @db-read       none
 * @db-write      sourcing_sources, sourcing_source_provides, sourcing_captures, sourcing_observations
 * @db-txn        owned
 * @doctrine      docs/doctrine/DOCTRINE_SOURCE_OBSERVATION.md
 * @impact-areas  sourcing, catalog, supplier-import
 * @version       2026-09
 */

const crypto = require('crypto');
const db = require('../db');
const { isV2, buildObservationPlan, observedProvides } = require('./sourcing-observation-shadow-plan');

const CHUNK = 150;

function sourceTypeOf(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!['api', 'csv', 'manual', 'json'].includes(v)) throw new Error(`source_type shadow non supporte: ${v || '(vide)'}`);
  return v;
}

function slug(value) {
  return String(value || '').trim().toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 56) || 'source';
}

function hash12(value) {
  return crypto.createHash('sha256').update(String(value || '').trim().toLowerCase(), 'utf8').digest('hex').slice(0, 12);
}

function buildSourceDescriptor({ sourceType, supplierName, supplierId, sourceInstanceKey }) {
  const type = sourceTypeOf(sourceType);
  const supplier = String(supplierName || '').trim();
  if (!supplier) throw new Error('supplierName requis pour le shadow sourcing');

  if (type === 'api') {
    if (!supplierId) throw new Error('supplierId requis pour une source API shadow');
    const adapter = slug(supplierId);
    const suffix = sourceInstanceKey ? `:${slug(sourceInstanceKey)}:${hash12(sourceInstanceKey)}` : '';
    return { sourceId: `api:${adapter}${suffix}`, adapterType: adapter, acquisition: 'pull', continuity: 'recurring' };
  }

  const identity = sourceInstanceKey || supplier;
  return {
    sourceId: `${type}:${slug(identity)}:${hash12(identity)}`,
    adapterType: type,
    acquisition: 'push',
    continuity: 'recurring',
  };
}

async function insertRows(client, rows) {
  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    const chunk = rows.slice(offset, offset + CHUNK);
    const params = [];
    const tuples = chunk.map((r, i) => {
      const b = i * 10;
      params.push(r.id, r.captureId, r.grain, r.sourceRef, null, r.parentId, r.observedAt,
        JSON.stringify(r.normalized), '{}', JSON.stringify(r.raw));
      const p = (n) => `$${b + n}`;
      return `(${p(1)},${p(2)},${p(3)},${p(4)},${p(5)},${p(6)},${p(7)},${p(8)}::jsonb,${p(9)}::jsonb,${p(10)}::jsonb)`;
    });
    await client.query(
      `INSERT INTO sourcing_observations
       (observation_id,capture_id,grain,source_ref,principal_ref,parent_observation_id,observed_at,normalized,field_provenance,raw_fragment)
       VALUES ${tuples.join(',')}`,
      params
    );
  }
}

async function persistShadow(client, context) {
  const products = (context.products || []).filter(isV2);
  if (!products.length) return { status: 'skipped', reason: 'no_v2_products', observations: 0 };

  const descriptor = buildSourceDescriptor(context);
  const captureId = crypto.randomUUID();
  const observedAt = new Date().toISOString();
  const plan = buildObservationPlan(products, { captureId, observedAt });
  const provides = observedProvides(plan);

  await client.query(
    `INSERT INTO sourcing_sources (source_id,adapter_type,acquisition,continuity)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (source_id) DO UPDATE SET adapter_type=EXCLUDED.adapter_type,
       acquisition=EXCLUDED.acquisition, continuity=EXCLUDED.continuity, updated_at=now()`,
    [descriptor.sourceId, descriptor.adapterType, descriptor.acquisition, descriptor.continuity]
  );

  for (const layer of provides) {
    await client.query(
      `INSERT INTO sourcing_source_provides (source_id,layer) VALUES ($1,$2)
       ON CONFLICT (source_id,layer) DO NOTHING`,
      [descriptor.sourceId, layer]
    );
  }

  const stats = {
    import_id: context.importId || null,
    source_type: sourceTypeOf(context.sourceType),
    source_filename: context.sourceFilename || null,
    normalized_v2_products: plan.productCount,
    observations: { product: plan.productCount, offer: plan.offerCount, unit: plan.unitCount, total: plan.rows.length },
  };

  await client.query(
    `INSERT INTO sourcing_captures (capture_id,source_id,status,started_at,completed_at,stats)
     VALUES ($1,$2,'complete',$3,$3,$4::jsonb)`,
    [captureId, descriptor.sourceId, observedAt, JSON.stringify(stats)]
  );
  await insertRows(client, plan.rows);

  return {
    status: 'recorded', source_id: descriptor.sourceId, capture_id: captureId,
    products: plan.productCount, offers: plan.offerCount, units: plan.unitCount,
    observations: plan.rows.length, provides,
  };
}

async function recordCatalogImportObservationsShadow(context) {
  if (!(context?.products || []).some(isV2)) return { status: 'skipped', reason: 'no_v2_products', observations: 0 };
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const summary = await persistShadow(client, context);
    await client.query('COMMIT');
    return summary;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  recordCatalogImportObservationsShadow,
  buildSourceDescriptor,
  _persistShadow: persistShadow,
};
