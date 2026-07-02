-- @migration 095_value_density_foundation.sql
-- @domain    logistics
-- @purpose   Socle densité de valeur (volume) — modèle léger, zéro contrainte

-- ============================================================================
--  095_value_density_foundation.sql  (v2 — fusionnée)
--  Doctrine : DOCTRINE_DENSITE_VALEUR.md (v1.1)
--  Liée à  : 087 (normalisation weight_kg) + scheduled/089 (drop weight_g)
--            → cette migration clôt la transformation poids→bi-métrique.
--
--  FUSION 2026-07-02 : absorbe et REMPLACE le fichier
--  `095_customs_shipment_parcel_volume.sql` (branche parallèle) qui ne doit
--  PAS être commité — même colonne (§2 ci-dessous), même numéro. Le code de
--  cette branche est conservé, lui (customs-shipment-service.js,
--  cost-allocation/allocate.js, tests) : il consomme les colonnes posées ici.
--
--  PRINCIPE « APPLICATION SANS CONTRAINTE » :
--    - Aucun NOT NULL, aucun CHECK bloquant, aucun trigger, aucun job.
--    - Toutes les colonnes sont nullables : données partielles acceptées
--      (même philosophie que le moteur sourcing, cf. SOURCING_ENGINE.md §1).
--    - Le volume INFORME (alertes, classement, vue), il ne BLOQUE jamais
--      une commande, un scan hub ou un shipment.
--    - Ventilation fret maritime (allocate.js) : by_volume automatique si
--      transport_mode='sea' et volumes snapshotés ; sinon répartition ÉGALE
--      marquée estimated_fallback / confidence 'low' — JAMAIS le poids en
--      maritime (le poids n'a aucun sens économique sur du LCL acheté au m³ :
--      mieux vaut un signal neutre honnête qu'un signal faux).
--      allocation_method='manual' explicite reste un override admin respecté.
--    - Les seuils vivent dans business_rules (invariant I-08), modifiables
--      sans redéploiement, désactivables via is_active.
--
--  Idempotente : IF NOT EXISTS / ON CONFLICT DO NOTHING partout.
-- ============================================================================

SET client_encoding = 'UTF8';

-- ── 1. Volume au niveau shipment (le compteur W/M manquant) ─────────────────
-- Symétrique de total_weight_kg. Saisi par l'admin depuis la facture
-- transitaire (le m³ facturé EST la vérité terrain — Vue 3, doctrine alloc §5).

ALTER TABLE customs_shipments
  ADD COLUMN IF NOT EXISTS total_volume_m3 NUMERIC(8,4);

COMMENT ON COLUMN customs_shipments.total_volume_m3 IS
  'Volume total facturé par le transitaire (m³), saisi depuis la facture. '
  'Sert au taux de remplissage et au tonnage taxable W/M (v_shipment_density).';

-- ── 2. Snapshot volume par colis du shipment ─────────────────────────────────
-- Miroir de parcel_weight_kg : la liaison fige les valeurs au moment de la
-- déclaration, indépendamment des évolutions ultérieures de parcels.
-- Renseignée par customs-shipment-service.js :
--   COALESCE(parcels.volume_cm3, Σ products.volume_cm3 × quantité).

ALTER TABLE customs_shipment_parcels
  ADD COLUMN IF NOT EXISTS parcel_volume_cm3 NUMERIC(12,2);

COMMENT ON COLUMN customs_shipment_parcels.parcel_volume_cm3 IS
  'Snapshot du volume du colis (cm3) au moment du rattachement au shipment. '
  'Utilise pour ventiler le fret maritime au m3 (doctrine LCL) au lieu du poids. '
  'NULL pour les rattachements anterieurs a la migration 095 -> repartition egale, '
  'confidence low (jamais le poids en maritime).';

-- ── 3. Repack au hub (prescrit par le système, exécuté par l'opérateur — R2) ─
-- repack_volume_cm3 : volume constaté APRÈS repack (mesuré une fois à la
--   première réception ; NULL = jamais repacké/mesuré).
-- repack_exempt : exclusions doctrinales (fragile, boîte = valeur perçue,
--   identification douane). Posé par l'admin, jamais par l'agent hub.
-- Le gain candidat = volume_cm3 - repack_volume_cm3, comparé à
--   REPACK_MIN_GAIN_CM3 pour poser next_action:'repack' au scan.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS repack_volume_cm3 NUMERIC(10,2);
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS repack_exempt BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN products.repack_volume_cm3 IS
  'Volume constaté après repack hub (cm³), mesuré à la première réception. '
  'NULL = jamais mesuré. Gain repack = volume_cm3 - repack_volume_cm3.';
COMMENT ON COLUMN products.repack_exempt IS
  'Exclusion doctrinale du repack : fragile, boîte = valeur perçue, douane. '
  'Posé par admin uniquement (R2 : l''agent hub exécute, ne décide pas).';

-- ── 4. Seuils en business_rules (I-08 : rien en dur dans le code) ────────────

INSERT INTO business_rules (category, key, value, value_type, label_fr, description, min_value, max_value)
VALUES
  ('logistics', 'SEA_WM_KG_PER_M3', '{"value": 1000}', 'number',
   'Équivalence W/M maritime (kg par m³)',
   'Règle Weight/Measure LCL : tonnage taxable = max(poids_kg / cette valeur, volume_m3). Standard : 1000.',
   500, 2000),

  ('logistics', 'AIR_VOLUMETRIC_DIVISOR', '{"value": 6000}', 'number',
   'Diviseur volumétrique aérien (cm³/kg)',
   'Poids taxable aérien = max(poids_réel, volume_cm3 / cette valeur). Standard IATA : 6000.',
   4000, 7000),

  ('logistics', 'REPACK_MIN_GAIN_CM3', '{"value": 2000}', 'number',
   'Gain volume minimal pour prescrire un repack (cm³)',
   'Sous ce gain, le repack ne vaut pas le temps opérateur. Le hub reçoit next_action:repack uniquement au-dessus. Calibrer avec fret_maritime_eur_m3.',
   0, 50000),

  ('sourcing', 'VALUE_DENSITY_TARGET_KMF_PER_DM3', '{"value": 500}', 'number',
   'Cible densité de valeur (KMF de marge par dm³)',
   'Marge absolue unitaire / volume unitaire (dm³). Sous la cible → alerte informative review_volume (jamais bloquante). CONFIANCE BASSE : à recalibrer après le premier shipment réel via v_shipment_density.',
   0, 100000)
ON CONFLICT (key) DO NOTHING;

-- ── 5. Vue pilotage densité — LECTURE SEULE, à la demande ────────────────────
-- Même principe que v_parcel_reconciliation (094) : pas de job, pas de cron.
-- Fournit par shipment : poids, volume, tonnage taxable W/M, et le KPI
-- doctrinal « marge embarquée par m³ ». Tolère les données partielles :
-- les colonnes restent NULL si les volumes ne sont pas renseignés.

CREATE OR REPLACE VIEW v_shipment_density AS
WITH parcel_vol AS (
  SELECT csp.shipment_id,
         csp.parcel_id,
         csp.parcel_weight_kg,
         COALESCE(csp.parcel_volume_cm3, p.volume_cm3) AS volume_cm3
  FROM customs_shipment_parcels csp
  LEFT JOIN parcels p ON p.id = csp.parcel_id
),
margin_embarked AS (
  -- Marge embarquée = SUM((prix - coût) × qty) des order_items du shipment.
  -- NULL-safe : les items sans coût contribuent 0 (données partielles OK).
  SELECT pv.shipment_id,
         SUM( COALESCE(oi.price_kmf, 0) * COALESCE(pi.quantity, 1)
            - COALESCE(pr.cost_kmf, oi.price_kmf, 0) * COALESCE(pi.quantity, 1)
         ) AS margin_kmf
  FROM parcel_vol pv
  JOIN parcel_items pi ON pi.parcel_id = pv.parcel_id
  JOIN order_items  oi ON oi.id = pi.order_item_id
  LEFT JOIN products pr ON pr.id = pi.product_id
  GROUP BY pv.shipment_id
)
SELECT
  cs.id                                            AS shipment_id,
  cs.reference,
  cs.transport_mode,
  cs.total_weight_kg,
  cs.total_volume_m3,
  SUM(pv.parcel_weight_kg)                         AS parcels_weight_kg,
  SUM(pv.volume_cm3) / 1000000.0                   AS parcels_volume_m3,
  -- Tonnage taxable W/M (maritime) : max(poids/1000, volume m³)
  GREATEST(
    COALESCE(cs.total_weight_kg, SUM(pv.parcel_weight_kg)) / 1000.0,
    COALESCE(cs.total_volume_m3, SUM(pv.volume_cm3) / 1000000.0)
  )                                                AS chargeable_wm,
  -- Remplissage : volume colis / volume facturé (NULL si l'un des deux manque)
  CASE
    WHEN cs.total_volume_m3 > 0 AND SUM(pv.volume_cm3) > 0
    THEN ROUND((SUM(pv.volume_cm3) / 1000000.0) / cs.total_volume_m3 * 100, 1)
  END                                              AS fill_rate_pct,
  me.margin_kmf                                    AS margin_embarked_kmf,
  -- LE KPI doctrinal : marge embarquée par m³ facturé
  CASE
    WHEN cs.total_volume_m3 > 0
    THEN ROUND(me.margin_kmf / cs.total_volume_m3, 0)
  END                                              AS margin_kmf_per_m3,
  cs.freight_kmf,
  cs.status
FROM customs_shipments cs
LEFT JOIN parcel_vol pv       ON pv.shipment_id = cs.id
LEFT JOIN margin_embarked me  ON me.shipment_id = cs.id
WHERE cs.is_active = TRUE
GROUP BY cs.id, cs.reference, cs.transport_mode, cs.total_weight_kg,
         cs.total_volume_m3, cs.freight_kmf, cs.status, me.margin_kmf;

-- ── Vérification post-migration (lecture seule) ──────────────────────────────
-- SELECT key, value FROM business_rules
--  WHERE key IN ('SEA_WM_KG_PER_M3','AIR_VOLUMETRIC_DIVISOR',
--                'REPACK_MIN_GAIN_CM3','VALUE_DENSITY_TARGET_KMF_PER_DM3');
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'customs_shipment_parcels' AND column_name = 'parcel_volume_cm3';
-- SELECT * FROM v_shipment_density LIMIT 5;

DO $$
BEGIN
  RAISE NOTICE 'Migration 095 v2 OK : socle densité de valeur (fusion branche volume, 0 contrainte bloquante)';
END $$;
