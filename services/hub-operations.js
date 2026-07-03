/**
 * @komerce-arch
 * @role          hub-operations
 * @domain        logistics
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       business_rules, parcel_items, parcels, products, scan_events
 * @db-write      parcels, products, scan_events
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change, DOCTRINE_DENSITE_VALEUR (V-4, 2026-07-02)
 * @impact-areas  unknown
 * @version       2026-06
 */

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

// ══════════════════════════════════════════════════════════════════════════
// V-4 DOCTRINE_DENSITE_VALEUR — repack prescrit, jamais improvisé (R2)
// Le système décide (flags + seuil business_rules), l'agent hub exécute.
// SANS CONTRAINTE : toute erreur ici est avalée — le scan n'échoue JAMAIS
// à cause du volume. Champs additifs dans le body, contrat existant intact.
// ══════════════════════════════════════════════════════════════════════════

const REPACK_MIN_GAIN_FALLBACK_CM3 = 2000; // fallback ultime si business_rules inaccessible

/**
 * Calcule les tâches volume d'un colis à la réception :
 *   - 'measure' : produit sans volume_cm3 → mesurer L×l×h à la 1ʳᵉ réception
 *                 (le volume alimente la ventilation fret 095 et la densité V-2)
 *   - 'repack'  : gain prouvé (volume_cm3 − repack_volume_cm3) ≥ REPACK_MIN_GAIN_CM3
 *                 et non repack_exempt → consigne d'emballage optimisé
 * Les exemptions (fragile, boîte = valeur perçue, douane) sont posées par
 * l'admin via products.repack_exempt — jamais décidées ici ni par l'agent.
 *
 * @param {string} parcelId
 * @returns {Promise<{ next_action: string|null, tasks: Array }>}
 */
async function computeVolumeTasks(parcelId) {
  const empty = { next_action: null, tasks: [] };
  try {
    const { rows: items } = await db.query(
      `SELECT pi.product_id,
              COALESCE(pi.product_name, pr.name) AS name,
              pi.quantity,
              pr.volume_cm3, pr.repack_volume_cm3, pr.repack_exempt
       FROM parcel_items pi
       JOIN products pr ON pr.id = pi.product_id
       WHERE pi.parcel_id = $1`,
      [parcelId]
    );
    if (!items.length) return empty;

    let minGain = REPACK_MIN_GAIN_FALLBACK_CM3;
    try {
      const { rows } = await db.query(
        `SELECT value FROM business_rules WHERE key = 'REPACK_MIN_GAIN_CM3' AND is_active = TRUE LIMIT 1`
      );
      if (rows[0]) {
        const v = rows[0].value && rows[0].value.value != null ? Number(rows[0].value.value) : Number(rows[0].value);
        if (!isNaN(v)) minGain = v;
      }
    } catch (_) { /* business_rules inaccessible → fallback */ }

    const tasks = [];
    for (const it of items) {
      if (it.repack_exempt) continue;
      const vol    = it.volume_cm3        != null ? Number(it.volume_cm3)        : null;
      const repack = it.repack_volume_cm3 != null ? Number(it.repack_volume_cm3) : null;

      if (vol == null) {
        tasks.push({
          task: 'measure',
          product_id: it.product_id,
          name: it.name,
          quantity: it.quantity,
          instruction: 'Mesurer L×l×h (cm) du produit emballé et saisir le volume',
        });
      } else if (repack != null && (vol - repack) >= minGain) {
        tasks.push({
          task: 'repack',
          product_id: it.product_id,
          name: it.name,
          quantity: it.quantity,
          gain_cm3: Math.round(vol - repack),
          instruction: `Repacker en emballage optimisé (gain ${Math.round((vol - repack) / 1000)} dm³/unité)`,
        });
      }
    }

    const next_action = tasks.some(t => t.task === 'repack') ? 'repack'
      : tasks.some(t => t.task === 'measure') ? 'measure_volume'
      : null;

    return { next_action, tasks };
  } catch (_) {
    return empty; // sans contrainte : jamais d'échec de scan pour cause de volume
  }
}

/**
 * Enregistre une mesure de volume produit (POST /api/hub/volume).
 * L'agent exécute une consigne de mesure — il ne décide rien (R2) :
 * pas de flag d'exemption ici, pas de seuil, juste la saisie.
 * Dernière mesure gagne (pas de verrou : la donnée fraîche prime).
 *
 * @param {string} productId
 * @param {string} userId
 * @param {{ volume_cm3?: number, repack_volume_cm3?: number }} payload
 * @returns {Promise<{ status: number, body: object }>}
 */
async function recordVolume(productId, userId, payload) {
  const { volume_cm3, repack_volume_cm3 } = payload || {};
  if (volume_cm3 == null && repack_volume_cm3 == null) {
    return { status: 400, body: { error: 'Fournir volume_cm3 et/ou repack_volume_cm3' } };
  }

  const sets = [];
  const params = [];
  let i = 1;
  if (volume_cm3 != null)        { sets.push(`volume_cm3 = $${i++}`);        params.push(volume_cm3); }
  if (repack_volume_cm3 != null) { sets.push(`repack_volume_cm3 = $${i++}`); params.push(repack_volume_cm3); }
  params.push(productId);

  const { rows } = await db.query(
    `UPDATE products SET ${sets.join(', ')}
     WHERE id = $${i}
     RETURNING id, name, volume_cm3, repack_volume_cm3, repack_exempt`,
    params
  );
  if (!rows.length) {
    return { status: 404, body: { error: 'Produit introuvable' } };
  }

  const p = rows[0];
  const gain = (p.volume_cm3 != null && p.repack_volume_cm3 != null)
    ? Math.round(Number(p.volume_cm3) - Number(p.repack_volume_cm3))
    : null;

  return {
    status: 200,
    body: {
      message: `Volume enregistré pour ${p.name}`,
      product: p,
      repack_gain_cm3: gain,
      recorded_by: userId,
    },
  };
}

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

    // V-4 : tâches volume/repack — hors transaction, jamais bloquant.
    const volumeTasks = await computeVolumeTasks(parcel.id);

    return {
      status: 200,
      body: {
        message: `Colis ${parcel.reference} scanné au hub`,
        parcel:  updated.rows[0],
        sync:    syncResult,
        next_action:  volumeTasks.next_action,   // 'repack' | 'measure_volume' | null
        volume_tasks: volumeTasks.tasks,          // consignes par produit (R2 : exécution)
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

/**
 * Enregistre la photo de scellé d'un colis (POST /api/hub/photo) — Q-1.
 * BORNE 1 des fenêtres de responsabilité (doctrine non-conformité §2) :
 * défaut visible avant cette photo → fournisseur ; après → transport.
 * Insère un scan_event dédié event_type='seal_photo' : la preuve est datée,
 * signée (scanned_by) et rattachée au colis — jamais une simple URL orpheline.
 * Sans contrainte : l'absence de photo ne bloque jamais un scellé.
 *
 * @param {string} parcelId
 * @param {string} userId
 * @param {string} photoUrl  URL publique (/uploads/hub/...)
 * @param {string|null} notes
 * @returns {Promise<{ status: number, body: object }>}
 */
async function recordSealPhoto(parcelId, userId, photoUrl, notes = null) {
  const { rows: parcels } = await db.query(
    'SELECT id, reference FROM parcels WHERE id = $1',
    [parcelId]
  );
  if (!parcels.length) {
    return { status: 404, body: { error: 'Colis introuvable' } };
  }

  const { rows } = await db.query(
    `INSERT INTO scan_events
       (parcel_id, event_type, scanned_by, actor_role, photo_urls, notes)
     VALUES ($1, 'seal_photo', $2, 'hub_agent', ARRAY[$3]::text[], $4)
     RETURNING id, created_at`,
    [parcelId, userId, photoUrl, notes]
  );

  const { rows: countRows } = await db.query(
    `SELECT COALESCE(SUM(cardinality(photo_urls)), 0) AS photo_count
     FROM scan_events
     WHERE parcel_id = $1 AND event_type = 'seal_photo'`,
    [parcelId]
  );

  return {
    status: 201,
    body: {
      message: `Photo de scellé enregistrée pour ${parcels[0].reference}`,
      event_id: rows[0].id,
      photo_url: photoUrl,
      photo_count: Number(countRows[0].photo_count),
      recorded_at: rows[0].created_at,
    },
  };
}

module.exports = { receiveParcel, packParcel, sealParcel, batchScan, recordVolume, computeVolumeTasks, recordSealPhoto };
