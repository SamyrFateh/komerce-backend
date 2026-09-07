# Chantier — Vérité risque N2 de période

> **Statut** : contrat technique avant autorité commerciale du gate de couverture
> **Doctrine** : `DOCTRINE_PRICING_ANCRE_MARCHE_VIABILITE.md` V1.3
> **Migration** : 167 — `economic_risk_cost_events` + `economic_risk_watermark_events`

## 1. Problème fermé

La provision risque est du N2, mais une provision n'est pas un sinistre réalisé. Utiliser directement `risk_provisions` ou le montant provisionné comme « réel » biaise systématiquement la contribution.

L'autre erreur serait symétrique :

```text
aucun sinistre enregistré = 0 KMF de risque réel
```

Cette égalité est interdite. Une absence de ligne peut simplement signifier que personne n'a encore clôturé/revu la période.

## 2. Deux journaux append-only

### `economic_risk_cost_events`

Porte les pertes/sinistres réalisés :

- `market_id` obligatoire ;
- `order_id` optionnel mais, lorsqu'il existe, le marché vient de la commande côté serveur ;
- lien optionnel à `risk_provisions` pour comparer provision et réel ;
- identité du risque snapshotée ;
- date économique `economic_at` ;
- montant/devise/FX ;
- source et preuve ;
- auteur/date d'enregistrement ;
- `ACCRUAL`, `ADJUSTMENT`, `REVERSAL`.

Une correction garde le marché, la commande, la catégorie et la date économique du fait original. Elle ne peut donc pas déplacer une perte vers une autre fenêtre.

### `economic_risk_watermark_events`

Certifie qu'un marché a été revu jusqu'à une borne `closed_through`.

C'est ce watermark qui permet d'affirmer honnêtement :

```text
coût risque réalisé de la fenêtre = 0
```

lorsqu'aucun événement de coût n'existe dans une fenêtre pourtant revue.

## 3. Écriture backdatée après clôture

Une clôture n'efface pas la possibilité d'une information tardive. Si un événement dont `economic_at` appartient à une fenêtre déjà revue est **enregistré après** le watermark ayant servi à la certifier :

```text
status = NOT_DECISIONAL_RISK_WATERMARK_STALE
```

Une nouvelle certification est nécessaire. Ainsi le moteur ne conserve jamais un feu vert obtenu avant la découverte d'une perte tardive.

## 4. Watermark monotone

`closed_through` ne peut pas reculer. Une nouvelle revue peut :

- avancer la borne ;
- recertifier la même borne après une information tardive.

Elle ne peut jamais faire croire que le marché connaît moins d'histoire qu'auparavant.

## 5. Réconciliation par marché

Le risque est réconcilié sur le même `market_id` que le gate de couverture.

La lecture canonique prend exactement :

```text
from <= economic_at < to
```

et exige un watermark couvrant `to`.

Sortie décisionnelle :

```text
status = RISK_PERIOD_TRUTH_AVAILABLE
actual_risk_cost_kmf = Σ faits append-only de la fenêtre
```

Un total net négatif est traité `NOT_DECISIONAL_NEGATIVE_RISK_TOTAL` : les recouvrements/revenus exceptionnels ne doivent pas transformer silencieusement le risque variable en crédit de marge.

## 6. Intégration au gate de couverture

`pricing-market-coverage.js` ne reçoit plus un objet de risque fourni par son appelant. Il consomme directement `computePeriodRiskTruth`.

Le numérateur devient donc :

```text
contribution réconciliée
= CA commandes MATURE
  - N1 réel
  - paiement réel
  - risque réalisé certifié sur la période
```

La provision snapshotée reste publiée pour analyser :

```text
variance risque = risque réalisé - provision estimée
```

mais ne se fait jamais passer pour le réel.

## 7. Sources opérationnelles futures

Les systèmes `refunds`, `disputes`, non-conformité, impayés relais ou autres incidents peuvent devenir des **sources** d'événements risque, mais ils ne sont pas automatiquement promus en vérité économique dans ce lot.

Le futur branchement devra définir, source par source :

- quel événement constitue réellement une perte ;
- à quelle date économique ;
- pour quel montant net ;
- comment éviter le double comptage (ex. refund + dispute pour le même cas) ;
- quelle preuve est conservée.

Aucun `JOIN` opportuniste sur ces tables ne vaut doctrine de reconnaissance.

## 8. Ce que ce lot ne fait pas

- aucune route de saisie ;
- aucun import automatique des refunds/disputes ;
- aucun changement de `computePrices` ;
- aucune politique de seuil couverture ;
- aucune refacturation ;
- aucun pricing marché automatique.

Après ce lot, le dernier verrou avant une vraie autorité du gate reste la **politique canonique de fenêtre et de seuils**, versionnée et non pilotable ad hoc par un manager.
