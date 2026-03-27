-- ============================================================
-- KOMERCE — Migration v6 → v7.1
-- Delta uniquement — idempotent (safe à rejouer)
-- Mars 2026
--
-- Appliquer dans l'ordre :
--   psql $DATABASE_URL -f migration_v6_to_v71.sql
--
-- Prérequis : schema.sql + schema_extension.sql déjà appliqués
-- ============================================================

BEGIN;

-- ============================================================
-- 1. ENUM order_status — 2 nouveaux statuts
-- ============================================================
-- Ajout de 'purchasing' (en achat au hub) et 'transit_comores'
-- (arrivé aux Comores, en cours de dédouanement)
--
-- PostgreSQL ne supporte pas IF NOT EXISTS sur ALTER TYPE ADD VALUE
-- On vérifie l'existence avant d'ajouter.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'purchasing'
      AND enumtypid = 'order_status'::regtype
  ) THEN
    -- 'paid' peut ne pas exister en v6 — on insère après 'ordered' en fallback
    IF EXISTS (
      SELECT 1 FROM pg_enum
      WHERE enumlabel = 'paid' AND enumtypid = 'order_status'::regtype
    ) THEN
      ALTER TYPE order_status ADD VALUE 'purchasing' AFTER 'paid';
    ELSE
      ALTER TYPE order_status ADD VALUE 'purchasing' AFTER 'ordered';
    END IF;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'transit_comores'
      AND enumtypid = 'order_status'::regtype
  ) THEN
    ALTER TYPE order_status ADD VALUE 'transit_comores' AFTER 'shipped';
  END IF;
END$$;

-- ============================================================
-- 2. ENUM scan_step — 3 nouveaux points de scan
-- ============================================================
-- Ancien : preparation | shipped | relais_received | collected
-- Nouveau : hub_preparation (scan Hub étape 3)
--           relais_received (scan relais étape 6 — inchangé)
--           collected (scan QR client étape 7 — inchangé)
-- Note : 'hub_preparation' remplace sémantiquement 'preparation'
--        pour clarifier que c'est un scan physique au Hub.
--        L'ancien 'preparation' est conservé pour compatibilité.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'hub_preparation'
      AND enumtypid = 'scan_step'::regtype
  ) THEN
    ALTER TYPE scan_step ADD VALUE 'hub_preparation' AFTER 'preparation';
  END IF;
END$$;

-- ============================================================
-- 3. TABLE orders — Colonnes marge réelle
-- ============================================================
-- cost_transport_kmf et cost_douane_kmf existent déjà (v6)
-- On ajoute les colonnes estimé/réel/delta et les alertes

ALTER TABLE orders
  -- Coût total estimé à la commande (calculé par le moteur pricing)
  ADD COLUMN IF NOT EXISTS cost_estimated_kmf     INTEGER,

  -- Coût total réel (renseigné après livraison complète)
  ADD COLUMN IF NOT EXISTS cost_real_kmf          INTEGER,

  -- Écart estimé vs réel en % (calculé : cost_real / cost_estimated - 1)
  ADD COLUMN IF NOT EXISTS cost_delta_pct         NUMERIC(6,3),

  -- Marge estimée à la commande (objectif 12%)
  ADD COLUMN IF NOT EXISTS margin_estimated_pct   NUMERIC(6,3),

  -- Marge réelle = (total_kmf - cost_real_kmf) / total_kmf
  ADD COLUMN IF NOT EXISTS margin_real_pct        NUMERIC(6,3),

  -- Alertes automatiques
  ADD COLUMN IF NOT EXISTS margin_alert           BOOLEAN  NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sourcing_blocked       BOOLEAN  NOT NULL DEFAULT FALSE,

  -- Horodatage de la clôture comptable (quand cost_real est renseigné)
  ADD COLUMN IF NOT EXISTS cost_closed_at         TIMESTAMPTZ;

COMMENT ON COLUMN orders.cost_estimated_kmf   IS 'Coût total estimé par le moteur pricing au moment de la commande';
COMMENT ON COLUMN orders.cost_real_kmf        IS 'Coût total réel renseigné après livraison (douane réelle incluse)';
COMMENT ON COLUMN orders.cost_delta_pct       IS 'Écart coût réel vs estimé en % — alimentation mensuelle du coefficient risque';
COMMENT ON COLUMN orders.margin_estimated_pct IS 'Marge estimée à la commande — objectif 12%';
COMMENT ON COLUMN orders.margin_real_pct      IS 'Marge réelle post-livraison = (total_kmf - cost_real_kmf) / total_kmf';
COMMENT ON COLUMN orders.margin_alert         IS 'true si margin_real_pct < 10% — alerte back-office';
COMMENT ON COLUMN orders.sourcing_blocked     IS 'true si margin_real_pct < 0 — blocage sourcing produit/catégorie';
COMMENT ON COLUMN orders.cost_closed_at       IS 'Horodatage de la clôture comptable commande';

-- ============================================================
-- 4. NOUVELLE TABLE partners
-- ============================================================
-- Créée ici (avant orders couture) car orders.confection_artisan_id
-- y fait référence via FK — l'ordre est obligatoire.

CREATE TABLE IF NOT EXISTS partners (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT        NOT NULL,
  type            TEXT        NOT NULL,
  -- relais_simple | relais_showroom | partenaire_avance |
  -- atelier_couture | artisan_retouche | franchise_s5
  location        TEXT,
  island          TEXT        NOT NULL DEFAULT 'Anjouan',
  country         CHAR(2)     NOT NULL DEFAULT 'KM',
  phone           TEXT,
  email           TEXT,
  contact_name    TEXT,

  commission_kmf  INTEGER,
  commission_pct  NUMERIC(5,2),
  commission_type TEXT        NOT NULL DEFAULT 'fixed',
  -- fixed | percentage | hybrid

  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  activated_at    DATE,
  suspended_at    DATE,
  suspension_reason TEXT,

  activation_phase TEXT       NOT NULL DEFAULT 'phase_1',
  -- phase_1 | phase_2 | phase_3 | phase_4

  relais_id       UUID        REFERENCES relais(id) ON DELETE SET NULL,

  avg_delivery_hours NUMERIC(6,1),
  scan_rate_pct      NUMERIC(5,2),
  nps_score          NUMERIC(4,1),
  incident_count     INTEGER     NOT NULL DEFAULT 0,

  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  partners                  IS 'Réseau partenaires Komerce — 3 niveaux MVP + artisans couture + franchise Phase 4';
COMMENT ON COLUMN partners.type             IS 'relais_simple | relais_showroom | partenaire_avance | atelier_couture | artisan_retouche | franchise_s5';
COMMENT ON COLUMN partners.activation_phase IS 'Phase d activation : phase_1 (MVP) à phase_4 (franchise)';

-- ============================================================
-- 5. TABLE orders — Colonnes couture
-- ============================================================
-- Complément aux tables ceremony_* existantes :
-- ces colonnes portent le service couture au niveau de la commande

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS confection_type          VARCHAR(32) NOT NULL DEFAULT 'aucun',
  ADD COLUMN IF NOT EXISTS confection_instructions  TEXT,
  ADD COLUMN IF NOT EXISTS confection_delay_days    INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confection_artisan_id    UUID        REFERENCES partners(id) ON DELETE SET NULL;

COMMENT ON COLUMN orders.confection_type         IS 'aucun | couture_standard | sur_mesure | retouche_locale | broderie';
COMMENT ON COLUMN orders.confection_instructions IS 'Mensurations ou notes libres transmises par le client';
COMMENT ON COLUMN orders.confection_delay_days   IS 'Délai supplémentaire jours calculé selon le service choisi';
COMMENT ON COLUMN orders.confection_artisan_id   IS 'Référence atelier Deira ou artisan relais Anjouan (table partners)';

-- ============================================================
-- 5. TABLE orders — Colonnes timestamps nouveaux statuts
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS purchasing_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transit_comores_at   TIMESTAMPTZ;

COMMENT ON COLUMN orders.purchasing_at       IS 'Horodatage passage au statut purchasing (en achat au hub)';
COMMENT ON COLUMN orders.transit_comores_at  IS 'Horodatage passage au statut transit_comores (dédouanement Mutsamudu)';

-- ============================================================
-- 6. TABLE products — Coefficient de risque douane par catégorie
-- ============================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS customs_risk_coeff    NUMERIC(5,3) NOT NULL DEFAULT 1.200,
  ADD COLUMN IF NOT EXISTS customs_risk_updated  DATE;

COMMENT ON COLUMN products.customs_risk_coeff   IS 'Coefficient risque douane (ex: 1.200 = +20%). MVP=1.2 fixe. Phase 2=calculé depuis customs_history';
COMMENT ON COLUMN products.customs_risk_updated IS 'Date de dernière mise à jour du coefficient (révision mensuelle)';

-- ============================================================
-- 7. NOUVELLE TABLE customs_history
-- ============================================================
-- Historisation de chaque passage douanier
-- Alimentée par le transitaire via le back-office admin

CREATE TABLE IF NOT EXISTS customs_history (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Commande et lot d'expédition associés
  order_id              UUID          REFERENCES orders(id) ON DELETE SET NULL,
  shipment_id           UUID          REFERENCES shipments(id) ON DELETE SET NULL,

  -- Catégorie produit (SH code) pour analyse par famille
  sh_category           TEXT          NOT NULL,     -- ex: '85xx', '61xx', '33xx'
  product_category      TEXT,                        -- libellé catégorie Komerce

  -- Coûts douane
  customs_estimated_kmf INTEGER       NOT NULL,      -- CIF × taux officiel × coeff. risque
  customs_real_kmf      INTEGER,                     -- coût réel payé — saisi par transitaire
  customs_delta_kmf     INTEGER
    GENERATED ALWAYS AS (customs_real_kmf - customs_estimated_kmf) STORED,
  customs_delta_pct     NUMERIC(8,4)
    GENERATED ALWAYS AS (
      CASE WHEN customs_estimated_kmf > 0
        THEN ROUND(
          (customs_real_kmf::NUMERIC / customs_estimated_kmf - 1) * 100, 4
        )
        ELSE NULL
      END
    ) STORED,

  -- Contexte du passage
  customs_date          DATE          NOT NULL DEFAULT CURRENT_DATE,
  customs_agent_id      TEXT,                        -- identifiant/nom agent douanier
  customs_notes         TEXT,                        -- justification surcoût, contexte

  -- Anomalie détectée
  is_anomaly            BOOLEAN       NOT NULL DEFAULT FALSE,
  -- true si customs_real > 2 × customs_estimated

  -- Qui a saisi
  recorded_by           UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  customs_history                    IS 'Historique de chaque passage douanier — source de vérité pour le coefficient de risque';
COMMENT ON COLUMN customs_history.customs_agent_id   IS 'Identifiant ou nom agent douanier — détection de patterns de sur-évaluation';
COMMENT ON COLUMN customs_history.is_anomaly         IS 'true si customs_real > 2× customs_estimated — alerte back-office automatique';
COMMENT ON COLUMN customs_history.customs_delta_kmf  IS 'Colonne calculée : customs_real_kmf - customs_estimated_kmf';
COMMENT ON COLUMN customs_history.customs_delta_pct  IS 'Colonne calculée : écart en % — alimentation coefficient de risque mensuel';

-- ============================================================
-- 9. TABLE shipments — Colonne dédouanement réel
-- ============================================================
-- customs_cleared_at existait déjà — on ajoute le coût réel total

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS customs_total_estimated_kmf  INTEGER,
  ADD COLUMN IF NOT EXISTS customs_total_real_kmf       INTEGER,
  ADD COLUMN IF NOT EXISTS customs_notes                TEXT;

COMMENT ON COLUMN shipments.customs_total_estimated_kmf IS 'Total douane estimé pour ce lot d expédition';
COMMENT ON COLUMN shipments.customs_total_real_kmf      IS 'Total douane réel — saisi après dédouanement complet';
COMMENT ON COLUMN shipments.customs_notes               IS 'Notes transitaire sur le passage douanier du lot';

-- ============================================================
-- 10. TABLE disputes — Colonne type couture
-- ============================================================
-- Ajout du type de litige couture pour la politique d'avoir v7.1

ALTER TABLE disputes
  ADD COLUMN IF NOT EXISTS confection_type  TEXT;

COMMENT ON COLUMN disputes.confection_type IS 'Si litige lié à un service couture : type du service concerné';

-- ============================================================
-- 11. INDEX nouveaux
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_orders_margin_alert
  ON orders(margin_alert) WHERE margin_alert = TRUE;

CREATE INDEX IF NOT EXISTS idx_orders_sourcing_blocked
  ON orders(sourcing_blocked) WHERE sourcing_blocked = TRUE;

CREATE INDEX IF NOT EXISTS idx_orders_confection_type
  ON orders(confection_type) WHERE confection_type <> 'aucun';

CREATE INDEX IF NOT EXISTS idx_customs_history_order
  ON customs_history(order_id);

CREATE INDEX IF NOT EXISTS idx_customs_history_shipment
  ON customs_history(shipment_id);

CREATE INDEX IF NOT EXISTS idx_customs_history_category
  ON customs_history(sh_category);

CREATE INDEX IF NOT EXISTS idx_customs_history_date
  ON customs_history(customs_date);

CREATE INDEX IF NOT EXISTS idx_customs_history_anomaly
  ON customs_history(is_anomaly) WHERE is_anomaly = TRUE;

CREATE INDEX IF NOT EXISTS idx_customs_history_agent
  ON customs_history(customs_agent_id) WHERE customs_agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_partners_type
  ON partners(type);

CREATE INDEX IF NOT EXISTS idx_partners_active
  ON partners(is_active) WHERE is_active = TRUE;

-- ============================================================
-- 12. TRIGGER updated_at — nouvelles tables
-- ============================================================

CREATE TRIGGER trg_partners_updated
  BEFORE UPDATE ON partners
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 13. TRIGGER marge réelle — alerte automatique
-- ============================================================
-- Déclenché à chaque UPDATE de cost_real_kmf sur orders
-- Calcule margin_real_pct, pose margin_alert et sourcing_blocked

CREATE OR REPLACE FUNCTION compute_real_margin()
RETURNS TRIGGER AS $$
BEGIN
  -- Calcul uniquement si cost_real_kmf est renseigné et total_kmf > 0
  IF NEW.cost_real_kmf IS NOT NULL AND NEW.total_kmf > 0 THEN

    NEW.margin_real_pct := ROUND(
      (NEW.total_kmf - NEW.cost_real_kmf)::NUMERIC / NEW.total_kmf * 100,
      3
    );

    NEW.cost_delta_pct := CASE
      WHEN NEW.cost_estimated_kmf IS NOT NULL AND NEW.cost_estimated_kmf > 0
      THEN ROUND(
        (NEW.cost_real_kmf::NUMERIC / NEW.cost_estimated_kmf - 1) * 100,
        3
      )
      ELSE NULL
    END;

    -- Alerte si marge réelle < 10%
    NEW.margin_alert := NEW.margin_real_pct < 10;

    -- Blocage sourcing si marge réelle négative
    NEW.sourcing_blocked := NEW.margin_real_pct < 0;

    -- Clôture comptable
    IF NEW.cost_closed_at IS NULL THEN
      NEW.cost_closed_at := NOW();
    END IF;

  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_compute_real_margin
  BEFORE UPDATE OF cost_real_kmf ON orders
  FOR EACH ROW EXECUTE FUNCTION compute_real_margin();

-- ============================================================
-- 14. TRIGGER douane — anomalie automatique
-- ============================================================
-- Marque is_anomaly = true si customs_real > 2× customs_estimated

CREATE OR REPLACE FUNCTION flag_customs_anomaly()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.customs_real_kmf IS NOT NULL
     AND NEW.customs_estimated_kmf > 0
     AND NEW.customs_real_kmf > (NEW.customs_estimated_kmf * 2)
  THEN
    NEW.is_anomaly := TRUE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_customs_anomaly
  BEFORE INSERT OR UPDATE OF customs_real_kmf ON customs_history
  FOR EACH ROW EXECUTE FUNCTION flag_customs_anomaly();

-- ============================================================
-- 15. TRIGGER scan — mise à jour statuts nouveaux
-- ============================================================
-- Extension du trigger existant sync_order_status_from_scan
-- pour couvrir les 2 nouveaux statuts

CREATE OR REPLACE FUNCTION sync_order_status_from_scan()
RETURNS TRIGGER AS $$
DECLARE
  v_order_id   UUID;
  v_new_status order_status;
BEGIN
  IF NEW.order_id IS NOT NULL THEN
    v_order_id := NEW.order_id;
  ELSE
    SELECT order_id INTO v_order_id FROM order_items WHERE id = NEW.order_item_id;
  END IF;

  -- Correspondance scan_step → order_status (7 étapes v7.1)
  v_new_status := CASE NEW.step
    WHEN 'preparation'     THEN 'preparation'::order_status
    WHEN 'hub_preparation' THEN 'preparation'::order_status  -- alias v7.1
    WHEN 'shipped'         THEN 'shipped'::order_status
    WHEN 'relais_received' THEN 'available'::order_status
    WHEN 'collected'       THEN 'collected'::order_status
    ELSE NULL
  END;

  IF v_new_status IS NOT NULL AND v_order_id IS NOT NULL THEN
    UPDATE orders SET
      status              = v_new_status,
      shipped_at          = CASE WHEN NEW.step = 'shipped'         THEN NOW() ELSE shipped_at          END,
      available_at        = CASE WHEN NEW.step = 'relais_received' THEN NOW() ELSE available_at        END,
      collected_at        = CASE WHEN NEW.step = 'collected'       THEN NOW() ELSE collected_at        END,
      transit_comores_at  = CASE WHEN NEW.step = 'relais_received' THEN NOW() ELSE transit_comores_at  END
    WHERE id = v_order_id;

    INSERT INTO order_status_history (order_id, status, scan_id, changed_by, note)
    VALUES (v_order_id, v_new_status, NEW.id, NEW.scanned_by, NEW.notes);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Le trigger existant appelle déjà cette fonction — pas besoin de le recréer.
-- La fonction est remplacée (CREATE OR REPLACE) — prise en compte immédiate.

-- ============================================================
-- 16. VUE — Résumé marge réelle par commande
-- ============================================================

CREATE OR REPLACE VIEW v_order_margins AS
SELECT
  o.id,
  o.reference,
  o.created_at::DATE                    AS order_date,
  o.total_kmf,
  o.cost_estimated_kmf,
  o.cost_real_kmf,
  o.margin_estimated_pct,
  o.margin_real_pct,
  o.cost_delta_pct,
  o.margin_alert,
  o.sourcing_blocked,
  o.status,
  o.confection_type,
  o.cost_closed_at,
  p.full_name                           AS client_name,
  r.name                                AS relais_name
FROM orders o
LEFT JOIN users     p ON p.id = o.user_id
LEFT JOIN relais    r ON r.id = o.relais_id
WHERE o.cost_real_kmf IS NOT NULL;

COMMENT ON VIEW v_order_margins IS 'Commandes avec marge réelle calculée — alimentation dashboard back-office';

-- ============================================================
-- 17. VUE — Analyse douane par catégorie (dashboard admin)
-- ============================================================

CREATE OR REPLACE VIEW v_customs_analysis AS
SELECT
  sh_category,
  product_category,
  COUNT(*)                              AS nb_passages,
  AVG(customs_delta_pct)::NUMERIC(6,2) AS avg_delta_pct,
  MAX(customs_delta_pct)::NUMERIC(6,2) AS max_delta_pct,
  COUNT(*) FILTER (WHERE is_anomaly)    AS nb_anomalies,
  -- Coefficient recommandé = 1 + (avg_delta_pct / 100) + 0.05 (marge sécurité)
  ROUND(
    1 + COALESCE(AVG(customs_delta_pct) / 100, 0.20) + 0.05,
    3
  )                                     AS recommended_coeff,
  MAX(customs_date)                     AS last_passage
FROM customs_history
WHERE customs_real_kmf IS NOT NULL
GROUP BY sh_category, product_category
ORDER BY avg_delta_pct DESC NULLS LAST;

COMMENT ON VIEW v_customs_analysis IS 'Analyse douane par catégorie SH — calcul du coefficient de risque recommandé';

-- ============================================================
-- FIN MIGRATION
-- ============================================================

COMMIT;

-- ============================================================
-- RÉSUMÉ DES CHANGEMENTS
-- ============================================================
--
-- Ordre d'exécution (dépendances FK respectées) :
--   1. ENUMs  : +purchasing, +transit_comores, +hub_preparation
--   2. TABLE partners (créée avant orders.confection_artisan_id)
--   3. TABLE orders : +9 colonnes (marge réelle, couture, timestamps)
--   4. TABLE orders : +timestamps purchasing_at, transit_comores_at
--   5. TABLE products : +customs_risk_coeff, customs_risk_updated
--   6. TABLE customs_history : nouveau
--   7. TABLE shipments : +3 colonnes douane
--   8. TABLE disputes : +confection_type
--   9. INDEX : 11 nouveaux
--  10. TRIGGERS : compute_real_margin, customs_anomaly, partners_updated, scan→status
--  11. VUES : v_order_margins, v_customs_analysis
--
-- Idempotent : safe à rejouer (IF NOT EXISTS partout)
-- ============================================================
