-- @migration 217_invoices_finance_config_kmf_numeric.sql
-- @domain    documents, finance
-- @purpose   Chantier currency debt (audit 09-2026), LOT 4 — 20 colonnes
--            monétaires integer, 2 tables :
--
--              invoices.subtotal_kmf, shipping_kmf, total_kmf
--
--              finance_config : 17 colonnes. 7 ajoutées par migration
--              (frais_stripe_fixed_kmf, commission_relais_standard_kmf,
--              commission_relais_showroom_kmf, transitaire_fixed_kmf,
--              portuaires_kmf, sante_seuil_vip_kmf,
--              sante_seuil_atrisk_ltv_kmf — migration 036) + 10 créées dans
--              bootstrap/startup-migrations.js (CREATE TABLE IF NOT EXISTS,
--              hors dossier migrations/) : cost_fixed_sourcing_kmf,
--              cost_fixed_transit_kmf, cost_fixed_hub_kmf,
--              cost_fixed_relais_kmf, cost_fixed_support_kmf,
--              target_panier_moyen_kmf, objectif_ca_mensuel_kmf,
--              frais_livraison_defaut_kmf, seuil_livraison_gratuite_kmf,
--              loyalty_threshold_kmf.
--
--            Ces 10 dernières étaient absentes d'une première passe
--            d'audit basée sur `grep migrations/*.sql` : finance_config est
--            en partie créée par du SQL embarqué dans un script JS de
--            bootstrap, pas seulement par des fichiers migrations/NNN_*.sql
--            numérotés. Portée confirmée par recoupement direct avec le
--            dump de schéma vivant (docs/db/railway-live-schema.sql), pas
--            seulement par lecture des fichiers migrations/.
--
--            Précision numeric(14,2), cohérente avec orders/products/
--            wallet-cash (LOTs 1a/1b/2/3 de ce même chantier).
--
--            Aucun trigger, aucune vue ne dépend de ces colonnes (vérifié
--            par lecture du dépôt et par grep exhaustif sur
--            "CREATE VIEW"/"TRIGGER" à travers migrations/routes/services ;
--            le seul trigger présent sur finance_config,
--            trg_customs_categories_updated, porte sur customs_categories,
--            table distincte). Aucune boucle de soustraction/addition
--            répétée trouvée sur ces colonnes (contrairement au risque
--            propre au LOT 3 wallet) :
--              - invoices : snapshot figé à l'émission
--                (services/invoice-service.js — const total = order.total_kmf,
--                shipping_kmf toujours 0, jamais recalculé après coup —
--                doctrine facture immuable) ;
--              - finance_config : valeurs de configuration singleton, lues
--                en fallback ponctuel ou additionnées une seule fois sur une
--                poignée de champs fixes (routes/admin-finance-config.js,
--                total des coûts fixes), jamais accumulées en boucle.
--            Lot donc structurellement plus proche de LOT 2 (products) que
--            de LOT 3 (wallet) : conversion de type directe, pas de piège
--            arithmétique caché identifié.
--
--            Correctif applicatif nécessaire (hors SQL, dans ce même lot) :
--            routes/admin-finance-config.js validait 10 de ces 17 colonnes
--            en type: 'int' (Number.isInteger, rejette tout décimal) — sans
--            correction, l'API admin aurait continué à refuser les centimes
--            que cette migration vient justement de permettre en base.
--            Passé en type: 'decimal'. Les 7 autres colonnes ne sont pas
--            concernées : 2 sont retirées de l'admin (RETIRED_RELAY_
--            COMMISSION_FIELDS) et 5 ne sont pas exposées dans FIELD_SCHEMA.
--
--            Hors scope, volontairement non touché : invoices.items_snapshot
--            (JSONB, valeurs unitaires internes au JSON, pas des colonnes
--            typées) et les colonnes finance_config déjà NUMERIC
--            (pourcentages/taux, pas des montants KMF entiers).

ALTER TABLE invoices
  ALTER COLUMN subtotal_kmf TYPE NUMERIC(14,2),
  ALTER COLUMN shipping_kmf TYPE NUMERIC(14,2),
  ALTER COLUMN total_kmf    TYPE NUMERIC(14,2);

ALTER TABLE finance_config
  ALTER COLUMN cost_fixed_sourcing_kmf         TYPE NUMERIC(14,2),
  ALTER COLUMN cost_fixed_transit_kmf          TYPE NUMERIC(14,2),
  ALTER COLUMN cost_fixed_hub_kmf              TYPE NUMERIC(14,2),
  ALTER COLUMN cost_fixed_relais_kmf           TYPE NUMERIC(14,2),
  ALTER COLUMN cost_fixed_support_kmf          TYPE NUMERIC(14,2),
  ALTER COLUMN target_panier_moyen_kmf         TYPE NUMERIC(14,2),
  ALTER COLUMN objectif_ca_mensuel_kmf         TYPE NUMERIC(14,2),
  ALTER COLUMN frais_livraison_defaut_kmf      TYPE NUMERIC(14,2),
  ALTER COLUMN seuil_livraison_gratuite_kmf    TYPE NUMERIC(14,2),
  ALTER COLUMN loyalty_threshold_kmf           TYPE NUMERIC(14,2),
  ALTER COLUMN frais_stripe_fixed_kmf          TYPE NUMERIC(14,2),
  ALTER COLUMN commission_relais_standard_kmf  TYPE NUMERIC(14,2),
  ALTER COLUMN commission_relais_showroom_kmf  TYPE NUMERIC(14,2),
  ALTER COLUMN transitaire_fixed_kmf           TYPE NUMERIC(14,2),
  ALTER COLUMN portuaires_kmf                  TYPE NUMERIC(14,2),
  ALTER COLUMN sante_seuil_vip_kmf             TYPE NUMERIC(14,2),
  ALTER COLUMN sante_seuil_atrisk_ltv_kmf      TYPE NUMERIC(14,2);
