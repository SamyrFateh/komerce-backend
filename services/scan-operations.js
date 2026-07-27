/**
 * @komerce-arch
 * @role          logistics-scan-operations
 * @domain        logistics
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, routes/loyalty.js, services/notification-service.js, services/order-status-machine.js, utils/logger.js, utils/parcelSync.js
 * @used-by       routes/scans.js
 * @db-read       order_items, orders, recipients, relais, users
 * @db-write      alerts, orders, scans
 * @db-write-via:order-status-machine product_variants, order_status_history, products
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — Service opérations scan logistique (REFACTO-R3)
 *
 * Extraction iso-comportement depuis routes/scans.js v8.7 :
 *   POST /api/scans          → recordScan(body, user, deviceId)
 *   POST /api/scans/collect  → collectParcel(body, user, ip, ua)
 *   POST /api/scans/verify-qr → verifyQr(body, user)
 *   triggerScan3 (interne)   → triggerScan3(order_id, scanned_by?)
 *
 * Invariants préservés :
 *   I-01 — transitions de statut via order-status-machine exclusivement
 *   I-03 — forward-only (géré par parcelSync / scan-engine)
 *   I-04 — historique append-only (scans INSERT, jamais UPDATE)
 *   I-09 — colis unité autonome (safeSyncScanToParcels via parcelSync)
 *   I-10 — anti-fraude relais (cross-relais check P0, brute-force 5 attempts)
 *
 * FIX-004 : safeSyncScanToParcels appelé DANS la transaction (client passé
 * en second argument) pour maintenir le verrou FOR UPDATE.
 *
 * Note db.pool.connect() : la route originale utilisait db.pool.connect()
 * qui est strictement équivalent à db.getClient() = pool.connect().
 * Le service utilise db.getClient() pour cohérence projet.
 *
 * Pattern de retour : { status: number, body: object }
 */

const db = require('../db');
const { notifyText } = require('./notification-service');
const { safeSyncScanToParcels, STEP_TO_ORDER_STATUS } = require('../utils/parcelSync');
const { transitionOrderStatus } = require('./order-status-machine');
const { resolveQrCollection } = require('./qr-collection-core');
const { createAlert } = require('../utils/alerts');
const log = require('../utils/logger').child({ module: 'scan-operations' });

// Droits d'accès par étape (iso-comportement avec la route)
const STEP_ROLES = {
  preparation:     ['admin', 'agent_hub'],
  hub_preparation: ['admin', 'agent_hub'],
  shipped:         ['admin', 'agent_hub'],
  in_transit:      ['admin', 'agent_hub'],
  relais_received: ['admin', 'agent_relais'],
  collected:       ['admin', 'agent_relais'],
};

const VALID_STEPS = ['preparation', 'shipped', 'in_transit', 'relais_received'];

// ── recordScan (POST /api/scans) ────────────────────────────────────────────

/**
 * Enregistre un scan logistique générique. Résout le scan_code vers une
 * commande ou un article, insère dans `scans`, sync parcelSync, déclenche
 * les notifications SMS selon l'étape.
 *
 * @param {object} body        — { scan_code, step, location, notes, is_anomaly, latitude, longitude }
 * @param {object} user        — { id, role }
 * @param {string|null} deviceId — header x-device-id
 * @returns {Promise<{ status: number, body: object }>}
 */
async function recordScan(body, user, deviceId) {
  const {
    scan_code,
    step,
    location   = '',
    notes      = '',
    is_anomaly = false,
    latitude,
    longitude,
  } = body;

  if (!scan_code || !step) {
    return { status: 400, body: { error: 'scan_code et step sont requis' } };
  }
  if (!VALID_STEPS.includes(step)) {
    return { status: 400, body: { error: `step invalide. Valeurs acceptées : ${VALID_STEPS.join(', ')}` } };
  }

  const allowedRoles = STEP_ROLES[step];
  if (!allowedRoles.includes(user.role)) {
    return { status: 403, body: { error: `Étape "${step}" non autorisée pour le rôle "${user.role}"` } };
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    let order_id      = null;
    let order_item_id = null;

    if (scan_code.startsWith('KOM-ITEM-')) {
      const { rows } = await client.query(
        'SELECT id, order_id FROM order_items WHERE scan_code = $1',
        [scan_code]
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        return { status: 404, body: { error: 'Article introuvable avec ce code' } };
      }
      order_item_id = rows[0].id;
      order_id      = rows[0].order_id;
    } else {
      const { rows } = await client.query(
        'SELECT id FROM orders WHERE reference = $1',
        [scan_code]
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        return { status: 404, body: { error: 'Commande introuvable avec cette référence' } };
      }
      order_id = rows[0].id;
    }

    const { rows: [scan] } = await client.query(
      `INSERT INTO scans
         (order_id, order_item_id, step, scanned_by, location,
          device_id, latitude, longitude, scan_code, notes, is_anomaly)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [order_id, order_item_id, step, user.id, location,
       deviceId || null, latitude || null, longitude || null,
       scan_code, notes, is_anomaly]
    );

    const syncResult = await safeSyncScanToParcels({
      order_id,
      step,
      scan_id: scan.id,
      order_item_id,
      scanned_by: user.id,
      notes,
    }, client);

    if (!syncResult.synced && STEP_TO_ORDER_STATUS[step]) {
      await transitionOrderStatus({
        orderId:   order_id,
        newStatus: STEP_TO_ORDER_STATUS[step],
        actor:     { id: user.id, role: user.role },
        source:    'scan',
        scanId:    scan.id,
        note:      notes || `[scan] step=${step} (no parcels)`,
        dbClient:  client,
      });
    }

    await client.query('COMMIT');

    const { rows: [order] } = await db.query(
      'SELECT status, reference FROM orders WHERE id = $1',
      [order_id]
    );

    // Notifications post-commit (non bloquantes)
    let sms_triggered = false;
    if (!is_anomaly) {
      sms_triggered = await _notifyPostScan(step, order_id, order.reference);
    } else {
      _notifyAnomaly(order.reference, step, notes, order_id);
    }

    return {
      status: 201,
      body: {
        scan_id:         scan.id,
        order_id,
        order_reference: order.reference,
        new_status:      order.status,
        step,
        sms_triggered,
        is_anomaly,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── collectParcel (POST /api/scans/collect) ─────────────────────────────────

/**
 * Retrait par le destinataire : l'agent relais saisit le code à 6 chiffres.
 * Anti-fraude P0 : cross-relais check + brute-force 5 attempts + block 15 min.
 *
 * @param {object} body — { pickup_code }
 * @param {object} user — { id, role }
 * @param {string} ip
 * @param {string} ua   — user-agent
 * @returns {Promise<{ status: number, body: object }>}
 */
async function collectParcel(body, user, ip, ua) {
  const { pickup_code } = body;
  if (!pickup_code) {
    return { status: 400, body: { error: 'pickup_code requis' } };
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT o.*, r.name AS relais_name, rc.full_name AS recipient_name
       FROM orders o
       LEFT JOIN relais     r  ON r.id  = o.relais_id
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       WHERE o.pickup_code = $1 AND o.status = 'available'
       FOR UPDATE OF o`,
      [pickup_code]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      _logAlert('low', 'pickup_code invalide', { user_id: user.id, user_role: user.role, ip, ua,
        code_attempted_prefix: String(pickup_code).slice(0, 2) + '****' });
      return { status: 404, body: { error: 'Code invalide ou commande déjà retirée' } };
    }

    const order = rows[0];

    // Anti-brute-force par commande
    if (order.pickup_secret_blocked_until && new Date(order.pickup_secret_blocked_until) > new Date()) {
      await client.query('ROLLBACK');
      log.warn(`[SCAN-COLLECT] Order ${order.reference} blocked until ${order.pickup_secret_blocked_until}`);
      return { status: 429, body: {
        error: 'Trop de tentatives sur cette commande, réessayez plus tard',
        blocked_until: order.pickup_secret_blocked_until,
      }};
    }

    // Cross-relais check (I-10)
    if (user.role === 'agent_relais') {
      const crossCheck = await _crossRelaisCheck(client, user, order);
      if (crossCheck) {
        // crossCheck != null signifie refus — client déjà rollback dans helper
        return crossCheck;
      }
    }

    const { rows: [scanRow] } = await client.query(
      `INSERT INTO scans (order_id, step, scanned_by, location, scan_code, notes)
       VALUES ($1,'collected',$2,$3,$4,$5) RETURNING id`,
      [order.id, user.id, order.relais_name || '', pickup_code, 'Retrait destinataire — code valide']
    );

    const collectSync = await safeSyncScanToParcels({
      order_id:   order.id,
      step:       'collected',
      scan_id:    scanRow?.id,
      scanned_by: user.id,
      notes:      'Retrait destinataire — code valide',
    }, client);

    if (!collectSync.synced && STEP_TO_ORDER_STATUS['collected']) {
      await transitionOrderStatus({
        orderId:   order.id,
        newStatus: STEP_TO_ORDER_STATUS['collected'],
        actor:     { id: user.id, role: user.role },
        source:    'scan',
        scanId:    scanRow?.id,
        note:      'Retrait destinataire (no parcels)',
        dbClient:  client,
      });
    }

    // Reset compteur d'échecs au succès (défense en profondeur)
    await client.query(
      `UPDATE orders
         SET pickup_secret_attempts = 0, pickup_secret_blocked_until = NULL
       WHERE id = $1
         AND (pickup_secret_attempts > 0 OR pickup_secret_blocked_until IS NOT NULL)`,
      [order.id]
    );

    await client.query('COMMIT');

    // Notification commanditaire (non bloquant)
    const { rows: [fullOrder] } = await db.query(
      `SELECT u.phone AS user_phone FROM orders o
       LEFT JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
      [order.id]
    );
    if (fullOrder?.user_phone) {
      notifyText(
        fullOrder.user_phone,
        `Komerce · Votre colis ${order.reference} a bien été récupéré par ${order.recipient_name}. Merci pour votre confiance !`,
        'collected', order.id
      ).catch(err => log.error({ err }, 'Notification collect error'));
    }

    return {
      status: 200,
      body: {
        message:      'Retrait enregistré',
        reference:    order.reference,
        recipient:    order.recipient_name,
        relais:       order.relais_name,
        collected_at: new Date().toISOString(),
      },
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── verifyQr (POST /api/scans/verify-qr) ────────────────────────────────────

/**
 * Remise client via QR token. Transition via order-status-machine, invalidation
 * atomique du token, sync parcelSync dans la même transaction.
 *
 * @param {object} body — { token, order_id? }
 * @param {object} user — { id, role }
 * @returns {Promise<{ status: number, body: object }>}
 */
async function verifyQr(body, user) {
  const { token, order_id } = body;
  if (!token) {
    return { status: 400, body: { error: 'token est requis' } };
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // P5-L5 : validation + transition + invalidation QR + scan + parcelSync
    // sont désormais dans qr-collection-core.js, partagé avec
    // verify-qr-collection.js. ROLLBACK déjà exécuté par le noyau sur tout
    // `ok:false`. Durcissement au passage : ce chemin n'avait pas de
    // FOR UPDATE avant l'extraction — le noyau le pose désormais toujours.
    const result = await resolveQrCollection({ client, token, orderId: order_id, user });
    if (!result.ok) return result.response;

    const { order } = result;

    await client.query('COMMIT');

    log.info(`[VERIFY-QR] ✅ ${order.reference} remis à ${order.recipient_name} via QR`);

    // Notification commanditaire (non bloquant)
    if (order.user_phone) {
      notifyText(
        order.user_phone,
        `Komerce · Votre colis ${order.reference} a bien été récupéré par ${order.recipient_name || 'le destinataire'}. Merci pour votre confiance ! 🎉`,
        'collected', order.id
      ).catch(err => log.error({ err }, 'Notification QR collect error'));
    }

    // Recalculer fidélité (non bloquant)
    if (order.user_id) {
      // O7.3 (provider loyalty) : importait auparavant routes/loyalty.js
      // (une route, pas une boundary de feature). Voir docs/O7_3_BOUNDARY_ANALYSIS.md.
      const { recalculateLoyalty } = require('./loyalty-service');
      recalculateLoyalty(db, order.user_id)
        .catch(e => log.error({ err: e }, '[LOYALTY] recalculate error:'));
    }

    return {
      status: 200,
      body: {
        success:      true,
        message:      'Remise enregistrée avec succès',
        reference:    order.reference,
        recipient:    order.recipient_name,
        relais:       order.relais_name,
        collected_at: new Date().toISOString(),
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── triggerScan3 ─────────────────────────────────────────────────────────────

/**
 * Déclenché par purchasing.js après complétude réception hub.
 * Notifie le client, insère un scan auto, synce les colis.
 *
 * Garde : si commande pas en 'preparation', retourne { skipped: true }.
 *
 * @param {string} order_id
 * @param {string|null} scanned_by
 * @returns {Promise<{ success: boolean, ... } | { skipped: boolean, ... }>}
 */
async function triggerScan3(order_id, scanned_by = null) {
  const orderRes = await db.query(
    `SELECT o.*, u.phone AS client_phone, u.full_name AS first_name
     FROM orders o
     JOIN users u ON u.id = o.user_id
     WHERE o.id = $1`,
    [order_id]
  );

  if (!orderRes.rows.length) {
    throw new Error(`triggerScan3 : commande ${order_id} introuvable`);
  }

  const order = orderRes.rows[0];

  if (order.status !== 'preparation') {
    log.warn(`[SCAN3] Commande ${order_id} ignorée — statut: ${order.status} (attendu: preparation)`);
    return { skipped: true, reason: `statut_invalide: ${order.status}` };
  }

  notifyText(
    order.client_phone,
    `Bonjour ${order.first_name}, votre commande Komerce ref ${order.reference} est en cours de préparation à Dubai. Vous serez notifié(e) dès l'expédition. 🛍️`,
    'preparation', order_id
  ).catch(err => log.error({ err }, '[SCAN3] notification préparation échouée'));

  let scan_id = null;
  try {
    const { rows: [scanRow] } = await db.query(
      `INSERT INTO scans (order_id, step, scan_code, scanned_by, notes)
       VALUES ($1, 'preparation', 'AUTO-HUB-' || $1, $2, 'Auto-déclenché après complétude réception hub')
       RETURNING id`,
      [order_id, scanned_by]
    );
    scan_id = scanRow?.id;
  } catch (logErr) {
    log.warn(`[SCAN3] Log non enregistré:`, logErr.message);
  }

  if (scan_id) {
    await safeSyncScanToParcels({
      order_id,
      step:       'preparation',
      scan_id,
      scanned_by,
      notes:      'Auto-déclenché après complétude réception hub',
    });
  }

  log.info(`[SCAN3] ✅ Commande ${order.reference} en préparation — SMS client envoyé`);
  return { success: true, order_id, reference: order.reference };
}

// ── Helpers privés ───────────────────────────────────────────────────────────

/**
 * Cross-relais check (I-10). Vérifie que l'agent relais est affecté au bon
 * relais. Gère le brute-force (5 tentatives → block 15 min).
 * Retourne null si OK, ou { status, body } si refus.
 * Le client est déjà en ROLLBACK quand on retourne un refus.
 */
async function _crossRelaisCheck(client, user, order) {
  let agentRelaisId = null;
  let checkPossible = true;

  try {
    const { rows: [agent] } = await client.query(
      'SELECT relais_id FROM users WHERE id = $1',
      [user.id]
    );
    agentRelaisId = agent?.relais_id || null;
  } catch (e) {
    checkPossible = false;
    log.warn(`[SCAN-COLLECT] users.relais_id query failed: ${e.message}`);
  }

  if (!checkPossible || !agentRelaisId) {
    await client.query('ROLLBACK');
    _logAlert('elevated', `agent_relais sans relais_id tente collect: user=${user.id}`, {
      order_reference: order.reference, user_id: user.id, check_possible: checkPossible,
    });
    return { status: 403, body: { error: 'Configuration agent incomplète — contactez un admin' } };
  }

  if (String(agentRelaisId) !== String(order.relais_id)) {
    const attempts    = (order.pickup_secret_attempts || 0) + 1;
    const blockUntil  = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;

    await client.query('ROLLBACK');
    try {
      await db.query(
        `UPDATE orders SET pickup_secret_attempts = $1, pickup_secret_blocked_until = $2 WHERE id = $3`,
        [attempts, blockUntil, order.id]
      );
    } catch (e) {
      log.warn({ err: e }, '[SCAN-COLLECT] update attempts failed');
    }

    log.warn(`[SCAN-COLLECT] ⛔ Cross-relais refusé — agent ${user.id} (relais ${agentRelaisId}) tentait order ${order.reference} (relais ${order.relais_id}) — attempts=${attempts}/5`);
    _logAlert('elevated', `Cross-relais refusé: ${order.reference}`, {
      user_id: user.id, agent_relais_id: agentRelaisId,
      order_relais_id: order.relais_id, order_reference: order.reference,
      attempts, blocked_until: blockUntil,
    });
    return { status: 403, body: {
      error:        'Cette commande appartient à un autre relais — vous ne pouvez pas la valider',
      attempts,
      blocked_until: blockUntil,
    }};
  }

  return null; // OK
}

/**
 * Déclenche les notifications SMS post-scan selon l'étape.
 * @returns {Promise<boolean>} sms_triggered
 */
async function _notifyPostScan(step, order_id, reference) {
  try {
    if (step === 'shipped') {
      const { rows: [o] } = await db.query(
        `SELECT o.*, u.phone AS user_phone FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
        [order_id]
      );
      if (o?.user_phone) {
        notifyText(o.user_phone,
          `Komerce · Votre commande ${reference} est prête, remise au transitaire à Dubai.`,
          'shipped', order_id
        ).catch(err => log.error({ err }, 'Notification shipped error'));
        return true;
      }
    }

    if (step === 'in_transit') {
      const { rows: [o] } = await db.query(
        `SELECT o.*, u.phone AS user_phone FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
        [order_id]
      );
      if (o?.user_phone) {
        notifyText(o.user_phone,
          `Komerce · Votre commande ${reference} est embarquée sur le bateau ! 🚢 Arrivée estimée 3–5 semaines.`,
          'in_transit', order_id
        ).catch(err => log.error({ err }, 'Notification in_transit error'));
        return true;
      }
    }

    if (step === 'relais_received') {
      const { rows: [o] } = await db.query(
        `SELECT o.pickup_code, rc.phone AS recipient_phone, rc.full_name,
                r.name AS relais_name, r.address AS relais_address
         FROM orders o
         LEFT JOIN recipients rc ON rc.id = o.recipient_id
         LEFT JOIN relais     r  ON r.id  = o.relais_id
         WHERE o.id = $1`,
        [order_id]
      );
      if (o?.recipient_phone) {
        notifyText(o.recipient_phone,
          `Komerce · Bonjour ${o.full_name}, votre colis est disponible au ${o.relais_name} (${o.relais_address}). Code de retrait : ${o.pickup_code}`,
          'available', order_id
        ).catch(err => log.error({ err }, 'Notification available error'));
        return true;
      }
    }
  } catch (e) {
    log.error({ err: e }, '[SCAN-OPS] _notifyPostScan error');
  }
  return false;
}

/** Notification anomalie → admins (non bloquant) */
function _notifyAnomaly(reference, step, notes, order_id) {
  db.query(`SELECT phone FROM users WHERE role = 'admin' AND phone IS NOT NULL`)
    .then(({ rows }) => Promise.all(
      rows.map(a => notifyText(a.phone,
        `Komerce · Anomalie scan sur ${reference} à l'étape "${step}". Notes : ${notes || 'aucune'}`,
        'anomaly_alert', order_id
      ))
    ))
    .catch(err => log.error({ err }, 'Notification anomaly error'));
}

/**
 * Log d'alerte sécurité non bloquant. Appelée uniquement APRÈS un ROLLBACK
 * déjà exécuté par l'appelant (cf. call sites) : jamais sur un client
 * transactionnel encore ouvert. Persistée via le pool (`db`).
 */
function _logAlert(level, message, payload) {
  const entityId = payload?.order_id || null;
  createAlert(db, {
    type: 'scan_operations_security',
    entityType: 'order',
    entityId,
    severity: level,
    title: String(message).slice(0, 500),
    description: JSON.stringify(payload),
  }).catch((e) => log.error({ err: e.message }, '[SCAN-OPS] alert insert failed'));
}

module.exports = { recordScan, collectParcel, verifyQr, triggerScan3 };
