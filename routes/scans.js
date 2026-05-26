/**
 * KOMERCE — Routes scan logistique — v8.7 F27+fallback machine
 *
 * POST /api/scans             → enregistrer un scan (agent hub ou relais)
 * POST /api/scans/collect     → scan de retrait destinataire (code à 6 chiffres)
 * POST /api/scans/hub/receive → réception hub via QR (délègue à purchasing)
 * GET  /api/scans/hub/pending → commandes en attente de réception hub
 * GET  /api/scans/:order_id   → historique des scans d'une commande (admin)
 *
 * SÉCURITÉ v8.3 :
 *   [S1] 'collected' retiré du endpoint générique POST /api/scans
 *        → retrait DOIT passer par /scans/collect ou /scans/verify-qr
 *   [S2] verify-qr : order_id optionnel, recherche par token seul
 *        → corrige le bug frontend qui n'envoyait pas order_id
 *
 * PHASE 3 PARCEL-CENTRIC v8.5 :
 *   [P3-1] safeSyncScanToParcels() est maintenant awaité (plus fire-and-forget)
 *   [P3-2] Le trigger legacy trg_scan_sync_status est DÉSACTIVÉ
 *          → parcelSync.js est la SOURCE DE VÉRITÉ pour orders.status
 *   [P3-3] Passage de scanned_by/notes à parcelSync pour order_status_history
 *   [P3-4] verify-qr : skipHistory=true (historique géré dans la transaction)
 *
 * PHASE 2 (conservé) :
 *   [P2-1] Import safeSyncScanToParcels() depuis utils/parcelSync.js
 *   [P2-2] Appel dans les 4 endpoints (POST /api/scans, /collect, /verify-qr, triggerScan3)
 *
 * BUGS CORRIGÉS v8.2 :
 *   [B1] po.quantity → po.qty         (vraie colonne purchase_orders)
 *   [B4] JOIN products via product_supplier_id → product_suppliers → products
 *   [B7] receiveItem() non défini → route hub/receive inline (501 → purchasing)
 *   [B8] u.first_name → u.full_name AS first_name
 *   [B9] scan_logs → scans (vraie table)
 *   [B10] scanned_at supprimé (created_at est automatique)
 *   [B11] scan_code NOT NULL → ajouté dans INSERT
 *   [B12] scanned_by → paramètre optionnel ajouté
 *   [B13] Commentaires -- SQL → // JS
 *
 * [P3-2] Le trigger PostgreSQL est DÉSACTIVÉ. parcelSync.js gère tout.
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendSMS } = require('../utils/sms');
const { validate } = require('../middleware/validate');
const { scans } = require('../validators');

// [P2-1] Parcel sync — [P3-2] maintenant SOURCE DE VÉRITÉ (trigger désactivé)
const { safeSyncScanToParcels, STEP_TO_ORDER_STATUS } = require('../utils/parcelSync');
const { transitionOrderStatus } = require('../services/order-status-machine');
const log = require('../utils/logger').child({ module: 'scans' });

// Alias middleware (le fichier original utilisait requireAuth dans certains endroits)
const requireAuth = authenticate;

// Droits d'accès par étape de scan
const STEP_ROLES = {
  preparation:     ['admin', 'agent_hub'],
  hub_preparation: ['admin', 'agent_hub'],
  shipped:         ['admin', 'agent_hub'],
  in_transit:      ['admin', 'agent_hub'],     // D2: hub confirms departure
  relais_received: ['admin', 'agent_relais'],
  collected:       ['admin', 'agent_relais'],
};

// ──────────────────────────────────────────────────────────────
// triggerScan3 — v8.5
// Appelé depuis purchasing.js après vérification de complétude.
// Le statut 'preparation' est déjà positionné avant l'appel.
// [P3-1] await safeSyncScanToParcels() — source de vérité
// [P3-3] Passage scanned_by + notes pour order_status_history
// ──────────────────────────────────────────────────────────────

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

  // Garde : si la commande n'est pas en 'preparation', ne rien faire
  if (order.status !== 'preparation') {
    log.warn(`[SCAN3] Commande ${order_id} ignorée — statut: ${order.status} (attendu: preparation)`);
    return { skipped: true, reason: `statut_invalide: ${order.status}` };
  }

  // SMS client
  const smsClient = `Bonjour ${order.first_name}, votre commande Komerce ref ${order.reference} est en cours de préparation à Dubai. Vous serez notifié(e) dès l'expédition. 🛍️`;

  try {
    await sendSMS(order.client_phone, smsClient);
  } catch (smsErr) {
    log.error(`[SCAN3] SMS client échoué (order ${order_id}):`, smsErr.message);
  }

  // [B9] scans (pas scan_logs) | [B10] created_at auto | [B11] scan_code NOT NULL | [B12] scanned_by optionnel
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

  // [P3-1] Parcel sync — awaité, source de vérité
  // [P3-3] Passage scanned_by + notes pour order_status_history
  if (scan_id) {
    await safeSyncScanToParcels({
      order_id,
      step: 'preparation',
      scan_id,
      scanned_by,
      notes: 'Auto-déclenché après complétude réception hub',
    });
  }

  log.info(`[SCAN3] ✅ Commande ${order.reference} en préparation — SMS client envoyé`);
  return { success: true, order_id, reference: order.reference };
}

// ── POST /api/scans ───────────────────────────────────────────────────────────
// Enregistre un scan sur la chaîne logistique.
// Body : { scan_code, step, location, notes, is_anomaly }
//
// scan_code peut être :
//   - un code article  : KOM-ITEM-XXXX  (order_item)
//   - une référence    : KOM-2026-XXXX  (order entière)
router.post('/', authenticate, validate(scans.create), async (req, res, next) => {
  // F27: transaction for atomic scan + parcelSync
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const {
      scan_code,
      step,
      location   = '',
      notes      = '',
      is_anomaly = false,
      latitude,
      longitude,
    } = req.body;

    // Validation
    if (!scan_code || !step) {
      return res.status(400).json({ error: 'scan_code et step sont requis' });
    }

    const validSteps = ['preparation', 'shipped', 'in_transit', 'relais_received'];
    // 🔒 SÉCURITÉ : 'collected' retiré — le retrait client doit passer par
    // POST /api/scans/collect (code 6 chiffres) ou POST /api/scans/verify-qr (QR token)
    // pour garantir la double vérification agent relais + client.
    if (!validSteps.includes(step)) {
      return res.status(400).json({ error: `step invalide. Valeurs acceptées : ${validSteps.join(', ')}` });
    }

    // Vérifier que l'agent a le droit de scanner cette étape
    const allowedRoles = STEP_ROLES[step];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Étape "${step}" non autorisée pour le rôle "${req.user.role}"` });
    }

    // Résoudre le scan_code → order_id ou order_item_id
    let order_id      = null;
    let order_item_id = null;

    if (scan_code.startsWith('KOM-ITEM-')) {
      // Code article individuel
      const { rows } = await client.query(
        'SELECT id, order_id FROM order_items WHERE scan_code = $1',
        [scan_code]
      );
      if (!rows.length) return res.status(404).json({ error: 'Article introuvable avec ce code' });
      order_item_id = rows[0].id;
      order_id      = rows[0].order_id;
    } else {
      // Référence commande complète (KOM-2026-XXXX)
      const { rows } = await client.query(
        'SELECT id FROM orders WHERE reference = $1',
        [scan_code]
      );
      if (!rows.length) return res.status(404).json({ error: 'Commande introuvable avec cette référence' });
      order_id = rows[0].id;
    }

    // Insérer le scan
    // [P3-2] Le trigger est désactivé — parcelSync gère le statut
    const { rows: [scan] } = await client.query(
      `INSERT INTO scans
         (order_id, order_item_id, step, scanned_by, location,
          device_id, latitude, longitude, scan_code, notes, is_anomaly)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [order_id, order_item_id, step, req.user.id, location,
       req.headers['x-device-id'] || null, latitude || null, longitude || null,
       scan_code, notes, is_anomaly]
    );

    // [P3-1] Parcel sync — awaité, source de vérité pour orders.status
    // [P3-3] Passage scanned_by + notes pour order_status_history
    const syncResult = await safeSyncScanToParcels({
      order_id,
      step,
      scan_id: scan.id,
      order_item_id,
      scanned_by: req.user.id,
      notes,
    }, client);

    // Fallback: if no parcels exist, call machine directly
    if (!syncResult.synced && STEP_TO_ORDER_STATUS[step]) {
      await transitionOrderStatus({
        orderId: order_id,
        newStatus: STEP_TO_ORDER_STATUS[step],
        actor: { id: req.user.id, role: req.user.role },
        source: 'scan',
        scanId: scan.id,
        note: notes || `[scan] step=${step} (no parcels)`,
        dbClient: client,
      });
    }

    await client.query('COMMIT');

    // [P3-2] Récupérer le statut — maintenant mis à jour par parcelSync (plus par le trigger)
    const { rows: [order] } = await db.query(
      'SELECT status, reference FROM orders WHERE id = $1',
      [order_id]
    );

    // SMS déclenchés par certaines étapes
    let sms_triggered = false;

    if (!is_anomaly) {
      if (step === 'shipped') {
        // SMS au commanditaire — colis remis au transitaire
        const { rows: [fullOrder] } = await db.query(
          `SELECT o.*, u.phone AS user_phone
           FROM orders o LEFT JOIN users u ON u.id = o.user_id
           WHERE o.id = $1`, [order_id]
        );
        if (fullOrder?.user_phone) {
          sendSMS(
            fullOrder.user_phone,
            `Komerce · Votre commande ${order.reference} est prête, remise au transitaire à Dubai.`,
            'shipped', order_id
          ).catch(err => log.error({ err }, 'SMS shipped error'));
          sms_triggered = true;
        }
      }

      if (step === 'in_transit') {
        // SMS au commanditaire — confirmation embarquement bateau
        const { rows: [fullOrder] } = await db.query(
          `SELECT o.*, u.phone AS user_phone
           FROM orders o LEFT JOIN users u ON u.id = o.user_id
           WHERE o.id = $1`, [order_id]
        );
        if (fullOrder?.user_phone) {
          sendSMS(
            fullOrder.user_phone,
            `Komerce · Votre commande ${order.reference} est embarquée sur le bateau ! 🚢 Arrivée estimée 3–5 semaines.`,
            'in_transit', order_id
          ).catch(err => log.error({ err }, 'SMS in_transit error'));
          sms_triggered = true;
        }
      }

      if (step === 'relais_received') {
        // SMS au destinataire — non bloquant
        const { rows: [fullOrder] } = await db.query(
          `SELECT o.pickup_code, rc.phone AS recipient_phone, rc.full_name,
                  r.name AS relais_name, r.address AS relais_address
           FROM orders o
           LEFT JOIN recipients rc ON rc.id = o.recipient_id
           LEFT JOIN relais     r  ON r.id  = o.relais_id
           WHERE o.id = $1`, [order_id]
        );
        if (fullOrder?.recipient_phone) {
          sendSMS(
            fullOrder.recipient_phone,
            `Komerce · Bonjour ${fullOrder.full_name}, votre colis est disponible au ${fullOrder.relais_name} (${fullOrder.relais_address}). Code de retrait : ${fullOrder.pickup_code}`,
            'available', order_id
          ).catch(err => log.error({ err }, 'SMS relais error'));
          sms_triggered = true;
        }
      }
    } else {
      // Anomalie → alerte admin par SMS — non bloquant
      const { rows: adminUsers } = await db.query(
        `SELECT phone FROM users WHERE role = 'admin' AND phone IS NOT NULL`
      );
      Promise.all(
        adminUsers.map(a => sendSMS(
          a.phone,
          `Komerce · Anomalie scan sur ${order.reference} à l'étape "${step}". Notes : ${notes || 'aucune'}`,
          'anomaly_alert', order_id
        ))
      ).catch(err => log.error({ err }, 'SMS anomaly error'));
    }

    res.status(201).json({
      scan_id:       scan.id,
      order_id,
      order_reference: order.reference,
      new_status:    order.status,
      step,
      sms_triggered,
      is_anomaly,
    });

  } catch(err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ── POST /api/scans/collect ───────────────────────────────────────────────────
// Retrait par le destinataire : l'agent relais saisit le code à 6 chiffres.
// Body : { pickup_code }
//
// PATCH P0 (sprint 2) — anti-fraude relais :
//   - Cross-relais check : agent_relais ne peut valider qu'au relais où il est affecté
//   - Si users.relais_id absent et role=agent_relais → REFUS (admin only)
//   - Journalisation explicite des échecs (alerts) pour détecter brute-force
//   - SELECT FOR UPDATE pour éviter double-validation simultanée
router.post('/collect', authenticate, requireRole(['admin', 'agent_relais']), validate(scans.collect), async (req, res, next) => {
  // F27: transaction for atomic scan + parcelSync
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { pickup_code } = req.body;
    if (!pickup_code) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'pickup_code requis' });
    }

    // Retrouver la commande par pickup_code (FOR UPDATE pour éviter race)
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
      // Journalisation échec — utile pour détecter brute-force
      // (on ne peut pas savoir quelle order était ciblée ; on log juste l'IP et l'agent)
      try {
        await db.query(
          `INSERT INTO alerts (level, source, message, payload)
           VALUES ('low', 'scan_collect', $1, $2)
           ON CONFLICT DO NOTHING`,
          [
            'pickup_code invalide',
            JSON.stringify({
              user_id: req.user?.id,
              user_role: req.user?.role,
              ip: req.ip,
              ua: req.get('user-agent'),
              code_attempted_prefix: String(pickup_code).slice(0, 2) + '****',
            }),
          ]
        );
      } catch (_) { /* non-bloquant */ }
      return res.status(404).json({ error: 'Code invalide ou commande déjà retirée' });
    }

    const order = rows[0];

    // ── ANTI-BRUTE-FORCE PAR COMMANDE (P0 sprint 2) ──────────────────────
    // Si la commande est en blocage temporaire, refus immédiat (429).
    // Le blocage est posé après 5 échecs cross-relais ou autres.
    if (order.pickup_secret_blocked_until && new Date(order.pickup_secret_blocked_until) > new Date()) {
      await client.query('ROLLBACK');
      log.warn(`[SCAN-COLLECT] Order ${order.reference} blocked until ${order.pickup_secret_blocked_until}`);
      return res.status(429).json({
        error: 'Trop de tentatives sur cette commande, réessayez plus tard',
        blocked_until: order.pickup_secret_blocked_until,
      });
    }

    // ── CROSS-RELAIS CHECK (anti-fraude) ──────────────────────────────────
    // agent_relais ne peut valider qu'au relais où il est affecté.
    // admin = exempté (peut valider partout).
    if (req.user.role === 'agent_relais') {
      let agentRelaisId = null;
      let checkPossible = true;
      try {
        const { rows: [agent] } = await client.query(
          'SELECT relais_id FROM users WHERE id = $1',
          [req.user.id]
        );
        agentRelaisId = agent?.relais_id || null;
      } catch (e) {
        // Colonne users.relais_id absente
        checkPossible = false;
        log.warn(`[SCAN-COLLECT] users.relais_id query failed: ${e.message}`);
      }

      if (!checkPossible || !agentRelaisId) {
        // P0 FIX : agent_relais sans relais_id assigné → REFUS strict
        // (avant : laissait passer silencieusement = trou de sécurité)
        await client.query('ROLLBACK');
        try {
          await db.query(
            `INSERT INTO alerts (level, source, message, payload)
             VALUES ('elevated', 'scan_collect', $1, $2)`,
            [
              `agent_relais sans relais_id tente collect: user=${req.user.id}`,
              JSON.stringify({
                order_reference: order.reference,
                user_id: req.user.id,
                check_possible: checkPossible,
              }),
            ]
          );
        } catch (_) { /* non-bloquant */ }
        return res.status(403).json({
          error: 'Configuration agent incomplète — contactez un admin',
        });
      }

      if (String(agentRelaisId) !== String(order.relais_id)) {
        // P0 FIX : incrémenter pickup_secret_attempts sur cette commande.
        // Si l'attaquant a deviné le pickup_code mais essaie depuis un mauvais relais,
        // on bloque la commande après 5 tentatives (15 min).
        // L'incrémentation se fait HORS transaction principale (qui est rollback).
        const attempts = (order.pickup_secret_attempts || 0) + 1;
        const blockUntil = attempts >= 5
          ? new Date(Date.now() + 15 * 60 * 1000)
          : null;

        await client.query('ROLLBACK');
        // UPDATE compteur dans une nouvelle requête (hors transaction rollback)
        try {
          await db.query(
            `UPDATE orders
               SET pickup_secret_attempts = $1,
                   pickup_secret_blocked_until = $2
             WHERE id = $3`,
            [attempts, blockUntil, order.id]
          );
        } catch (e) {
          log.warn('[SCAN-COLLECT] update attempts failed:', e.message);
        }

        log.warn(`[SCAN-COLLECT] ⛔ Cross-relais refusé — agent ${req.user.id} (relais ${agentRelaisId}) tentait order ${order.reference} (relais ${order.relais_id}) — attempts=${attempts}/5`);
        try {
          await db.query(
            `INSERT INTO alerts (level, source, message, payload)
             VALUES ('elevated', 'scan_collect', $1, $2)`,
            [
              `Cross-relais refusé: ${order.reference}`,
              JSON.stringify({
                user_id: req.user.id,
                agent_relais_id: agentRelaisId,
                order_relais_id: order.relais_id,
                order_reference: order.reference,
                attempts,
                blocked_until: blockUntil,
              }),
            ]
          );
        } catch (_) { /* non-bloquant */ }
        return res.status(403).json({
          error: 'Cette commande appartient à un autre relais — vous ne pouvez pas la valider',
          attempts,
          blocked_until: blockUntil,
        });
      }
    }

    // [B9] scans (pas scan_logs) | [B10] created_at auto | [B11] scan_code NOT NULL
    const { rows: [scanRow] } = await client.query(
      `INSERT INTO scans
         (order_id, step, scanned_by, location, scan_code, notes)
       VALUES ($1,'collected',$2,$3,$4,$5)
       RETURNING id`,
      [order.id, req.user.id, order.relais_name || '', pickup_code, 'Retrait destinataire — code valide']
    );

    // [P3-1] Parcel sync — awaité, source de vérité
    // [P3-3] Passage scanned_by + notes pour order_status_history
    const collectSync = await safeSyncScanToParcels({
      order_id: order.id,
      step: 'collected',
      scan_id: scanRow?.id,
      scanned_by: req.user.id,
      notes: 'Retrait destinataire — code valide',
    }, client);

    // Fallback: if no parcels exist, call machine directly
    if (!collectSync.synced && STEP_TO_ORDER_STATUS['collected']) {
      await transitionOrderStatus({
        orderId: order.id,
        newStatus: STEP_TO_ORDER_STATUS['collected'],
        actor: { id: req.user.id, role: req.user.role },
        source: 'scan',
        scanId: scanRow?.id,
        note: 'Retrait destinataire (no parcels)',
        dbClient: client,
      });
    }

    // P0 FIX : Reset compteur d'échecs au succès (defense en profondeur)
    // Si la commande avait des tentatives échouées avant un retrait légitime,
    // on remet à zéro pour ne pas bloquer la commande à un futur retrait
    // (cas extrême : retrait → annulation → re-livraison ; rare mais possible)
    await client.query(
      `UPDATE orders
         SET pickup_secret_attempts = 0,
             pickup_secret_blocked_until = NULL
       WHERE id = $1
         AND (pickup_secret_attempts > 0 OR pickup_secret_blocked_until IS NOT NULL)`,
      [order.id]
    );

    await client.query('COMMIT');

    // SMS confirmation au commanditaire
    const { rows: [fullOrder] } = await db.query(
      `SELECT u.phone AS user_phone FROM orders o
       LEFT JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
      [order.id]
    );
    if (fullOrder?.user_phone) {
      sendSMS(
        fullOrder.user_phone,
        `Komerce · Votre colis ${order.reference} a bien été récupéré par ${order.recipient_name}. Merci pour votre confiance !`,
        'collected', order.id
      ).catch(err => log.error({ err }, 'SMS collect error'));
    }

    res.json({
      message:    'Retrait enregistré',
      reference:  order.reference,
      recipient:  order.recipient_name,
      relais:     order.relais_name,
      collected_at: new Date().toISOString(),
    });

  } catch(err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ── POST /api/scans/hub/receive ───────────────────────────────────────────────
// Réception hub via QR — délègue à POST /api/purchasing/:id/receive
// Body : { qr_code?, po_id? }
// [B7] receiveItem() n'existe pas → 501 explicite avec po_id résolu
router.post('/hub/receive', requireAuth, requireRole(['admin', 'agent_hub']), validate(scans.hubReceive), async (req, res, next) => {
  const { qr_code, po_id } = req.body;

  try {
    let purchase_order_id = po_id;

    // Si scan QR → résoudre l'ID du PO
    if (qr_code && !po_id) {
      const poRes = await db.query(
        `SELECT id FROM purchase_orders WHERE supplier_order_id = $1 AND status != 'cancelled'`,
        [qr_code]
      );
      if (!poRes.rows.length) {
        return res.status(404).json({ error: `QR code non reconnu : ${qr_code}` });
      }
      purchase_order_id = poRes.rows[0].id;
    }

    if (!purchase_order_id) {
      return res.status(400).json({ error: 'po_id ou qr_code requis' });
    }

    // Délègue à la route purchasing — le frontend peut appeler directement
    return res.status(501).json({
      error: 'Utilisez POST /api/purchasing/:po_id/receive directement',
      po_id: purchase_order_id
    });

  } catch(err) { next(err); }
});

// ── GET /api/scans/hub/pending ────────────────────────────────────────────────
// Commandes en attente de réception hub
// [B1] po.qty (pas po.quantity) | [B4] JOIN via product_suppliers
// IMPORTANT : doit être AVANT /:order_id pour ne pas être capturé
router.get('/hub/pending', requireAuth, requireRole(['admin', 'agent_hub']), async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT
         o.id            AS order_id,
         o.reference,
         o.status,
         o.created_at,
         COUNT(po.id)    AS total_pos,
         SUM(CASE WHEN po.received_qty >= po.qty THEN 1 ELSE 0 END)  AS pos_recus,
         SUM(po.qty - po.received_qty) FILTER (
           WHERE po.status != 'cancelled' AND po.received_qty < po.qty
         )               AS qty_manquante,
         ARRAY_AGG(
           p.name || ' (' || po.received_qty || '/' || po.qty || ')'
           ORDER BY p.name
         )               AS articles
       FROM orders o
       JOIN purchase_orders po ON po.order_id = o.id
       JOIN product_suppliers ps ON ps.id = po.product_supplier_id
       JOIN products p ON p.id = ps.product_id
       -- [Phase 5.1] Simplified: orders stay 'ordered'/'confirmed' until preparation
      WHERE o.status IN ('ordered', 'confirmed')
         AND po.status != 'cancelled'
       GROUP BY o.id, o.reference, o.status, o.created_at
       ORDER BY o.created_at ASC`
    );

    res.json({
      count: result.rows.length,
      orders: result.rows
    });

  } catch(err) { next(err); }
});

// ── GET /api/scans/:order_id ──────────────────────────────────────────────────
// Historique complet des scans d'une commande — admin uniquement
// IMPORTANT : doit rester EN DERNIER (route générique /:order_id)

// ─── POST /api/scans/verify-qr ─────────────────────────────────────────────
// [P3-1] await safeSyncScanToParcels APRÈS le commit
// [P3-4] skipHistory=true — verify-qr gère l'historique dans sa transaction
router.post('/verify-qr', authenticate, requireRole(['admin', 'agent_relais']), validate(scans.verifyQr), async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { token, order_id } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'token est requis' });
    }

    // 🔒 Chercher la commande par token seul OU token + order_id
    // Le token est unique et lié à une seule commande
    let queryText, queryParams;
    if (order_id) {
      queryText = `SELECT o.*,
              rc.full_name  AS recipient_name,
              rc.phone      AS recipient_phone,
              r.name        AS relais_name,
              u.phone       AS user_phone
       FROM orders o
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       LEFT JOIN relais     r  ON r.id  = o.relais_id
       LEFT JOIN users      u  ON u.id  = o.user_id
       WHERE o.id = $1 AND o.qr_token = $2`;
      queryParams = [order_id, token];
    } else {
      queryText = `SELECT o.*,
              rc.full_name  AS recipient_name,
              rc.phone      AS recipient_phone,
              r.name        AS relais_name,
              u.phone       AS user_phone
       FROM orders o
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       LEFT JOIN relais     r  ON r.id  = o.relais_id
       LEFT JOIN users      u  ON u.id  = o.user_id
       WHERE o.qr_token = $1`;
      queryParams = [token];
    }

    const { rows: [order] } = await client.query(queryText, queryParams);

    if (!order) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    // Vérifications
    if (order.status !== 'available') {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: order.status === 'collected'
          ? 'Ce colis a déjà été remis au client'
          : `Statut incompatible : ${order.status}`,
        current_status: order.status,
      });
    }

    if (!order.qr_token) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Aucun QR code généré pour cette commande' });
    }

    if (order.qr_token !== token) {
      await client.query('ROLLBACK');
      log.warn(`[VERIFY-QR] Token invalide pour ${order.reference} — fourni: ${token.slice(0, 8)}... attendu: ${order.qr_token.slice(0, 8)}...`);
      return res.status(400).json({ error: 'QR code invalide' });
    }

    if (order.qr_expires_at && new Date(order.qr_expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'QR code expiré — veuillez en générer un nouveau',
        expired_at: order.qr_expires_at,
      });
    }

    // ✅ Token valide — transition via MACHINE (D1/D2)
    // Machine handles: status, timestamp, history.
    const machineResult = await transitionOrderStatus({
      orderId: order.id,
      newStatus: 'collected',
      actor: { id: req.user.id, role: req.user.role },
      source: 'patch',
      note: 'Remise client via QR Code',
      dbClient: client,
    });

    if (!machineResult.success) {
      await client.query('ROLLBACK');
      return res.status(422).json({ error: machineResult.error });
    }

    // Invalidate QR token (same transaction — atomic)
    await client.query(
      `UPDATE orders SET qr_token = NULL, qr_expires_at = NULL WHERE id = $1`,
      [order.id]
    );

    // Enregistrer le scan
    const { rows: [scanRow] } = await client.query(
      `INSERT INTO scans
         (order_id, step, scanned_by, location, scan_code, notes)
       VALUES ($1, 'collected', $2, $3, $4, 'Retrait client via QR Code — token validé')
       RETURNING id`,
      [
        order.id,
        req.user.id,
        order.relais_name || '',
        `QR-${token.slice(0, 8)}`,
      ]
    );

    // A-BE-15 : sync colis dans la même transaction que collected (2026-05-26)
    // safeSyncScanToParcels reçoit le client → atomique avec le COMMIT ci-dessous.
    // transitionOrderStatus interne retourne noop (statut déjà collected) — zéro
    // double écriture dans order_status_history. Seuls les parcels sont mis à jour.
    await safeSyncScanToParcels({
      order_id: order.id,
      step: 'collected',
      scan_id: scanRow?.id,
      scanned_by: req.user.id,
      notes: 'Retrait client via QR Code — token validé',
    }, client);

    await client.query('COMMIT');

    log.info(`[VERIFY-QR] ✅ ${order.reference} remis à ${order.recipient_name} via QR`);

    // SMS confirmation au commanditaire (non bloquant)
    if (order.user_phone) {
      sendSMS(
        order.user_phone,
        `Komerce · Votre colis ${order.reference} a bien été récupéré par ${order.recipient_name || 'le destinataire'}. Merci pour votre confiance ! 🎉`,
        'collected',
        order.id
      ).catch(err => log.error({ err }, 'SMS QR collect error'));
    }

    // Recalculer fidélité (non bloquant)
    if (order.user_id) {
      const { recalculateLoyalty } = require('./loyalty');
      recalculateLoyalty(db, order.user_id)
        .catch(e => log.error('[LOYALTY] recalculate error:', e.message));
    }

    res.json({
      success:      true,
      message:      'Remise enregistrée avec succès',
      reference:    order.reference,
      recipient:    order.recipient_name,
      relais:       order.relais_name,
      collected_at: new Date().toISOString(),
    });

  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

router.get('/:order_id', authenticate, requireRole(['admin']), async (req, res, next) => {
  try {
    // Valider le format UUID pour éviter un crash PostgreSQL
    // si le paramètre est un mot (ex: "prepare", "collect")
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(req.params.order_id)) {
      return res.status(400).json({ error: 'order_id invalide — UUID attendu' });
    }

    const { rows } = await db.query(
      `SELECT s.*, u.full_name AS scanned_by_name
       FROM scans s
       LEFT JOIN users u ON u.id = s.scanned_by
       WHERE s.order_id = $1
       ORDER BY s.created_at ASC`,
      [req.params.order_id]
    );
    res.json(rows);
  } catch(err) { next(err); }
});

// Export router + triggerScan3 (utilisé par purchasing.js)
module.exports = router;
module.exports.triggerScan3 = triggerScan3;
