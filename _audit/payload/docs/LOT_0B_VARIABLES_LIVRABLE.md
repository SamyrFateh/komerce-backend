# LOT 0B — Inventaire des variables

Réf. doctrine : `DOCTRINE_ADMIN_DASHBOARDS.md` §I-4 (« une variable = une vérité », `CONSUMED_BY` obligatoire) et §VII-3 (le gabarit remplit `source_aggregator`/`nature` depuis cet inventaire).

Source factuelle : extracteur reproductible `tools/variables-inventory/inventory.js` — parse les en-têtes `@komerce-arch` (`@db-read`/`@db-write`/`@role`) de `services/` + `routes/` (259 modules instrumentés). Les colonnes **CONSUMED_BY / EDIT_IN / fantôme** sont générées ; le **type / owner / verdict** sont du jugement (ci-dessous).

## A. Matrice des tables de variables (généré + verdicts)

| Table | CONSUMED_BY (moteurs réels) | EDIT_IN | Fantôme ? | Verdict |
|---|---|---|---|---|
| `finance_config` | 13 (pricing-cdr, pricing-recommend, cost-allocation, finance-metrics, pricing-dashboard, pricing-strategy, radar, loyalty…) | pricing-rates, admin-costing, admin-finance-config | non | **KEEP** — source runtime principale (ADR-009) |
| `customs_categories` | 5 (customs-classification, pricing-cdr, pricing-recommend, pricing-dashboard, pricing-strategy) | admin-customs-categories | non | **KEEP** — autorité douane DEDICATED (I-5) |
| `risk_provisions` | 4 (pricing-cdr, pricing-recommend, pricing-dashboard, pricing-strategy) | admin-risk-provisions | non | **KEEP** — autorité risque DEDICATED (I-5) |
| `cost_components` | **1** (pricing-cdr) | admin-cost-components | non | **KEEP (cible)** — mais quasi inutilisée : voir finding ①. Autorité coûts OWNED (I-5) |
| `charges` | 5 (economic-engine, pricing-cdr, pricing-recommend, pricing-dashboard, pricing-strategy) | economic-engine-queries | non | **KEEP** — charges fixes (N3) |
| `business_rules` | 3 (catalog-product-detail, hub-operations, sourcing-analysis) | admin-rules | non | **KEEP** — ⚠️ vérifier finding ③ (rails transport / W/M) |
| `economic_variables` | **1** (economic-engine-queries, = son écrivain) | economic-engine-queries | non | **GELER après migration `redistribute`** (plan 1A) — gardée pour redistribute |
| `pricing_components` | 4 (pricing-cdr, pricing-recommend, pricing-dashboard, pricing-strategy) | admin-pricing-components | non | **LEGACY fallback** — retrait LOT 11 seulement après `cost_components` complet. Voir finding ① |
| `pricing_category_taxes` | **0** | admin-pricing-matrices | ⚠️ **PHANTOM** | **DELETE** (1A silencieux) — archiver `pricing_matrices_audit` |
| `pricing_category_dims` | **0** | admin-pricing-matrices | ⚠️ **PHANTOM** | **DELETE** (1A silencieux) |

## Findings

**① Le remplaçant est moins consommé que le legacy.** `cost_components` (cible) = **1** moteur ; `pricing_components` (legacy) = **4**. La migration ADR-011 est à mi-chemin : le fallback legacy fait encore le gros du travail. → la purge `pricing_components` (LOT 11) est loin ; ne rien y toucher avant que `cost_components` prouve sa complétude (LOT 8).

**② Deux éditeurs fantômes confirmés.** `pricing_category_taxes` et `pricing_category_dims` sont écrits par `admin-pricing-matrices.js` et lus par **personne** (seul l'éditeur relit ses écritures). Suppression sûre en LOT 1A silencieux — aucun moteur ne les consomme, donc `Golden CDR BEFORE == AFTER` garanti.

**③ À vérifier — chemin W/M transport.** `business_rules` (où vivent les diviseurs W/M par rail, cf. ADR-013) n'est **pas** listé comme lu par un module transport dans les en-têtes. Soit `transport-pricing`/`transport-rails` lisent via un chemin sans `@db-read` déclaré, soit la config rail vit ailleurs (tables migration 118). À confirmer avant 1B.

## B. Variables scalaires de `finance_config` (typage proposé)

Chaque colonne = une variable. `EDIT_IN` = admin-finance-config (sauf mention). À valider ensemble.

| Variable | Type (I-4) | Note |
|---|---|---|
| `fret_eur_per_m3` | COST | ⚠️ **DEDICATED → transport-rails** (ADR-013) — devient fallback à retirer |
| `frais_stripe_pct`, `frais_stripe_fixed_kmf` | COST | paiement |
| `commission_relais_standard_kmf`, `commission_relais_showroom_kmf` | COST | relais — ⚠️ désambiguïser (doctrine : 3 champs commission → 1 règle de priorité) |
| `transitaire_pct`, `transitaire_fixed_kmf`, `portuaires_kmf` | COST | transit / port |
| `commission_agent_pct` | COST | agent |
| `hub_monthly_cost_aed` | COST | hub (mensuel → charge fixe N3) |
| `taux_aed_kmf`, `taux_change_eur_kmf` | POLICY | taux de change de référence, fixés admin (candidat MEASURE si branché sur un flux marché) |
| `target_marge_brute_pct` | OBJECTIVE | marge cible |
| `objectif_commandes_mois` | OBJECTIVE | volume cible (sert à l'allocation N3) |
| `avg_articles_per_order`, `avg_articles_per_parcel`, `avg_articles_per_shipment` | ASSUMPTION | ⚠️ non calibrées — warnings CDR ; trajectoire → MEASURED CALIBRATION |
| `sante_seuil_atrisk_ltv_kmf`, `sante_seuil_vip_kmf`, `sante_seuil_cash_retard_pct`, `sante_seuil_pipeline_block_pct` | POLICY | **seuils d'alerte Pilotage/Santé** → alimentent l'AlertPanel du gabarit (VII) |
| `allocation_confidence`, `allocation_calibrated_at` | META | état de calibration, pas une variable métier |

## Décisions résiduelles (jugement)

1. Confirmer le type des taux de change (POLICY admin vs MEASURE marché).
2. `commission_relais_*` : figer la règle de priorité unique (standard vs showroom) avant 1A.
3. Finding ③ : tracer le chemin de lecture réel des diviseurs W/M transport.
4. `pricing_components` vs `cost_components` : plan de bascule des 4 consommateurs (hors périmètre 0B, prépare LOT 8).

## Reproductibilité

```bash
node tools/variables-inventory/inventory.js            # matrice markdown
node tools/variables-inventory/inventory.js --json     # sortie machine
```

Idée de gate CI (optionnelle) : `--json` + assertion « nombre de fantômes ne doit pas augmenter » → toute PR réintroduisant un éditeur de table morte échoue.
