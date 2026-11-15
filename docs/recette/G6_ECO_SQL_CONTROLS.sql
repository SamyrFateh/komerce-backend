-- G6-PRE-STRESS-2 / O-ECO — contre-expertise Fable moteur économique #3988, contrôles Q1..Q3.
-- Lecture seule. Diagnostics de configuration : ils ne s'attendent pas à « 0 ligne ». Chaque ligne
-- se qualifie (constat ME-xx connu, décision propriétaire, ou anomalie). Même SHA pour les deux campagnes.
-- Provenance : https://github.com/SamyrFateh/komerce-backend/issues/3988 (section 4, texte d'origine conservé).
-- Une requête invalide sur le schéma live = NOT_PROVEN, jamais PASS. Zéro écriture.

-- Q1 Composants globaux appliqués à CM / CG sans surcharge marché (ME-04)
-- à rapprocher de marketCostComponents.listEffectiveComponents(market_id), colonne source = 'market_override'
SELECT m.code, c.key, c.category, c.default_value, c.unit
  FROM markets m CROSS JOIN cost_components c
 WHERE m.code IN ('CM', 'CG') AND c.is_active AND NOT c.is_exceptional
   AND c.category IN ('freight', 'transit', 'port_transitary', 'customs', 'local_distribution', 'relay');

-- Q2 Fret au poids actif (ME-03) et moyennes non calibrées (ME-02)
SELECT key, unit, allocation_method FROM cost_components
 WHERE is_active AND category IN ('freight', 'transit')
   AND NOT (allocation_method = 'by_volume' OR unit = 'kmf_per_m3');
SELECT avg_articles_per_order, avg_articles_per_parcel, avg_articles_per_shipment,
       allocation_calibrated_at, minimum_safety_margin_pct FROM finance_config WHERE id = 1;

-- Q3 Achat « réel » issu du catalogue (ME-14)
SELECT COUNT(*) FROM order_item_real_cost_allocations
 WHERE cost_type = 'product_purchase' AND is_actual AND source = 'products.cost_kmf';
