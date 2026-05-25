# Komerce — Status Produit & Runtime

Dernière mise à jour : 2026-05-25

## Doctrine actuelle

Komerce suit désormais une doctrine **boutique-first** :

> Tout commence dans la boutique.  
> Tout se comprend dans la boutique.  
> Tout revient dans la boutique.

Le panier partagé n'est pas un produit séparé, ni un workspace autonome. C'est une capacité naturelle du panier boutique :

```txt
parcourir la boutique
→ remplir le panier
→ choisir "payer ensemble"
→ partager le lien
→ recevoir les contributions
→ finaliser la commande quand le panier est entièrement financé
```

Objectif UX : léger, intuitif, mobile-first, compréhensible par WhatsApp et par des utilisateurs non techniques.

## Modèle actif : panier partagé boutique

Le modèle actif est le panier partagé porté par :

- routes API : `/api/shared-carts/*`
- pages publiques : `/cart/shared/:token`
- compte client : `/account/shared-carts`
- logique front boutique : onglet Groupe, side cart, bannière, contribution, finalisation
- garde financière webhook Stripe
- file admin des remboursements manuels

### Règles fortes

- La boutique reste le point d'entrée principal.
- Le panier est créé depuis le panier boutique réel.
- Les contributions sont libres en montant, mais bornées par le reste à financer.
- Stripe webhook est la source de vérité financière.
- Le backend empêche tout surfinancement silencieux.
- Un paiement tardif/non comptabilisable devient une exception visible :
  - contribution `failed`
  - `metadata.requires_manual_refund = true`
  - remontée dans `/api/admin/shared-carts/refund-queue`
  - clôture manuelle via `mark-refunded`
- La finalisation commande est autorisée uniquement si le panier est `fully_funded`.
- Aucun remboursement automatique Stripe au MVP.

## Ancien modèle désactivé : collective workspace

L'ancien modèle **Panier Événement Collectif / Collective Workspace** est déclassé.

Il était plus lourd :

```txt
workspace
→ intentions
→ review
→ réservation stock
→ payment session
→ close
→ order
```

Ce modèle ne correspond plus à la doctrine actuelle, car il crée un produit parallèle à la boutique et ajoute trop de phases visibles pour l'utilisateur.

### Décision

Le modèle `collective-workspaces` est conservé temporairement dans le dépôt pour référence technique et historique, mais il n'est plus exposé comme runtime produit.

### Runtime désactivé

Les montages API suivants sont désactivés dans `server.js` :

- `/api/collective-workspaces`
- `/api/collective-payments`
- webhook `/api/collective-payments/stripe/webhook`
- cron `collectivePaymentOrchestrator.startExpirationCron(...)`

Les anciennes pages HTML sont redirigées vers `/boutique` :

- `/event/create`
- `/event/manage/:creatorToken`
- `/event/w/:publicToken`
- `/event/pay/:paymentToken`
- `/event/:creatorToken/manage`
- `/workspace/:publicToken`

## Ce qui n'est pas supprimé pour l'instant

Pour éviter une suppression destructrice prématurée, les fichiers, services et tables liés au collectif peuvent rester présents :

- `routes/collective-workspaces.js`
- `services/collective-*`
- tables `collective_*`
- pages `public/boutique/event/*`

Ils ne doivent plus être utilisés comme surface produit active.

## Politique de nettoyage progressive

1. D'abord démonter le runtime.
2. Rediriger les anciennes entrées utilisateur vers la boutique.
3. Documenter la décision dans ce fichier.
4. Observer qu'aucun trafic utile ne dépend encore des anciennes routes.
5. Supprimer ou archiver les fichiers legacy dans une PR séparée.
6. Ne supprimer les tables DB que via migration explicite, après sauvegarde et décision métier.

## Prochaines évolutions autorisées

Les idées issues de l'ancien modèle peuvent être reprises uniquement si elles restent boutique-first :

- délai simple de contribution : 24h / 3 jours / 7 jours
- montant indicatif moyen par participant
- rôle léger du créateur
- clôture claire et lisible
- messages WhatsApp de suivi

Interdit de réintroduire :

- workspace séparé comme produit principal
- intentions complexes avant paiement
- préautorisation collective lourde
- parcours événement parallèle
- vocabulaire technique visible côté client

## État résumé

```txt
ACTIF      : panier partagé boutique
DÉSACTIVÉ  : collective workspace runtime
CONSERVÉ   : code legacy pour référence temporaire
DOCTRINE   : boutique-first, simple, fluide, opérable
```
