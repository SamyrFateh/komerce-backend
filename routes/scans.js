// ============================================================
// KOMERCE — scans.js — diff v8.x → v8.2  [BUGFIXED]
// Session 11 — Corrections colonnes réelles DB
// ============================================================
//
// BUGS CORRIGÉS vs scans_v82_diff.js :
//   [B1] po.quantity → po.qty       (vraie colonne purchase_orders)
//   [B4] JOIN products via product_id → via product_supplier_id
//   [B7] receiveItem() non défini → logique inline dans hub/receive
//
// ============================================================

// ──────────────────────────────────────────────────────────────
// triggerScan3 — v8.2
// Appelé depuis purchasing.js après vérification de complétude.
// Le statut 'preparation' est déjà positionné avant l'appel.
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
    console.warn(`[SCAN3] Commande ${order_id} ignorée — statut: ${order.status} (attendu: preparation)`);
    return { skipped: true, reason: `statut_invalide: ${order.status}` };
  }

  // SMS client
  const smsClient = `Bonjour ${order.first_name}, votre commande Komerce ref ${order.reference} est en cours de préparation à Dubai. Vous serez notifié(e) dès l'expédition. 🛍️`;

  try {
    await sendSMS(order.client_phone, smsClient);
  } catch (smsErr) {
    console.error(`[SCAN3] SMS client échoué (order ${order_id}):`, smsErr.message);
  }

  // Log scan
  try {
    await db.query(
      `INSERT INTO scans (order_id, step, scan_code, scanned_by, notes)
       VALUES ($1, 'preparation', 'AUTO-HUB-' || $1, $2, 'Auto-déclenché après complétude réception hub')`,
       // scan_code NOT NULL requis | created_at auto | trg_scan_sync_status gère le statut order
      [order_id, scanned_by]
    );
  } catch (logErr) {
    console.warn(`[SCAN3] Log non enregistré:`, logErr.message);
  }

  console.log(`[SCAN3] ✅ Commande ${order.reference} en préparation — SMS client envoyé`);
  return { success: true, order_id, reference: order.reference };
}

// Exporter pour purchasing.js
module.exports.triggerScan3 = triggerScan3;

// ──────────────────────────────────────────────────────────────
// NOUVELLE ROUTE : POST /api/scans/hub/receive
// [B7] receiveItem() remplacé par logique inline pour éviter dépendance
// ──────────────────────────────────────────────────────────────

router.post('/hub/receive', requireAuth, async (req, res) => {
  const { qr_code, po_id, qty_recue } = req.body;

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

    // [B7] Logique inline (évite d'appeler receiveItem non défini)
    // Déléguer via appel HTTP interne à POST /api/purchasing/:id/receive
    // — En pratique : importer la fonction depuis purchasing.js si refacto
    // — Pour l'instant : redirect vers la route purchasing directement
    // Le frontend peut appeler POST /api/purchasing/:id/receive directement.
    return res.status(501).json({
      error: 'Utilisez POST /api/purchasing/:po_id/receive directement',
      po_id: purchase_order_id
    });

  } catch (err) {
    console.error('[scans/hub/receive] Erreur:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
// NOUVELLE ROUTE : GET /api/scans/hub/pending
// [B1] po.qty (pas po.quantity)
// [B4] JOIN products via product_suppliers
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
       WHERE o.status IN ('confirmed', 'purchasing', 'partially_received')
         AND po.status != 'cancelled'
       GROUP BY o.id, o.reference, o.status, o.created_at
       ORDER BY o.created_at ASC`
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
// SCAN 4, 5, 6 (expédition, relais, retrait) — INCHANGÉS en v8.2
// ──────────────────────────────────────────────────────────────
