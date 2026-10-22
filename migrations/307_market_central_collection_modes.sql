-- 307_market_central_collection_modes.sql
-- Lot 3 (stabilisation multi-pays) — Gate serveur des moyens de paiement encaissés sur le compte central.
--
-- Constat audité (P1) : le checkout acceptait stripe_eur / paypal_eur pour tout marché, sans lien avec
-- la doctrine « le Market encaisse ; Komerce n'est pas automatiquement vendeur ni détenteur des fonds ».
-- Cette table dit, par marché, quel moyen d'encaissement CENTRAL (Stripe EUR / PayPal EUR) est autorisé.
-- Absence de ligne = refus (fail-closed). Aucune autorisation implicite pour un nouveau marché.
--
-- Backfill : uniquement le marché KM, pour préserver le comportement existant (Komerce vendeur de
-- référence). CM / CG / DJ ne reçoivent AUCUNE autorisation : le titulaire des fonds n'est pas défini.
-- Additif ; rollback : DROP TABLE market_central_collection_modes.

CREATE TABLE IF NOT EXISTS market_central_collection_modes (
  market_id     UUID NOT NULL REFERENCES markets(id),
  payment_mode  TEXT NOT NULL CHECK (payment_mode IN ('stripe_eur', 'paypal_eur')),
  evidence_ref  TEXT NOT NULL CHECK (length(btrim(evidence_ref)) >= 3),
  authorized_by UUID REFERENCES users(id),
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ,
  PRIMARY KEY (market_id, payment_mode)
);

COMMENT ON TABLE market_central_collection_modes IS
  'Moyens d''encaissement central (stripe_eur, paypal_eur) autorisés par marché. Absence ou revoked_at = refus. Le titulaire des fonds doit être décidé par le propriétaire avant toute ligne hors KM.';

INSERT INTO market_central_collection_modes (market_id, payment_mode, evidence_ref)
SELECT m.id, v.payment_mode, 'legacy:central-account-km-baseline'
  FROM markets m
 CROSS JOIN (VALUES ('stripe_eur'), ('paypal_eur')) AS v(payment_mode)
 WHERE m.code = 'KM'
ON CONFLICT (market_id, payment_mode) DO NOTHING;
