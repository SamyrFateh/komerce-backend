'use strict';

/**
 * KOMERCE — Service opérations hub terrain (REFACTO-R2)
 *
 * Extraction iso-comportement depuis routes/hub.js :
 *   POST /api/hub/scan        → scanParcel(parcelRef, userId, notes?)
 *   POST /api/hub/pack        → packParcel(parcelId, userId, boxLabel?, notes?)
 *   POST /api/hub/seal        → sealParcel(parcelId, userId, notes?)
 *   POST /api/hub/batch-scan  → batchScan(parcelRefs, userId, notes?)
 *
 * Invariant I-09 : le colis est une unité autonome. Les mutations ici ne
 * dépendent jamais du statut de la commande parente — seul `order_id` est
 * lu pour l'appel à safeSyncScanToParcels (qui orchestre lui-même les
 * transitions orders.status).
 *
 * FIX-004 : safeSyncScanToParcels est appelé DANS la transaction (client
 * passé en second argument) pour que le verrou FOR UPDATE reste actif
 * pendant toute la durée du sync.
 *
 * Pattern de retour : { status: number, body: object }
 * (même convention que pricing-apply.js pour cohérence projet)
 */

const db = require('../db');
const { safeSyncScanToParcels } = require('../utils/parcelSync');

// ── receiveParcel (POST /scan) ──────────────────────────────────────────────

/**
 * Reçoit un colis au hub : verrouille la ligne, synchronise l'étape
 * `hub_preparation` via safeSyncScanToParcels, commite.
 *
 * @param {string} parcelRef
 * @param {string} userId
 * @param {string|undefined} notes
 * @returns {Promise<{ status: number, body: object }>}
 */
async function receiveParcel(parcelRef, userId, notes) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT p.id, p.order_id, p.status, p.reference
       FROM parcels p
       WHERE p.reference = $1 AND p.status != 'cancelled'
       FOR UPDATE`,
      [parcelRef]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return { status: 404, body: { error: `Colis ${parcelRef} introuvable` } };
    }

    const parcel = rows[0];

    const syncResult = await safeSyncScanToParcels({
      order_id:   parcel.order_id,
      step:       'hub_preparation',
      scan_id:    null,
      scanned_by: userId,
      notes:      notes || `Hub scan: ${parcel.reference}`,
    }, client);

    await client.query('COMMIT');

    const updated = await db.query('SELECT * FROM parcels WHERE id = $1', [parcel.id]);

    return {
      status: 200,
      body: {
        message: `Colis ${parcel.reference} scanné au hub`,
        parcel:  updated.rows[0],
        sync:    syncResult,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── packParcel (POST /pack) ─────────────────────────────────────────────────

/**
 * Marque un colis comme emballé (étape intermédiaire, pas de changement de
 * statut — juste un append dans le champ `notes`).
 *
 * @param {string|number} parcelId
 * @param {string} userId
 * @param {string|undefined} boxLabel
 * @param {string|undefined} notes
 * @returns {Promise<{ status: number, body: object }>}
 */
async function packParcel(parcelId, userId, boxLabel, notes) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, order_id, status, reference
       FROM parcels WHERE id = $1 AND status != 'cancelled'
       FOR UPDATE`,
      [parcelId]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return { status: 404, body: { error: 'Colis introuvable' } };
    }

    const parcel = rows[0];

    if (parcel.status !== 'preparation') {
      await client.query('ROLLBACK');
      return {
        status: 400,
        body: { error: `Colis ${parcel.reference} n'est pas en préparation (statut: ${parcel.status})` },
      };
    }

    const packNote =
      `[PACKED] ${new Date().toISOString()} by ${userId}` +
      (boxLabel ? ` | Box: ${boxLabel}` : '') +
      (notes    ? ` | ${notes}`         : '');

    await client.query(
      `UPDATE parcels
       SET notes = CASE
             WHEN notes IS NULL THEN $1
             ELSE notes || E'\\n' || $1
           END,
           updated_at = NOW()
       WHERE id = $2`,
      [packNote, parcelId]
    );

    await client.query('COMMIT');

    const updated = await db.query('SELECT * FROM parcels WHERE id = $1', [parcelId]);

    return {
      status: 200,
      body: {
        message: `Colis ${parcel.reference} emballé`,
        parcel:  updated.rows[0],
      },
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── sealParcel (POST /seal) ─────────────────────────────────────────────────

/**
 * Scelle un colis (prêt à expédier) : verrouille, vérifie le statut
 * `preparation`, synchronise l'étape `shipped` via safeSyncScanToParcels.
 *
 * @param {string|number} parcelId
 * @param {string} userId
 * @param {string|undefined} notes
 * @returns {Promise<{ status: number, body: object }>}
 */
async function sealParcel(parcelId, userId, notes) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, order_id, status, reference
       FROM parcels WHERE id = $1 AND status != 'cancelled'
       FOR UPDATE`,
      [parcelId]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return { status: 404, body: { error: 'Colis introuvable' } };
    }

    const parcel = rows[0];

    if (parcel.status !== 'preparation') {
      await client.query('ROLLBACK');
      return {
        status: 400,
        body: {
          error: `Colis ${parcel.reference} doit être en préparation pour être scellé (statut: ${parcel.status})`,
        },
      };
    }

    const syncResult = await safeSyncScanToParcels({
      order_id:   parcel.order_id,
      step:       'shipped',
      scan_id:    null,
      scanned_by: userId,
      notes:      notes || `Hub seal: ${parcel.reference}`,
    }, client);

    await client.query('COMMIT');

    const updated = await db.query('SELECT * FROM parcels WHERE id = $1', [parcelId]);

    return {
      status: 200,
      body: {
        message: `Colis ${parcel.reference} scellé — prêt à expédier`,
        parcel:  updated.rows[0],
        sync:    syncResult,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── batchScan (POST /batch-scan) ────────────────────────────────────────────

/**
 * Scanne plusieurs colis d'un coup. Chaque colis est traité dans sa propre
 * transaction (iso-comportement avec la route d'origine) : un échec isolé
 * n'annule pas les succès précédents.
 *
 * @param {string[]} parcelRefs
 * @param {string}   userId
 * @param {string|undefined} notes
 * @returns {Promise<{ status: number, body: object }>}
 */
async function batchScan(parcelRefs, userId, notes) {
  if (!Array.isArray(parcelRefs) || parcelRefs.length === 0) {
    return { status: 400, body: { error: 'parcel_refs doit être un tableau non-vide' } };
  }
  if (parcelRefs.length > 50) {
    return { status: 400, body: { error: 'Maximum 50 colis par batch' } };
  }

  const results = [];
  const errors  = [];

  for (const ref of parcelRefs) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `SELECT p.id, p.order_id, p.status, p.reference
         FROM parcels p
         WHERE p.reference = $1 AND p.status != 'cancelled'
         FOR UPDATE`,
        [ref]
      );

      if (!rows.length) {
        await client.query('ROLLBACK');
        errors.push({ ref, error: 'Colis introuvable' });
        continue;
      }

      const parcel = rows[0];

      const syncResult = await safeSyncScanToParcels({
        order_id:   parcel.order_id,
        step:       'hub_preparation',
        scan_id:    null,
        scanned_by: userId,
        notes:      notes || `Batch scan: ${parcel.reference}`,
      }, client);

      await client.query('COMMIT');

      results.push({
        ref:      parcel.reference,
        parcel_id: parcel.id,
        order_id: parcel.order_id,
        status:   'scanned',
        sync:     syncResult,
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      errors.push({ ref, error: err.message });
    } finally {
      client.release();
    }
  }

  return {
    status: 200,
    body: {
      message:       `${results.length}/${parcelRefs.length} colis scannés`,
      scanned:       results,
      errors,
      total_success: results.length,
      total_errors:  errors.length,
    },
  };
}

module.exports = { receiveParcel, packParcel, sealParcel, batchScan };
