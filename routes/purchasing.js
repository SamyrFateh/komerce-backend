// ============================================================
// KOMERCE — purchasing.js — diff v8.1 → v8.2  [BUGFIXED]
// Session 11 — Corrections colonnes réelles DB
// ============================================================
//
// BUGS CORRIGÉS vs purchasing_v82_diff.js :
//   [B1] quantity → qty          (vraie colonne purchase_orders)
//   [B2] received_at → hub_received_at  (vraie colonne purchase_orders)
//   [B3] parseInt(order_id) → supprimé  (order_id est UUID, pas integer)
//   [B4] JOIN products via product_id → via product_supplier_id → product_suppliers → products
//
// INTÉGRATION :
//   1. Remplacer la route POST /:id/receive existante par le bloc ci-dessous
//   2. Ajouter la route GET /order/:order_id/completeness si elle n'existe pas
//   3. S'assurer que triggerScan3 est importé depuis scans.js ou défini avant
//
// ============================================================

// ──────────────────────────────────────────────────────────────
// ROUTE MODIFIÉE : POST /api/purchasing/:id/receive
// Remplace l'ancienne route receive (v8.1)
// ──────────────────────────────────────────────────────────────

router.post('/:id/receive', requireAuth, async (req, res) => {
  const { id } = req.params;
  // qty_recue : quantité reçue maintenant. Défaut = totalité commandée.
  const qty_recue = parseInt(req.body.qty_recue) || null;

  try {
    // 1. Récupérer le PO actuel
    // [B1] qty (pas quantity) | [B2] hub_received_at (pas received_at)
    const poRes = await db.query(
      `SELECT id, order_id, qty, received_qty, status, hub_received_at
       FROM purchase_orders
       WHERE id = $1`,
      [id]
    );
    if (!poRes.rows.length) {
      return res.status(404).json({ error: 'PO introuvable' });
    }
    const po = poRes.rows[0];

    // Quantité à incrémenter : celle fournie, sinon le reste non reçu
    // [B1] po.qty (pas po.quantity)
    const delta = qty_recue !== null
      ? Math.min(qty_recue, po.qty - po.received_qty)
      : po.qty - po.received_qty;

    if (delta <= 0) {
      return res.status(400).json({ error: 'Quantité déjà reçue en totalité' });
    }

    const new_received = po.received_qty + delta;
    // [B1] po.qty (pas po.quantity)
    const po_complete  = new_received >= po.qty;

    // 2. Mettre à jour ce PO
    // [B2] hub_received_at (pas received_at)
    const updatedPo = await db.query(
      `UPDATE purchase_orders
       SET received_qty     = $1,
           status           = $2,
           hub_received_at  = CASE WHEN $3 THEN NOW() ELSE hub_received_at END,
           updated_at       = NOW()
       WHERE id = $4
       RETURNING *`,
      [
        new_received,
        po_complete ? 'received' : 'partially_received',
        po_complete,   // hub_received_at seulement quand complet
        id
      ]
    );

    // 3. Vérifier si TOUS les POs de la commande sont reçus
    // [B1] qty (pas quantity) dans SUM et dans CASE
    const completenessRes = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status != 'cancelled')                             AS total,
         COUNT(*) FILTER (WHERE received_qty >= qty AND status != 'cancelled')     AS recus,
         SUM(qty)          FILTER (WHERE status != 'cancelled')                    AS qty_totale,
         SUM(received_qty) FILTER (WHERE status != 'cancelled')                    AS qty_recue
       FROM purchase_orders
       WHERE order_id = $1`,
      [po.order_id]
    );

    const { total, recus, qty_totale, qty_recue: qty_recue_total } = completenessRes.rows[0];
    const order_complete = parseInt(recus) === parseInt(total);

    // 4. Mettre à jour le statut de la commande
    if (order_complete) {
      // Tous les articles sont là → preparation + SMS
      await db.query(
        `UPDATE orders SET status = 'preparation', preparation_at = NOW()
         WHERE id = $1`,
        [po.order_id]
      );

      // Déclencher SCAN 3 (notification SMS hub + client)
      try {
        await triggerScan3(po.order_id, req.user?.id || null);
      } catch (smsErr) {
        // Ne pas bloquer la réception si le SMS échoue — logguer seulement
        console.error('[purchasing/receive] Erreur SMS SCAN3:', smsErr.message);
      }

    } else {
      // Réception partielle → pas de SMS, mise en attente
      await db.query(
        `UPDATE orders SET status = 'partially_received'
         WHERE id = $1 AND status NOT IN ('preparation', 'shipped', 'available', 'collected', 'cancelled')`,
        [po.order_id]
      );
    }

    // 5. Construire la réponse opérateur
    const items_missing = parseInt(total) - parseInt(recus);

    res.json({
      success:          true,
      po_status:        updatedPo.rows[0].status,
      order_id:         po.order_id,
      order_status:     order_complete ? 'preparation' : 'partially_received',
      ready_to_prepare: order_complete,
      items_received:   parseInt(recus),
      items_total:      parseInt(total),
      items_missing,
      qty_totale:       parseInt(qty_totale),
      qty_recue:        parseInt(qty_recue_total),
      message: order_complete
        ? `✅ Commande complète — ${total}/${total} articles — Prête à préparer`
        : `📦 Réception partielle — ${recus}/${total} articles — ${items_missing} manquant(s)`
    });

  } catch (err) {
    console.error('[purchasing/receive] Erreur:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
// NOUVELLE ROUTE : GET /api/purchasing/order/:order_id/completeness
// ──────────────────────────────────────────────────────────────

router.get('/order/:order_id/completeness', requireAuth, async (req, res) => {
  const { order_id } = req.params;
  try {
    // [B1] po.qty (pas po.quantity)
    // [B2] po.hub_received_at (pas po.received_at)
    // [B3] order_id est UUID → pas de parseInt
    // [B4] JOIN via product_suppliers (purchase_orders n'a pas product_id)
    const result = await db.query(
      `SELECT
         po.id,
         p.name                                        AS product_name,
         po.qty,
         po.received_qty,
         po.status,
         (po.received_qty >= po.qty)                   AS is_complete,
         (po.qty - po.received_qty)                    AS qty_missing,
         s.name                                        AS supplier_name,
         po.hub_received_at
       FROM purchase_orders po
       JOIN product_suppliers ps ON ps.id = po.product_supplier_id
       JOIN products p ON p.id = ps.product_id
       LEFT JOIN suppliers s ON s.id = ps.supplier_id
       WHERE po.order_id = $1
         AND po.status != 'cancelled'
       ORDER BY po.id`,
      [order_id]
    );

    const items       = result.rows;
    const total       = items.length;
    const recus       = items.filter(i => i.is_complete).length;
    const is_complete = recus === total && total > 0;

    res.json({
      order_id,            // [B3] UUID — pas de parseInt
      is_complete,
      items_received:   recus,
      items_total:      total,
      items_missing:    total - recus,
      pct_received:     total > 0 ? Math.round(100 * recus / total) : 0,
      items
    });

  } catch (err) {
    console.error('[purchasing/completeness] Erreur:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
// AUCUNE AUTRE MODIFICATION dans purchasing.js v8.2
// ──────────────────────────────────────────────────────────────
