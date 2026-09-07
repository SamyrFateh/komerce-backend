# Doctrine Flux, Contribution et Point d'Équilibre Komerce

> **Version** : 1.1 — 2026-09-07  
> **Statut** : doctrine canonique spécialisée du moteur économique  
> **Complète** : `DOCTRINE_CLASSIFICATION_COUTS_N1_N2_N3.md`, `DOCTRINE_PRICING_ANCRE_MARCHE_VIABILITE.md` V1.3, `DOCTRINE_MOTEUR_ECONOMIQUE_STRATEGIE.md`, `DOCTRINE_ALLOCATION_COUTS.md`, `DOCTRINE_DENSITE_VALEUR.md`  
> **Code d'application** : `services/pricing-market-decision-policy.js` (`flow_break_even`)

---

## 1. Phrase de vérité

> **Les articles vendus créent la contribution. Les commandes et les colis regroupent cette même contribution. C'est le flux réconcilié de la période qui absorbe N3.**

Komerce ne demande pas à chaque SKU de payer la structure. Le moteur mesure :

1. ce que les articles vendus coûtent réellement au niveau variable ;
2. la contribution unique qu'ils génèrent ;
3. comment cette contribution se regroupe par commande et par colis ;
4. combien le flux cumulé a déjà absorbé de N3 ;
5. quelle distance reste à parcourir avant l'équilibre ;
6. comment traduire cette distance en articles, commandes et colis équivalents.

Le **panier moyen** reste un indicateur commercial utile. Il n'est pas la vérité de viabilité du modèle.

---

## 2. Chaîne canonique des coûts

```text
N1 = variable opérationnel / logistique
N2 = variable business / transactionnel
N3 = structure fixe / semi-fixe de période

Coût variable complet = N1 + N2
Contribution = prix encaissé - coût variable complet

CDR = Coût de Revient complet de référence
CDR = N1 + N2 + N3 imputé
```

Conséquence fondamentale :

```text
N3 n'est pas une dette du SKU.
```

Un article peut être vendu sous son CDR de référence tout en contribuant positivement si :

```text
prix >= coût variable complet
```

La vérité de couverture se juge au niveau du marché et de la période :

```text
coverage_ratio
  = contribution réconciliée unique de période
    / N3 économique attribué au marché sur la même fenêtre
```

---

## 3. Les unités du flux ne sont pas des sources de contribution indépendantes

Komerce distingue :

| Unité | Rôle économique |
|---|---|
| **Article vendu** | origine de la contribution économique |
| **Commande** | regroupement commercial des contributions d'articles |
| **Panier** | composition commerciale de la commande |
| **Colis** | regroupement logistique des contributions d'articles + coûts logistiques attribués |
| **Shipment** | niveau de mutualisation de certains N1 |
| **Période** | unité de vérité pour N3 et la viabilité globale |

### 3.1 Contribution article

Après attribution unique des coûts variables partagés :

```text
article_contribution
  = revenu net attribué à l'article
    - N1 attribué
    - N2 attribué
```

### 3.2 Agrégation commande

```text
order_contribution
  = Σ article_contribution des articles de la commande
```

La commande ne crée pas une deuxième contribution.

### 3.3 Agrégation colis

Lorsque `parcel_items` et les allocations de coûts sont complets :

```text
parcel_contribution
  = Σ article_contribution des quantités contenues dans le colis
```

Le colis ne crée pas une troisième contribution.

### 3.4 Identité anti-double-comptage

Sur la même cohorte complètement attribuée :

```text
Σ contribution articles
= Σ contribution commandes
= Σ contribution colis
= contribution de période
```

Il est strictement interdit de faire :

```text
contribution totale
= contribution articles
+ contribution commandes
+ contribution colis
```

> **Une contribution, plusieurs vues. Jamais plusieurs contributions additionnées.**

---

## 4. Forme observée du flux

Le moteur publie des ratios de lecture du **même pool de contribution** :

```text
articles / commande
articles / colis
contribution / article
contribution / commande
contribution / colis
```

Les trois contributions moyennes ne s'additionnent pas. Elles expriment la puissance économique moyenne du même flux selon trois unités opérationnelles.

Lorsque les données logistiques le permettent, poids, volume et densité de valeur complètent cette lecture.

---

## 5. Distance à l'équilibre

La première mesure est monétaire :

```text
break_even_gap_kmf
  = max(0, N3 économique de période - contribution réconciliée unique)
```

Exemple :

```text
N3 économique de période       1 000 000 KMF
Contribution réconciliée         720 000 KMF
--------------------------------------------
Distance à l'équilibre           280 000 KMF
Couverture                           72 %
```

La distance est la vérité primaire. Les nombres d'articles, commandes ou colis sont des traductions du même gap.

---

## 6. Productivité à mix réconcilié actuel

```text
contribution_moyenne_article
  = contribution réconciliée / unités article

contribution_moyenne_commande
  = contribution réconciliée / commandes matures

contribution_moyenne_colis
  = contribution réconciliée / colis
```

Exemple avec 720 000 KMF de contribution unique :

```text
514 articles  → 1 401 KMF / article
206 commandes → 3 495 KMF / commande
91 colis      → 7 912 KMF / colis
```

Ce sont trois lectures de 720 000 KMF, pas 2 160 000 KMF.

---

## 7. Seuil total et unités équivalentes restantes

### 7.1 Seuil total équivalent à 100 % de N3

```text
articles_equivalents_seuil
  = ceil(N3 / contribution_moyenne_article)

commandes_equivalentes_seuil
  = ceil(N3 / contribution_moyenne_commande)

colis_equivalents_seuil
  = ceil(N3 / contribution_moyenne_colis)
```

### 7.2 Reste équivalent à produire

```text
articles_equivalents_restants
  = ceil(gap / contribution_moyenne_article)

commandes_equivalentes_restantes
  = ceil(gap / contribution_moyenne_commande)

colis_equivalents_restants
  = ceil(gap / contribution_moyenne_colis)
```

Le mot **équivalent** est obligatoire.

Ces nombres ne sont pas trois objectifs à additionner. Ils expriment le même seuil ou le même gap dans trois unités différentes.

Formulation UI :

> **À mix réconcilié actuel, le gap restant correspond à environ X articles, Y commandes ou Z colis équivalents supplémentaires.**

---

## 8. Unités contributives observées

Le dashboard peut aussi mesurer la qualité du flux.

### Article contributif

```text
article_contribution > 0
```

### Commande contributive

```text
Σ contribution des articles de la commande > 0
```

### Colis contributif

```text
Σ contribution des quantités article du colis > 0
```

Le nombre d'unités contributives est un KPI de **qualité du flux**. Il ne doit jamais remplacer le numérateur économique total.

Le break-even est calculé sur la contribution nette de toute la cohorte, y compris l'effet des unités négatives.

Tant que l'attribution article ↔ colis et des coûts variables du colis n'est pas complète, le moteur ne doit pas fabriquer un nombre de colis contributifs ; seule la contribution moyenne par colis peut être publiée comme ratio de forme du flux.

---

## 9. Deux cibles : équilibre et sécurité

### Équilibre économique

```text
target_coverage_ratio = 1.0
```

### Cible gouvernée de sécurité

```text
coverage_threshold > 1.0
```

```text
safety_gap_kmf
  = max(0, N3 × coverage_threshold - contribution réconciliée)
```

Le seuil de sécurité est une politique versionnée et reste distinct de l'équilibre à 100 %.

---

## 10. Le mix est un levier

La projection permet de simuler :

- davantage d'articles utiles par commande ;
- meilleure densification des colis ;
- meilleur mix de catégories ;
- baisse d'un coût variable ;
- amélioration de la contribution sans prix excessif.

> **Améliorer le flux signifie mieux composer les ventes utiles au client, pas forcer un achat pour améliorer un KPI interne.**

---

## 11. Paliers de structure

```text
structure_constant_within_projection = true
current_mix_constant = true
unmodelled_capacity_step_excluded = true
```

Un palier futur connu — salarié, hub, véhicule, capacité réservée — doit entrer dans un scénario prospectif N3 séparé.

---

## 12. Réel, qualité du flux et simulation

### Réel décisionnel

- ventes `MATURE` ;
- contribution unique réconciliée ;
- N3 économique de période ;
- risque réel de période ;
- politique de couverture versionnée.

### Qualité / forme du flux

- articles ;
- commandes ;
- colis ;
- unités contributives / négatives ;
- ratios de contribution moyenne.

### Simulation

- objectifs de volume ;
- panier cible ;
- densité cible ;
- amélioration supposée de contribution ;
- futur palier N3.

---

## 13. Fail-honest

```text
coverage_status = NOT_DECISIONAL
→ aucun seuil équivalent décisionnel
```

Si la contribution moyenne nette est nulle ou négative et qu'un gap subsiste :

```text
additional_equivalent_* = null
status = CURRENT_MIX_NOT_PROJECTABLE
```

Si l'attribution colis est incomplète :

```text
contributive_parcels_count = null
contributive_parcels_ratio = null
```

---

## 14. Contrat API existant et cible

Le bloc `flow_break_even` existant expose déjà :

```text
observed_mix:
  mature_orders
  article_units
  parcels
  articles_per_order
  articles_per_parcel
  reconciled_contribution_kmf
  contribution_per_order_kmf
  contribution_per_article_kmf
  contribution_per_parcel_kmf

economic_break_even:
  target_coverage_ratio
  target_contribution_kmf
  gap_kmf
  additional_equivalent_orders
  additional_equivalent_articles
  additional_equivalent_parcels
```

Le contrat cible ajoute les seuils totaux et la qualité du flux sans créer un second numérateur :

```text
break_even_floor_articles
break_even_floor_orders
break_even_floor_parcels

contributive_article_units
contributive_orders_count
contributive_parcels_count  # seulement avec attribution complète
```

---

## 15. Phrase de contrôle

Avant de valider un calcul ou un écran :

> **Ce chiffre crée-t-il une nouvelle valeur économique, ou ne fait-il que regrouper la contribution des articles vendus ?**

Si c'est une agrégation, elle ne doit jamais être additionnée une seconde fois au total.
