-- ============================================================
-- Migration 039 : pricing_benchmarks
-- Date : avril 2026
-- Version ASCII pure pour psql Windows
--
-- OBJECTIF : Catalogue de charges typiques observees dans le secteur
--            e-commerce import (Dubai-Comores), import maritime general,
--            commerce Comores-Afrique, et hub physique.
--
--            Permet a l'Atelier de composition du prix de detecter ce
--            qui manque dans la config actuelle de l'utilisateur en
--            comparant avec ces benchmarks sectoriels.
--
-- USAGE : SELECT key, label, benchmark_median FROM pricing_benchmarks
--         WHERE category = 'sourcing' AND importance = 'critical';
-- ============================================================

SET client_encoding = 'UTF8';

CREATE TABLE IF NOT EXISTS pricing_benchmarks (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,                       -- ex: 'frais_transfert_wu'
  label TEXT NOT NULL,                            -- ex: 'Frais transfert d''argent'
  emoji TEXT,
  category TEXT NOT NULL CHECK (category IN
    ('sourcing','transit','douane','hub','distribution','paiement')),
  unit TEXT NOT NULL CHECK (unit IN
    ('pct','kmf','kmf_per_kg','kmf_per_m3','aed','eur','months')),

  -- Valeurs de reference (mediane + plage)
  benchmark_median NUMERIC NOT NULL,              -- valeur typique observee
  benchmark_min NUMERIC,                          -- borne basse plage
  benchmark_max NUMERIC,                          -- borne haute plage

  -- Importance pour la pertinence du prix
  importance TEXT NOT NULL DEFAULT 'recommended' CHECK (importance IN
    ('critical', 'recommended', 'optional')),

  -- Pedagogie
  why TEXT,                                       -- pourquoi cette charge existe
  source_benchmark TEXT,                          -- d''ou vient le chiffre

  -- Contextualisation
  applies_to TEXT DEFAULT 'all',                  -- 'all', 'channel:diaspora', 'category:phones'

  display_order INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_benchmarks_category ON pricing_benchmarks(category, display_order);
CREATE INDEX IF NOT EXISTS idx_benchmarks_importance ON pricing_benchmarks(importance);

-- ===================================================================
-- SEEDING : 32 charges typiques observees dans 4 sources sectorielles
-- ===================================================================

-- ===== SOURCING (8) =====
-- Source : import wholesalers Deira/Dragon Mart + tarifs WU/Wise/MoneyGram
INSERT INTO pricing_benchmarks
(key, label, emoji, category, unit, benchmark_median, benchmark_min, benchmark_max, importance, why, source_benchmark, display_order)
VALUES
('frais_transfert_wu', 'Frais transfert d''argent', E'\U0001F4B8', 'sourcing', 'pct',
 2.5, 1.0, 4.5, 'critical',
 'Tout transfert AED <-> KMF passe par WU/Wise/MoneyGram et coute 1-5%. Si vous payez vos fournisseurs Dubai depuis Comores, ces frais s''appliquent sur 100% du sourcing.',
 'Wise tarifs 2024 + Western Union MAE/KMF', 1),

('cout_negociation_dubai', 'Cout negociation Dubai', E'\U0001F91D', 'sourcing', 'kmf',
 1000, 500, 3000, 'recommended',
 'Frais de deplacement et temps de negociation pour chaque commande significative chez les wholesalers Dragon Mart/Deira.',
 'Estimation moyenne hub Komerce', 2),

('groupage_inter_fournisseurs', 'Groupage entre fournisseurs Dubai', E'\U0001F4E6', 'sourcing', 'kmf',
 500, 200, 1500, 'recommended',
 'Quand on achete chez plusieurs fournisseurs Deira, il faut consolider physiquement les colis. Petit cout par commande.',
 'Operations import Dubai standard', 3),

('cout_echantillon', 'Echantillon test produit', E'\U0001F9EA', 'sourcing', 'pct',
 1.0, 0.5, 2.0, 'optional',
 'Pour les produits nouveaux, achat d''un echantillon a tester avant de commander en volume. Amortir sur les 1ers lots.',
 'Pratique sourcing import e-commerce', 4),

('inspection_avant_envoi', 'Inspection avant envoi', E'\U0001F50E', 'sourcing', 'kmf',
 300, 100, 800, 'optional',
 'Verification qualite par un tiers avant embarquement. Recommande pour electronique haut de gamme.',
 'Services QC Dubai (SGS, Bureau Veritas)', 5),

('emballage_renforce', 'Emballage renforce', E'\U0001F4E6', 'sourcing', 'kmf',
 200, 100, 500, 'optional',
 'Sur-emballage carton + film bulle pour produits fragiles (electronique, verre).',
 'Fournitures emballage Dubai', 6),

('agent_commission_pct', 'Commission agent sourcing', E'\U0001F454', 'sourcing', 'pct',
 5.0, 3.0, 8.0, 'recommended',
 'Si vous travaillez avec un agent local Dubai qui sourcing pour vous, sa commission tourne autour de 3-8% selon volume.',
 'Tarifs agents sourcing Dubai 2024', 7),

('frais_change_aed_eur', 'Frais change AED <-> EUR', E'\U0001F4B1', 'sourcing', 'pct',
 1.5, 0.5, 3.0, 'optional',
 'Si vous detenez des fonds en EUR mais payez en AED, le spread bancaire/exchange coute 0.5-3%.',
 'Spread bancaire UAE 2024', 8);

-- ===== TRANSIT (5) =====
-- Source : compagnies maritimes CMA-CGM, MSC + transitaires Comores
INSERT INTO pricing_benchmarks
(key, label, emoji, category, unit, benchmark_median, benchmark_min, benchmark_max, importance, why, source_benchmark, display_order)
VALUES
('surcharge_baf', 'Surcharge BAF (carburant)', E'\U000026FD', 'transit', 'pct',
 5.0, 0.0, 15.0, 'critical',
 'Bunker Adjustment Factor - surcharge variable des compagnies maritimes liee au prix du carburant. Peut atteindre 15% en periode de tension.',
 'CMA-CGM, MSC, Maersk tarifs 2024', 1),

('frais_documentaires', 'Frais documentaires (B/L, COO)', E'\U0001F4C4', 'transit', 'kmf',
 8000, 5000, 15000, 'critical',
 'Bill of Lading + Certificat d''Origine + autres documents douaniers. Cout fixe par envoi consolide (a amortir sur le nb de produits).',
 'Transitaires Comores standard', 2),

('stationnement_si_retard', 'Stationnement portuaire si retard', E'\U0001F69B', 'transit', 'kmf',
 800, 300, 2500, 'recommended',
 'Si dedouanement traine, le port de Moroni facture des frais de stationnement journaliers. A provisionner systematiquement.',
 'Port autonome de Moroni 2024', 3),

('assurance_transit', 'Assurance transit cargaison', E'\U0001F6E1', 'transit', 'pct',
 0.8, 0.3, 2.0, 'recommended',
 'Couverture optionnelle mais fortement recommandee pour produits fragiles ou de valeur (electronique, bijoux).',
 'Assureurs maritimes France/UAE', 4),

('reclassement_sh', 'Re-classification SH si erreur', E'\U0001F4DD', 'transit', 'kmf',
 500, 200, 1500, 'optional',
 'Si la classification SH initiale est rejetee par les douanes, frais de re-classification + retard.',
 'Pratique douaniere Comores', 5);

-- ===== DOUANE (4) =====
-- Source : code douanier Comores + experience transitaires
INSERT INTO pricing_benchmarks
(key, label, emoji, category, unit, benchmark_median, benchmark_min, benchmark_max, importance, why, source_benchmark, display_order)
VALUES
('forfait_dedouanement', 'Forfait dedouanement transitaire', E'\U0001F4CB', 'douane', 'kmf',
 4500, 2500, 8000, 'critical',
 'Forfait fixe par container/groupage paye au transitaire pour les operations de dedouanement.',
 'Transitaires Moroni 2024', 1),

('frais_portuaires_complets', 'Frais portuaires complets', E'\U0001F3ED', 'douane', 'kmf',
 1200, 600, 2500, 'recommended',
 'Manutention quai + magasinage 48h + securite. A ajouter au forfait dedouanement.',
 'Tarif port Moroni', 2),

('caution_si_litige', 'Caution si litige classification', E'\U0001F4B0', 'douane', 'pct',
 0.5, 0.0, 2.0, 'optional',
 'En cas de contestation tarifaire avec les douanes, caution temporaire jusqu''a resolution.',
 'Droit douanier Comores', 3),

('escroquerie_anti_corruption', 'Provision facilitation administrative', E'\U0001F575', 'douane', 'pct',
 1.0, 0.0, 5.0, 'optional',
 'Realite operationnelle - certains importateurs reportent des coups de pouce informels pour accelerer les procedures. A budgeter selon votre ethique business.',
 'Realite import Comores', 4);

-- ===== HUB (5) =====
-- Source : couts operationnels hub Dubai
INSERT INTO pricing_benchmarks
(key, label, emoji, category, unit, benchmark_median, benchmark_min, benchmark_max, importance, why, source_benchmark, display_order)
VALUES
('visas_employes_uae', 'Visas employes UAE (mensualise)', E'\U0001F6C2', 'hub', 'kmf',
 250, 100, 500, 'critical',
 'Cout par commande des visas + permis de travail des employes du hub Dubai. (Total annuel divise par volume.)',
 'Cout visas UAE 2024', 1),

('comptable_uae', 'Comptable UAE par commande', E'\U0001F4D3', 'hub', 'kmf',
 100, 50, 250, 'recommended',
 'Quote-part comptable Dubai (TVA, formalites administratives, Tax registration).',
 'Cabinets comptables Dubai 2024', 2),

('petites_fournitures', 'Cartons + ruban + etiqueteuse', E'\U0001F4E6', 'hub', 'kmf',
 75, 30, 150, 'recommended',
 'Consommables d''emballage hub - amorti par commande envoyee.',
 'Fournitures emballage UAE', 3),

('internet_telephonie_hub', 'Internet et telephonie hub', E'\U0001F4F1', 'hub', 'kmf',
 50, 20, 120, 'optional',
 'Quote-part communications du hub - amortie par commande.',
 'Etisalat/Du UAE 2024', 4),

('renouvellement_license', 'Renouvellement licence commerciale', E'\U0001F4DC', 'hub', 'kmf',
 150, 80, 400, 'recommended',
 'Renouvellement annuel de la licence commerciale UAE / DMCC / IFZA. Quote-part par commande.',
 'Licences UAE 2024', 5);

-- ===== DISTRIBUTION (4) =====
-- Source : reseau relais cash Comores + experience compensation client
INSERT INTO pricing_benchmarks
(key, label, emoji, category, unit, benchmark_median, benchmark_min, benchmark_max, importance, why, source_benchmark, display_order)
VALUES
('compensation_retard_livraison', 'Compensation retard livraison', E'\U0001F381', 'distribution', 'pct',
 0.5, 0.0, 2.0, 'recommended',
 'Geste commercial typique en cas de retard depasse. Bon d''achat ou reduction sur prochaine commande.',
 'Pratique e-commerce qualite service', 1),

('sms_notifications_supplem', 'SMS notifications supplementaires', E'\U0001F4E8', 'distribution', 'kmf',
 80, 40, 150, 'optional',
 'Au-dela des SMS standards (confirmation + livraison), relances ponctuelles si client absent au relais.',
 'Operateurs SMS Comores', 2),

('manutention_relais_volumineux', 'Manutention si produit volumineux', E'\U0001F4AA', 'distribution', 'kmf',
 300, 100, 800, 'optional',
 'Surcout relais pour produits >5kg ou volumineux (TV, electromenager) qui demandent stockage particulier.',
 'Reseau relais Komores', 3),

('frais_retour_si_invendu', 'Frais retour si produit invendu', E'\U0001F500', 'distribution', 'pct',
 0.3, 0.0, 1.0, 'optional',
 'Provision pour rapatriement hub si client ne vient jamais chercher (au-dela de la provision impayes).',
 'Operations retour Comores', 4);

-- ===== PAIEMENT (3) =====
-- Source : passerelles paiement + processeurs cartes
INSERT INTO pricing_benchmarks
(key, label, emoji, category, unit, benchmark_median, benchmark_min, benchmark_max, importance, why, source_benchmark, display_order)
VALUES
('frais_stripe_diaspora', 'Frais Stripe (diaspora EUR)', E'\U0001F4B3', 'paiement', 'pct',
 2.5, 1.4, 3.5, 'critical',
 'Frais carte de credit Stripe sur les paiements diaspora en EUR. 1.4% + 0.25 EUR par transaction (cartes EUR), 2.9% + 0.25 EUR (cartes non-EU).',
 'Stripe France pricing 2024', 1),

('frais_stripe_fixed_kmf', 'Stripe frais fixes par transaction', E'\U0001F4B5', 'paiement', 'kmf',
 150, 100, 250, 'critical',
 'Composante fixe Stripe (~0.25 EUR converti). A appliquer en sus du pourcentage.',
 'Stripe France pricing 2024', 2),

('chargeback_provision', 'Provision chargeback / impayes carte', E'\U000026A0', 'paiement', 'pct',
 0.3, 0.0, 1.5, 'optional',
 'Risque de retro-facturation par la banque cliente (Stripe charge 15 EUR par chargeback en plus de l''impaye).',
 'Stripe disputes / chargebacks', 3);

-- ===== PROVISIONS RISQUES (3) =====
-- Note : ces provisions sont au Niveau 3 mais le benchmark les recense ici
-- pour la coherence pedagogique de l'Atelier
INSERT INTO pricing_benchmarks
(key, label, emoji, category, unit, benchmark_median, benchmark_min, benchmark_max, importance, why, source_benchmark, display_order)
VALUES
('demarque_inconnue_comores', 'Demarque inconnue (vol/casse stockage)', E'\U0001F50D', 'distribution', 'pct',
 1.5, 0.5, 4.0, 'recommended',
 'Vols, casses non identifiees, erreurs d''inventaire. Niveau plus eleve que retail europeen (1-2%) compte tenu du contexte logistique.',
 'Retail Africa / Comores observations', 50),

('defaut_paiement_cash_relais', 'Defaut paiement cash relais', E'\U0001F4B5', 'distribution', 'pct',
 3.0, 1.5, 6.0, 'critical',
 'Pourcentage de commandes cash relais ou le client ne vient jamais payer/retirer. A provisionner systematiquement sur ce canal.',
 'Operations Komerce + benchmarks e-commerce Afrique', 51),

('mauvaise_dette_diaspora', 'Mauvaise dette diaspora (chargeback)', E'\U0001F4B3', 'paiement', 'pct',
 0.5, 0.1, 2.0, 'recommended',
 'Litige carte / contestation paiement diaspora. Plus rare que les defauts cash mais plus couteux par cas (15 EUR de fees Stripe par chargeback).',
 'Industry chargeback rates 2024', 52);
