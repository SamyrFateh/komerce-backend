/**
 * @komerce-arch
 * @role          catalog-field-sync-decision
 * @domain        catalog
 * @layer         service
 * @criticality   critical
 * @inputs        immutable_catalog_change_observation_id, field_name
 * @outputs       explicit_auditable_field_application_decision
 * @depends       db.js, services/sourcing-catalog-change-sku-identity-proof.js
 * @used-by       services/catalog-field-sync-application.js, tests/integration/catalog-field-sync-decision-real-db.test.js
 * @db-read       catalog_field_sync_state, catalog_field_overrides, products, product_skus, sourcing_captures, sourcing_observations
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CATALOG_CHANGE_INTAKE.md
 * @impact-areas  catalog, sourcing
 * @version       2026-09
 *
 * MISSION 2 (KOMERCE_AUDIT_ABSTRACTIONS_CATALOG_CHANGE_INTAKE) — moteur
 * commun de décision pour les champs du catalogue AU-DELÀ du stock
 * (Mission 1, catalog-stock-sync-decision.js, jamais touché ici). Même
 * contrat d'entrée (Catalog Change Intake), mêmes preuves d'identité
 * réutilisées telles quelles, mais une POLITIQUE PROPRE À CHAQUE CHAMP
 * (autorité, override, ce que "appliquer" signifie) plutôt qu'un
 * traitement uniforme — cf. brief §2.1/§2.3.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Ce que ce moteur sait et ne sait PAS (audit préalable, voir PR) :
 *
 * - proveExactCatalogSkuForStockDelta (sourcing-catalog-change-sku-
 *   identity-proof.js) est RÉUTILISÉE TELLE QUELLE malgré son nom : elle
 *   résout déjà catalog_product_id EN PLUS de product_sku_id, à partir du
 *   grain 'unit' de l'observation — sa preuve ne dépend d'aucune manière
 *   du fait stock_available spécifiquement. Aucune preuve d'identité
 *   parallèle n'est créée ici.
 *
 * - Champs PRODUIT (title/description/media/attributes) : products.name,
 *   products.description, products.image_url/images. Champs déjà couverts
 *   par un mécanisme d'override manuel (name, description — services/
 *   catalog-overrides.js, table catalog_field_overrides) : la présence
 *   d'une ligne d'override pour CE (product_id, field) bloque
 *   inconditionnellement l'application — jamais silencieusement écrasé
 *   par le prochain refresh fournisseur (brief §2.2, "Correction manuelle
 *   ≠ donnée écrasable"). Média n'a PAS de mécanisme d'override dédié à
 *   ce jour ; ce moteur RÉUTILISE la lecture de catalog_field_overrides
 *   (déjà non restreinte à un ensemble de champs fixe côté lecture) sans
 *   étendre son écriture — un override existant pour 'image_url'/'images'
 *   bloquerait de la même façon s'il en existait un jour un.
 *
 * - purchase_price/currency : products.cost_kmf alimente le moteur
 *   économique actif (services/pricing-output.js#sources.purchase_price) —
 *   une écriture directe risquerait une propagation silencieuse vers le
 *   prix de vente, explicitement interdite par le brief. Ce moteur ne lit
 *   ni n'écrit JAMAIS cost_kmf : la fraîcheur/l'idempotence se comparent
 *   exclusivement contre catalog_field_sync_state (jamais contre l'état
 *   vendable réel), et catalog-field-sync-application.js n'écrit que
 *   cette même table de suivi, jamais products.cost_kmf.
 *
 * - offer_status/is_active/option_axes/sellable_units : la mutation vit
 *   dans services/catalog-promotion/* (orchestrateur de PUBLICATION), que
 *   ce moteur n'invoque JAMAIS. Decision-only pour ces champs — cf.
 *   decideOfferLifecycleFieldSync ci-dessous, qui ne retourne jamais APPLY
 *   utilisable en écriture (toujours REVIEW_REQUIRED au mieux), et
 *   catalog-field-sync-application.js n'a pas de politique d'écriture
 *   pour eux.
 * ──────────────────────────────────────────────────────────────────────
 */
'use strict';

const db = require('../db');
const skuProof = require('./sourcing-catalog-change-sku-identity-proof');

// Même garde que catalog-stock-sync-decision.js#isolatedStockSyncProofTest —
// aucun résolveur d'autorité runtime n'existe encore pour ces champs non
// plus. Une preuve synthétique ne peut jamais franchir cette porte hors CI
// PostgreSQL jetable.
function isolatedFieldSyncProofTest() {
  return process.env.GITHUB_ACTIONS === 'true'
    && process.env.NODE_ENV === 'test'
    && process.env.KOMERCE_DISABLE_CRONS === 'true'
    && process.env.DATABASE_URL === 'postgresql://komerce:komerce@localhost:5432/komerce_test';
}

const DECISION = Object.freeze({
  APPLY: 'APPLY',
  NO_CHANGE: 'NO_CHANGE',
  STALE: 'STALE',
  BLOCKED: 'BLOCKED',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
});

const REASON = Object.freeze({
  IDENTITY_NOT_PROVEN: 'IDENTITY_NOT_PROVEN',
  FACT_NOT_PRESENT: 'FACT_NOT_PRESENT',
  INVALID_FIELD_VALUE: 'INVALID_FIELD_VALUE',
  FUTURE_OBSERVATION: 'FUTURE_OBSERVATION',
  REPLAY_SAME_OBSERVATION: 'REPLAY_SAME_OBSERVATION',
  OLDER_OR_EQUAL_TO_APPLIED: 'OLDER_OR_EQUAL_TO_APPLIED',
  SUBJECT_TOUCHED_AFTER_OBSERVATION: 'SUBJECT_TOUCHED_AFTER_OBSERVATION',
  MANUAL_OVERRIDE_PROTECTED: 'MANUAL_OVERRIDE_PROTECTED',
  FIELD_AUTHORITY_NOT_PROVEN: 'FIELD_AUTHORITY_NOT_PROVEN',
  SYNTHETIC_PROOF_NOT_ALLOWED: 'SYNTHETIC_PROOF_NOT_ALLOWED',
  TARGET_EQUALS_CURRENT_VALUE: 'TARGET_EQUALS_CURRENT_VALUE',
  IDENTITY_PROVEN_AND_FRESH: 'IDENTITY_PROVEN_AND_FRESH',
  PUBLICATION_LINKED_DECISION_ONLY: 'PUBLICATION_LINKED_DECISION_ONLY',
});

function verdict(decision, reason, extra = {}) {
  return Object.freeze({ decision, reason, application_status: 'NOT_EVALUATED', ...extra });
}

const DEFAULT_UNPROVEN_AUTHORITY = async () =>
  ({ proved: false, reason: 'NO_RUNTIME_FIELD_AUTHORITY_PROOF' });

/**
 * Lit l'identité (produit + SKU) et le fait `fieldName` de l'observation,
 * sans aucune politique de champ — brique partagée par les fonctions
 * exportées ci-dessous.
 */
async function proveIdentityAndFact(observationId, fieldName, query, identityFn) {
  const identity = await identityFn(observationId, query);
  if (identity.status !== skuProof.STATUS.EXACT_CATALOG_SKU_IDENTITY) {
    return { ok: false, verdict: verdict(DECISION.BLOCKED, REASON.IDENTITY_NOT_PROVEN, {
      observation_id: observationId, underlying_identity_status: identity.status,
    }) };
  }
  const { rows: [row] } = await query(`
    SELECT o.observed_at, o.normalized, c.stats->>'event_id' AS event_id
      FROM sourcing_observations o
      JOIN sourcing_captures c ON c.capture_id = o.capture_id
     WHERE o.observation_id = $1::uuid
  `, [observationId]);
  if (!row) {
    return { ok: false, verdict: verdict(DECISION.BLOCKED, REASON.IDENTITY_NOT_PROVEN, {
      observation_id: observationId, underlying_identity_status: 'NO_OBSERVATION',
    }) };
  }
  const normalized = row.normalized || {};
  if (normalized.fact_name !== fieldName || !(fieldName in normalized)) {
    return { ok: false, verdict: verdict(DECISION.BLOCKED, REASON.FACT_NOT_PRESENT, {
      observation_id: observationId, catalog_product_id: identity.catalog_product_id,
      product_sku_id: identity.product_sku_id, requested_field: fieldName,
    }) };
  }
  const observedMillis = new Date(row.observed_at).getTime();
  if (!Number.isFinite(observedMillis) || observedMillis > Date.now()) {
    return { ok: false, verdict: verdict(DECISION.BLOCKED, REASON.FUTURE_OBSERVATION, {
      observation_id: observationId, catalog_product_id: identity.catalog_product_id,
      product_sku_id: identity.product_sku_id, observed_at: row.observed_at,
    }) };
  }
  return {
    ok: true, identity, observedAt: row.observed_at, eventId: row.event_id,
    observedValue: normalized[fieldName],
  };
}

async function checkFreshness(query, subjectType, subjectId, fieldName, observationId, observedAt) {
  const { rows: [prior] } = await query(
    'SELECT last_observation_id, last_observed_at FROM catalog_field_sync_state ' +
    'WHERE subject_type = $1 AND subject_id = $2 AND field_name = $3',
    [subjectType, subjectId, fieldName]
  );
  if (prior && prior.last_observation_id === observationId) {
    return verdict(DECISION.NO_CHANGE, REASON.REPLAY_SAME_OBSERVATION, {});
  }
  if (prior && new Date(prior.last_observed_at).getTime() >= new Date(observedAt).getTime()) {
    return verdict(DECISION.STALE, REASON.OLDER_OR_EQUAL_TO_APPLIED, {
      applied_observed_at: prior.last_observed_at,
    });
  }
  return null;
}

/**
 * Politique title/description — champs PRODUIT déjà couverts par
 * catalog_field_overrides (services/catalog-overrides.js). column est le
 * nom réel de la colonne products (name pour title, description pour
 * description — l'intake nomme le fait 'title', products nomme la
 * colonne 'name').
 */
async function decideProductTextFieldSync(observationId, factName, column, {
  query = db.query.bind(db),
  identityFn = skuProof.proveExactCatalogSkuForStockDelta,
  authorityFn = DEFAULT_UNPROVEN_AUTHORITY,
} = {}) {
  // column est interpolé dans le SQL ci-dessous (PostgreSQL n'accepte pas
  // un nom de colonne en paramètre lié) — jamais dérivé de l'observation ni
  // d'une entrée utilisateur, toujours passé littéralement par les
  // appelants de ce fichier ; liste blanche explicite par discipline.
  if (!((factName === 'title' && column === 'name')
      || (factName === 'description' && column === 'description'))) {
    throw new TypeError('decideProductTextFieldSync: champ/colonne non concordants');
  }
  if (!isolatedFieldSyncProofTest() && authorityFn !== DEFAULT_UNPROVEN_AUTHORITY) {
    return verdict(DECISION.BLOCKED, REASON.SYNTHETIC_PROOF_NOT_ALLOWED, { observation_id: observationId });
  }
  const proof = await proveIdentityAndFact(observationId, factName, query, identityFn);
  if (!proof.ok) return proof.verdict;
  const { identity, observedAt, eventId, observedValue } = proof;
  const productId = identity.catalog_product_id;
  if (typeof observedValue !== 'string' || !observedValue.trim()) {
    return verdict(DECISION.BLOCKED, REASON.INVALID_FIELD_VALUE, {
      observation_id: observationId, catalog_product_id: productId, field_name: factName,
    });
  }


  const common = {
    observation_id: observationId, catalog_product_id: productId,
    product_sku_id: identity.product_sku_id, source_id: identity.source_id,
    observed_at: observedAt, event_id: eventId, field_name: factName,
  };

  const fresh = await checkFreshness(query, 'product', productId, factName, observationId, observedAt);
  if (fresh) return verdict(fresh.decision, fresh.reason, { ...common, ...fresh });

  // Correction manuelle ≠ donnée écrasable par le prochain refresh (brief
  // §2.2) : une ligne d'override existante pour ce (product_id, colonne)
  // protège inconditionnellement, quelle que soit la fraîcheur observée.
  const { rows: [override] } = await query(
    'SELECT set_by, updated_at FROM catalog_field_overrides WHERE product_id = $1 AND field_name = $2',
    [productId, column]
  );
  if (override) {
    return verdict(DECISION.REVIEW_REQUIRED, REASON.MANUAL_OVERRIDE_PROTECTED, {
      ...common, override_set_by: override.set_by, override_updated_at: override.updated_at,
    });
  }

  const authority = await authorityFn({ ...common, observed_value: observedValue });
  const authorityMatches = authority && authority.proved === true
    && authority.operation === `${factName}_write`
    && authority.source_id === identity.source_id
    && authority.catalog_product_id === productId;
  if (!authorityMatches) {
    return verdict(DECISION.REVIEW_REQUIRED, REASON.FIELD_AUTHORITY_NOT_PROVEN, {
      ...common, authority_reason: authority?.reason || 'MISSING_PROOF',
    });
  }

  const { rows: [row] } = await query(
    `SELECT ${column} AS current_value, updated_at FROM products WHERE id = $1`, [productId]
  );
  if (row && new Date(row.updated_at).getTime() > new Date(observedAt).getTime()) {
    return verdict(DECISION.REVIEW_REQUIRED, REASON.SUBJECT_TOUCHED_AFTER_OBSERVATION, {
      ...common, subject_updated_at: row.updated_at,
    });
  }
  if (row && row.current_value === observedValue) {
    return verdict(DECISION.NO_CHANGE, REASON.TARGET_EQUALS_CURRENT_VALUE, {
      ...common, current_value: row.current_value,
    });
  }

  return verdict(DECISION.APPLY, REASON.IDENTITY_PROVEN_AND_FRESH, {
    ...common, target_value: observedValue, current_value: row ? row.current_value : null,
    subject_type: 'product', subject_id: productId, column,
  });
}

/**
 * Politique média — champ PRODUIT sans mécanisme d'override dédié à ce
 * jour (cf. audit). Réutilise la LECTURE de catalog_field_overrides sans
 * étendre son écriture — un override futur pour 'image_url'/'images'
 * bloquerait de la même façon.
 */
async function decideProductMediaSync(observationId, {
  query = db.query.bind(db),
  identityFn = skuProof.proveExactCatalogSkuForStockDelta,
  authorityFn = DEFAULT_UNPROVEN_AUTHORITY,
} = {}) {
  if (!isolatedFieldSyncProofTest() && authorityFn !== DEFAULT_UNPROVEN_AUTHORITY) {
    return verdict(DECISION.BLOCKED, REASON.SYNTHETIC_PROOF_NOT_ALLOWED, { observation_id: observationId });
  }
  const proof = await proveIdentityAndFact(observationId, 'media', query, identityFn);
  if (!proof.ok) return proof.verdict;
  const { identity, observedAt, eventId, observedValue } = proof;
  const productId = identity.catalog_product_id;
  // An empty/invalid media list cannot silently clear images or leave the
  // old image_url paired with an empty list. Explicit removals are a separate
  // publication decision; they are never inferred from an OBSERVED payload.
  if (!Array.isArray(observedValue) || observedValue.length === 0
      || observedValue.some((url) => typeof url !== 'string'
        || !/^https:\/\//i.test(url) || url.length > 2048)) {
    return verdict(DECISION.BLOCKED, REASON.INVALID_FIELD_VALUE, {
      observation_id: observationId, catalog_product_id: productId, field_name: 'media',
    });
  }

  const common = {
    observation_id: observationId, catalog_product_id: productId,
    product_sku_id: identity.product_sku_id, source_id: identity.source_id,
    observed_at: observedAt, event_id: eventId, field_name: 'media',
  };

  const fresh = await checkFreshness(query, 'product', productId, 'media', observationId, observedAt);
  if (fresh) return verdict(fresh.decision, fresh.reason, { ...common, ...fresh });

  const { rows: overrides } = await query(
    "SELECT field_name FROM catalog_field_overrides WHERE product_id = $1 AND field_name IN ('image_url','images')",
    [productId]
  );
  if (overrides.length) {
    return verdict(DECISION.REVIEW_REQUIRED, REASON.MANUAL_OVERRIDE_PROTECTED, {
      ...common, override_fields: overrides.map((o) => o.field_name),
    });
  }

  const authority = await authorityFn({ ...common, observed_value: observedValue });
  const authorityMatches = authority && authority.proved === true
    && authority.operation === 'media_write'
    && authority.source_id === identity.source_id
    && authority.catalog_product_id === productId;
  if (!authorityMatches) {
    return verdict(DECISION.REVIEW_REQUIRED, REASON.FIELD_AUTHORITY_NOT_PROVEN, {
      ...common, authority_reason: authority?.reason || 'MISSING_PROOF',
    });
  }

  const { rows: [row] } = await query(
    'SELECT images, image_url, updated_at FROM products WHERE id = $1', [productId]
  );
  if (row && new Date(row.updated_at).getTime() > new Date(observedAt).getTime()) {
    return verdict(DECISION.REVIEW_REQUIRED, REASON.SUBJECT_TOUCHED_AFTER_OBSERVATION, {
      ...common, subject_updated_at: row.updated_at,
    });
  }
  const currentImages = row ? JSON.stringify(row.images ?? null) : null;
  const targetImages = JSON.stringify(observedValue ?? null);
  if (row && currentImages === targetImages) {
    return verdict(DECISION.NO_CHANGE, REASON.TARGET_EQUALS_CURRENT_VALUE, {
      ...common, current_value: row.images,
    });
  }

  return verdict(DECISION.APPLY, REASON.IDENTITY_PROVEN_AND_FRESH, {
    ...common, target_value: observedValue, current_value: row ? row.images : null,
    subject_type: 'product', subject_id: productId,
  });
}

/**
 * Politique purchase_price/currency — jamais de comparaison contre
 * products.cost_kmf (moteur économique actif). Fraîcheur et idempotence
 * exclusivement contre catalog_field_sync_state. APPLY signifie
 * uniquement "à enregistrer dans la table de suivi", jamais "à publier
 * comme coût actif" — cf. catalog-field-sync-application.js.
 */
async function decidePurchasePriceSync(observationId, {
  query = db.query.bind(db),
  identityFn = skuProof.proveExactCatalogSkuForStockDelta,
  authorityFn = DEFAULT_UNPROVEN_AUTHORITY,
} = {}) {
  if (!isolatedFieldSyncProofTest() && authorityFn !== DEFAULT_UNPROVEN_AUTHORITY) {
    return verdict(DECISION.BLOCKED, REASON.SYNTHETIC_PROOF_NOT_ALLOWED, { observation_id: observationId });
  }
  const proof = await proveIdentityAndFact(observationId, 'purchase_price', query, identityFn);
  if (!proof.ok) return proof.verdict;
  const { identity, observedAt, eventId, observedValue } = proof;
  const productId = identity.catalog_product_id;

  const common = {
    observation_id: observationId, catalog_product_id: productId,
    product_sku_id: identity.product_sku_id, source_id: identity.source_id,
    observed_at: observedAt, event_id: eventId, field_name: 'purchase_price',
  };

  const fresh = await checkFreshness(query, 'product', productId, 'purchase_price', observationId, observedAt);
  if (fresh) return verdict(fresh.decision, fresh.reason, { ...common, ...fresh });

  const authority = await authorityFn({ ...common, observed_value: observedValue });
  const authorityMatches = authority && authority.proved === true
    && authority.operation === 'purchase_price_write'
    && authority.source_id === identity.source_id
    && authority.catalog_product_id === productId;
  if (!authorityMatches) {
    return verdict(DECISION.REVIEW_REQUIRED, REASON.FIELD_AUTHORITY_NOT_PROVEN, {
      ...common, authority_reason: authority?.reason || 'MISSING_PROOF',
    });
  }

  const { rows: [tracked] } = await query(
    'SELECT applied_value FROM catalog_field_sync_state ' +
    "WHERE subject_type = 'product' AND subject_id = $1 AND field_name = 'purchase_price'",
    [productId]
  );
  const currentTracked = tracked ? JSON.stringify(tracked.applied_value) : null;
  const targetTracked = JSON.stringify(observedValue);
  if (currentTracked === targetTracked) {
    return verdict(DECISION.NO_CHANGE, REASON.TARGET_EQUALS_CURRENT_VALUE, {
      ...common, current_value: tracked ? tracked.applied_value : null,
    });
  }

  return verdict(DECISION.APPLY, REASON.IDENTITY_PROVEN_AND_FRESH, {
    ...common, target_value: observedValue, current_value: tracked ? tracked.applied_value : null,
    subject_type: 'product', subject_id: productId,
  });
}

/**
 * offer_status / is_active / option_axes / sellable_units — DECISION-ONLY.
 * La mutation vit dans services/catalog-promotion/* (orchestrateur de
 * publication), jamais invoqué ici. Cette fonction prouve l'identité et la
 * fraîcheur au même niveau d'exigence que les autres, mais ne retourne
 * JAMAIS DECISION.APPLY — REVIEW_REQUIRED au mieux, pour signaler qu'une
 * décision humaine/opérateur est nécessaire. catalog-field-sync-
 * application.js n'a aucune politique d'écriture pour ces champs.
 */
async function decideOfferLifecycleFieldSync(observationId, factName, {
  query = db.query.bind(db),
  identityFn = skuProof.proveExactCatalogSkuForStockDelta,
} = {}) {
  if (!['offer_status', 'is_active', 'option_axes', 'sellable_units'].includes(factName)) {
    throw new TypeError(`decideOfferLifecycleFieldSync: champ non pris en charge: ${factName}`);
  }
  const proof = await proveIdentityAndFact(observationId, factName, query, identityFn);
  if (!proof.ok) return proof.verdict;
  const { identity, observedAt, eventId, observedValue } = proof;
  const common = {
    observation_id: observationId, catalog_product_id: identity.catalog_product_id,
    product_sku_id: identity.product_sku_id, source_id: identity.source_id,
    observed_at: observedAt, event_id: eventId, field_name: factName,
  };

  return verdict(DECISION.REVIEW_REQUIRED, REASON.PUBLICATION_LINKED_DECISION_ONLY, {
    ...common, observed_value: observedValue,
    note: 'Mutation liée à la publication (services/catalog-promotion/*) — jamais appliquée automatiquement par ce moteur.',
  });
}

module.exports = {
  DECISION, REASON,
  decideProductTextFieldSync,
  decideProductMediaSync,
  decidePurchasePriceSync,
  decideOfferLifecycleFieldSync,
};
