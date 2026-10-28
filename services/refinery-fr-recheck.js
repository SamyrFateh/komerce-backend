/**
 * @komerce-arch
 * @role          refinery-active-editorial-recheck
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        authenticated_admin, active_handed_off_product_ref, french_editorial_proposal
 * @outputs       traced_editorial_override_only
 * @depends       services/catalog-overrides.js, services/catalog-fr-quality.js
 * @db-read       products, sourcing_candidates
 * @db-write      catalog_field_overrides, products(name,description,content_source,needs_review)
 * @db-txn        same_transaction_as_override
 * @doctrine      refinery_edits_french_not_publication_market_or_prices
 */
'use strict';

const db = require('../db');
const { upsertOverrides } = require('./catalog-overrides');
const { frenchLanguageProblems, describeFrenchProblems } = require('./catalog-fr-quality');

class RefineryFrenchRecheckError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function isEditorialIncomplete(row) {
  if (!row) return false;
  const locale = String(row.source_locale || '').toLowerCase().replace('_', '-');
  const frenchSource = locale === 'fr' || locale.startsWith('fr-');
  return !String(row.description || '').trim()
    || row.needs_review === true
    || (row.content_source === 'connector_raw' && !frenchSource);
}

async function correctActiveFrench(productRef, payload = {}, actor, executor = db) {
  const ref = String(productRef || '').trim();
  const name = String(payload.name || '').trim();
  const description = String(payload.description || '').trim();
  if (!ref) throw new RefineryFrenchRecheckError('product_ref_required', 'Référence produit obligatoire', 400);
  if (!name || !description) {
    throw new RefineryFrenchRecheckError('refinery_fr_fields_required',
      'Titre français et description française sont obligatoires.', 422);
  }
  if (!actor?.id) {
    throw new RefineryFrenchRecheckError('refinery_fr_actor_required',
      'Un acteur authentifié est obligatoire pour tracer la correction.', 403);
  }
  const problems = frenchLanguageProblems({ title: name, description });
  if (problems.length) {
    throw new RefineryFrenchRecheckError('refinery_fr_language_check_failed',
      'Préparation française refusée : ' + describeFrenchProblems(problems), 422);
  }

  const work = async q => {
    const { rows: [before] } = await q.query(
      'SELECT * FROM products WHERE product_ref=$1 FOR UPDATE', [ref]);
    if (!before) throw new RefineryFrenchRecheckError('product_not_found',
      'Produit introuvable', 404);
    if (before.lifecycle_status !== 'active' || before.is_active !== true) {
      throw new RefineryFrenchRecheckError('refinery_active_recheck_only',
        'Cette correction est réservée à un produit déjà actif et à réexaminer.', 409);
    }
    const { rows: handoffs } = await q.query(
      "SELECT 1 FROM sourcing_candidates WHERE product_id=$1 AND state='imported_to_catalog' LIMIT 1",
      [before.id]);
    if (!handoffs.length) {
      throw new RefineryFrenchRecheckError('refinery_handoff_required',
        'La provenance Sourcing canonique du produit doit être vérifiée.', 409);
    }
    if (!isEditorialIncomplete(before)) {
      throw new RefineryFrenchRecheckError('refinery_fr_already_ready',
        'La fiche ne présente plus de défaut éditorial nécessitant un réexamen.', 409);
    }

    // Canonical domain writer: preserves original supplier fields and audit
    // reasons; the transaction prevents partial name/description overrides.
    await upsertOverrides(q, before.id, { name, description }, {
      reason: 'Raffinerie : correction FR après réexamen du produit actif',
      setBy: actor.id,
    });
    // Explicit human editorial recheck, not a second catalogue approval.
    const { rows: [after] } = await q.query(
      `UPDATE products
          SET content_source='manual', needs_review=FALSE,
              enrichment_version=NULL, enrichment_confidence=NULL,
              updated_at=NOW()
        WHERE id=$1 AND lifecycle_status='active' AND is_active=TRUE
        RETURNING product_ref, content_source, needs_review, is_active, lifecycle_status`,
      [before.id]);
    if (!after) throw new RefineryFrenchRecheckError('refinery_active_conflict',
      'Produit modifié pendant la correction.', 409);
    return {
      product_ref: after.product_ref,
      status: 'editorial_recheck_saved',
      source_preserved: true,
      approval_granted: false,
      publication_changed: false,
      market_exposure_changed: false,
    };
  };
  return executor === db ? db.withTransaction(work) : work(executor);
}

module.exports = {
  correctActiveFrench,
  RefineryFrenchRecheckError,
  _test: { isEditorialIncomplete },
};
