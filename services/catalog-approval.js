/**
 * @komerce-arch
 * @role          catalog-approval-queue
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        product_id, admin_user, reject_reason, override_fields
 * @outputs       queue_page, approved_product, rejected_product, overridden_product
 * @depends       db.js, services/catalog-overrides.js, services/product-publication-guard.js, utils/alerts.js, utils/rules.js
 * @used-by       routes/admin/catalog-approval.js, services/catalog-workspace.js
 * @db-read       products
 * @db-write      products
 * @db-write-via:alerts-persistence-boundary alerts
 * @db-txn        first_publication_serialized_by_catalog_cap_lock
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md §5, §6, §7, §9
 * @impact-areas  catalog, admin-dashboard
 * @version       2026-09
 */

'use strict';

/**
 * KOMERCE — File d'approbation / curation catalogue.
 *
 * Toute première publication passe ici. La source peut être native FR,
 * préparée manuellement ou assistée par IA ; la donnée fournisseur brute
 * étrangère reste bloquée par product-publication-guard.
 *
 * Le cap catalogue est une contrainte métier, pas un simple indicateur UI :
 * les publications sont sérialisées dans une transaction via advisory lock,
 * puis le nombre de produits actifs est comparé à CATALOG_CAP_MVP avant UPDATE.
 */

const db = require('../db');
const { createAlert } = require('../utils/alerts');
const { getRuleNumber } = require('../utils/rules');
const { upsertOverrides } = require('./catalog-overrides');
const { validatePublicationUpdate } = require('./product-publication-guard');
const log = require('../utils/logger').child({ module: 'catalog-approval' });

const PENDING_SOURCES = Object.freeze(['connector_raw', 'ai_enriched', 'manual']);
const CATALOG_CAP_FALLBACK = 120;
const PUBLICATION_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('komerce:catalog:first-publication'))";

/**
 * Page de la file d'approbation : candidats jamais publiés.
 */
async function getApprovalQueue(q = db, { limit = 50, offset = 0 } = {}) {
  const { rows: items } = await q.query(
    `SELECT id, name, description, category, fragility, emoji, price_kmf, stock,
            lifecycle_status, content_source, needs_review, enrichment_confidence, created_at
       FROM products
      WHERE lifecycle_status = 'candidate'
        AND is_active = FALSE
        AND content_source IN ('connector_raw', 'ai_enriched', 'manual')
      ORDER BY needs_review DESC, enrichment_confidence ASC NULLS FIRST
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  const { rows: [{ count }] } = await q.query(
    `SELECT COUNT(*) FROM products
      WHERE lifecycle_status = 'candidate'
        AND is_active = FALSE
        AND content_source IN ('connector_raw', 'ai_enriched', 'manual')`
  );

  return { items, total: Number(count), limit, offset };
}

async function loadCandidate(q, productId) {
  const { rows: [product] } = await q.query('SELECT * FROM products WHERE id = $1', [productId]);
  return product || null;
}

function isPending(product) {
  return product.lifecycle_status === 'candidate'
    && !product.is_active
    && PENDING_SOURCES.includes(product.content_source);
}

async function assertCatalogCapacity(q) {
  const cap = Math.max(1, Number(await getRuleNumber('CATALOG_CAP_MVP', CATALOG_CAP_FALLBACK)) || CATALOG_CAP_FALLBACK);
  const { rows: [{ count }] } = await q.query('SELECT COUNT(*)::int AS count FROM products WHERE is_active = TRUE');
  const published = Number(count) || 0;
  if (published >= cap) {
    return {
      ok: false,
      result: {
        status: 409,
        body: {
          error: `Cap catalogue atteint (${published}/${cap}) : sortir une référence avant d'en publier une nouvelle`,
          code: 'catalog_cap_reached',
          catalog_cap_mvp: cap,
          published_products: published,
        },
      },
    };
  }
  return { ok: true, cap, published };
}

/**
 * Sérialise les décisions de première publication en production. Lorsqu'un
 * client transactionnel est injecté (tests ou orchestration externe), le
 * caller reste propriétaire de sa transaction et nous appliquons seulement
 * les contrôles fonctionnels.
 */
async function withPublicationDecision(q, work) {
  if (q === db && typeof db.withTransaction === 'function') {
    return db.withTransaction(async client => {
      await client.query(PUBLICATION_LOCK_SQL);
      return work(client);
    });
  }
  return work(q);
}

async function publish(q, before) {
  const { rows: [{ count: mediaCount }] } = await q.query(
    `SELECT COUNT(*)::int AS count FROM catalog_media WHERE product_id = $1 AND is_active = TRUE`,
    [before.id]
  );
  const patch = { is_active: true };
  const context = { catalogMediaCount: mediaCount };
  const check = validatePublicationUpdate({ before, patch, context });
  if (!check.ok) return { status: 422, body: { error: check.error, code: check.code } };

  const capacity = await assertCatalogCapacity(q);
  if (!capacity.ok) return capacity.result;

  const { rows: [product] } = await q.query(
    `UPDATE products
        SET is_active = TRUE,
            quality_validated = TRUE,
            needs_review = FALSE,
            lifecycle_status = 'active',
            updated_at = NOW()
      WHERE id = $1
        AND lifecycle_status = 'candidate'
        AND is_active = FALSE
      RETURNING *`,
    [before.id]
  );

  if (!product) {
    return { status: 409, body: { error: 'Candidat déjà décidé (publication concurrente)', code: 'not_pending' } };
  }
  return { status: 200, body: product };
}

async function approveProduct(q = db, productId, adminUser) {
  return withPublicationDecision(q, async tx => {
    const before = await loadCandidate(tx, productId);
    if (!before) return { status: 404, body: { error: 'Produit introuvable' } };
    if (!isPending(before)) {
      return { status: 409, body: { error: 'Candidat déjà décidé ou hors file de curation', code: 'not_pending' } };
    }

    const result = await publish(tx, before);
    if (result.status === 200) {
      log.info(`Approuvé par ${adminUser?.id || 'admin'} — produit ${productId}`);
    }
    return result;
  });
}

async function rejectProduct(q = db, productId, { reason } = {}, adminUser) {
  if (!reason || !String(reason).trim()) {
    return { status: 400, body: { error: 'Raison de rejet obligatoire' } };
  }

  const before = await loadCandidate(q, productId);
  if (!before) return { status: 404, body: { error: 'Produit introuvable' } };
  if (!isPending(before)) {
    return { status: 409, body: { error: 'Candidat déjà décidé ou hors file de curation', code: 'not_pending' } };
  }

  const { rows: [product] } = await q.query(
    `UPDATE products
        SET is_active = FALSE,
            lifecycle_status = 'rejected',
            needs_review = FALSE,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [productId]
  );

  try {
    await createAlert(q, {
      type: 'catalog_approval_reject',
      entityType: 'product',
      entityId: productId,
      severity: 'low',
      title: `Produit rejeté en approbation: ${reason}`,
      description: `Raison: ${reason} — décidé par ${adminUser?.id || 'admin'}`,
    });
  } catch (err) {
    log.warn({ err }, '[catalog-approval] trace rejet ignorée:');
  }

  log.info(`Rejeté par ${adminUser?.id || 'admin'} — produit ${productId}: ${reason}`);
  return { status: 200, body: product };
}

async function overrideAndApprove(q = db, productId, { fields, reason } = {}, adminUser) {
  if (!fields || !Object.keys(fields).length) {
    return { status: 400, body: { error: 'Aucun champ à corriger fourni' } };
  }

  return withPublicationDecision(q, async tx => {
    const before = await loadCandidate(tx, productId);
    if (!before) return { status: 404, body: { error: 'Produit introuvable' } };
    if (!isPending(before)) {
      return { status: 409, body: { error: 'Candidat déjà décidé ou hors file de curation', code: 'not_pending' } };
    }

    // Refuse avant d'écrire les overrides quand le catalogue est plein.
    const capacity = await assertCatalogCapacity(tx);
    if (!capacity.ok) return capacity.result;

    let overrideResult;
    try {
      overrideResult = await upsertOverrides(tx, productId, fields, { reason: reason || null, setBy: adminUser?.id || null });
    } catch (err) {
      if (err.code === 'OVERRIDE_FIELD_NOT_ALLOWED') {
        return { status: 422, body: { error: err.message, code: err.code } };
      }
      throw err;
    }

    // Cap déjà contrôlé sous le même advisory lock ; ne pas refaire une lecture
    // susceptible de rendre les tests/transactions inutilement bavards.
    const { rows: [{ count: overrideMediaCount }] } = await tx.query(
      `SELECT COUNT(*)::int AS count FROM catalog_media WHERE product_id = $1 AND is_active = TRUE`,
      [overrideResult.product.id]
    );
    const patch = { is_active: true };
    const check = validatePublicationUpdate({
      before: overrideResult.product,
      patch,
      context: { catalogMediaCount: overrideMediaCount },
    });
    if (!check.ok) return { status: 422, body: { error: check.error, code: check.code } };
    const { rows: [product] } = await tx.query(
      `UPDATE products
          SET is_active = TRUE,
              quality_validated = TRUE,
              needs_review = FALSE,
              lifecycle_status = 'active',
              updated_at = NOW()
        WHERE id = $1
          AND lifecycle_status = 'candidate'
          AND is_active = FALSE
        RETURNING *`,
      [overrideResult.product.id]
    );
    if (!product) {
      return { status: 409, body: { error: 'Candidat déjà décidé (publication concurrente)', code: 'not_pending' } };
    }

    const result = { status: 200, body: { ...product, overridden: overrideResult.overridden } };
    log.info(`Corrigé + approuvé par ${adminUser?.id || 'admin'} — produit ${productId} (${overrideResult.overridden.join(', ')})`);
    return result;
  });
}

module.exports = {
  PENDING_SOURCES,
  CATALOG_CAP_FALLBACK,
  getApprovalQueue,
  approveProduct,
  rejectProduct,
  overrideAndApprove,
  _test: { isPending, assertCatalogCapacity, withPublicationDecision },
};