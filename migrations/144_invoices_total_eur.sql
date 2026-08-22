-- @migration 144_invoices_total_eur.sql
-- @domain    documents
-- @purpose   P4 — corrige un bug de Payment Boundary trouvé lors de la
--            cartographie P3 (freeze 22-08-2026) : invoice-service.js
--            affichait 'KMF' codé en dur sur TOUTES les factures, même
--            quand le paiement réel s'était fait en EUR (Stripe/PayPal).
--
--            Ne touche NI currency_parities (P1) NI display_total_amount
--            (P3, Currency Boundary) — c'est une correction de la Payment
--            Boundary elle-même (finance_config/orders.total_eur, jamais
--            remise en cause), qui manquait simplement sur invoices.
--
--            Nullable, aucun backfill : les factures déjà émises restent
--            immuables (doctrine DOCTRINE_DOCUMENTS_TRANSACTIONNELS_
--            KOMERCE.md — "une facture déjà émise reste immuable").

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS total_eur NUMERIC(10, 2);

COMMENT ON COLUMN invoices.total_eur IS
  'Montant en EUR — snapshot de orders.total_eur au moment de l''émission. '
  'Affiché sur la facture UNIQUEMENT si payment_mode = stripe_eur ou '
  'paypal_eur (P4, freeze 22-08-2026) ; sinon total_kmf fait foi. NULL pour '
  'les factures antérieures à cette migration — aucun backfill fabriqué.';
