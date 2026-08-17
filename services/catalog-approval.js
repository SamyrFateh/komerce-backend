/**
 * @komerce-arch
 * @role          catalog-approval-queue
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        product_id, admin_user, reject_reason, override_fields
 * @outputs       queue_page, approved_product, rejected_product, overridden_product
 * @depends       db.js, services/catalog-overrides.js, services/product-publication-guard.js, utils/alerts.js
 * @used-by       routes/admin/catalog-approval.js
 * @db-read       products
 * @db-write      products
 * @db-write-via:alerts-persistence-boundary alerts
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md §5, §6
 * @impact-areas  catalog, admin-dashboard
 * @version       2026-07
 */

'use strict';

/**
 * KOMERCE — File d'approbation admin (K-4, DOCTRINE_CATALOGUE.md §6, §5)
 * ═══════════════════════════════════════════════════════════════════════════
 * §6 — "Un écran, trois actions." Chaque fiche générée par le pipeline
 *      (K-3, content_source IN connector_raw|ai_enriched) arrive candidate
 *      et inactive. C'est ICI, et seulement ici, qu'elle peut franchir
 *      lifecycle_status='active' — le seul point de validation humaine
 *      obligatoire avant publication, même si needs_review est faux.
 *
 *   approve          → publie tel quel (is_active + quality_validated).
 *   reject            → ne publie jamais, sort de la file, trace la raison
 *                        dans `alerts` (mémoire du solo-dev, doctrine §9).
 *   override + approve → pose des overrides tracés (délégué à
 *                        catalog-overrides.js, doctrine §5/§7), PUIS publie
 *                        dans le même geste — une seule décision admin.
 *
 * Chaque action de publication repasse par
 * product-publication-guard.js#validatePublicationUpdate (garde de sanité
 * partagée avec product-admin-service.js : nom/catégorie/prix/stock) —
 * jamais deux vérités sur "qu'est-ce qu'une fiche publiable".
 */

const db = require('../db');
const { createAlert } = require('../utils/alerts');
const { upsertOverrides } = require('./catalog-overrides');
const { validatePublicationUpdate } = require('./product-publication-guard');
const log = require('../utils/logger').child({ module: 'catalog-approval' });

const PENDING_SOURCES = ['connector_raw', 'ai_enriched'];

/**
 * Page de la file d'approbation : candidats pipeline jamais publiés.
 * Tri : needs_review d'abord (le plus urgent), puis confiance IA croissante
 * (le moins fiable d'abord) — doctrine §6, ordre de priorité humaine.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} [q]
 * @param {{limit?:number, offset?:number}} params
 * @returns {Promise<{items:object[], total:number, limit:number, offset:number}>}
 */
async function getApprovalQueue(q = db, { limit = 50, offset = 0 } = {}) {
  const { rows: items } = await q.query(
    `SELECT id, name, description, category, fragility, emoji, price_kmf, stock,
            lifecycle_status, content_source, needs_review, enrichment_confidence, created_at
       FROM products
      WHERE lifecycle_status = 'candidate'
        AND is_active = FALSE
        AND content_source IN ('connector_raw', 'ai_enriched')
      ORDER BY needs_review DESC, enrichment_confidence ASC NULLS FIRST
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  const { rows: [{ count }] } = await q.query(
    `SELECT COUNT(*) FROM products
      WHERE lifecycle_status = 'candidate'
        AND is_active = FALSE
        AND content_source IN ('connector_raw', 'ai_enriched')`
  );

  return { items, total: Number(count), limit, offset };
}

/**
 * Charge le candidat par id. Retourne null si absent — 404 côté caller.
 */
async function loadCandidate(q, productId) {
  const { rows: [product] } = await q.query('SELECT * FROM products WHERE id = $1', [productId]);
  return product || null;
}

/** Toujours vrai pour un candidat pipeline jamais encore décidé. */
function isPending(product) {
  return product.lifecycle_status === 'candidate' && !product.is_active;
}

/**
 * Publie une fiche déjà conforme (garde §6 : is_active + quality_validated,
 * needs_review levé, lifecycle_status='active'). Ne re-décide rien sur le
 * contenu — la conformité (nom/catégorie/prix/stock) est vérifiée par
 * validatePublicationUpdate avant l'écriture.
 */
async function publish(q, before) {
  const patch = { is_active: true };
  const check = validatePublicationUpdate({ before, patch });
  if (!check.ok) return { status: 422, body: { error: check.error, code: check.code } };

  const { rows: [product] } = await q.query(
    `UPDATE products
        SET is_active = TRUE,
            quality_validated = TRUE,
            needs_review = FALSE,
            lifecycle_status = 'active',
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [before.id]
  );

  return { status: 200, body: product };
}

/**
 * Approuve tel quel : la fiche générée est acceptée sans retouche.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} [q]
 * @param {string} productId
 * @param {{id:string}} adminUser
 */
async function approveProduct(q = db, productId, adminUser) {
  const before = await loadCandidate(q, productId);
  if (!before) return { status: 404, body: { error: 'Produit introuvable' } };
  if (!isPending(before)) {
    return { status: 409, body: { error: 'Candidat déjà décidé (publié ou hors file)', code: 'not_pending' } };
  }

  const result = await publish(q, before);
  if (result.status === 200) {
    log.info(`Approuvé par ${adminUser?.id || 'admin'} — produit ${productId}`);
  }
  return result;
}

/**
 * Rejette : ne publie jamais, sort de la file (lifecycle_status='rejected'),
 * trace la raison dans `alerts` — mémoire du solo-dev, doctrine §9 (une
 * décision non tracée est une décision perdue).
 *
 * @param {import('pg').Pool|import('pg').PoolClient} [q]
 * @param {string} productId
 * @param {{reason?:string}} payload
 * @param {{id:string}} adminUser
 */
async function rejectProduct(q = db, productId, { reason } = {}, adminUser) {
  if (!reason || !String(reason).trim()) {
    return { status: 400, body: { error: 'Raison de rejet obligatoire' } };
  }

  const before = await loadCandidate(q, productId);
  if (!before) return { status: 404, body: { error: 'Produit introuvable' } };
  if (!isPending(before)) {
    return { status: 409, body: { error: 'Candidat déjà décidé (publié ou hors file)', code: 'not_pending' } };
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
      title: `Produit rejet\u00e9 en approbation: ${reason}`,
      description: `Raison: ${reason} \u2014 d\u00e9cid\u00e9 par ${adminUser?.id || 'admin'}`,
    });
  } catch (err) {
    log.warn({ err }, '[catalog-approval] trace rejet ignorée:');
  }

  log.info(`Rejeté par ${adminUser?.id || 'admin'} — produit ${productId}: ${reason}`);
  return { status: 200, body: product };
}

/**
 * Pose des overrides tracés (doctrine §5/§7, délégué à catalog-overrides.js)
 * PUIS publie dans le même geste — une seule décision admin, pas deux appels
 * séparés qui pourraient laisser une fiche corrigée mais jamais publiée.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} [q]
 * @param {string} productId
 * @param {{fields?:Object<string,string>, reason?:string}} payload
 * @param {{id:string}} adminUser
 */
async function overrideAndApprove(q = db, productId, { fields, reason } = {}, adminUser) {
  if (!fields || !Object.keys(fields).length) {
    return { status: 400, body: { error: 'Aucun champ à corriger fourni' } };
  }

  const before = await loadCandidate(q, productId);
  if (!before) return { status: 404, body: { error: 'Produit introuvable' } };
  if (!isPending(before)) {
    return { status: 409, body: { error: 'Candidat déjà décidé (publié ou hors file)', code: 'not_pending' } };
  }

  let overrideResult;
  try {
    overrideResult = await upsertOverrides(q, productId, fields, { reason: reason || null, setBy: adminUser?.id || null });
  } catch (err) {
    if (err.code === 'OVERRIDE_FIELD_NOT_ALLOWED') {
      return { status: 422, body: { error: err.message, code: err.code } };
    }
    throw err;
  }

  const result = await publish(q, overrideResult.product);
  if (result.status === 200) {
    result.body = { ...result.body, overridden: overrideResult.overridden };
    log.info(`Corrigé + approuvé par ${adminUser?.id || 'admin'} — produit ${productId} (${overrideResult.overridden.join(', ')})`);
  }
  return result;
}

module.exports = { getApprovalQueue, approveProduct, rejectProduct, overrideAndApprove };
