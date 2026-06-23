# Komerce — Moteur Sourcing

> Créé : **2026-06-23** (lot C6)
> Fichiers de référence : `services/sourcing-analysis.js`, `services/sourcing-mutations.js`, `routes/sourcing-engine.js`
> Doctrine : invariant I-08 (pas de coefficient dur — tout depuis `business_rules`)

---

## 1. Philosophie

> "Le moteur sourcing n'achète pas à la place de l'admin. Il filtre, explique et priorise."

Le moteur ne prend aucune décision définitive. Il calcule, classe et recommande. La validation finale (importer un candidat dans le catalogue, assigner un rail, activer un produit) est toujours une **action admin explicite**.

Trois principes fondateurs :

1. **Pas de magie** — chaque décision est expliquée par une `reason` lisible.
2. **Données partielles acceptées** — le moteur fonctionne même si `cost_kmf`, `weight_kg` ou `sourcing_rail` sont absents. Il documente explicitement ce qui manque.
3. **Seuils variabilisés** — aucun coefficient dur dans le code. Tous les seuils viennent de `business_rules` en DB, avec des fallbacks défensifs (voir §4).

---

## 2. Architecture

### 2.1 Séparation lectures / mutations

| Responsabilité | Fichier |
|---|---|
| Lectures, analyse, KPIs | `services/sourcing-analysis.js` |
| Mutations produit/variants/rail | `services/sourcing-mutations.js` |
| HTTP facade (auth + dispatch) | `routes/sourcing-engine.js` |

La route ne contient aucune logique métier : authentification, validation basique, appel service, réponse.

### 2.2 Mapping endpoints → services

| Méthode + Path | Service appelé |
|---|---|
| `GET /api/admin/sourcing/analysis` | `sourcingAnalysis.getAnalysis(filters)` |
| `GET /api/admin/sourcing/analysis/:id` | `sourcingAnalysis.getAnalysisById(id)` |
| `GET /api/admin/sourcing/synthesis` | `sourcingAnalysis.getSynthesis()` |
| `PUT /api/admin/sourcing/products/:id` | `sourcingMutations.updateProduct(id, body)` |
| `POST /api/admin/sourcing/bulk-rail` | `sourcingMutations.bulkAssignRail(ids, rail)` |
| `GET /api/admin/sourcing/config` | `sourcingAnalysis.getConfig()` |
| `GET /api/admin/sourcing/products/:id/variants` | `sourcingAnalysis.getProductVariants(id)` |
| `PUT /api/admin/sourcing/products/:id/variants` | `sourcingMutations.replaceVariants(id, variants)` |

Toutes les routes : `authenticate + requireAdmin` obligatoire.

---

## 3. Pipeline d'analyse produit

`analyzeProduct(product, cfg, salesMap)` est le cœur du moteur. Il est pur (pas d'I/O) et fonctionne avec des données partielles.

```
Entrée : product (DB row), cfg (seuils), salesMap (ventes 30j)
  │
  ├── 1. Normalisation doublon coût/poids
  │      getProductCostKmf()  → cost_kmf || cost_price_kmf
  │      getProductWeightKg() → weight_kg || weight_g/1000
  │
  ├── 2. Calcul marge
  │      margin_pct = (price_kmf - cost_kmf) / price_kmf * 100
  │      (null si coût absent)
  │
  ├── 3. Inférence du rail
  │      Si sourcing_rail déclaré → rail = sourcing_rail
  │      Sinon inférence par règles :
  │        price_kmf > priceMinB → rail B (produits lourds/chers)
  │        price_kmf < priceMaxA → rail A (accessoires légers)
  │        weight > weightMaxB   → rail D (articles denses)
  │        sinon                 → rail C (milieu de gamme)
  │
  ├── 4. Score de confiance (0-100)
  │      + coût renseigné
  │      + poids renseigné
  │      + ventes > 0 les 30 derniers jours
  │      + conforme rail (marge, poids)
  │
  ├── 5. Diagnostic marge
  │      margin_pct < marginTarget[rail] → alerte marge insuffisante
  │      margin_pct == null             → alerte coût manquant
  │
  ├── 6. Diagnostic poids
  │      weight > weightMax[rail] → alerte poids hors rail
  │
  ├── 7. Statut activité
  │      is_active = false → "dead" si > deadThresholdDays sans ventes
  │      sales_30d > starThresholdSales30d → "star"
  │
  └── Sortie : { sourcing_decision, reason, action, score, computed, alerts }
```

### 3.1 Décisions sourcing possibles

| `sourcing_decision` | Condition |
|---|---|
| `buy` | Marge OK, poids OK, confiance suffisante |
| `review_price` | Marge insuffisante pour le rail |
| `review_cost` | Coût manquant — impossible d'évaluer |
| `review_weight` | Poids hors rail |
| `dead` | Produit actif mais sans vente depuis > `dead_threshold_days` |
| `star` | Ventes > `star_threshold_sales_30d` en 30j |

### 3.2 Actions recommandées

| `action` | Sens |
|---|---|
| `activate` | Produit prêt à mettre en vente |
| `bundler` | Regrouper avec un autre produit (rail A ou D, marge faible) |
| `promote` | Baisser le prix pour accélérer les ventes |
| `renegotiate` | Revoir le prix d'achat fournisseur |
| `destock` | Écouler le stock, ne pas renouveler |
| `discontinue` | Arrêter le produit |

---

## 4. Seuils et configuration (I-08)

Tous les seuils sont lus depuis `business_rules` (table DB clé/valeur, clés en MAJUSCULES). En cas d'absence, les fallbacks défensifs ci-dessous s'appliquent. Aucun coefficient n'est hardcodé dans la logique métier.

| Clé `business_rules` | Fallback | Description |
|---|---|---|
| `COST_FIXED_PER_ORDER_KMF` | 4 200 | Coût fixe par commande (logistique, hub) |
| `BREAK_EVEN_ORDER_KMF` | 14 000 | Seuil de rentabilité commande |
| `MAX_ACTIVE_PRODUCTS` | 120 | Plafond catalogue actif MVP |
| `MARGIN_TARGET_RAIL_A_PCT` | 45 | Cible marge Rail A (accessoires) |
| `MARGIN_TARGET_RAIL_B_PCT` | 18 | Cible marge Rail B (gros/chers) |
| `MARGIN_TARGET_RAIL_C_PCT` | 35 | Cible marge Rail C (milieu gamme) |
| `MARGIN_TARGET_RAIL_D_PCT` | 70 | Cible marge Rail D (dense/petit) |
| `PRICE_MAX_RAIL_A_KMF` | 10 000 | Prix max Rail A |
| `PRICE_MIN_RAIL_B_KMF` | 30 000 | Prix min Rail B |
| `PRICE_MIN_RAIL_C_KMF` | 20 000 | Prix min Rail C |
| `PRICE_MAX_RAIL_D_KMF` | 5 000 | Prix max Rail D |
| `WEIGHT_MAX_RAIL_A_G` | 500 g | Poids max Rail A |
| `WEIGHT_MAX_RAIL_B_G` | 5 000 g | Poids max Rail B |
| `WEIGHT_MAX_RAIL_D_G` | 200 g | Poids max Rail D |
| `CATALOG_CAP_MVP` | 120 | Plafond catalogue (même que MAX_ACTIVE_PRODUCTS) |
| `DEAD_THRESHOLD_DAYS` | 30 | Jours sans vente → produit "mort" |
| `STAR_THRESHOLD_SALES_30D` | 3 | Ventes min 30j → produit "star" |

Pour modifier un seuil en production : `UPDATE business_rules SET value = '...' WHERE key = 'MARGIN_TARGET_RAIL_A_PCT'`. Pas de redéploiement requis.

---

## 5. Rails sourcing

Les 4 rails classent les produits par profil logistique + prix.

| Rail | Profil | Prix cible | Poids max | Marge cible |
|---|---|---|---|---|
| **A** | Accessoires légers, petits | < 10 000 KMF | 500 g | 45 % |
| **B** | Produits lourds ou chers | > 30 000 KMF | 5 000 g | 18 % |
| **C** | Milieu de gamme | > 20 000 KMF | — | 35 % |
| **D** | Articles denses/petits, à marges très élevées | < 5 000 KMF | 200 g | 70 % |

Le rail peut être **déclaré** (admin l'a assigné via l'UI) ou **inféré** automatiquement par le moteur. L'inférence est documentée dans le champ `rail_source` (`'declared'` ou `'inferred'`).

**Champs autorisés en mutation** (`PUT /products/:id`) :

```
sourcing_rail, cost_price_kmf, weight_g, volume_class, fragility,
sale_mode, exposure_mode, lifecycle_status, quality_validated,
real_weight_known, real_price_validated, delivery_delay_days, supplier_notes
```

La mutation synchronise automatiquement les colonnes en doublon (`cost_kmf ↔ cost_price_kmf`, `weight_kg ↔ weight_g`) — dette documentée Lot C5.

---

## 6. Synthèse portefeuille (`getSynthesis`)

Retourne les KPIs globaux du catalogue :

| KPI | Description |
|---|---|
| `total_products` | Produits actifs analysés |
| `by_rail` | Répartition par rail (A/B/C/D/non assigné) |
| `by_decision` | Répartition buy / review_price / review_cost / dead / star |
| `avg_margin_pct` | Marge moyenne pondérée |
| `no_cost_count` | Produits sans coût renseigné |
| `no_rail_count` | Produits sans rail assigné (rail inféré) |
| `alerts` | Liste des alertes portefeuille (marge basse, coût manquant, hors rail) |

---

## 7. Invariants protégés

| # | Invariant |
|---|---|
| I-08 | Aucun coefficient dur dans le code — tout seuil vient de `business_rules` |
| I-COST | Tout produit actif sans `cost_kmf` ni `cost_price_kmf` → alerte explicite, décision `review_cost` |
| I-RAIL | Un rail invalide (hors A/B/C/D) ne peut pas être posé via l'API (`VALID_RAILS` whitelist) |
| I-MUTATION | Les mutations ne modifient jamais `price_kmf` ni `is_active` directement — seul l'admin passe par la route admin produit |
| I-IMPORT | Aucun `sourcing_candidate` ne devient `product` sans `state = 'imported_to_catalog'` ET action admin explicite |

---

## 8. Dettes actives (à résoudre en Lot C5 et C7)

| Dette | Description | Lot |
|---|---|---|
| Doublon `cost_kmf / cost_price_kmf` | Deux colonnes, même sémantique. Source de vérité : `cost_kmf`. Migration à écrire. | C5 |
| Doublon `weight_kg / weight_g` | Deux colonnes, même sémantique. Source de vérité : `weight_kg`. Migration à écrire. | C5 |
| `sourcing_rail` sans CHECK DB | Validé uniquement dans le code. Risque : valeur invalide via migration directe. | C7 |
| `partners.partner_type` texte libre | 6 valeurs connues, pas de CHECK DB. | C7 |

---

## 9. Évolutions prévues

| Vague | Contenu |
|---|---|
| **C5** | Normalisation colonnes dupliquées (migration + code) |
| **C7** | Script de garde-fou `scripts/audit-sourcing.js` |
| **Vague future** | Scoring ML (ventes historiques, saisonnalité) |
| **Vague future** | Connecteur Noon activé (si accès partenaire obtenu) |
| **Vague future** | Allocation marge automatique par rail selon performance réelle |
| **Vague future** | Intelligence portefeuille (complémentarité produits, couverture catégories) |
