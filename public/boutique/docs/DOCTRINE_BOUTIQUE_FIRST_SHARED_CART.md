# Komerce Boutique — Doctrine Boutique-First du Panier Partagé

Dernière mise à jour : 2026-05-25

## Décision produit

Le panier partagé est désormais une capacité native de la boutique, pas un produit séparé.

Doctrine :

```txt
Tout commence dans la boutique.
Tout se comprend dans la boutique.
Tout revient dans la boutique.
```

Le client ne doit pas avoir l'impression de basculer vers un outil événementiel ou un workspace autonome. Il reste dans l'expérience d'achat Komerce.

## Parcours cible

```txt
Parcourir la boutique
→ ajouter des produits au panier
→ choisir "payer ensemble"
→ partager le lien
→ recevoir les contributions
→ suivre l'avancement dans l'onglet Groupe
→ finaliser quand le panier est entièrement financé
```

## Pourquoi l'ancien workspace est désactivé

L'ancien modèle `collective workspace` était plus lourd :

```txt
workspace
→ intentions
→ review
→ réservation stock
→ session de paiement
→ close
→ commande
```

Il avait de bonnes idées, mais il introduisait trop de phases visibles, trop de vocabulaire technique et une logique parallèle à la boutique.

Le modèle retenu doit rester plus souple :

- panier réel de la boutique comme point de départ ;
- création immédiate d'un lien partagé ;
- contribution libre en montant ;
- suivi léger ;
- finalisation uniquement quand le total est atteint ;
- exceptions financières traitées côté backend/admin.

## Ce qui est autorisé pour les évolutions futures

Les évolutions suivantes sont compatibles avec la doctrine si elles restent simples côté utilisateur :

- délai de contribution pré-défini : 24h / 3 jours / 7 jours ;
- montant indicatif moyen par participant ;
- rôle léger du créateur ;
- bouton de clôture clair ;
- messages WhatsApp de suivi ;
- statut lisible dans l'onglet Groupe.

## Ce qui est interdit

Ne pas réintroduire :

- un workspace autonome comme produit principal ;
- un parcours événement séparé ;
- des intentions complexes avant paiement ;
- une préautorisation collective lourde ;
- un vocabulaire technique visible côté client ;
- une logique qui oblige à quitter la boutique pour comprendre le panier.

## Règles UX

- Le panier partagé doit être visible comme une option du panier.
- L'onglet Groupe sert au suivi, pas à recréer un back-office.
- Le créateur ne doit pas devenir administrateur d'un projet complexe.
- Le contributeur doit comprendre en une phrase quoi faire.
- WhatsApp reste le canal naturel de partage.

## Règles backend associées

- Stripe webhook est la source de vérité financière.
- Le backend empêche le surfinancement silencieux.
- Un paiement tardif devient une exception visible et opérable.
- La finalisation commande est bloquée tant que le panier n'est pas `fully_funded`.
- Aucun remboursement automatique Stripe au MVP.

## État runtime

Actif :

```txt
/api/shared-carts/*
/cart/shared/:token
/account/shared-carts
boutique onglet Groupe
```

Désactivé :

```txt
/api/collective-workspaces
/api/collective-payments
/event/*
/workspace/*
```

Les anciennes surfaces peuvent rester en code temporairement, mais elles ne sont plus la direction produit.
