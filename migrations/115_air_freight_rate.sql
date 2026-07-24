-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 115 — Tarif fret aérien dans business_rules
--
-- Ajoute AIR_KMF_PER_KG_TAXABLE : prix commercial air facturé au client,
-- en KMF par kg taxable (poids taxable = max(poids_réel, volume_cm3 / 6000)).
--
-- Valeur par défaut : 2 500 KMF/kg (estimation marché Dubai → Comores,
-- ~5 USD/kg au taux de change actuel). À recalibrer dès réception du devis
-- transporteur réel via UPDATE ou l'interface admin business_rules.
--
-- Utilisation : buildDeliveryOptions() dans catalog-product-detail.js
-- lira cette valeur pour calculer price_kmf sur l'option AIR_EXPRESS.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO business_rules (category, key, value, value_type, label_fr, description, min_value, max_value)
VALUES (
  'logistics',
  'AIR_KMF_PER_KG_TAXABLE',
  '{"value": 2500}',
  'number',
  'Tarif fret aérien (KMF/kg taxable)',
  'Prix unitaire air Dubai → Comores facturé au client. '
  'Poids taxable = max(poids_réel_kg, volume_cm3 / AIR_VOLUMETRIC_DIVISOR). '
  'Valeur par défaut : estimation marché ~5 USD/kg. '
  'À recalibrer dès réception du devis transporteur réel.',
  500,
  10000
)
ON CONFLICT (key) DO NOTHING;
