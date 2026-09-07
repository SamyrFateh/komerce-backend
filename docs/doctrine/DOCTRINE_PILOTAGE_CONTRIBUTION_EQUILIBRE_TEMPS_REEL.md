# Doctrine canonique — Pilotage temps réel de la contribution et de l'équilibre

> **Version** : 1.1 — 2026-09-07  
> **Statut** : canonique / spécialisé  
> **Objet** : fixer les indicateurs de contribution, de couverture et de point d'équilibre à suivre dans l'Atelier économique Komerce, avec une source unique de contribution et une règle anti-double-comptage.  
> **Complète** : `DOCTRINE_CLASSIFICATION_COUTS_N1_N2_N3.md`, `DOCTRINE_FLUX_CONTRIBUTION_POINT_EQUILIBRE.md`, `DOCTRINE_PRICING_ANCRE_MARCHE_VIABILITE.md`.

---

## 1. Phrase de vérité

> **Ce qui crée la contribution est l'article vendu. La commande et le colis ne créent pas une contribution supplémentaire : ils regroupent la même contribution pour la rendre pilotable.**

Puis :

> **Komerce pilote la vitesse à laquelle la contribution unique du flux d'articles vendus absorbe N3.**

Le tableau de bord économique doit répondre en permanence à cinq questions :

1. combien les articles vendus ont-ils contribué sur la période ?
2. comment cette contribution se regroupe-t-elle par commande et par colis ?
3. quelle part de N3 est déjà absorbée ?
4. quelle distance monétaire reste-t-il avant l'équilibre ?
5. à mix réconcilié actuel, combien d'articles, commandes ou colis **équivalents** correspondent au seuil total et au reste à produire ?

---

## 2. Rappels intangibles

```text
N1 = variable opérationnel / logistique
N2 = variable business / transactionnel
N3 = structure fixe / semi-fixe de période

Coût variable complet = N1 + N2
Contribution = Prix encaissé - (N1 + N2)

CDR = Coût de Revient complet de référence
CDR = N1 + N2 + N3 imputé
```

N3 réel n'est pas une dette du SKU : il est absorbé par la contribution cumulée du flux sur la période.

---

## 3. Source unique de contribution — règle anti-double-comptage

### 3.1 L'article vendu est l'origine économique

L'unité économique primitive est l'**article vendu** — plus précisément la quantité vendue d'une ligne de commande.

Pour une unité ou ligne vendue :

```text
article_contribution_kmf
  = article_net_revenue_kmf
    - article_attributed_n1_kmf
    - article_attributed_n2_kmf
```

Les coûts variables engagés à un niveau partagé — commande, colis ou shipment — sont attribués **une seule fois** selon leur règle canonique avant agrégation.

Exemples :

```text
frais paiement de commande → répartis une fois sur les articles concernés
frais colis                → répartis une fois sur les articles du colis
fret shipment              → réparti une fois selon la règle logistique canonique
```

### 3.2 Commande et colis sont des vues d'agrégation

```text
order_contribution_kmf
  = Σ article_contribution_kmf des articles de la commande

parcel_contribution_kmf
  = Σ article_contribution_kmf des quantités attribuées au colis

period_contribution_kmf
  = Σ article_contribution_kmf de la cohorte mature de période
```

Lorsque l'attribution article ↔ colis est complète sur la même cohorte :

```text
Σ contribution articles
= Σ contribution commandes
= Σ contribution colis
= contribution de période
```

Ces quatre expressions sont **la même valeur économique regroupée différemment**.

### 3.3 Interdiction absolue

Il est interdit de calculer :

```text
contribution_totale
= contribution_articles
+ contribution_commandes
+ contribution_colis
```

Cela compterait plusieurs fois la même valeur.

Règle canonique :

> **Une contribution, plusieurs vues. Jamais plusieurs contributions additionnées.**

---

## 4. Vérité primaire : contribution, N3, couverture, gap

### 4.1 Contribution réconciliée de période

```text
period_contribution_kmf
  = Σ article_contribution_kmf réconciliées
```

Le backend peut techniquement obtenir cette identité par agrégation de commandes et d'allocations réconciliées ; le contrat métier reste qu'il s'agit d'un **pool unique de contribution provenant des articles vendus**.

### 4.2 N3 réel de période

```text
period_n3_kmf
  = coûts de structure reconnus et attribués au marché sur la même fenêtre
```

### 4.3 Couverture de N3

```text
coverage_ratio
  = period_contribution_kmf / period_n3_kmf
```

Lecture :

```text
< 100 %  → structure non couverte
= 100 %  → équilibre économique
> 100 %  → structure couverte, résultat positif de période
```

### 4.4 Distance monétaire à l'équilibre

```text
break_even_gap_kmf
  = max(0, period_n3_kmf - period_contribution_kmf)
```

Le gap monétaire est la vérité primaire. Les nombres d'articles, commandes ou colis sont des traductions opérationnelles de ce même gap.

---

## 5. Productivité observée du flux

Les ratios sont calculés sur la **même cohorte mature et réconciliée** :

```text
contribution_per_article_kmf
  = period_contribution_kmf / article_units

contribution_per_order_kmf
  = period_contribution_kmf / mature_orders

contribution_per_parcel_kmf
  = period_contribution_kmf / parcels
```

Ils ne s'additionnent pas.

Ils répondent à trois questions différentes :

- combien de contribution le mix génère en moyenne par article vendu ?
- combien la composition moyenne d'une commande représente-t-elle de contribution ?
- combien la densité moyenne d'un colis représente-t-elle de contribution ?

Le dashboard publie également :

```text
articles_per_order
articles_per_parcel
```

pour rendre le mix explicite.

---

## 6. Qualité réelle du flux : unités contributives

Le nombre d'unités contributives est un **KPI de qualité**, pas une nouvelle contribution.

### Article contributif

```text
article_contribution_kmf > 0
```

KPI :

```text
contributive_article_units
contributive_article_ratio
negative_article_units
negative_article_ratio
```

### Commande contributive

Une commande est contributive si la somme des contributions de ses articles, après attribution unique des coûts variables de commande, est positive :

```text
order_contribution_kmf > 0
```

KPI :

```text
contributive_orders_count
contributive_orders_ratio
negative_orders_count
negative_orders_ratio
```

### Colis contributif

Un colis est contributif si la somme des contributions des quantités d'articles qu'il contient, après attribution canonique des coûts variables du colis, est positive :

```text
parcel_contribution_kmf > 0
```

KPI seulement si l'attribution `parcel_items` et les coûts variables correspondants sont complets :

```text
contributive_parcels_count
contributive_parcels_ratio
negative_parcels_count
negative_parcels_ratio
```

Tant que cette vérité n'est pas complète, l'UI peut afficher `contribution_per_parcel_kmf` comme ratio de forme du flux mais ne doit pas inventer un nombre de colis contributifs.

### Invariant de prudence

Le break-even utilise la **contribution nette de tout le flux**, donc aussi l'effet des articles, commandes ou colis négatifs.

Il est interdit de calculer le point d'équilibre uniquement à partir des unités positives : cela gonflerait artificiellement la productivité économique.

---

## 7. Deux mesures d'équilibre : seuil total et reste à produire

Pour chaque unité opérationnelle, l'Atelier affiche deux lectures.

### 7.1 Seuil total équivalent d'équilibre

> « Au mix actuel, combien d'unités équivalentes correspondent à 100 % de N3 ? »

```text
break_even_floor_articles
  = ceil(period_n3_kmf / contribution_per_article_kmf)

break_even_floor_orders
  = ceil(period_n3_kmf / contribution_per_order_kmf)

break_even_floor_parcels
  = ceil(period_n3_kmf / contribution_per_parcel_kmf)
```

### 7.2 Reste équivalent à produire

> « Compte tenu de la contribution déjà acquise, combien d'unités équivalentes supplémentaires correspondent au gap restant ? »

```text
additional_equivalent_articles
  = ceil(break_even_gap_kmf / contribution_per_article_kmf)

additional_equivalent_orders
  = ceil(break_even_gap_kmf / contribution_per_order_kmf)

additional_equivalent_parcels
  = ceil(break_even_gap_kmf / contribution_per_parcel_kmf)
```

Le mot **équivalent** et la mention **à mix actuel** sont obligatoires.

Ces valeurs ne sont pas des quotas indépendants :

```text
200 articles
81 commandes
36 colis
```

peuvent être trois expressions du **même gap**. On ne doit donc jamais demander simultanément `200 + 81 + 36` unités comme trois objectifs cumulés.

---

## 8. Exemple canonique anti-double-comptage

Supposons :

```text
N3 période                         1 000 000 KMF
Contribution unique du flux         720 000 KMF
Couverture                               72 %
Gap                                   280 000 KMF

Articles                                 514
Commandes                                206
Colis                                     91
```

Le même pool de 720 000 KMF est lu ainsi :

```text
720 000 / 514 = 1 401 KMF / article
720 000 / 206 = 3 495 KMF / commande
720 000 /  91 = 7 912 KMF / colis
```

On n'a pas :

```text
720 000 + 720 000 + 720 000
```

On a **720 000 KMF une seule fois**, observés sous trois angles.

À mix actuel :

```text
Seuil total équivalent :
≈ 714 articles
≈ 287 commandes
≈ 127 colis

Reste équivalent :
≈ 200 articles
≈ 81 commandes
≈ 36 colis
```

---

## 9. KPI canoniques de l'Atelier

### Bloc A — État économique

| KPI | Formule | Rôle |
|---|---|---|
| Contribution cumulée unique | `Σ article_contribution` | pool de valeur après variable |
| N3 période | `Σ structure reconnue` | structure à absorber |
| Couverture N3 | `contribution / N3` | progression vers l'équilibre |
| Gap équilibre | `max(0, N3 - contribution)` | distance restante |
| Résultat période | `contribution - N3` | surplus / déficit |

### Bloc B — Productivité du même pool de contribution

| KPI | Formule |
|---|---|
| Contribution / article | `contribution / articles` |
| Contribution / commande | `contribution / commandes` |
| Contribution / colis | `contribution / colis` |
| Articles / commande | `articles / commandes` |
| Articles / colis | `articles / colis` |

### Bloc C — Qualité du flux

- articles contributifs / négatifs ;
- commandes contributives / négatives ;
- colis contributifs / négatifs lorsque l'attribution est décisionnelle ;
- ratios contributifs correspondants.

### Bloc D — Équilibre à mix actuel

- seuil total équivalent articles / commandes / colis ;
- reste équivalent articles / commandes / colis ;
- couverture actuelle ;
- gap monétaire.

---

## 10. Temps réel ne veut pas dire double comptage ni vérité provisoire

Le dashboard se rafraîchit dès qu'une nouvelle vérité réconciliée est disponible.

La vue décisionnelle reste fondée sur :

- ventes matures ;
- revenus réconciliés ;
- N1 et N2 attribués une seule fois ;
- N3 reconnu sur la même période ;
- politique marché active.

Une vue opérationnelle peut montrer des données non matures sous statut `PROVISIONAL`, sans les ajouter au numérateur décisionnel.

L'UI doit publier :

```text
economic_truth_status
last_reconciled_at
window_from
window_to
```

---

## 11. Cible économique et cible de sécurité

```text
Équilibre économique = 100 % de N3
Cible de sécurité = policy.coverage_threshold
```

```text
safety_target_contribution
  = N3 × coverage_threshold

safety_gap
  = max(0, safety_target_contribution - period_contribution_kmf)
```

Les mêmes traductions équivalentes peuvent être affichées pour la cible de sécurité, clairement séparées de l'équilibre à 100 %.

---

## 12. Paliers N3

Les seuils sont valides dans le palier de structure actuel :

```text
structure_constant_within_projection = true
current_mix_constant = true
unmodelled_capacity_step_excluded = true
```

Un nouveau salarié, hub, véhicule ou autre capacité fixe crée un nouveau scénario N3. Le seuil courant ne doit pas être extrapolé silencieusement au-delà de ce palier.

---

## 13. Contrat UI

Lecture cible en moins de dix secondes :

```text
ÉQUILIBRE ÉCONOMIQUE

Contribution unique du flux      720 000 KMF
N3 de période                   1 000 000 KMF
Couverture                            72 %
Reste à absorber                  280 000 KMF

MÊME CONTRIBUTION, 3 VUES
1 401 KMF / article
3 495 KMF / commande
7 912 KMF / colis

SEUIL TOTAL À MIX ACTUEL
≈ 714 articles équivalents
≈ 287 commandes équivalentes
≈ 127 colis équivalents

RESTE À PRODUIRE À MIX ACTUEL
≈ 200 articles équivalents
≈ 81 commandes équivalentes
≈ 36 colis équivalents
```

Phrase permanente :

> **Les articles créent la contribution. Commandes et colis la regroupent. Le flux absorbe N3.**

---

## 14. Contrat API cible

Le backend reste la source unique. Le navigateur ne recalcule pas la contribution.

```text
flow_break_even:
  status
  basis = CURRENT_RECONCILED_MIX

  economic_state:
    period_contribution_kmf
    period_n3_kmf
    coverage_ratio
    break_even_gap_kmf
    period_result_kmf

  observed_mix:
    mature_orders
    article_units
    parcels
    articles_per_order
    articles_per_parcel
    contribution_per_article_kmf
    contribution_per_order_kmf
    contribution_per_parcel_kmf

  flow_quality:
    contributive_article_units
    contributive_article_ratio
    contributive_orders_count
    contributive_orders_ratio
    contributive_parcels_count   # uniquement si attribution complète
    contributive_parcels_ratio   # uniquement si attribution complète

  economic_break_even:
    target_coverage_ratio = 1
    break_even_floor_articles
    break_even_floor_orders
    break_even_floor_parcels
    additional_equivalent_articles
    additional_equivalent_orders
    additional_equivalent_parcels
```

Aucun champ de contribution commande ou colis ne doit être ajouté au numérateur de période : ce sont des agrégations du même pool.

---

## 15. Fail-honest

Si la productivité nette du flux est nulle ou négative et qu'un gap subsiste :

```text
break_even_floor_* = null
additional_equivalent_* = null
status = CURRENT_MIX_NOT_PROJECTABLE
```

Si l'attribution article ↔ colis est incomplète, la contribution propre par colis et le nombre de colis contributifs restent `null` / `NOT_DECISIONAL`.

---

## 16. Phrase de contrôle

Avant de publier ou additionner un KPI :

> **Est-ce une nouvelle valeur économique, ou seulement une autre agrégation de la même contribution des articles vendus ?**

Si c'est une autre agrégation, elle ne doit jamais être ajoutée au total.
