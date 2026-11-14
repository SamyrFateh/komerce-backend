-- G6-PRE-STRESS-2 / O-FIN — audit Fable flux d'argent #3987, invariants I1..I15.
-- Lecture seule, exécuter sur PostgreSQL staging APRÈS stabilisation de chaque geste financier
-- (paiement, remboursement, wallet, compensation SAV, paiement fournisseur) et AVANT/APRÈS l'E2E.
-- Même SHA, mêmes requêtes pour ChatGPT et Opus, cohortes distinctes (filtrer par références de cohorte).
-- Chaque requête doit renvoyer 0 ligne sur les objets de la cohorte ; une ligne = anomalie à qualifier.
-- Provenance : https://github.com/SamyrFateh/komerce-backend/issues/3987 (section 2, texte d'origine conservé).
-- Colonnes issues de docs/db/railway-live-schema.sql : vérifier sur le schéma live avant la campagne ;
-- une requête invalide = NOT_PROVEN, jamais PASS. Zéro écriture.

-- I1 Wallet : aucun solde négatif, solde = somme du journal (FA-01/02/16)
SELECT w.id, w.currency, w.balance_kmf,
       SUM(CASE WHEN t.type = 'debit' OR t.reason = 'lot_reversal' THEN -t.amount_kmf ELSE t.amount_kmf END) AS journal
  FROM wallets w LEFT JOIN wallet_transactions t ON t.wallet_id = w.id
 GROUP BY w.id HAVING w.balance_kmf < 0
    OR w.balance_kmf <> COALESCE(SUM(CASE WHEN t.type = 'debit' OR t.reason = 'lot_reversal' THEN -t.amount_kmf ELSE t.amount_kmf END), 0);

-- I2 Wallet : lots actifs = solde (FA-16)
SELECT w.id, w.balance_kmf, COALESCE(SUM(l.remaining_kmf), 0) AS lots
  FROM wallets w LEFT JOIN wallet_credit_lots l ON l.wallet_id = w.id AND l.status = 'active'
 GROUP BY w.id HAVING w.balance_kmf <> COALESCE(SUM(l.remaining_kmf), 0);

-- I3 Commande : wallet_applied sans débit, ou débit actif sans wallet_applied (FA-01)
SELECT o.id, o.reference, o.wallet_applied_kmf, d.amount_kmf AS debit,
       (SELECT COALESCE(SUM(c.amount_kmf), 0) FROM wallet_consumptions c
         WHERE c.order_id = o.id AND c.reversed_at IS NULL) AS conso_active
  FROM orders o
  LEFT JOIN wallet_transactions d ON d.idempotency_key = 'checkout_' || o.id AND d.type = 'debit'
 WHERE (COALESCE(o.wallet_applied_kmf, 0) > 0) <>
       (EXISTS (SELECT 1 FROM wallet_consumptions c WHERE c.order_id = o.id AND c.reversed_at IS NULL));

-- I4 Restitué ≤ encaissé, par commande (FA-02/05/06/07/10)
SELECT o.id, o.reference, o.total_kmf,
       COALESCE(r.kmf, 0) AS rembourse_kmf, COALESCE(wc.n, 0) AS credits_wallet
  FROM orders o
  LEFT JOIN (SELECT order_id, SUM(amount_kmf) AS kmf FROM refunds
              WHERE status IN ('completed', 'pending') GROUP BY 1) r ON r.order_id = o.id
  LEFT JOIN (SELECT reference_id, COUNT(*) AS n FROM wallet_transactions
              WHERE type = 'credit' AND reason IN ('order_cancel', 'sav_compensation') GROUP BY 1) wc
         ON wc.reference_id = o.id
 WHERE COALESCE(r.kmf, 0) > o.total_kmf + 0.01 OR COALESCE(wc.n, 0) > 1;

-- I5 Remboursement ou avoir sur une commande jamais payée (FA-06/07)
SELECT o.id, o.reference, o.payment_status, t.id AS wallet_tx, t.amount_kmf
  FROM wallet_transactions t JOIN orders o ON o.id = t.reference_id
 WHERE t.type = 'credit' AND t.reason = 'order_cancel'
   AND o.payment_status NOT IN ('paid', 'refunded')
   AND NOT EXISTS (SELECT 1 FROM order_status_history h WHERE h.order_id = o.id AND h.status = 'confirmed');

-- I6 Commande annulée ou remboursée : wallet encore appliqué (FA-14)
SELECT id, reference, status, wallet_applied_kmf FROM orders
 WHERE status IN ('cancelled', 'refunded') AND COALESCE(wallet_applied_kmf, 0) > 0;

-- I7 Commande payée à montant nul hors remplacement SAV, ou payée sans encaissement tracé
SELECT o.id, o.reference, o.payment_mode, o.total_kmf FROM orders o
 WHERE o.payment_status = 'paid' AND o.payment_mode <> 'sav_replacement'
   AND ((o.payment_mode = 'cash_relais' AND COALESCE(o.wallet_applied_kmf, 0) = 0
         AND NOT EXISTS (SELECT 1 FROM cash_collections c WHERE c.order_id = o.id))
     OR (o.payment_mode = 'mobile_money' AND COALESCE(o.wallet_applied_kmf, 0) = 0
         AND NOT EXISTS (SELECT 1 FROM mobile_money_transactions m
                          WHERE m.order_id = o.id AND m.status = 'succeeded')));

-- I8 Double encaissement PSP (FA-12/13)
SELECT stripe_event_id, payload_summary FROM stripe_events_processed
 WHERE payload_summary->>'ignored' = 'already_paid' OR payload_summary ? 'rejected';
SELECT m.order_id, COUNT(*) FROM mobile_money_transactions m
 WHERE m.status = 'succeeded' GROUP BY 1 HAVING COUNT(*) > 1;

-- I9 Une commande par clé d'idempotence ; pas de doublon de commande à la seconde (FA-22)
SELECT user_id, idempotency_key, COUNT(DISTINCT order_id) FROM order_checkout_idempotency
 GROUP BY 1, 2 HAVING COUNT(DISTINCT order_id) > 1;

-- I10 SAV : quantité compensée ≤ quantité remise, par ligne (FA-10)
SELECT d.return_order_item_id, oi.qty_collected, SUM(d.return_quantity) AS compensee
  FROM relay_return_compensations c
  JOIN disputes d ON d.id = c.request_id
  JOIN order_items oi ON oi.id = d.return_order_item_id
 GROUP BY 1, 2 HAVING SUM(d.return_quantity) > oi.qty_collected;

-- I11 Ligne : remis + remboursé ≤ commandé
SELECT id, order_id, quantity, qty_collected, qty_refunded FROM order_items
 WHERE COALESCE(qty_collected, 0) + COALESCE(qty_refunded, 0) > quantity;

-- I12 Intentions PSP non résolues depuis plus de 30 min (FA-04/08)
SELECT id, order_id, provider, status, amount_eur, updated_at FROM refund_execution_intents
 WHERE status IN ('reserved', 'processing', 'unknown') AND updated_at < NOW() - INTERVAL '30 minutes';
SELECT id, order_id, refund_type, amount_kmf FROM refunds
 WHERE status = 'pending' AND created_at < NOW() - INTERVAL '30 minutes';

-- I13 Fournisseur : cumul payé ≤ autorisé ; paiement sans autorisation (FA-23)
SELECT p.purchase_order_id, p.currency, SUM(COALESCE(p.observed_amount, p.expected_amount)) AS paye, a.amount AS autorise
  FROM supplier_execution_payments p
  LEFT JOIN purchase_order_authorizations a
         ON a.purchase_order_id = p.purchase_order_id AND a.authorization_type = 'supplier_payment'
 WHERE p.status IN ('requested', 'succeeded', 'ambiguous')
 GROUP BY 1, 2, a.amount, a.currency
HAVING a.amount IS NULL OR a.currency <> p.currency
    OR SUM(COALESCE(p.observed_amount, p.expected_amount)) > a.amount + 0.0001;

-- I14 Commande annulée dont une ligne d'achat reste engagée (FA-09)
SELECT o.id, o.reference, po.id AS po_id, po.status
  FROM orders o JOIN order_items oi ON oi.order_id = o.id
  JOIN purchase_lines pl ON pl.order_item_id = oi.id AND pl.cancelled_at IS NULL
  JOIN purchase_orders po ON po.id = pl.purchase_order_id
 WHERE o.status IN ('cancelled', 'refunded') AND po.status NOT IN ('cancelled', 'draft');

-- I15 Documents : facture par commande payée, reçu par remboursement confirmé (FA-19)
SELECT o.id FROM orders o LEFT JOIN invoices i ON i.order_id = o.id
 WHERE o.payment_status = 'paid' AND i.id IS NULL AND o.updated_at < NOW() - INTERVAL '5 minutes';
SELECT r.id FROM refunds r
 WHERE r.status = 'completed' AND r.completed_at < NOW() - INTERVAL '5 minutes'
   AND NOT EXISTS (SELECT 1 FROM transaction_documents td
                    WHERE td.document_type = 'refund_receipt' AND td.subject_id = r.id);
