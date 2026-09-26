# Validation produit par marché — interface simple

## Objectif

Les Responsables pays ne voient jamais la Raffinerie, TERMIUM, les hashes,
les Supplier Order Identities ni les détails internes de préparation.

Ils voient uniquement les produits que le catalogue central considère déjà
comme **prêts à être décidés par un marché**.

## Parcours

```text
produit candidat prêt
        ↓
file "Nouveaux produits" du marché
        ↓
Responsable pays
   ├─ Valider pour ce marché
   │      ↓
   │   publication globale via l'autorité catalog si nécessaire
   │      ↓
   │   exposition ENABLED pour ce marché
   │
   └─ Ne pas retenir
          ↓
       exposition DISABLED pour ce marché
```

Un produit non retenu sur un marché peut toujours être retenu sur un autre.
Le catalogue produit reste unique ; seule la projection pays varie.

## Ce que le Responsable pays voit

Pour chaque nouveau produit :

- image ;
- titre français ;
- catégorie / sous-catégorie ;
- stock lisible ;
- lien vers la fiche ;
- **Valider pour ce marché** ;
- **Ne pas retenir**.

Aucun détail Raffinerie n'est exposé.

## Critères serveur avant apparition dans la file

Le produit doit déjà être :

- `lifecycle_status='candidate'` ;
- `is_active=false` ;
- `content_source='manual'` ;
- `needs_review=false` ;
- sans décision `product_market_exposure` pour ce marché ;
- accepté par `product-publication-guard` (nom, catégorie, prix, stock,
  description, média catalogue).

Les produits qui ne remplissent pas ces critères restent invisibles pour le
Responsable pays. Ils demeurent une responsabilité des couches internes.

## Autorité

Le Responsable pays agit via la capability `catalog.expose`.

Lors d'une validation positive :

1. `market-delegation` résout l'autorisation serveur pour le Market ID ;
2. si le produit n'est pas encore globalement actif, la première publication
   est déléguée à `catalog-approval`, propriétaire du lifecycle produit ;
3. dans la même transaction, `product_market_exposure` devient `ENABLED`
   pour le marché ;
4. la décision est auditée.

Ainsi, le Dashboard pays n'écrit jamais directement `products`.

## Fail-closed

- absence de décision marché = masqué ;
- refus marché = `DISABLED` ;
- validation marché = `ENABLED` ;
- un échec de première publication annule toute la transaction ;
- le cap catalogue et les guards restent appliqués côté `catalog`.

## UX

Les libellés visibles sont volontairement métier :

- **Nouveaux produits**
- **À valider**
- **Valider pour ce marché**
- **Ne pas retenir**
- **Produits déjà publiés**
- **Visible / Masqué**

Les termes techniques internes ne doivent jamais apparaître sur cette surface.
