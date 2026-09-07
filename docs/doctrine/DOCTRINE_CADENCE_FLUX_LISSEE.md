# Doctrine canonique — Cadence lissée du flux

> **Version** : 1.0 — 2026-09-07  
> **Statut** : canonique / spécialisé  
> **Objet** : fixer l'indicateur stable de cadence du flux utilisé pour projeter la vitesse d'absorption de N3.

## 1. Phrase de vérité

> **À mesure que Komerce accumule de l'historique, la cadence stable du flux se lit comme un taux moyen lissé d'articles, de commandes et de colis par unité de temps.**

Ces taux sont des vues opérationnelles d'un même flux. Ils ne créent aucune contribution supplémentaire.

## 2. Fenêtre de lissage

La première implémentation canonique utilise la fenêtre économique glissante déjà gouvernée par la politique marché :

```text
window_days = canonical_period.width_days
```

Puis :

```text
articles_per_day = article_units / window_days
orders_per_day = mature_orders / window_days
parcels_per_day = parcels / window_days
```

Cette moyenne glissante réduit la volatilité événementielle et fournit une cadence comparable dans le temps.

## 3. Vitesse économique

La contribution reste un pool unique issu des articles vendus :

```text
contribution_per_day
  = reconciled_contribution / window_days
```

La vitesse d'absorption de N3 est donc monétaire. Articles/jour, commandes/jour et colis/jour expliquent comment cette vitesse est produite opérationnellement.

## 4. Projection du temps à l'équilibre

```text
projected_days_to_break_even
  = break_even_gap / contribution_per_day
```

À mix et cadence constants, les traductions opérationnelles doivent converger vers la même durée :

```text
additional_equivalent_orders / orders_per_day
≈ additional_equivalent_articles / articles_per_day
≈ additional_equivalent_parcels / parcels_per_day
≈ break_even_gap / contribution_per_day
```

Les écarts dus aux arrondis sont admis. Une divergence structurelle signale un problème de cohorte, d'attribution ou de double-comptage.

## 5. Fail-honest

Aucune durée n'est projetée si :

- la contribution moyenne par unité de temps est nulle ou négative ;
- la couverture n'est pas décisionnelle ;
- la fenêtre économique n'est pas valide ;
- le mix requis n'est pas réconcilié.

## 6. Hypothèses

La projection de cadence V1 suppose :

```text
current_mix_constant = true
current_flow_cadence_constant = true
structure_constant_within_projection = true
unmodelled_capacity_step_excluded = true
```

Un changement connu de palier N3 doit être simulé séparément.

## 7. Présentation UI

L'Atelier affiche :

```text
Cadence lissée · fenêtre X jours
A articles / jour
B commandes / jour
C colis / jour
D KMF de contribution / jour
Équilibre projeté ≈ E jours
```

Phrase de contrôle :

> **Une contribution, plusieurs cadences de lecture. Les cadences ne s'additionnent jamais.**
