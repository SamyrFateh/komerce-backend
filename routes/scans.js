// ============================================================
// KOMERCE — scans.js — diff v8.x → v8.2
// Session 8 — Hub Stock — SCAN 3 conditionnel
// ============================================================
//
// CE FICHIER EST UN DIFF.
//
// CHANGEMENTS :
//   - triggerScan3() n'est plus appelé automatiquement à chaque réception.
//     Il est maintenant appelé uniquement par purchasing.js après vérification
//     de complétude (tous les POs reçus).
//   - SCAN 3 vérifie que l'order est bien en statut 'preparation' avant d'agir.
//   - Nouveau : POST /api/scans/hub/:order_id (scan manuel hub) — pour Phase 2.
//
// ============================================================

// ──────────────────────────────────────────────────────────────
// AVANT (v8.x) — triggerScan3 supposé
// ──────────────────────────────────────────────────────────────
//
// async function triggerScan3(order_id) {
//   // Passait en preparation sans vérification de complétude
//   await db.query(`UPDATE orders SET status='preparation' WHERE id=$1`, [order_id]);
//   const order = await db.query(`SELECT * FROM orders WHERE id=$1`, [order_id]);
//   await sendSMS(order.rows[0].phone, `Votre commande est en préparation...`);
// }

// ──────────────────────────────────────────────────────────────
// APRÈS (v8.2) — triggerScan3 avec garde
// ──────────────────────────────────────────────────────────────

/**
 * triggerScan3 — déclenché uniquement par purchasing.js après vérification complétude
 * Le statut 'preparation' est déjà positionné par purchasing.js avant l'appel.
 * Cette fonction envoie les SMS et logue l'événement.
 *
 * @param {number} order_id
 */
async function triggerScan3(order_id) {
  // Récupérer la commande — vérifier qu'elle est bien en 'preparation'
  const orderRes = await db.query(
    `SELECT o.*, u.phone AS client_phone, u.first_name
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
  // (protection contre double déclenchement)
  if (order.status !== 'preparation') {
    console.warn(`[SCAN3] Commande ${order_id} ignorée — statut: ${order.status} (attendu: preparation)`);
    return { skipped: true, reason: `statut_invalide: ${order.status}` };
  }

  // SMS client : votre commande est en cours de préparation
  const smsClient = `Bonjour ${order.first_name}, votre commande Komerce ref ${order.reference} est en cours de préparation à Dubai. Vous serez notifié(e) dès l'expédition. 🛍️`;

  try {
    await sendSMS(order.client_phone, smsClient);
  } catch (smsErr) {
    console.error(`[SCAN3] SMS client échoué (order ${order_id}):`, smsErr.message);
    // On ne propage pas l'erreur SMS — la préparation a quand même lieu
  }

  // Log scan (table scan_logs si elle existe, sinon juste console)
  try {
    await db.query(
      `INSERT INTO scan_logs (order_id, scan_type, scanned_at, notes)
       VALUES ($1, 'SCAN3_PREPARATION', NOW(), 'Auto-déclenché après complétude réception hub')
       ON CONFLICT DO NOTHING`,
      [order_id]
    );
  } catch (logErr) {
    // Table scan_logs peut ne pas exister encore — pas bloquant
    console.warn(`[SCAN3] Log non enregistré:`, logErr.message);
  }

  console.log(`[SCAN3] ✅ Commande ${order.reference} en préparation — SMS client envoyé`);
  return { success: true, order_id, reference: order.reference };
}

// Exporter pour purchasing.js
module.exports.triggerScan3 = triggerScan3;

// ──────────────────────────────────────────────────────────────
// SCAN 4 — Expédition (inchangé sauf commentaire)
// ──────────────────────────────────────────────────────────────
//
// router.post('/ship/:order_id', requireAuth, async (req, res) => { ... })
// → Aucun changement en v8.2

// ──────────────────────────────────────────────────────────────
// NOUVELLE ROUTE : POST /api/scans/hub/receive
// Scan de réception hub (interface opérateur Phase 2)
// Appelle POST /api/purchasing/:id/receive en interne
// Permet à terme de scanner un QR code article → réception automatique
// ──────────────────────────────────────────────────────────────

router.post('/hub/receive', requireAuth, async (req, res) => {
  // req.body : { qr_code: 'KOM-PO-00123' } ou { po_id: 123 }
  const { qr_code, po_id, qty_recue } = req.body;

  try {
    let purchase_order_id = po_id;

    // Si scan QR → résoudre l'ID du PO
    if (qr_code && !po_id) {
      const poRes = await db.query(
        `SELECT id FROM purchase_orders WHERE qr_code = $1 AND status != 'cancelled'`,
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

    // Déléguer à la logique de réception dans purchasing.js
    // (appel interne — en production on peut soit importer la fonction
    // soit faire un appel HTTP interne, selon l'architecture)
    const result = await receiveItem(purchase_order_id, qty_recue);

    res.json(result);

  } catch (err) {
    console.error('[scans/hub/receive] Erreur:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
// NOUVELLE ROUTE : GET /api/scans/hub/pending
// Liste les commandes en attente de réception ou partiellement reçues
// Utile pour l'opérateur hub qui veut voir ce qui doit arriver
// ──────────────────────────────────────────────────────────────

router.get('/hub/pending', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         o.id            AS order_id,
         o.reference,
         o.status,
         o.created_at,
         COUNT(po.id)    AS total_pos,
         SUM(CASE WHEN po.received_qty >= po.quantity THEN 1 ELSE 0 END) AS pos_recus,
         SUM(po.quantity - po.received_qty) FILTER (
           WHERE po.status != 'cancelled' AND po.received_qty < po.quantity
         )               AS qty_manquante,
         ARRAY_AGG(
           p.name || ' (' || po.received_qty || '/' || po.quantity || ')'
           ORDER BY p.name
         )               AS articles
       FROM orders o
       JOIN purchase_orders po ON po.order_id = o.id
       JOIN products p ON p.id = po.product_id
       WHERE o.status IN ('confirmed', 'purchasing', 'partially_received')
         AND po.status != 'cancelled'
       GROUP BY o.id, o.reference, o.status, o.created_at
       ORDER BY o.created_at ASC`,
    );

    res.json({
      count: result.rows.length,
      orders: result.rows
    });

  } catch (err) {
    console.error('[scans/hub/pending] Erreur:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
// SCAN 5, SCAN 6 (relais, retrait) — INCHANGÉS en v8.2
// ──────────────────────────────────────────────────────────────
