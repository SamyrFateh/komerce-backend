# Doctrine — Supplier Reconciliation

## But

La réconciliation fournisseur prouve la correspondance entre un fait attendu par Komerce et un fait réellement observé chez le provider.

Elle ne signifie jamais simplement « une commande existe ».

Le contrat canonique est :

```text
expected
  → observed provider fact
  → bounded evidence
  → canonical verdict
```

## Scopes

Trois scopes sont distincts et ne doivent pas être fusionnés :

```text
ORDER
PAYMENT
FULFILLMENT
```

### ORDER

Prouve que l'engagement fournisseur observé correspond exactement à la PO Komerce.

Exemples de faits comparables :
- provider ;
- Supplier Order Identity / exact unit ;
- quantité ;
- montant natif ;
- devise ;
- external_ref / supplier_order_id ;
- statut provider relu.

### PAYMENT

Prouve que le débit réel correspond à l'obligation fournisseur attendue.

Ce scope consomme la doctrine `DOCTRINE_SUPPLIER_PAYMENT_FACT.md` et ne peut pas déduire un débit à partir d'un simple statut d'ordre.

### FULFILLMENT

Prouve que l'expédition / le tracking observé correspond à l'engagement fournisseur attendu.

Ce scope reste CLOSED tant qu'un provider réel n'a pas fourni une preuve suffisante. Aucun tracking générique n'est inventé par anticipation.

## Verdicts canoniques

```text
MATCHED
NOT_FOUND
MISMATCH
AMBIGUOUS
PENDING
```

Règles :

- `MATCHED` : une correspondance exacte et unique est prouvée ;
- `NOT_FOUND` : aucun fait provider correspondant n'est observé ;
- `MISMATCH` : un fait est observé mais diffère sur une donnée requise ;
- `AMBIGUOUS` : plusieurs faits plausibles existent ou l'observation ne permet pas un match unique ;
- `PENDING` : le provider expose un état transitoire connu et aucun verdict terminal ne peut encore être posé.

Tout verdict autre que `MATCHED` exige une raison explicite.

## Fail-closed

La réconciliation ne transforme jamais l'absence de preuve en succès.

```text
0 match exact      → NOT_FOUND
1 match exact      → MATCHED
>1 match plausible → AMBIGUOUS
fait incompatible  → MISMATCH
état transitoire   → PENDING
```

## Frontières d'autorité

- Purchasing possède la réconciliation ORDER et PAYMENT fournisseur.
- Logistics possède les mouvements physiques et le tracking client/transporteur.
- Supplier Connectivity possède les contrats provider/adapters et la traduction de leur vocabulaire natif.
- Le coeur canonique ne doit pas interpréter un statut provider privé.

## Compatibilité

Le contrat est ajouté sans remplacer brutalement les frontières existantes.

Les adaptateurs actuels peuvent continuer à exposer leur résultat legacy tant qu'une migration dédiée ne les projette pas vers ce contrat canonique.

Aucune capability provider n'est promue par la seule existence de ce fichier.
