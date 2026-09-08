# Doctrine canonique — Pilotage temps réel de la contribution et de l'équilibre

> **Version** : 2.0 — 2026-09-08  
> **Statut** : canonique / spécialisé  
> **Objet** : fixer les indicateurs de contribution, de couverture et de point d'équilibre de l'Atelier économique, sans vocabulaire N1/N2/N3 et sans double comptage.  
> **Complète** : `DOCTRINE_CLASSIFICATION_CHARGES.md`, `DOCTRINE_ECONOMIQUE_KOMERCE.md`, `DOCTRINE_PRICING_ANCRE_MARCHE_VIABILITE.md`.

---

## 1. Phrase de vérité

> **Les articles vendus créent la contribution. Le portefeuille absorbe les charges fixes directes et mutualisées. Commandes et colis ne créent pas une deuxième contribution : ils regroupent la même valeur.**

Le dashboard économique doit répondre en permanence à cinq questions :

1. combien de contribution le portefeuille a-t-il réellement généré ?
2. combien de charges fixes directes et mutualisées doivent être couvertes sur la même période ?
3. quelle part est déjà couverte ?
4. quel gap monétaire reste-t-il ?
5. au mix actuel, à combien d'articles, commandes ou colis équivalents ce gap correspond-il ?

---

## 2. Source unique de contribution

L'unité économique primitive est l'article vendu.

```text
article_contribution
  = article_net_revenue
    - article_attributed_variable_costs
```

Les charges variables engagées à un niveau commande, colis ou shipment sont attribuées **une seule fois** selon leur règle canonique avant agrégation.

```text
order_contribution
  = Σ article_contribution de la commande

parcel_contribution
  = Σ article_contribution des articles du colis

period_contribution
  = Σ article_contribution de la cohorte mature
```

Lorsque les attributions sont complètes sur la même cohorte :

```text
Σ contribution articles
= Σ contribution commandes
= Σ contribution colis
= contribution de période
```

Interdiction absolue :

```text
contribution_totale
!= contribution_articles
 + contribution_commandes
 + contribution_colis
```

> **Une contribution, plusieurs vues. Jamais plusieurs contributions additionnées.**

---

## 3. Charges de période à couvrir

```text
period_fixed_charges
  = charges fixes directes reconnues pour le marché
    + quotes-parts fixes mutualisées attribuées au marché
```

Les deux composantes doivent rester visibles séparément dans l'Atelier :

```text
direct_fixed_charges
mutualized_fixed_share
period_fixed_charges = direct_fixed_charges + mutualized_fixed_share
```

Une charge mutualisée n'est utilisable dans la couverture que si sa clé d'allocation est explicite et suffisamment fiable pour la fenêtre concernée.

---

## 4. Couverture et gap

```text
coverage_ratio
  = period_contribution
    / period_fixed_charges

break_even_gap
  = max(0, period_fixed_charges - period_contribution)

period_result
  = period_contribution - period_fixed_charges
```

Lecture :

```text
< 100 %  → charges de période non couvertes
= 100 %  → équilibre économique
> 100 %  → structure couverte, résultat positif
```

Le gap monétaire est la vérité primaire.

---

## 5. Productivité du mix réel

Les ratios sont calculés sur la même cohorte mature et réconciliée :

```text
contribution_per_article
  = period_contribution / article_units

contribution_per_order
  = period_contribution / mature_orders

contribution_per_parcel
  = period_contribution / parcels
```

Ils ne s'additionnent pas.

Ils permettent de traduire la même contribution sous trois angles opérationnels.

Le dashboard peut aussi publier :

```text
articles_per_order
articles_per_parcel
```

pour rendre le mix explicite.

---

## 6. Qualité du flux

Un article est contributif si :

```text
article_contribution > 0
```

Une commande est contributive si la somme des contributions de ses articles est positive après attribution unique des charges variables de commande.

Un colis est contributif si la somme des contributions des articles qu'il contient est positive après attribution canonique des charges variables du colis.

Ces compteurs sont des KPI de qualité, jamais de nouvelles contributions.

Le point d'équilibre utilise la contribution nette de tout le flux, y compris l'effet des articles, commandes ou colis négatifs.

---

## 7. Seuil total et reste équivalent

Au mix actuel :

```text
break_even_floor_articles
  = ceil(period_fixed_charges / contribution_per_article)

additional_equivalent_articles
  = ceil(break_even_gap / contribution_per_article)
```

Même principe pour commandes et colis.

Le mot **équivalent** et la mention **au mix actuel** sont obligatoires.

Exemple :

```text
≈ 200 articles
≈ 81 commandes
≈ 36 colis
```

Ces trois nombres décrivent le même gap. Ils ne sont jamais des objectifs cumulables.

---

## 8. Contribution requise moyenne : indicateur de pilotage

Le moteur peut publier :

```text
required_average_contribution
  = break_even_gap / projected_or_equivalent_remaining_units
```

Cette valeur sert à comparer le besoin de couverture à la capacité contributive réelle du portefeuille.

Elle n'est jamais une quote-part fixe imposée à chaque SKU.

Lecture utile :

```text
contribution moyenne requise
vs
contribution moyenne réalisable à borne basse / cible / haute
```

Si la capacité réaliste du portefeuille à borne haute reste insuffisante, le diagnostic doit devenir structurel et ne pas pousser artificiellement les prix au-delà du marché.

---

## 9. Temps réel et qualité de vérité

Le dashboard se rafraîchit lorsqu'une nouvelle vérité réconciliée est disponible.

La vue décisionnelle reste fondée sur :

- ventes matures ;
- revenus réconciliés ;
- charges variables attribuées une seule fois ;
- charges fixes reconnues sur la même période ;
- quotes-parts mutualisées issues d'une allocation gouvernée ;
- politique marché active.

Une vue opérationnelle peut montrer des données provisoires sous statut `PROVISIONAL`, sans les ajouter au numérateur décisionnel.

L'UI doit publier au minimum :

```text
economic_truth_status
last_reconciled_at
window_from
window_to
```

---

## 10. Cible économique et cible de sécurité

```text
Équilibre économique = 100 % des charges de période
Cible de sécurité = policy.coverage_threshold
```

```text
safety_target_contribution
  = period_fixed_charges × coverage_threshold

safety_gap
  = max(0, safety_target_contribution - period_contribution)
```

La cible de sécurité doit être distinguée de l'équilibre économique à 100 %.

---

## 11. Paliers de structure

Les seuils sont valides dans le palier de structure courant.

Un nouveau salarié, Hub, véhicule, entrepôt ou abonnement de capacité peut créer un nouveau scénario de charges fixes.

Le moteur ne doit pas extrapoler silencieusement le seuil courant au-delà de ce palier.

---

## 12. Contrat UI minimal de l'Atelier

Lecture cible en moins de dix secondes.

La page principale doit privilégier quelques indicateurs dérivés :

```text
Charges à couvrir
Contribution générée
Couverture
Reste à couvrir
Contribution moyenne / article
Équivalents restants au mix actuel (optionnel)
```

Les valeurs dérivées sont non éditables et visuellement plus discrètes.

Les zones actionnables restent les coûts, politiques, hypothèses et prix autorisés. Toute mutation déclenche un nouveau calcul serveur avant rafraîchissement des indicateurs.

Doctrine d'interface :

> **Le Dashboard observe. Le Workspace agit. Le 360 explique. La Variable pilote. Le moteur calcule.**

L'Atelier est un Workspace : il peut agir sur les leviers autorisés, mais il ne redérive jamais la vérité économique dans le navigateur.

---

## 13. Contrat API cible

Le backend reste la source unique.

Nouveaux noms métier cibles :

```text
flow_break_even:
  status
  basis = CURRENT_RECONCILED_MIX

  economic_state:
    period_contribution_kmf
    direct_fixed_charges_kmf
    mutualized_fixed_share_kmf
    period_fixed_charges_kmf
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
```

Les champs techniques historiques contenant `n1`, `n2` ou `n3` peuvent subsister temporairement comme aliases de compatibilité interne. Ils ne doivent plus être exposés comme vocabulaire métier dans l'UI.