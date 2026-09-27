/**
 * @komerce-arch
 * @role          market-delegation-catalog-service
 * @domain        market-delegation
 * @layer         service
 * @criticality   high
 * @inputs        authenticated market operator, market code, product exposure decision
 * @outputs       product exposure read model, auditable exposure mutations
 * @depends       services/market-delegation-team-service.js, services/market-delegation-service.js, services/catalog-market-exposure-service.js, services/catalog-approval.js
 * @used-by       routes/market-delegation-catalog.js
 * @db-read       products
 * @db-write      none
 * @db-write-via:catalog-market-exposure-service product_market_exposure
 * @db-write-via:catalog-approval products
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        caller-owned
 * @doctrine      catalog_authority_is_capability_based, client_market_id_never_authority, writer_not_owner_boundary, market_validation_may_delegate_first_publication_to_catalog_owner, catalog_stays_unique_exposure_is_projection
 * @impact-areas  market, delegation, catalog
 * @version       2026-09
 */
'use strict';

const { audit } = require('./market-delegation-service');
const { resolveActiveAssignmentByMarketCode, resolveAuthorization } = require('./market-delegation-team-service');
const exposureService = require('./catalog-market-exposure-service');
const catalogApproval = require('./catalog-approval');

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('market-delegation-catalog-service: executor.query requis');
  }
  return executor;
}

function delegationError(code, message, status = 403) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

async function listExposure(executor, { marketId }) {
  return exposureService.listExposureForMarket(marketId, requireExecutor(executor));
}

async function listReviewQueue(executor, { marketId, limit = 100 }) {
  return exposureService.listReviewCandidatesForMarket(
    marketId,
    requireExecutor(executor),
    { limit }
  );
}

function summarizeExposure(rows) {
  const exposure = Array.isArray(rows) ? rows : [];
  const catalogProducts = exposure.length;
  const exposedProducts = exposure.filter(row => row && row.commercial_exposure === exposureService.EXPOSURE.ENABLED).length;
  const hiddenProducts = Math.max(0, catalogProducts - exposedProducts);
  const undecidedProducts = exposure.filter(row => row && row.decision_recorded !== true).length;
  const decidedProducts = Math.max(0, catalogProducts - undecidedProducts);
  const explicitHiddenProducts = exposure.filter(row => row
    && row.decision_recorded === true
    && row.commercial_exposure === exposureService.EXPOSURE.DISABLED).length;
  const exposedNeedsReview = exposure.filter(row => row
    && row.commercial_exposure === exposureService.EXPOSURE.ENABLED
    && row.needs_review === true).length;

  return Object.freeze({
    catalog_products: catalogProducts,
    exposed_products: exposedProducts,
    hidden_products: hiddenProducts,
    decided_products: decidedProducts,
    undecided_products: undecidedProducts,
    explicit_hidden_products: explicitHiddenProducts,
    exposed_needs_review: exposedNeedsReview,
    exposure_pct: catalogProducts > 0 ? Math.round((exposedProducts / catalogProducts) * 100) : null,
  });
}

async function setExposure(executor, { marketCode, actorUserId, correlationId = null, productId, exposure }) {
  const db = requireExecutor(executor);
  const authz = await resolveAuthorization(db, { userId: actorUserId, marketCode, requiredCapability: 'catalog.expose' });

  let before;
  try {
    before = await exposureService.getExposure(productId, authz.market_id, db);
  } catch (_) {
    before = null;
  }

  let after;
  try {
    after = await exposureService.setExposure(productId, authz.market_id, exposure, actorUserId, db);
  } catch (error) {
    if (/produit introuvable/.test(error.message)) {
      throw delegationError('CATALOG_PRODUCT_NOT_FOUND', 'Produit introuvable.', 404);
    }
    if (/exposition invalide/.test(error.message)) {
      throw delegationError('CATALOG_EXPOSURE_INVALID', error.message, 400);
    }
    throw error;
  }

  await audit(db, {
    actorUserId, assignmentId: authz.assignment_id, membershipId: authz.membership_id,
    capability: 'catalog.expose',
    action: exposure === 'ENABLED' ? 'CATALOG_PRODUCT_EXPOSED' : 'CATALOG_PRODUCT_HIDDEN',
    before: { commercial_exposure: before }, after, correlationId,
  });

  return after;
}


/**
 * Validation simple d'un produit pour un marché.
 *
 * Le Responsable pays ne manipule jamais la Raffinerie : le read-model ne lui
 * propose que des candidats déjà prêts côté catalog. Sa validation humaine
 * déclenche, si nécessaire, la première publication globale via l'autorité
 * catalog, puis enregistre l'exposition ENABLED pour son marché dans la même
 * transaction appelante.
 */
async function validateForMarket(executor, {
  marketCode,
  actorUserId,
  correlationId = null,
  productId,
}) {
  const db = requireExecutor(executor);
  const authz = await resolveAuthorization(db, {
    userId: actorUserId,
    marketCode,
    requiredCapability: 'catalog.expose',
  });

  const { rows: [product] } = await db.query(
    `SELECT id, product_ref, lifecycle_status, is_active, content_source, needs_review
       FROM products
      WHERE id=$1
      LIMIT 1`,
    [productId]
  );
  if (!product) {
    throw delegationError('CATALOG_PRODUCT_NOT_FOUND', 'Produit introuvable.', 404);
  }

  let globalPublicationTriggered = false;
  if (product.is_active !== true) {
    if (
      product.lifecycle_status !== 'candidate'
      || product.content_source !== 'manual'
      || product.needs_review !== false
    ) {
      throw delegationError(
        'CATALOG_PRODUCT_NOT_READY',
        'Ce produit n’est pas disponible pour validation.',
        409
      );
    }

    // Preserve the exact same serialization boundary as catalog-approval when
    // the caller owns the transaction.
    await db.query("SELECT pg_advisory_xact_lock(hashtext('komerce:catalog:first-publication'))");
    const published = await catalogApproval.approveProduct(
      db,
      productId,
      { id: actorUserId }
    );

    if (published.status !== 200) {
      const code = published.body?.code || 'CATALOG_PRODUCT_NOT_READY';
      const message = code === 'catalog_cap_reached'
        ? 'Le catalogue a atteint sa capacité actuelle.'
        : 'Ce produit n’est pas encore prêt à être proposé.';
      throw delegationError(
        code === 'catalog_cap_reached' ? 'CATALOG_CAP_REACHED' : 'CATALOG_PRODUCT_NOT_READY',
        message,
        published.status || 409
      );
    }
    globalPublicationTriggered = true;
  }

  const before = await exposureService.getExposure(productId, authz.market_id, db);
  const after = await exposureService.setExposure(
    productId,
    authz.market_id,
    exposureService.EXPOSURE.ENABLED,
    actorUserId,
    db
  );

  await audit(db, {
    actorUserId,
    assignmentId: authz.assignment_id,
    membershipId: authz.membership_id,
    capability: 'catalog.expose',
    action: 'CATALOG_PRODUCT_VALIDATED_FOR_MARKET',
    before: {
      commercial_exposure: before,
      lifecycle_status: product.lifecycle_status,
      is_active: Boolean(product.is_active),
    },
    after: {
      ...after,
      global_publication_triggered: globalPublicationTriggered,
    },
    correlationId,
  });

  return {
    ...after,
    product_ref: product.product_ref,
    global_publication_triggered: globalPublicationTriggered,
  };
}

module.exports = {
  resolveActiveAssignmentByMarketCode,
  resolveAuthorization,
  listExposure,
  listReviewQueue,
  summarizeExposure,
  setExposure,
  validateForMarket,
};
