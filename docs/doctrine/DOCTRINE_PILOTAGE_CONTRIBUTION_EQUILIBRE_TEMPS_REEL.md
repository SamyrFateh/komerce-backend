# Doctrine canonique — Pilotage temps réel de la contribution et de l'équilibre

> **Version** : 1.0 — 2026-09-07  
> **Statut** : canonique / spécialisé  
> **Objet** : fixer les indicateurs de contribution, de couverture et de point d'équilibre à suivre dans l'Atelier économique Komerce.  
> **Complète** : `DOCTRINE_CLASSIFICATION_COUTS_N1_N2_N3.md`, `DOCTRINE_FLUX_CONTRIBUTION_POINT_EQUILIBRE.md`, `DOCTRINE_PRICING_ANCRE_MARCHE_VIABILITE.md`.

---

## 1. Phrase de vérité

> **Komerce ne pilote pas seulement le prix : Komerce pilote la vitesse à laquelle le flux de ventes absorbe N3.**

Le tableau de bord économique doit répondre en permanence à quatre questions :

1. combien le flux a-t-il déjà contribué ?
2. quelle part de N3 est déjà absorbée ?
3. quelle distance monétaire reste-t-il avant l'équilibre ?
4. à mix réconcilié actuel, combien d'articles, de commandes ou de colis équivalents reste-t-il à produire pour atteindre cet équilibre ?

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

N3 réel n'est pas une dette du SKU : il est absorbé par la somme des contributions du flux sur la période.

---

## 3. La vérité primaire : contribution, N3, couverture, gap

### 3.1 Contribution réconciliée de période

```text
period_contribution_kmf
  = Σ contributions réconciliées des ventes matures de la fenêtre
```

C'est le numérateur principal du pilotage économique.

### 3.2 N3 réel de période

```text
period_n3_kmf
  = coûts de structure reconnus et attribués au marché sur la même fenêtre
```

C'est la cible économique à absorber.

### 3.3 Couverture de N3

```text
coverage_ratio
  = period_contribution_kmf / period_n3_kmf
```

Lecture :

```text
coverage_ratio < 1   → structure non couverte
coverage_ratio = 1   → équilibre économique
coverage_ratio > 1   → structure couverte et résultat positif de période
```

L'UI affiche simultanément le ratio et le pourcentage : `0,72` et `72 %` représentent la même vérité.

### 3.4 Distance monétaire à l'équilibre

```text
break_even_gap_kmf
  = max(0, period_n3_kmf - period_contribution_kmf)
```

Cette distance monétaire est la vérité primaire. Les nombres d'articles, commandes et colis sont des traductions de ce gap.

---

## 4. Forme observée du flux

Le moteur calcule les productivités économiques sur la **même cohorte mature et réconciliée** que la couverture.

```text
contribution_per_order_kmf
  = period_contribution_kmf / mature_orders

contribution_per_article_kmf
  = period_contribution_kmf / article_units

contribution_per_parcel_kmf
  = period_contribution_kmf / parcels
```

Ces trois valeurs expriment la puissance contributive moyenne du flux à son mix actuel.

Elles doivent être affichées ensemble avec les volumes observés :

- commandes matures ;
- unités article ;
- colis ;
- articles / commande ;
- articles / colis.

---

## 5. Deux mesures distinctes : seuil total et reste à produire

L'Atelier doit afficher **deux lectures différentes** pour chaque unité opérationnelle.

### 5.1 Seuil équivalent total d'équilibre

Il répond à :

> « À la productivité contributive moyenne actuelle, combien d'unités équivalentes correspondent à 100 % de N3 ? »

```text
break_even_floor_orders
  = ceil(period_n3_kmf / contribution_per_order_kmf)

break_even_floor_articles
  = ceil(period_n3_kmf / contribution_per_article_kmf)

break_even_floor_parcels
  = ceil(period_n3_kmf / contribution_per_parcel_kmf)
```

Le mot **équivalent** ou la mention **à mix actuel** est obligatoire.

### 5.2 Unités équivalentes restantes

Elles répondent à :

> « Compte tenu de ce qui a déjà été contribué, combien d'unités équivalentes supplémentaires reste-t-il à produire ? »

```text
additional_equivalent_orders
  = ceil(break_even_gap_kmf / contribution_per_order_kmf)

additional_equivalent_articles
  = ceil(break_even_gap_kmf / contribution_per_article_kmf)

additional_equivalent_parcels
  = ceil(break_even_gap_kmf / contribution_per_parcel_kmf)
```

Les seuils totaux et les restes à produire ne doivent jamais être confondus.

---

## 6. Exemple canonique

```text
N3 réel de période                    1 000 000 KMF
Contribution réconciliée                720 000 KMF
Couverture                                   72 %
Gap à l'équilibre                        280 000 KMF

Commandes matures                            206
Articles                                     514
Colis                                         91

Contribution / commande                 3 495 KMF
Contribution / article                  1 401 KMF
Contribution / colis                    7 912 KMF
```

À ce mix :

```text
Seuil total équivalent :
≈ 287 commandes
≈ 714 articles
≈ 127 colis

Reste à produire :
≈ 81 commandes équivalentes
≈ 200 articles équivalents
≈ 36 colis équivalents
```

Les trois axes décrivent le **même équilibre économique** dans trois unités différentes.

---

## 7. « Contributif » : définition et piège à éviter

Une unité est **contributive** lorsque sa contribution propre réconciliée est strictement positive.

### Commande contributive

```text
order_contribution_kmf > 0
```

KPI de qualité souhaités :

```text
contributive_orders_count
contributive_orders_ratio
neutral_orders_count
negative_orders_count
negative_orders_ratio
```

### Colis contributif

Un colis ne peut être déclaré contributif que si une règle canonique permet d'attribuer au colis les revenus et coûts variables qui lui appartiennent.

```text
parcel_contribution_kmf > 0
```

Tant que cette attribution n'est pas disponible, l'UI peut afficher **contribution moyenne par colis** mais ne doit pas inventer un `contributive_parcels_count`.

### Règle fondamentale

Le point d'équilibre est calculé à partir de la **contribution nette réconciliée de tout le flux**, pas uniquement des unités positives.

Il est interdit de calculer la productivité de break-even uniquement sur les commandes contributives en excluant les commandes négatives : cela surévaluerait artificiellement la capacité du flux à absorber N3.

---

## 8. Les KPI canoniques de l'Atelier

### Bloc A — État économique

| KPI | Formule | Rôle |
|---|---|---|
| Contribution cumulée | `Σ contributions réconciliées` | valeur créée par le flux après variable |
| N3 période | `Σ structure reconnue` | structure à absorber |
| Couverture N3 | `contribution / N3` | progression vers l'équilibre |
| Gap équilibre | `max(0, N3 - contribution)` | distance monétaire restante |
| Résultat de période | `contribution - N3` | surplus / déficit économique |

### Bloc B — Productivité du flux

| KPI | Formule |
|---|---|
| Contribution / commande | `contribution / commandes matures` |
| Contribution / article | `contribution / unités article` |
| Contribution / colis | `contribution / colis` |
| Articles / commande | `articles / commandes` |
| Articles / colis | `articles / colis` |

### Bloc C — Seuils d'équilibre à mix actuel

| KPI | Sens |
|---|---|
| Commandes équivalentes au seuil | volume total correspondant à 100 % de N3 |
| Articles équivalents au seuil | idem en unités article |
| Colis équivalents au seuil | idem en colis |
| Commandes équivalentes restantes | effort supplémentaire au mix actuel |
| Articles équivalents restants | idem en unités article |
| Colis équivalents restants | idem en colis |

### Bloc D — Qualité du flux

| KPI | Sens |
|---|---|
| % commandes contributives | part des commandes à contribution propre positive |
| % commandes négatives | part des commandes destructrices |
| contribution moyenne commandes | puissance moyenne nette de la cohorte |
| contribution moyenne colis | puissance moyenne nette rapportée au nombre de colis |
| fraîcheur / maturité | âge et statut de la vérité utilisée |

---

## 9. Temps réel ne veut pas dire vérité provisoire

L'Atelier doit se rafraîchir dès qu'une nouvelle vérité économique réconciliée est disponible.

La couverture décisionnelle reste fondée sur :

- ventes matures ;
- coûts variables réconciliés ;
- N3 reconnu ;
- même fenêtre économique ;
- politique marché active.

Une vue opérationnelle peut afficher des événements plus récents non matures, mais ils doivent être explicitement étiquetés `PROVISIONAL` et ne doivent jamais modifier silencieusement le gate décisionnel.

L'UI affiche :

```text
economic_truth_status
last_reconciled_at
window_from
window_to
```

---

## 10. Cibles à 100 % et cible de sécurité

Le moteur distingue toujours :

```text
Équilibre économique = 100 % de N3
Cible de sécurité = policy.coverage_threshold
```

Les mêmes traductions opérationnelles peuvent être calculées pour la cible de sécurité :

```text
safety_target_contribution = N3 × coverage_threshold
safety_gap = max(0, safety_target_contribution - contribution)
```

L'UI ne doit jamais confondre les deux.

---

## 11. Paliers N3 et validité des planchers

Les seuils d'articles, commandes et colis sont valides **dans le palier de structure et le mix actuellement observés**.

```text
structure_constant_within_projection = true
current_mix_constant = true
unmodelled_capacity_step_excluded = true
```

Si un seuil de volume déclenche un salarié, un hub, un véhicule ou une capacité fixe supplémentaire, le nouveau N3 doit être introduit dans un scénario prospectif séparé.

Le moteur ne doit jamais présenter le seuil actuel comme une promesse de rentabilité après changement de palier.

---

## 12. Contrat de présentation UI

L'Atelier doit permettre une lecture en moins de dix secondes :

```text
ÉQUILIBRE ÉCONOMIQUE

Contribution reconnue          720 000 KMF
N3 de période                1 000 000 KMF
Couverture                         72 %
Reste à absorber               280 000 KMF

PRODUCTIVITÉ ACTUELLE
3 495 KMF / commande
1 401 KMF / article
7 912 KMF / colis

SEUIL À MIX ACTUEL
≈ 287 commandes équivalentes
≈ 714 articles équivalents
≈ 127 colis équivalents

RESTE À PRODUIRE
≈ 81 commandes équivalentes
≈ 200 articles équivalents
≈ 36 colis équivalents
```

Phrase permanente :

> **Le produit contribue. Le flux absorbe la structure.**

---

## 13. Contrat API cible

Le backend reste source unique de calcul. Le navigateur ne recalcule aucune formule économique.

Extension cible du bloc `flow_break_even` :

```text
flow_break_even:
  status
  reason
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
    contribution_per_order_kmf
    contribution_per_article_kmf
    contribution_per_parcel_kmf

  economic_break_even:
    target_coverage_ratio = 1
    break_even_floor_orders
    break_even_floor_articles
    break_even_floor_parcels
    additional_equivalent_orders
    additional_equivalent_articles
    additional_equivalent_parcels

  flow_quality:
    contributive_orders_count
    contributive_orders_ratio
    negative_orders_count
    negative_orders_ratio
    contributive_parcels_count  # seulement si attribution canonique disponible
    contributive_parcels_ratio  # seulement si attribution canonique disponible

  freshness:
    truth_status
    last_reconciled_at
    window_from
    window_to
```

---

## 14. Fail-honest

Si une productivité moyenne est nulle ou négative alors qu'un gap subsiste :

```text
break_even_floor_* = null
additional_equivalent_* = null
status = CURRENT_MIX_NOT_PROJECTABLE
```

Le moteur explique :

> **Le mix actuel ne converge pas vers l'équilibre.**

Il est interdit d'afficher zéro, une valeur négative ou une fausse précision.

Si la vérité de couverture n'est pas décisionnelle, aucun seuil d'équilibre ne doit être présenté comme certain.

---

## 15. Phrase de contrôle

Avant de publier un KPI :

> **Ce chiffre mesure-t-il la vérité économique du flux, la qualité du flux, ou une traduction du gap à mix actuel ?**

Les trois catégories doivent rester visuellement et techniquement séparées.
