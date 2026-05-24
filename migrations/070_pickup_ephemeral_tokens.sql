-- Migration 070 — Persistance DB des tokens éphémères pickup-secret
-- ═══════════════════════════════════════════════════════════════════════
-- SEC-1 : remplace les deux Maps in-memory de routes/pickup-secret.js
-- par des tables DB, pour survivre aux redémarrages et fonctionner
-- correctement en multi-instance Railway.
--
-- Deux tables :
--   pickup_print_tokens  — tokens one-shot d'impression reçu (TTL 2 min)
--   pickup_reveal_codes  — code clair temporaire pour révélation Stripe/Wallet/MM (TTL 30 min)
--
-- SÉCURITÉ :
--   • Les codes sont stockés en clair mais uniquement pendant leur fenêtre TTL.
--   • Les lignes expirées sont supprimées par le cron startPickupTokenCleanupCron()
--     (bootstrap/crons.js) toutes les 5 minutes.
--   • Une contrainte CHECK garantit que expires_at est dans le futur à l'insertion.
--   • L'accès DB est protégé par DATABASE_URL — même niveau de confiance qu'une
--     variable d'environnement ou de la mémoire process.
--
-- IDEMPOTENTE : IF NOT EXISTS sur les deux tables et les index.
--
-- Application :
--   psql $DATABASE_URL -f migrations/070_pickup_ephemeral_tokens.sql
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Table 1 : tokens d'impression reçu ──────────────────────────────────────
-- Créé après encaissement cash, consommé par GET /receipt/:orderId?token=...
-- TTL : 2 minutes. One-shot : supprimé à la première lecture.

CREATE TABLE IF NOT EXISTS pickup_print_tokens (
  token        TEXT        PRIMARY KEY,               -- hex 48 bytes, généré côté serveur
  order_id     UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  code         TEXT        NOT NULL,                  -- code clair (affiché sur le reçu)
  payer_name   TEXT,                                  -- nom du payeur (affiché sur le reçu)
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ppt_order_id
  ON pickup_print_tokens (order_id);

CREATE INDEX IF NOT EXISTS idx_ppt_expires_at
  ON pickup_print_tokens (expires_at);

COMMENT ON TABLE pickup_print_tokens IS
  'Tokens éphémères (TTL 2 min) pour accès one-shot au HTML imprimable du reçu cash. '
  'Remplace la Map printTokens in-memory de routes/pickup-secret.js (SEC-1).';

-- ── Table 2 : codes en attente de révélation ─────────────────────────────────
-- Créé par le webhook Stripe/Wallet/MM après génération du code secret.
-- Consommé par GET /reveal-once/:orderId (one-shot, supprimé à la lecture).
-- TTL : 30 minutes.
-- Raison d'existence : le hash SHA256+salt est irréversible — impossible de
-- reconstruire le code clair depuis la DB. Cette table comble ce gap
-- pendant la fenêtre de révélation.

CREATE TABLE IF NOT EXISTS pickup_reveal_codes (
  order_id     UUID        PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  code         TEXT        NOT NULL,                  -- code clair (8 chars), supprimé après reveal
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prc_expires_at
  ON pickup_reveal_codes (expires_at);

COMMENT ON TABLE pickup_reveal_codes IS
  'Codes pickup en clair, stockés temporairement (TTL 30 min) pour la révélation '
  'one-shot après paiement Stripe/Wallet/MM. Le code est supprimé immédiatement '
  'après la première lecture par GET /reveal-once. '
  'Remplace la Map REVEAL_CACHE in-memory de routes/pickup-secret.js (SEC-1).';

COMMIT;
