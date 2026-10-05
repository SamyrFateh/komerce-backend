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


## Recovery provider après résultat ambigu

Pour CJ, le recovery est asymétrique par sécurité :

- tous les sous-ordres observés dans un état post-paiement connu + montant observé = montant attendu → l'état local `ambiguous` peut être résolu en `succeeded` ;
- sous-ordres encore `UNPAID/CREATED/IN_CART` → simple observation, **jamais** une autorisation automatique de repayer ;
- états mixtes ou inconnus → unresolved ;
- mismatch de montant → unresolved ;
- dans tous les cas de ce lot, `real_debit_verified=false` reste explicite.

Raison : une lecture négative ou retardée ne prouve pas qu'un premier débit n'a pas été pris en compte. Seule une preuve positive peut fermer l'ambiguïté sans nouveau side-effect.


## Orchestration provider-neutral

Le service `supplier-payment-orchestrator.js` encadre le futur side-effect provider :

```
prepare/replay same payment fact
→ canInvokeProviderPayment
→ mark requested
→ invoke provider once
→ succeeded | rejected | ambiguous
```

Invariants :

- `requested` est persisté avant le side-effect provider ;
- une exception provider non explicitement classée est `ambiguous`, jamais un retry local ;
- un résultat provider non concluant est `ambiguous` ;
- un rejet explicitement déterministe peut devenir `rejected` ;
- `ambiguous` et `succeeded` bloquent toute nouvelle invocation ;
- le provider est injecté : ce service ne connaît aucun endpoint CJ et reste provider-neutral.

Ce lot ne branche encore aucun endpoint de paiement production.


## Preuve d'un débit monétaire réel

Le statut provider `paid` ou l'état post-paiement d'un ordre ne suffit pas à établir un débit réel.

Pour autoriser `real_debit_verified=true`, Komerce exige simultanément :

- paiement local `succeeded` ;
- `reconciliation_status=matched` ;
- provider identique ;
- montant observé = montant attendu ;
- devise identique ;
- `payment_ref` stable ;
- `proof_source` monétaire explicite ;
- `proof_ref` stable vers le fait de débit ;
- `debit_confirmed=true` ;
- `sandbox=false` ;
- `simulated=false`.

Exemples de preuves admissibles à terme : transaction de balance provider, journal de wallet provider, ou autre ledger financier provider documenté et relisible.

Ne sont jamais suffisants seuls :

- réponse `payBalanceV2: paid` ;
- statut d'ordre `UNSHIPPED/PROCESSING` ;
- `simulatePay` ;
- `payBalanceV2` sur commandes `isSandbox=1`.

Cette frontière appartient à Purchasing. La projection de ce fait vers les coûts/comptes B2B appartient ensuite à Economic Engine/Finance et doit rester un consommateur, pas un second écrivain du fait de paiement fournisseur.


## Conservation de la preuve monétaire

Les preuves positives de débit sont conservées dans `supplier_execution_payment_proofs`.

Chaque preuve contient uniquement des faits bornés :

- `supplier_payment_id` ;
- `provider` ;
- `proof_source` ;
- `proof_ref` ;
- identifiant d'ordre provider éventuel ;
- `payment_ref` éventuelle ;
- montant observé ;
- devise ;
- indicateurs `debit_confirmed`, `sandbox`, `simulated` ;
- date provider éventuelle ;
- faits provider minimaux sanitisés.

Jamais de payload brut ni de credential.

Une preuve native est unique par `provider + proof_source + proof_ref`. Un replay identique est idempotent ; rattacher la même preuve à un autre paiement est interdit.

### CJ

Pour CJ, la preuve cible est `POST /shopping/wallet/billingHistory`.

Une écriture est admissible lorsqu'elle correspond de façon unique à :

- l'ordre CJ attendu ;
- `typeDesc = Order Payment` ;
- `paymentTypeDesc = Balance` ;
- statut success ;
- montant attendu ;
- mouvement débiteur.

Le `billingHistory.id` devient le `proof_ref` durable.

Cette preuve reste distincte de la réponse `payBalanceV2` et du read-back de statut d'ordre.


## Rapprochement runtime CJ

Le service cj-billing-history-reconciliation.js ne déclenche aucun paiement provider.

Flux canonique : paiement fournisseur succeeded + matched, résolution des sous-ordres CJ, lecture billingHistory, agrégation, preuve unique, vérification real debit, persistance de la preuve, puis promotion real_debit_verified.

Règles : déjà vérifié = no-op ; état local non prêt = refus avant lecture ; zéro preuve = non vérifié ; plusieurs preuves = ambigu ; preuve rejetée = aucune persistance ; aucune mutation provider.
