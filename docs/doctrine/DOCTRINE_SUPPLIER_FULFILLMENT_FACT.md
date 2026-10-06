# Doctrine — Supplier Fulfillment Fact

## But

Le scope fournisseur est séparé en trois vérités indépendantes :

`ORDER → PAYMENT → FULFILLMENT`

Un ORDER accepté ne prouve ni paiement ni expédition.
Un PAYMENT rapproché ne prouve pas l'expédition.
Un tracking ou statut provider ne prouve pas la réception physique au Hub.

## Fait canonique

`supplier_execution_fulfillments` porte uniquement la vérité provider-side nécessaire à :

`expected → observed provider fact → bounded evidence → canonical verdict`

Verdicts canoniques :

- MATCHED
- NOT_FOUND
- MISMATCH
- AMBIGUOUS
- PENDING

La persistance utilise leur projection DB en minuscules.

## Frontière avec Logistics

Purchasing possède la réconciliation du fulfillment fournisseur.

Logistics possède :

- parcels ;
- shipments ;
- scans Hub/relais ;
- réception physique ;
- contenu reçu ;
- market leg ;
- remise client.

Donc :

`SUPPLIER_FULFILLMENT_MATCHED ≠ HUB_RECEIVED ≠ CUSTOMER_DELIVERED`

## Preuves minimales

Un verdict MATCHED exige au minimum :

- identité exacte du sous-ordre provider ;
- quantité attendue ;
- quantité observée compatible ;
- fait provider d'expédition ou de fulfillment ;
- evidence_source + evidence_ref stables ;
- aucun statut inventé dans le core.

Tracking/carrier sont conservés quand le provider les fournit, mais leur absence ne doit être interprétée que selon le contrat réel du provider.

## Rejeu

`provider + fulfillment_execution_key` est idempotent.
Une preuve native `provider + evidence_source + evidence_ref` ne peut être rattachée qu'à un seul fait canonique.

## Non-objectifs

Cette table :

- ne déclenche aucune commande ;
- ne déclenche aucun paiement ;
- ne crée aucun parcel ;
- ne marque jamais une commande client comme livrée ;
- ne remplace pas les scans physiques.
