-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 117 — Renommer delivery_mode → requested_transport_rail sur order_items
--
-- Sémantique corrigée (doctrine §7) :
--   requested_transport_rail = choix demandé par le client (peut être null)
--   assigned_transport_rail  = rail réellement exécuté (posé plus tard par logistics)
--
-- La colonne 'delivery_mode TEXT DEFAULT sea' avec valeurs 'sea'/'air' est
-- remplacée par la nomenclature canonique des codes rails.
-- Les valeurs existantes sont migrées : 'sea' → 'SEA_STANDARD', 'air' → 'AIR_EXPRESS'.
-- NULL = aucun choix explicite du client (n'implique pas SEA_STANDARD).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Ajouter la nouvelle colonne avec le bon type et sans défaut implicite
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS requested_transport_rail TEXT
    CONSTRAINT order_items_requested_transport_rail_check
    CHECK (requested_transport_rail IN ('SEA_STANDARD', 'AIR_EXPRESS'));

-- 2. Migrer les données existantes
UPDATE order_items SET requested_transport_rail = 'SEA_STANDARD' WHERE delivery_mode = 'sea';
UPDATE order_items SET requested_transport_rail = 'AIR_EXPRESS'  WHERE delivery_mode = 'air';
-- delivery_mode = null → requested_transport_rail reste null

-- 3. Déprécier l'ancienne colonne (DROP dans une migration future après vérification)
COMMENT ON COLUMN order_items.delivery_mode IS
  'DÉPRÉCIÉE — remplacée par requested_transport_rail (migration 117). '
  'À supprimer après vérification en production.';

COMMENT ON COLUMN order_items.requested_transport_rail IS
  'Code canonique du rail demandé par le client lors de la commande. '
  'NULL = aucun choix explicite (ne déduit pas SEA_STANDARD). '
  'Valeurs : SEA_STANDARD, AIR_EXPRESS. '
  'À distinguer de assigned_transport_rail (rail réellement exécuté par logistics).';
