-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 118 — Transport dans le total commande (§8 chantier reprise
-- Air Shipped / Livraison Express)
--
-- Problème : le total payé par le client (orders.total_kmf) ne contenait
-- jamais de valeur de transport. Le fret n'existait que côté coût interne
-- (cost_estimated_kmf), invisible du client, utilisé uniquement pour estimer
-- la marge. services/transport-pricing.js corrige ce gap en produisant un
-- devis commercial (price_kmf) par ligne, agrégé sur la commande.
--
-- 1) orders.transport_price_kmf : part du total facturée au transport,
--    conservée pour traçabilité/affichage (distincte de cost_estimated_kmf,
--    qui reste un coût interne, pas un prix client).
--
-- 2) SEA_KMF_PER_KG_COMMERCIAL : tarif commercial SEA_STANDARD (KMF/kg),
--    pendant AIR_KMF_PER_KG_TAXABLE (migration 115) qui existait déjà côté
--    AIR_EXPRESS mais restait inutilisé (rail non commercialement exposé).
--    Valeur par défaut alignée sur FREIGHT_KMF_PER_KG (65 KMF/kg, coût
--    interne actuel) en attendant une calibration commerciale dédiée —
--    à recalibrer via l'interface admin business_rules.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS transport_price_kmf INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN orders.transport_price_kmf IS
  'Part du total (orders.total_kmf) facturée au transport, calculée par '
  'services/transport-pricing.js au moment de la commande. Distincte de '
  'cost_estimated_kmf (coût interne fret, jamais facturé tel quel). '
  '0 pour les commandes créées avant la migration 118.';

INSERT INTO business_rules (category, key, value, value_type, label_fr, description, min_value, max_value)
VALUES (
  'logistics',
  'SEA_KMF_PER_KG_COMMERCIAL',
  '{"value": 65}',
  'number',
  'Tarif fret maritime commercial (KMF/kg)',
  'Prix unitaire transport SEA_STANDARD facturé au client, en KMF par kg '
  'réel. Valeur par défaut alignée sur FREIGHT_KMF_PER_KG (coût interne '
  'historique) en attendant une calibration commerciale dédiée. '
  'Utilisation : services/transport-pricing.js pour valoriser '
  'orders.transport_price_kmf.',
  10,
  5000
)
ON CONFLICT (key) DO NOTHING;
