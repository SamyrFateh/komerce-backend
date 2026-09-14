# Doctrine — Shadow ingestion V2

## Statut

PR 2 active le premier writer runtime vers `Source -> Capture -> Observation`.
Il reste strictement **shadow** : aucune lecture de production ne depend de ces tables et aucune autorite historique ne bascule.

Autorites inchangees :

- `sourcing_candidates` reste le lifecycle candidat de production ;
- `products` / `product_skus` restent le catalogue canonique courant ;
- Supplier Order Identity reste l'identite commandable courante ;
- la Resolution et la Selection restent hors de ce writer.

## Frontiere

Le writer consomme uniquement des `NormalizedSupplierProduct V2` deja valides par les connecteurs/catalog.

```text
CSV / Manual / API provider
        -> NormalizedSupplierProduct V2
        -> Source
        -> Capture
        -> Observation Product
             -> Observation Offer si faits commerciaux
                  -> Observation Unit si sellable_units
```

Le chemin JSON transactionnel historique reste hors de PR 2 ; il n'est ni casse ni detourne. Son raccordement devra reutiliser exactement le meme writer apres sa propre frontiere V2, sans branche fournisseur dans le core.

## Source

La Source est une instance d'acquisition, pas le vendeur commercial.

- API : `source_id` derive du provider technique (`api:cj`, `api:aliexpress`, etc.).
- CSV / manual : `source_id` est stable par canal + fournisseur declare, avec suffixe de hash anti-collision.
- `adapter_type`, `acquisition` et `continuity` sont poses par le writer.
- les capabilities `provides` sont monotones et derivees de ce qui a effectivement ete observe (`catalog`, `offers`, `units`).
- aucun `execution_mode` n'est deduit d'une observation. Capability d'execution et readiness restent separees.
- aucun credential n'est ecrit.

## Grain des Observations

### Product

Contient uniquement les faits d'identite/descriptifs V2. `source_ref = supplier_product_id` quand il existe. Le `raw_fragment` est le `raw_payload` source du produit.

### Offer

Une observation Offer n'existe que si le V2 contient au moins un fait commercial : prix, stock, MOQ, delai ou unite vendable.

Le V2 courant ne porte pas d'identite d'offre universelle distincte du produit. Le writer laisse donc `source_ref = NULL` au grain Offer au lieu d'en fabriquer une.

### Unit

Chaque `sellable_units[]` devient une Observation Unit. `source_ref` prend `supplier_unit_ref`, sinon `supplier_sku`, tous deux deja fournis par la source/adapter. Aucune heuristique de variante n'est autorisee.

## Proprietes shadow

- une nouvelle ingestion cree toujours une nouvelle Capture et de nouvelles Observations ;
- aucune Observation existante n'est mise a jour ;
- le writer est transactionnel pour son propre lot ;
- un echec shadow ne doit jamais faire echouer l'import autoritatif historique ;
- le resultat shadow est ajoute au resume d'import pour etre observable ;
- aucune Evidence n'est calculee ici ;
- aucun MatchProposal, Binding ou CanonicalEntity n'est cree ici ;
- aucun fournisseur n'est selectionne ici.

## Etape suivante

PR 3 consommera ces Observations pour construire l'Evidence, le Candidate Retrieval puis la Resolution en shadow. Le test N+1 exigera qu'une nouvelle source compatible V2 n'impose aucune branche provider-specific dans ce writer.
