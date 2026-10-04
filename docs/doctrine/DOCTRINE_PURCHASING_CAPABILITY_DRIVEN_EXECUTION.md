# Doctrine — Capability-driven Purchasing Execution

## 1. Principe

Komerce ne doit pas imposer un workflow fournisseur théorique.

Le workflow réel est dérivé des capabilities effectivement prouvées pour le provider.

> Une capacité API prouvée est automatisée.  
> Une capacité hors API explicitement prouvée devient une étape manuelle bornée.  
> Une capacité inconnue reste bloquée.

Le manuel n'est donc pas un fallback générique. C'est une capability explicite du processus.

## 2. Modes d'exécution

### AUTO_API

Conditions :

    readiness = READY
    buildOrderPayload() disponible
    placeOrder() disponible

Conséquence :

    Komerce peut soumettre automatiquement la commande fournisseur.

Si reconcile() existe, la confirmation fournisseur peut aussi être vérifiée automatiquement.

### MANUAL_EXTERNAL

Conditions :

    readiness = READY
    buildOrderPayload() disponible
    placeOrder() absent
    manual_procurement_ready = true

Conséquence :

    Komerce prépare exactement ce qu'il faut acheter,
    mais l'acte d'achat est exécuté hors API.

L'opérateur ne redécide pas le produit, la quantité, le prix attendu ou le fournisseur.
Il ne fait que traverser la frontière externe non automatisable.

Minimum à restituer ensuite :

    external_order_reference

et, si aucun reconcile() n'existe :

    supplier_commitment_evidence

### READINESS_ONLY

Conditions :

    readiness = READY
    mais aucun chemin d'exécution complet n'est prouvé.

Exemple actuel : AliExpress readiness réelle sans buildOrderPayload/placeOrder certifiés.

Conséquence :

    la PO est préparée,
    mais Komerce ne peut ni acheter automatiquement
    ni inventer un parcours manuel.

C'est un GAP de capability, pas une tâche opérateur implicite.

### BLOCKED

La readiness elle-même n'est pas confirmée.

Aucun achat, manuel ou automatique, ne doit avancer.

## 3. Ajustement réel du modèle

Le provider détermine naturellement le workflow :

    Provider A
    evaluate + build + place + reconcile
    → full API automation

    Provider B
    evaluate + build + reconcile
    → manual checkout + automatic reconciliation

    Provider C
    evaluate only
    → readiness only, execution gap visible

    Provider D
    no readiness
    → blocked

Le coeur Purchasing reste identique.

Il ne contient pas de branche métier :

    if provider === 'allegro'
    if provider === 'aliexpress'
    if provider === 'cj'

Il consomme seulement un plan canonique.

## 4. Rôle humain

L'humain intervient uniquement là où le contrat externe l'exige.

Il ne doit jamais :
- choisir à nouveau le SKU ;
- recalculer la quantité ;
- inventer le prix ;
- substituer un fournisseur ;
- confirmer un fait que l'API peut prouver.

Il peut devoir :
- cliquer/acheter sur un portail externe ;
- saisir une référence externe ;
- joindre une preuve fournisseur ;
- résoudre une exception après échec machine.

## 5. Exemple Allegro actuel

Capabilities prouvées :

    evaluate ✓
    buildOrderPayload ✓
    placeOrder ✗
    reconcile ✓
    manual_procurement_ready ✓

Plan :

    MANUAL_EXTERNAL

Flux :

    PO exacte
    → payload exact
    → achat externe manuel
    → external checkout ref
    → reconcile()
    → confirmation automatique de la preuve

## 6. Exemple AliExpress actuel

Capabilities :

    evaluate ✓
    buildOrderPayload ✗
    placeOrder ✗
    reconcile non prouvé

Plan :

    READINESS_ONLY

Flux :

    PO exacte
    → stock/prix/fret live
    → READY
    → stop

Le système sait exactement ce qui manque avant de pouvoir poursuivre.

## 7. Exemple CJ cible

Si P0/P1/P2 prouvent :

    evaluate ✓
    buildOrderPayload ✓
    placeOrder ✓
    reconcile ✓

Plan :

    AUTO_API

Sinon, si createOrder reste hors automatisation mais un parcours externe contrôlé existe :

    MANUAL_EXTERNAL

La classification vient des preuves réelles, jamais d'une préférence de design.

## 8. Invariant

> Le workflow Purchasing est une projection des capabilities fournisseur prouvées.

Conséquence :

- l'architecture ne force pas le fournisseur à ressembler à Komerce ;
- Komerce s'adapte au réel sans perdre ses invariants ;
- le besoin manuel devient mesurable ;
- le cockpit peut afficher uniquement les actions humaines réellement nécessaires.
