/**
 * @komerce-arch
 * @role          explicitly-authorized-canonical-media-recovery
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        product_ref, authenticated actor, source-linked V2 contract
 * @outputs       recovered media count, durable audit proof, no publication
 * @depends       db.js, services/catalog-promotion.js
 * @db-read       products, sourcing_candidates, catalog_media
 * @db-write-via:catalog-promotion catalog_media
 * @db-write       catalog_media_recovery_audit
 * @db-txn         caller_owned
 * @doctrine      verified_supplier_snapshot_only, deny_legacy_url_promotion, stable_supplier_media_identity, media_recovery_never_publishes
 * @impact-areas  catalog, sourcing, authorization, admin-dashboard
 * @version       2026-10
 */
'use strict';

const { createHash } = require('node:crypto');
const db = require('../db');
const promotion = require('./catalog-promotion');

class CatalogMediaRecoveryError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function recoverSourceMedia(productRef, actor, { database = db, promotionService = promotion } = {}) {
  const ref = String(productRef || '').trim();
  if (!ref || ref.length > 128) throw new CatalogMediaRecoveryError(
    'catalog_product_ref_invalid', 'Référence produit invalide', 400
  );
  if (!actor?.id) throw new CatalogMediaRecoveryError(
    'catalog_media_actor_required', 'Acteur identifié obligatoire', 403
  );

  const tx = await database.getClient();
  let open = false;
  try {
    await tx.query('BEGIN');
    open = true;
    const { rows: [product] } = await tx.query(
      `SELECT id, product_ref, lifecycle_status, is_active
         FROM products
        WHERE product_ref=$1
        FOR UPDATE`, [ref]
    );
    if (!product) throw new CatalogMediaRecoveryError(
      'catalog_product_not_found', 'Produit introuvable', 404
    );
    if (product.lifecycle_status !== 'candidate' || product.is_active !== false) {
      throw new CatalogMediaRecoveryError(
        'catalog_media_not_draft', 'Seul un brouillon Catalogue inactif peut être réintégré', 409
      );
    }
    const { rows: [existing] } = await tx.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE is_active=TRUE)::int AS active
         FROM catalog_media WHERE product_id=$1`, [product.id]
    );
    // An inactive media row may be deliberately disabled. Never silently
    // reactivate or overwrite it; manual review is required.
    if (Number(existing?.total) !== 0) throw new CatalogMediaRecoveryError(
      'catalog_media_existing_review_required',
      'Des médias canoniques existent déjà : réexamen requis, aucune écriture automatique', 409
    );

    const { rows: [source] } = await tx.query(
      `SELECT candidate_ref, normalized_source_contract
         FROM sourcing_candidates
        WHERE product_id=$1 AND state='imported_to_catalog'
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 1`, [product.id]
    );
    if (!source) throw new CatalogMediaRecoveryError(
      'catalog_media_source_handoff_missing', 'Preuve de remise fournisseur absente', 409
    );
    const contract = source.normalized_source_contract;
    if (!contract || typeof contract !== 'object') throw new CatalogMediaRecoveryError(
      'catalog_media_source_contract_missing', 'Contrat source normalisé absent', 422
    );

    const sourceMedia = Array.isArray(contract.media) ? contract.media : [];
    if (String(contract.schema_version) !== '2' || sourceMedia.length < 1) {
      throw new CatalogMediaRecoveryError(
        'catalog_media_source_v2_required', 'Contrat V2 avec médias fournisseurs requis', 422
      );
    }
    // Promotion is the existing catalog owner and will revalidate the entire
    // normalized structure. Never infer media from product.image_url or a
    // browser-supplied URL.
    const ids = await promotionService.restoreSourceMediaOnly(tx, product.id, contract);
    const { rows: [after] } = await tx.query(
      'SELECT COUNT(*)::int AS active FROM catalog_media WHERE product_id=$1 AND is_active=TRUE',
      [product.id]
    );
    const activeAfter = Number(after?.active || 0);
    if (activeAfter !== ids.length || activeAfter < 1) {
      throw new CatalogMediaRecoveryError(
        'catalog_media_recovery_unproven',
        'Réintégration non certifiée : transaction annulée', 409
      );
    }

    const hash = createHash('sha256').update(JSON.stringify(sourceMedia)).digest('hex');
    await tx.query(
      `INSERT INTO catalog_media_recovery_audit
         (product_id, product_ref, candidate_ref, actor_user_id,
          source_media_ids, source_media_hash, active_before, active_after)
       VALUES ($1,$2,$3,$4,$5,$6,0,$7)`,
      [product.id, product.product_ref, source.candidate_ref,
        actor.id, ids, hash, activeAfter]
    );
    await tx.query('COMMIT');
    open = false;
    return {
      product_ref: product.product_ref,
      source_candidate_ref: source.candidate_ref,
      media_recovered: activeAfter,
      audit_recorded: true,
      catalog_approved: false,
      market_exposure_changed: false,
    };
  } catch (error) {
    if (open) await tx.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    tx.release();
  }
}

module.exports = { recoverSourceMedia, CatalogMediaRecoveryError };
