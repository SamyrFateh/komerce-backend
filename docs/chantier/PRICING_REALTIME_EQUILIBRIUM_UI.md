# Chantier — Équilibre économique temps réel

> Date : 2026-09-07
> Statut : implémentation

## Objectif

Rendre visible dans l'Atelier Pricing la vérité de contribution et la distance à l'équilibre sans aucun double-comptage.

## Invariants

- la contribution économique est unique et provient des articles vendus ;
- commande et colis sont des vues d'agrégation du même pool de contribution ;
- N3 est la structure fixe / semi-fixe de période ;
- couverture = contribution unique / N3 réel ;
- articles / commandes / colis équivalents sont trois traductions du même gap ;
- le navigateur ne recalcule aucune formule économique.

## Cadence stable du flux

Le KPI de cadence stable repose sur la moyenne glissante de la fenêtre canonique :

```text
orders_per_day = mature_orders / window_days
parcels_per_day = parcels / window_days
articles_per_day = article_units / window_days
contribution_per_day = reconciled_contribution / window_days
```

Ces cadences ne s'additionnent pas. Elles sont plusieurs lectures du même flux.

La vitesse économique de référence reste la contribution par unité de temps :

```text
projected_days_to_break_even = gap / contribution_per_day
```

Les lectures par commandes ou colis doivent converger vers la même durée, à l'arrondi près :

```text
remaining_equivalent_orders / orders_per_day
≈ remaining_equivalent_parcels / parcels_per_day
≈ gap / contribution_per_day
```

## UI cible

La carte « Équilibre du flux » affiche :

- contribution reconnue ;
- N3 de période ;
- couverture % ;
- gap monétaire ;
- contribution moyenne / article, / commande, / colis ;
- seuil total équivalent à 100 % de N3 ;
- reste équivalent à produire ;
- cadence lissée / jour sur la fenêtre canonique ;
- estimation de temps jusqu'à l'équilibre à mix et cadence constants.

Phrase permanente :

> **Une contribution, plusieurs vues. Le produit contribue ; le flux absorbe la structure.**
