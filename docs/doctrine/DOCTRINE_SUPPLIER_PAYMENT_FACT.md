# Doctrine — Supplier Payment Fact

## But

Un paiement fournisseur ne doit jamais être réduit à « appeler une API de paiement ».

Avant toute ouverture d'un débit production, Komerce doit posséder un fait local stable permettant de reconstruire :

    quelle obligation fournisseur est payée
    → pour quelle PO
    → chez quel provider
    → avec quelle clé idempotente
    → pour quel montant attendu
    → quel montant le provider dit avoir traité
    → dans quelle devise
    → avec quelle référence provider
    → si un débit réel a réellement été prouvé

## Contrat canonique

La table `supplier_execution_payments` porte :

- `payment_execution_key` : clé locale stable réutilisée lors de tout retry ;
- cible exacte : un `supplier_execution_order_id` XOR un `supplier_execution_group_id` ;
- `expected_amount` ;
- `observed_amount` ;
- `currency` ;
- `payment_ref` éventuelle ;
- `status` : prepared / requested / succeeded / ambiguous / rejected ;
- `reconciliation_status` : pending / matched / mismatched / unverified ;
- `real_debit_verified`.

## Invariants

- même provider + même `payment_execution_key` = une seule tentative canonique ;
- la cible du paiement appartient à la même PO et au même provider ;
- un paiement sandbox peut être `succeeded + matched` tout en gardant `real_debit_verified=false` ;
- `real_debit_verified=true` n'est autorisé que pour un paiement `succeeded` ;
- aucun token, credential ni payload provider brut n'est persisté ;
- un timeout après appel provider doit produire `ambiguous`, jamais un retry aveugle ;
- un retry ne peut appeler de nouveau le provider qu'après une stratégie de read-back/recovery prouvée.

## Frontière avec la comptabilité

Ce modèle prouve le fait de paiement fournisseur.

Il ne crée pas à lui seul :
- une écriture comptable B2B ;
- une ventilation marché ;
- un rapprochement B2C↔B2B ;
- un statut `ECONOMICALLY_CLOSED`.

Ces opérations appartiennent aux autorités Finance existantes et seront branchées après preuve du paiement réel.

## État actuel

Après migration 280 :

    payment fact persistence = READY
    sandbox amount consistency = PROVEN
    production provider debit = UNPROVEN
    ambiguous debit recovery = UNPROVEN
    B2B accounting reconciliation = UNPROVEN


## Lifecycle applicatif

Le service `supplier-payment-state.js` applique la machine suivante :

```
prepared
  → requested
      → succeeded
      → rejected
      → ambiguous
```

Règles de sûreté :

- seul `prepared` autorise un premier appel provider ;
- `requested` bloque un appel concurrent ;
- `ambiguous` ne peut jamais être rejoué aveuglément : une réconciliation/read-back est obligatoire ;
- `succeeded` interdit tout second paiement ;
- `rejected` exige une décision/revue explicite avant une nouvelle tentative ;
- un même `payment_execution_key` rejoué avec un scope, montant, devise ou target différent est refusé.

Ce service n'appelle aucun provider. Il prépare la frontière de sûreté pour le futur orchestrateur de paiement.
