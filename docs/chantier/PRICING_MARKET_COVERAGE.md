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
estimated_risk_provision_kmf       # provision de snapshot, benchmark de calibration
contribution_before_risk_kmf
provisional_contribution_after_estimated_risk_kmf
reconciled_risk_cost_kmf           # vérité canonique de période
reconciled_contribution_kmf
risk_variance_vs_provision_kmf
```

## 3. Risque : absence d'incident != zéro

La provision risque appartient à N2 mais sa vérité est de période. Le service n'autorise donc **jamais** un ratio avec un zéro de risque déduit de l'absence d'événement.

La vérité canonique est lue depuis `pricing-risk-period.js`, qui s'appuie sur :

```text
economic_risk_cost_events
+ economic_risk_watermark_events
```

Pour devenir décisionnel, le risque doit porter exactement sur le même `market_id` et la même fenêtre canonique. Une période sans perte n'est reconnue à `0 KMF` que lorsqu'un watermark de revue explicite certifie la borne `closed_through` correspondante.

Un fait de risque backdaté mais enregistré après le watermark rend la certification `STALE` jusqu'à une nouvelle revue. Le gate repasse alors `NOT_DECISIONAL`.

La provision de snapshot reste publiée uniquement comme référence de calibration :

```text
risk_variance_vs_provision_kmf
  = risque réel réconcilié - provision estimée
```

Aucun `refund`, `dispute`, incident, impayé relais ou compensation n'est automatiquement transformé en coût risque par ce contrat. Chaque source devra disposer d'une règle de reconnaissance explicite pour empêcher les doubles comptes.

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

- watermark de maturité non prêt ;
- maturité sous seuil ;
- N3 marché non décisionnel ;
- coût variable réel inconnu ;
- jeu de commandes MATURE incohérent ;
- watermark risque absent, insuffisant ou stale ;
- vérité risque non réconciliée ;
- N3 nul/négatif ne permettant pas un ratio honnête.

Effet identique à `UNCOVERED` pour l'autorisation, mais sans fabriquer un ratio.

## 7. Ce que ce lot ne fait pas

- aucune modification de `computePrices` ;
- aucune route publique/admin ;
- aucune écriture de stratégie ;
- aucune refacturation partenaire ;
- aucune table de politique de couverture ;
- aucun auto-mapping de `refunds` / `disputes` / incidents vers le risque ;
- aucun budget de conquête automatique ;
- aucun corridor marché.

## 8. Prochain verrou après la vérité risque

Une fois la migration 167 vérifiée live en staging, le verrou restant avant autorité commerciale est de matérialiser la **politique canonique de fenêtre et de seuils** : largeur de fenêtre, `maturity_threshold`, `coverage_threshold`, politique de dispositions et version/evidence associées.

Ce n'est qu'après ce producteur de politique que `COVERED` pourra piloter une autorisation commerciale réelle. Le prix lui-même reste une décision distincte ; `computePrices` n'est pas modifié par ce contrat.
