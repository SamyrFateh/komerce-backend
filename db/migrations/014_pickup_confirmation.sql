-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 014 — Pickup Confirmation + Double Confirmation Cash Reverse
--
-- OBJECTIF : Implémenter deux couches de sécurité anti-fraude relais :
--
-- 1. CODE DE RETRAIT COLIS
--    parcels.pickup_code        (existait déjà, jamais rempli — on l'utilise maintenant)
--    parcels.pickup_code_sent_at TIMESTAMPTZ  — quand le code a été envoyé au client
--    parcels.pickup_confirmed_at TIMESTAMPTZ  — quand le relais a validé le code
--    parcels.pickup_confirmed_by UUID         — quel agent relais a confirmé
--
-- 2. DOUBLE CONFIRMATION CASH REVERSE
--    orders.cash_reverse_status        TEXT    — pending | declared | confirmed
--    orders.cash_reverse_declared_at   TIMESTAMPTZ — relais déclare avoir envoyé l'argent
--    orders.cash_reverse_amount_kmf    INTEGER — montant déclaré
--    orders.cash_reverse_notes         TEXT    — référence virement, photo, etc.
--    orders.cash_reverse_confirmed_at  TIMESTAMPTZ — admin valide
--    orders.cash_reverse_confirmed_by  UUID    — quel admin a validé
--
-- IMPACT : ZÉRO breaking change. Toutes les colonnes sont nullable avec défaut.
-- Le flow cash/confirm existant continue à fonctionner (backward compat).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Colonnes colis — confirmation retrait ──────────────────────────────────

ALTER TABLE parcels
  ADD COLUMN IF NOT EXISTS pickup_code_sent_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_confirmed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_confirmed_by  UUID REFERENCES users(id);

-- Index pour retrouver rapidement un colis par son pickup_code
CREATE INDEX IF NOT EXISTS idx_parcels_pickup_code ON parcels(pickup_code) WHERE pickup_code IS NOT NULL;

-- ── 2. Colonnes orders — double confirmation cash reverse ─────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cash_reverse_status       TEXT DEFAULT 'pending'
    CHECK (cash_reverse_status IN ('pending', 'declared', 'confirmed')),
  ADD COLUMN IF NOT EXISTS cash_reverse_declared_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cash_reverse_amount_kmf   INTEGER,
  ADD COLUMN IF NOT EXISTS cash_reverse_notes        TEXT,
  ADD COLUMN IF NOT EXISTS cash_reverse_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cash_reverse_confirmed_by UUID REFERENCES users(id);

-- Index dashboard — retrouver les reverses en attente de validation
CREATE INDEX IF NOT EXISTS idx_orders_cash_reverse ON orders(cash_reverse_status)
  WHERE payment_mode = 'cash_relais';

-- ── 3. Règles métier — seuils reverse ─────────────────────────────────────────

INSERT INTO business_rules (category, key, value, value_type, label_fr, description, min_value, max_value)
VALUES
  ('relais', 'REVERSE_DECLARE_DELAY_HOURS', '{"value": 24}', 'number',
   'Délai déclaration reverse (heures)',
   'Temps accordé au relais pour déclarer le reverse après collected_at. Au-delà → alerte fraud.',
   6, 168),

  ('relais', 'REVERSE_CONFIRM_DELAY_HOURS', '{"value": 48}', 'number',
   'Délai validation reverse admin (heures)',
   'Temps accordé à l''admin pour valider la déclaration de reverse. Au-delà → rappel.',
   12, 168),

  ('relais', 'PICKUP_CODE_LENGTH', '{"value": 6}', 'number',
   'Longueur code de retrait',
   'Nombre de caractères du code de retrait alphanumrique envoyé au client.',
   4, 8),

  ('relais', 'PICKUP_CODE_EXPIRY_HOURS', '{"value": 48}', 'number',
   'Validité code retrait (heures)',
   'Durée de validité du code retrait après envoi. Au-delà, le relais doit régénérer.',
   6, 168)
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIN Migration 014 — Pickup Confirmation + Cash Reverse
-- ═══════════════════════════════════════════════════════════════════════════════
