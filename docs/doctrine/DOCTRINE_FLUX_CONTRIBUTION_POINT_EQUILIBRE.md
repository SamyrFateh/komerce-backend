# Doctrine Flux, Contribution et Point d'Équilibre Komerce

> **Version** : 1.0 — 2026-09-07  
> **Statut** : doctrine canonique spécialisée du moteur économique  
> **Complète** : `DOCTRINE_PRICING_ANCRE_MARCHE_VIABILITE.md` V1.3, `DOCTRINE_MOTEUR_ECONOMIQUE_STRATEGIE.md`, `DOCTRINE_ALLOCATION_COUTS.md`, `DOCTRINE_DENSITE_VALEUR.md`  
> **Code d'application** : `services/pricing-market-decision-policy.js` (`flow_break_even`)

---

## 1. Phrase de vérité

> **Komerce ne demande pas à chaque SKU de payer la structure. Chaque vente doit d'abord contribuer positivement au flux ; c'est le flux réconcilié de la période qui absorbe N3.**

Le moteur économique ne cherche donc pas un coefficient magique qui rendrait chaque article « rentable tout seul ». Il mesure :

1. ce que chaque vente coûte réellement au niveau variable ;
2. ce qu'elle apporte comme contribution ;
3. combien le flux cumulé a déjà absorbé de la structure ;
4. quelle distance reste à parcourir avant l'équilibre ;
5. comment traduire cette distance en unités opérationnelles compréhensibles : commandes, articles et colis équivalents.

Le **panier moyen** reste un indicateur commercial utile. Il n'est pas la vérité de viabilité du modèle.

---

## 2. La chaîne canonique ne change pas

Les définitions N1 / N2 / N3 / CDR restent intangibles :

```text
N1 = coût rendu relais
N2 = business variable

Coût variable complet = N1 + N2
Contribution = prix encaissé - coût variable complet

N3 = charge économique de structure de période
CDR complet = N1 + N2 + N3 imputé pour lecture
```

Conséquence fondamentale :

```text
N3 n'est pas une dette du SKU.
```

Un SKU peut être vendu sous son CDR complet tout en créant de la valeur si :

```text
prix >= coût variable complet
```

Il contribue alors à l'absorption de N3. La vérité de couverture se juge au niveau de la période et du marché :

```text
coverage_ratio
  = Σ contributions réconciliées
    / N3 économique attribué au marché sur la même fenêtre
```

Le point d'équilibre n'ajoute aucune nouvelle définition de coût. Il **lit et projette** cette vérité existante.

---

## 3. Du panier au flux

Komerce distingue plusieurs unités qui ne doivent pas être confondues :

| Unité | Ce qu'elle dit |
|---|---|
| **Article** | contribution marginale d'une unité vendue |
| **Commande** | acte commercial d'un client / payeur |
| **Panier** | composition commerciale d'une commande |
| **Colis** | unité opérationnelle qui porte des coûts logistiques propres |
| **Shipment** | cohorte logistique de fret / douane / transit |
| **Période** | unité de vérité pour N3 et la viabilité globale |

Dans un modèle mutualisé, une commande et un colis ne sont pas synonymes. De même, « panier moyen » ne signifie pas « unité de rentabilité ».

Le moteur doit donc publier la **forme observée du flux** :

```text
articles / commande
articles / colis
contribution / commande
contribution / article
contribution / colis
```

Lorsque les données logistiques le permettent, les métriques de poids, volume et densité de valeur complètent cette lecture sans la remplacer.

---

## 4. Distance à l'équilibre

La première mesure est monétaire et ne dépend d'aucune moyenne commerciale :

```text
break_even_gap_kmf
  = max(0, N3 économique de période - contribution réconciliée)
```

Exemple :

```text
N3 économique de période       1 000 000 KMF
Contribution réconciliée         720 000 KMF
--------------------------------------------
Distance à l'équilibre           280 000 KMF
Couverture                           72 %
```

Cette distance est la vérité primaire. Les nombres de commandes, articles ou colis sont des **traductions opérationnelles** de cette même distance.

---

## 5. Point d'équilibre en unités équivalentes

À partir du mix réconcilié réellement observé sur la même fenêtre :

```text
contribution_moyenne_commande
  = contribution réconciliée / commandes matures

contribution_moyenne_article
  = contribution réconciliée / unités article des commandes matures

contribution_moyenne_colis
  = contribution réconciliée / colis des commandes matures
```

Puis :

```text
commandes_equivalentes_restantes
  = ceil(break_even_gap_kmf / contribution_moyenne_commande)

articles_equivalents_restants
  = ceil(break_even_gap_kmf / contribution_moyenne_article)

colis_equivalents_restants
  = ceil(break_even_gap_kmf / contribution_moyenne_colis)
```

Le mot **équivalent** est obligatoire.

Ces trois nombres ne sont pas trois points d'équilibre différents. Ils expriment **le même gap économique dans trois unités différentes**.

Formulation UI canonique :

> **À mix réconcilié actuel, l'équilibre correspond à environ X commandes, Y articles ou Z colis équivalents supplémentaires.**

Il est interdit d'afficher « il faut X commandes » sans préciser le mix de référence.

---

## 6. Deux cibles distinctes : équilibre et sécurité

Le moteur distingue toujours :

### 6.1 Équilibre économique

```text
target_coverage_ratio = 1.0
```

La contribution couvre exactement N3.

### 6.2 Seuil gouverné de sécurité

La politique marché peut exiger :

```text
coverage_threshold > 1.0
```

Le gap de sécurité est alors :

```text
safety_gap_kmf
  = max(0, N3 × coverage_threshold - contribution réconciliée)
```

Le dashboard peut donc afficher par exemple :

```text
Équilibre économique (100 %)      36 colis équivalents
Cible de sécurité (110 %)          43 colis équivalents
```

Le seuil de sécurité est une politique versionnée. Aucun seuil n'est hardcodé dans la projection.

---

## 7. Le mix est un levier, pas une vérité fixe

La projection « à mix actuel » permet ensuite de simuler des leviers :

- davantage d'articles utiles par commande ;
- meilleure densification des colis ;
- meilleur mix de catégories ;
- baisse d'un coût variable ;
- amélioration de la densité de valeur ;
- augmentation de la contribution sans prix client excessif.

Une suggestion commerciale peut participer à cette optimisation si elle reste pertinente pour le client. Le moteur ne doit jamais pousser un article inutile uniquement pour améliorer un KPI interne.

Doctrine commerciale :

> **Le gagnant-gagnant prime : améliorer la contribution du flux par une meilleure composition naturelle de la vente, pas par une contrainte client.**

---

## 8. Les paliers de structure

La structure n'est pas infiniment linéaire.

Un volume supplémentaire peut déclencher un nouveau palier : salarié, espace Hub, véhicule, logiciel, relais fixe, capacité réservée, etc.

La projection canonique V1 est donc locale et explicite :

```text
structure_constant_within_projection = true
current_mix_constant = true
unmodelled_capacity_step_excluded = true
```

Elle répond à :

> « Avec la structure et le mix actuellement reconnus, quelle distance économique reste à absorber ? »

Elle ne prétend pas répondre à :

> « Que coûtera exactement la structure après un doublement de volume ? »

Un palier futur connu doit entrer dans un **scénario prospectif N3** séparé avant de recalculer le point d'équilibre. Il est interdit de cacher un coût de capacité futur dans une moyenne actuelle.

---

## 9. Réel, hypothèse et simulation

Trois couches restent séparées :

### Réel décisionnel

- commandes `MATURE` ;
- contribution réconciliée ;
- N3 économique de période ;
- risque réel de période ;
- politique de couverture versionnée.

### Forme observée du flux

- nombre de commandes matures ;
- unités article correspondantes ;
- colis correspondants ;
- ratios dérivés de ces observations.

### Simulation

- objectif de commandes ;
- panier cible ;
- densité cible ;
- amélioration supposée de contribution ;
- futur palier de structure.

Les valeurs `avg_articles_per_order`, `avg_articles_per_parcel`, `objectif_commandes_mois` et équivalents restent utiles au CDR théorique et aux scénarios. Elles **ne deviennent jamais la preuve du point d'équilibre réel**.

---

## 10. Fail-honest obligatoire

La projection ne fabrique aucun chiffre lorsque la vérité de couverture n'est pas décisionnelle.

```text
coverage_status = NOT_DECISIONAL
→ flow_break_even.status = NOT_DECISIONAL
→ aucun nombre équivalent autorisant
```

Si la contribution moyenne observée est nulle ou négative et qu'un gap subsiste :

```text
additional_equivalent_* = null
status = CURRENT_MIX_NOT_PROJECTABLE
```

Le moteur doit alors expliquer que **le mix actuel ne converge pas vers l'équilibre**. Il est interdit de retourner zéro, un nombre négatif ou une division artificielle.

Une indisponibilité de la projection de forme du flux ne modifie jamais l'autorisation du gate de couverture. La projection explique la décision ; elle ne la remplace pas.

---

## 11. Contrat API canonique

La décision marché expose désormais un bloc supplémentaire :

```text
flow_break_even:
  status
  reason
  basis = CURRENT_RECONCILED_MIX

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
    target_coverage_ratio = 1
    target_contribution_kmf
    gap_kmf
    status
    additional_equivalent_orders
    additional_equivalent_articles
    additional_equivalent_parcels

  policy_safety_target:
    target_coverage_ratio = policy.coverage_threshold
    ...

  assumptions:
    structure_constant_within_projection = true
    current_mix_constant = true
    unmodelled_capacity_step_excluded = true
```

Ce bloc est **read-only** et n'écrit ni prix, ni N3, ni stratégie.

---

## 12. Ce que cette doctrine ne change pas

Elle ne change pas :

- N1 ;
- N2 ;
- N3 ;
- le CDR complet ;
- le `minimum_safe_price` ;
- la vérité de couverture ;
- la politique de décision ;
- la doctrine de densité de valeur ;
- la mutualisation Hub.

Elle ajoute uniquement la couche qui manquait :

```text
vérité des coûts
→ contribution
→ couverture
→ distance à l'équilibre
→ traduction opérationnelle du gap
```

---

## 13. Phrase de contrôle

Avant de valider un calcul ou un écran :

> **Est-ce que ce nombre décrit une vérité de coût, une contribution réelle, ou seulement une traduction du gap à mix actuel ?**

Si la réponse n'est pas explicite, le chiffre ne doit pas être présenté comme décisionnel.
