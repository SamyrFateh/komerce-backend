# Chantier — Gate de couverture économique par marché

> **Statut** : contrat technique fail-closed avant exposition UI / stratégie
> **Doctrine** : `DOCTRINE_PRICING_ANCRE_MARCHE_VIABILITE.md` V1.3
> **Périmètre** : contribution réconciliée d'un marché / N3 économique attribué au même marché et à la même fenêtre

## 1. Équation canonique

```text
market_coverage_ratio
  = Σ contributions réconciliées des commandes MATURE du marché
    / N3 économique attribué au marché sur la même fenêtre
```

Le ratio groupe n'autorise jamais une décision locale.

## 2. Numérateur

Le numérateur utilise uniquement des commandes :

- `market_id` identique au marché interrogé ;
- payées ;
- non annulées / non remboursées ;
- dans la fenêtre canonique ;
- économiquement `MATURE`.

Une commande `IRRECONCILABLE_DISPOSED` peut permettre au watermark d'avancer, mais sa contribution reste exclue du numérateur. Le traitement canonique imposé par le contrat est donc `EXCLUDE_FROM_NUMERATOR`.

Le service publie séparément :

```text
revenue_kmf
transaction_variable_cost_kmf      # N1 + paiement réellement réconciliables
estimated_risk_provision_kmf       # provision de snapshot, informative
contribution_before_risk_kmf
provisional_contribution_after_estimated_risk_kmf
reconciled_risk_cost_kmf           # uniquement si vérité de période fournie
reconciled_contribution_kmf
```

## 3. Risque : absence d'incident != zéro

La provision risque appartient à N2 mais sa vérité est de période. Le service n'autorise donc **jamais** un ratio avec un zéro de risque déduit de l'absence d'événement.

Pour devenir décisionnel, le gate exige une réconciliation de risque portant exactement sur :

- le même `market_id` ;
- le même `from/to` ;
- un `actual_risk_cost_kmf` explicite, y compris zéro ;
- une source, une version et une référence de preuve.

À ce stade, cette vérité de risque est un **contrat d'entrée interne**, pas encore une table canonique ni une route. Tant que son producteur append-only / gouverné n'est pas matérialisé, le gate ne doit pas être branché à une autorisation commerciale réelle.

## 4. Dénominateur

Le N3 vient uniquement de `computePeriodStructureTruth` :

```text
market_n3_total_kmf
  = MARKET_DIRECT reconnu
    + quote-part GROUP issue d'une politique gouvernée
```

Un pool GROUP partiellement alloué ou une politique manquante rend le ratio `NOT_DECISIONAL`.

## 5. Politique de couverture externe

Aucun seuil n'est hardcodé. Le service exige une politique versionnée couvrant toute la fenêtre :

```text
version
source
evidence_ref
effective_from / effective_to
maturity_threshold
coverage_threshold
disposed_contribution_treatment = EXCLUDE_FROM_NUMERATOR
```

La largeur de fenêtre n'est pas choisie par le service. `from/to` sont des bornes canoniques externes ; leur futur producteur devra être versionné et non pilotable ad hoc par un manager.

## 6. États

### `COVERED`

Toutes les vérités nécessaires sont décisionnelles et :

```text
coverage_ratio >= coverage_threshold
```

Effet technique : `ALLOW_NEW_UNDER_CDR_POSITION`.

Cela ne modifie ni un prix ni une stratégie existante.

### `UNCOVERED`

Toutes les vérités sont décisionnelles mais le ratio reste sous le seuil.

Effet : `DENY_NEW_UNDER_CDR_POSITION`.

### `NOT_DECISIONAL`

Exemples :

- watermark non prêt ;
- maturité sous seuil ;
- N3 marché non décisionnel ;
- coût variable réel inconnu ;
- jeu de commandes MATURE incohérent ;
- vérité risque absente ;
- N3 nul/négatif ne permettant pas un ratio honnête.

Effet identique à `UNCOVERED` pour l'autorisation, mais sans fabriquer un ratio.

## 7. Ce que ce lot ne fait pas

- aucune modification de `computePrices` ;
- aucune route publique/admin ;
- aucune écriture de stratégie ;
- aucune refacturation partenaire ;
- aucune table de politique de couverture ;
- aucune table de vérité risque ;
- aucun budget de conquête automatique ;
- aucun corridor marché.

## 8. Prochain verrou après ce contrat

Matérialiser la **vérité risque de période** de façon append-only / gouvernée, puis résoudre la **politique canonique de fenêtre et de seuils**. Ce n'est qu'après ces deux producteurs de vérité que `COVERED` pourra avoir une autorité commerciale réelle.
