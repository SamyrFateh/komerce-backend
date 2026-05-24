-- Migration 066 — wallet_consumptions append-only (PATCH P1-2)
--
-- Remplace la suppression physique des consommations wallet lors d'une
-- annulation commande par un marquage (reversed_at + reversal_reason).
-- Conserve la traçabilité complète "quel lot a financé quelle commande".
--
-- COMPATIBILITÉ : removeFromOrder() dans wallet-service.js est mis à jour
-- en parallèle pour faire UPDATE ... SET reversed_at = NOW() au lieu de DELETE.

ALTER TABLE wallet_consumptions
  ADD COLUMN IF NOT EXISTS reversed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversal_reason    VARCHAR(50);

-- Index pour filtrer les consommations actives (non reversées)
CREATE INDEX IF NOT EXISTS idx_wcons_active
  ON wallet_consumptions (order_id)
  WHERE reversed_at IS NULL;

COMMENT ON COLUMN wallet_consumptions.reversed_at IS
  'NULL = consommation active. Non-NULL = reversée lors d''une annulation de commande.';
COMMENT ON COLUMN wallet_consumptions.reversal_reason IS
  'Raison de la reversal (order_cancel, admin_correction, ...).';
