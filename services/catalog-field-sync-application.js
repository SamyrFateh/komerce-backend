/**
 * @komerce-arch
 * @role          catalog-field-sync-application
 * @domain        catalog
 * @layer         service
 * @criticality   critical
 * @inputs        immutable_catalog_change_observation_id, field_name
 * @outputs       applied_field_value_or_explicit_blocker, read_after_write_proof
 * @depends       db.js, services/catalog-field-sync-decision.js
 * @used-by       tests/integration/catalog-field-sync-application-real-db.test.js
 * @db-read       products, catalog_field_overrides, catalog_field_sync_state
 * @db-write      products (name, description, images, image_url uniquement), catalog_field_sync_state
 * @db-txn        owned (BEGIN/COMMIT/ROLLBACK ; verrou FOR UPDATE sur la ligne products ciblée)
 * @doctrine      docs/doctrine/DOCTRINE_CATALOG_CHANGE_INTAKE.md
 * @impact-areas  catalog, sourcing
 * @version       2026-09
 *
 * MISSION 2 — écriture contrôlée, même discipline que catalog-stock-sync-
 * application.js (Mission 1) : réévalue la décision SOUS VERROU juste
 * avant d'écrire, jamais un simple UPDATE.
 *
 * Ne couvre QUE title/description/media/purchase_price. offer_status,
 * is_active, option_axes, sellable_units n'ont volontairement AUCUNE
 * fonction d'application ici — leur décideur (catalog-field-sync-
 * decision.js#decideOfferLifecycleFieldSync) ne retourne jamais APPLY,
 * et rien dans ce fichier ne les mentionne.
 *
 * purchase_price n'écrit JAMAIS products.cost_kmf (moteur économique actif,
 * services/pricing-output.js) — uniquement catalog_field_sync_state, une
 * trace de ce qui a été OBSERVÉ, jamais publiée comme coût actif.
 */
'use strict';

const db = require('../db');
const {
  DECISION, REASON,
  decideProductTextFieldSync, decideProductMediaSync, decidePurchasePriceSync,
} = require('./catalog-field-sync-decision');

class FieldSyncApplicationError extends Error {
  constructor(status, verdict) {
    super(`[catalog-field-sync-application] ${verdict.decision}: ${verdict.reason}`);
    this.name = 'FieldSyncApplicationError';
    this.status = status;
    this.verdict = verdict;
  }
}

function statusFor(decision) {
  if (decision === DECISION.BLOCKED) return 422;
  if (decision === DECISION.REVIEW_REQUIRED) return 409;
  return 409; // STALE is a conflict; NO_CHANGE returns normally
}

async function upsertSyncState(q, { subjectType, subjectId, fieldName, sourceId, observationId, eventId, observedAt, appliedValue }) {
  await q(
    `INSERT INTO catalog_field_sync_state
       (subject_type, subject_id, field_name, source_id, last_observation_id,
        last_event_id, last_observed_at, applied_value, applied_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW(),NOW())
     ON CONFLICT (subject_type, subject_id, field_name) DO UPDATE SET
       source_id = EXCLUDED.source_id,
       last_observation_id = EXCLUDED.last_observation_id,
       last_event_id = EXCLUDED.last_event_id,
       last_observed_at = EXCLUDED.last_observed_at,
       applied_value = EXCLUDED.applied_value,
       applied_at = NOW(),
       updated_at = NOW()`,
    [subjectType, subjectId, fieldName, sourceId, observationId, eventId, observedAt, JSON.stringify(appliedValue)]
  );
}

/**
 * title/description — écrit products.name/description pour de vrai,
 * protégé par catalog_field_overrides (déjà vérifié par le décideur, et
 * REVÉRIFIÉ ici sous verrou).
 */
async function applyProductTextFieldSync(observationId, factName, column, { pool = db, authorityFn } = {}) {
  const client = await pool.getClient();
  let begun = false;
  try {
    await client.query('BEGIN');
    begun = true;
    const q = client.query.bind(client);

    const preview = await decideProductTextFieldSync(observationId, factName, column, { query: q, ...(authorityFn ? { authorityFn } : {}) });
    if (!preview.catalog_product_id) throw new FieldSyncApplicationError(statusFor(preview.decision), preview);

    const { rows: [locked] } = await q(
      'SELECT id FROM products WHERE id = $1 FOR UPDATE', [preview.catalog_product_id]
    );
    if (!locked) {
      throw new FieldSyncApplicationError(409, {
        ...preview, decision: DECISION.BLOCKED, reason: 'PRODUCT_DELETED_SINCE_DECISION',
      });
    }

    const verdict = await decideProductTextFieldSync(observationId, factName, column, { query: q, ...(authorityFn ? { authorityFn } : {}) });
    if (verdict.decision === DECISION.NO_CHANGE
        || verdict.decision === DECISION.STALE
        || verdict.decision === DECISION.BLOCKED
        || verdict.decision === DECISION.REVIEW_REQUIRED) {
      if (verdict.decision === DECISION.NO_CHANGE && verdict.reason === REASON.TARGET_EQUALS_CURRENT_VALUE) {
        await upsertSyncState(q, {
          subjectType: 'product', subjectId: verdict.catalog_product_id, fieldName: factName,
          sourceId: verdict.source_id, observationId: verdict.observation_id, eventId: verdict.event_id,
          observedAt: verdict.observed_at, appliedValue: verdict.current_value,
        });
        const { rows: [unchanged] } = await q(
          `SELECT ${column} AS value FROM products WHERE id = $1`, [verdict.catalog_product_id]
        );
        if (!unchanged || unchanged.value !== verdict.current_value) {
          throw new FieldSyncApplicationError(500, {
            ...verdict, decision: DECISION.BLOCKED, reason: 'NO_CHANGE_READBACK_MISMATCH',
          });
        }
        await client.query('COMMIT'); begun = false;
        return {
          verdict, catalog_product_id: verdict.catalog_product_id, applied: false,
          value_before: unchanged.value, value_after: unchanged.value,
          read_after_write_verified: true,
        };
      }
      if (verdict.decision === DECISION.NO_CHANGE) {
        await client.query('COMMIT'); begun = false;
        return {
          verdict, catalog_product_id: verdict.catalog_product_id, applied: false,
          read_after_write_verified: false,
        };
      }
      throw new FieldSyncApplicationError(statusFor(verdict.decision), verdict);
    }

    const { rows: [written] } = await q(
      `UPDATE products SET ${column} = $1, updated_at = NOW() WHERE id = $2 RETURNING ${column} AS value`,
      [verdict.target_value, verdict.catalog_product_id]
    );
    if (!written) {
      throw new FieldSyncApplicationError(500, {
        ...verdict, decision: DECISION.BLOCKED, reason: 'WRITE_ROW_VANISHED',
      });
    }
    await upsertSyncState(q, {
      subjectType: 'product', subjectId: verdict.catalog_product_id, fieldName: factName,
      sourceId: verdict.source_id, observationId: verdict.observation_id, eventId: verdict.event_id,
      observedAt: verdict.observed_at, appliedValue: verdict.target_value,
    });

    const { rows: [proof] } = await q(
      `SELECT ${column} AS value FROM products WHERE id = $1`, [verdict.catalog_product_id]
    );
    if (!proof || proof.value !== verdict.target_value) {
      throw new FieldSyncApplicationError(500, {
        ...verdict, decision: DECISION.BLOCKED, reason: 'READ_AFTER_WRITE_MISMATCH',
      });
    }
    await client.query('COMMIT');
    begun = false;
    return {
      verdict, catalog_product_id: verdict.catalog_product_id, applied: true,
      value_before: verdict.current_value, value_after: proof.value,
      read_after_write_verified: true,
    };
  } catch (err) {
    if (begun) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** media — écrit products.images/image_url, protégé par le même override. */
async function applyProductMediaSync(observationId, { pool = db, authorityFn } = {}) {
  const client = await pool.getClient();
  let begun = false;
  try {
    await client.query('BEGIN');
    begun = true;
    const q = client.query.bind(client);

    const preview = await decideProductMediaSync(observationId, { query: q, ...(authorityFn ? { authorityFn } : {}) });
    if (!preview.catalog_product_id) throw new FieldSyncApplicationError(statusFor(preview.decision), preview);

    const { rows: [locked] } = await q('SELECT id FROM products WHERE id = $1 FOR UPDATE', [preview.catalog_product_id]);
    if (!locked) {
      throw new FieldSyncApplicationError(409, {
        ...preview, decision: DECISION.BLOCKED, reason: 'PRODUCT_DELETED_SINCE_DECISION',
      });
    }

    const verdict = await decideProductMediaSync(observationId, { query: q, ...(authorityFn ? { authorityFn } : {}) });
    if (verdict.decision !== DECISION.APPLY) {
      if (verdict.decision === DECISION.NO_CHANGE && verdict.reason === REASON.TARGET_EQUALS_CURRENT_VALUE) {
        await upsertSyncState(q, {
          subjectType: 'product', subjectId: verdict.catalog_product_id, fieldName: 'media',
          sourceId: verdict.source_id, observationId: verdict.observation_id, eventId: verdict.event_id,
          observedAt: verdict.observed_at, appliedValue: verdict.current_value,
        });
        const { rows: [unchanged] } = await q(
          'SELECT images AS value FROM products WHERE id = $1', [verdict.catalog_product_id]
        );
        if (!unchanged || JSON.stringify(unchanged.value) !== JSON.stringify(verdict.current_value)) {
          throw new FieldSyncApplicationError(500, {
            ...verdict, decision: DECISION.BLOCKED, reason: 'NO_CHANGE_READBACK_MISMATCH',
          });
        }
        await client.query('COMMIT'); begun = false;
        return {
          verdict, catalog_product_id: verdict.catalog_product_id, applied: false,
          value_before: unchanged.value, value_after: unchanged.value,
          read_after_write_verified: true,
        };
      }
      if (verdict.decision === DECISION.NO_CHANGE) {
        await client.query('COMMIT'); begun = false;
        return {
          verdict, catalog_product_id: verdict.catalog_product_id, applied: false,
          read_after_write_verified: false,
        };
      }
      throw new FieldSyncApplicationError(statusFor(verdict.decision), verdict);
    }

    const images = verdict.target_value;
    const primary = Array.isArray(images) && images.length ? images[0] : null;
    const { rows: [written] } = await q(
      'UPDATE products SET images = $1::jsonb, image_url = COALESCE($2, image_url), updated_at = NOW() ' +
      'WHERE id = $3 RETURNING images AS value',
      [JSON.stringify(images), primary, verdict.catalog_product_id]
    );
    if (!written) {
      throw new FieldSyncApplicationError(500, {
        ...verdict, decision: DECISION.BLOCKED, reason: 'WRITE_ROW_VANISHED',
      });
    }
    await upsertSyncState(q, {
      subjectType: 'product', subjectId: verdict.catalog_product_id, fieldName: 'media',
      sourceId: verdict.source_id, observationId: verdict.observation_id, eventId: verdict.event_id,
      observedAt: verdict.observed_at, appliedValue: images,
    });

    const { rows: [proof] } = await q(
      'SELECT images AS value, image_url FROM products WHERE id = $1', [verdict.catalog_product_id]
    );
    if (!proof || JSON.stringify(proof.value) !== JSON.stringify(images)
        || proof.image_url !== primary) {
      throw new FieldSyncApplicationError(500, {
        ...verdict, decision: DECISION.BLOCKED, reason: 'READ_AFTER_WRITE_MISMATCH',
      });
    }
    await client.query('COMMIT');
    begun = false;
    return {
      verdict, catalog_product_id: verdict.catalog_product_id, applied: true,
      value_before: verdict.current_value, value_after: proof.value,
      read_after_write_verified: true,
    };
  } catch (err) {
    if (begun) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * purchase_price — n'écrit JAMAIS products.cost_kmf. Uniquement
 * catalog_field_sync_state, une trace, jamais une publication de coût.
 */
async function applyPurchasePriceSync(observationId, { pool = db, authorityFn } = {}) {
  const client = await pool.getClient();
  let begun = false;
  try {
    await client.query('BEGIN');
    begun = true;
    const q = client.query.bind(client);

    const preview = await decidePurchasePriceSync(observationId, { query: q, ...(authorityFn ? { authorityFn } : {}) });
    if (!preview.product_sku_id) throw new FieldSyncApplicationError(statusFor(preview.decision), preview);

    // Verrou sur la ligne de suivi elle-même (pas products : ce champ
    // n'écrit jamais products, donc rien à y verrouiller pour CETTE
    // écriture précise — le verrou protège la réévaluation, pas cost_kmf).
    await q(
      "SELECT pg_advisory_xact_lock(hashtext('komerce:catalog-field-sync:purchase_price'), hashtext($1))",
      [preview.product_sku_id]
    );

    const verdict = await decidePurchasePriceSync(observationId, { query: q, ...(authorityFn ? { authorityFn } : {}) });
    if (verdict.decision !== DECISION.APPLY) {
      if (verdict.decision === DECISION.NO_CHANGE && verdict.reason === REASON.TARGET_EQUALS_CURRENT_VALUE) {
        // Advance the observation watermark even when the tracked supplier
        // price is unchanged. Otherwise an older conflicting observation can
        // later be applied after this newer equal-value observation.
        await upsertSyncState(q, {
          subjectType: 'sku', subjectId: verdict.product_sku_id, fieldName: 'purchase_price',
          sourceId: verdict.source_id, observationId: verdict.observation_id,
          eventId: verdict.event_id, observedAt: verdict.observed_at,
          appliedValue: verdict.current_value,
        });
        const { rows: [unchanged] } = await q(
          "SELECT applied_value FROM catalog_field_sync_state " +
          "WHERE subject_type='sku' AND subject_id=$1 AND field_name='purchase_price'",
          [verdict.product_sku_id]
        );
        if (!unchanged || JSON.stringify(unchanged.applied_value) !== JSON.stringify(verdict.current_value)) {
          throw new FieldSyncApplicationError(500, {
            ...verdict, decision: DECISION.BLOCKED, reason: 'NO_CHANGE_READBACK_MISMATCH',
          });
        }
        await client.query('COMMIT'); begun = false;
        return {
          verdict, catalog_product_id: verdict.catalog_product_id, applied: false,
          value_before: unchanged.applied_value, value_after: unchanged.applied_value,
          read_after_write_verified: true,
        };
      }
      if (verdict.decision === DECISION.NO_CHANGE) {
        await client.query('COMMIT'); begun = false;
        return {
          verdict, catalog_product_id: verdict.catalog_product_id,
          product_sku_id: verdict.product_sku_id, applied: false,
          read_after_write_verified: false,
        };
      }
      throw new FieldSyncApplicationError(statusFor(verdict.decision), verdict);
    }

    await upsertSyncState(q, {
      subjectType: 'sku', subjectId: verdict.product_sku_id, fieldName: 'purchase_price',
      sourceId: verdict.source_id, observationId: verdict.observation_id, eventId: verdict.event_id,
      observedAt: verdict.observed_at, appliedValue: verdict.target_value,
    });

    const { rows: [proof] } = await q(
      "SELECT applied_value FROM catalog_field_sync_state " +
      "WHERE subject_type='sku' AND subject_id=$1 AND field_name='purchase_price'",
      [verdict.product_sku_id]
    );
    if (!proof || JSON.stringify(proof.applied_value) !== JSON.stringify(verdict.target_value)) {
      throw new FieldSyncApplicationError(500, {
        ...verdict, decision: DECISION.BLOCKED, reason: 'READ_AFTER_WRITE_MISMATCH',
      });
    }
    await client.query('COMMIT');
    begun = false;
    return {
      verdict, catalog_product_id: verdict.catalog_product_id, applied: true,
      value_before: verdict.current_value, value_after: proof.applied_value,
      read_after_write_verified: true,
    };
  } catch (err) {
    if (begun) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  FieldSyncApplicationError,
  applyProductTextFieldSync,
  applyProductMediaSync,
  applyPurchasePriceSync,
};
