# STATUS — Boutique-first shared cart cleanup

Date : 2026-05-25
Branche : `cleanup-disable-collective-workspaces`

## Décision

Le panier partagé boutique remplace l'ancien modèle `collective workspace / panier événement collectif`.

Doctrine produit :

```txt
Tout commence dans la boutique.
Tout se comprend dans la boutique.
Tout revient dans la boutique.
```

Le panier partagé doit rester une capacité naturelle du panier boutique, pas un produit parallèle ni un workspace autonome.

## Runtime actif

Actif :

```txt
/api/shared-carts/*
/api/admin/shared-carts/*
/cart/shared/:token
/account/shared-carts
boutique onglet Groupe
```

Règles fortes déjà en place :

- création depuis le panier boutique ;
- téléphone créateur invité ;
- restauration `/mine` ;
- sidebar/bannière/onglet Groupe ;
- finalisation uniquement si `fully_funded` ;
- garde financière Stripe webhook ;
- pas de surfinancement silencieux ;
- refund queue admin ;
- mark-refunded manuel avec audit.

## Runtime legacy désactivé

Désactivé / tombstone :

```txt
/api/collective-workspaces
/api/collective-payments
/event/*
/workspace/*
```

Comportement attendu :

- anciennes pages HTML `/event/*` et `/workspace/*` redirigent vers `/boutique` ;
- API collective retourne `410 collective_workspace_disabled` ;
- orchestrateur collectif ne lance plus de cron ;
- aucune création/capture de paiement collectif legacy.

## Ce qui reste conservé temporairement

Conservé pour référence technique/historique :

- tables `collective_*` ;
- migrations historiques ;
- services secondaires `collective-*` non exposés ;
- pages `public/boutique/event/*` non routées comme produit actif.

Aucune suppression DB destructrice dans cette étape.

## Documents boutique alignés

Document ajouté :

```txt
public/boutique/docs/DOCTRINE_BOUTIQUE_FIRST_SHARED_CART.md
```

Il devient la référence boutique pour :

- doctrine boutique-first ;
- différence avec l'ancien workspace ;
- règles UX autorisées/interdites ;
- surfaces actives/désactivées.

## Tests manuels attendus

1. `/boutique` fonctionne.
2. `/cart/shared/:token` fonctionne.
3. `/api/shared-carts/*` fonctionne.
4. `/event/create` redirige vers `/boutique`.
5. `/event/w/xxx` redirige vers `/boutique`.
6. `/workspace/xxx` redirige vers `/boutique`.
7. `/api/collective-workspaces` retourne `410 collective_workspace_disabled`.
8. `/api/collective-payments/xxx` retourne `410 collective_workspace_disabled`.
9. Les logs Railway indiquent que le cron collectif n'est pas lancé.

## Prochain nettoyage possible

Étape suivante, seulement après validation runtime :

- retirer les pages `public/boutique/event/*` ;
- déplacer ou archiver les services `collective-*` ;
- mettre à jour `CARTOGRAPHY_360.md` et `SCHEMA.md` si on décide de supprimer les surfaces/tables ;
- supprimer les tables `collective_*` uniquement via migration explicite, après sauvegarde et décision métier.
