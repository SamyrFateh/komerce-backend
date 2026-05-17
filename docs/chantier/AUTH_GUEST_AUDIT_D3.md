# D3 — Audit `auth-guest.js`

> Date : 2026-05-17
> Scope : audit/documentation uniquement

## Résumé

Audit du middleware `middleware/auth-guest.js` et de ses usages directs.

Aucune correction de logique métier n'a été appliquée dans ce lot.

Le middleware est fonctionnel pour le flux guest checkout, mais plusieurs risques doivent rester suivis avant Go Live.

## Usages inspectés

### `routes/orders/create.js`

`POST /api/orders` utilise :

```js
router.post('/', authenticateOrCreateGuest, validate(orders.create), async (...)
```

Effet : une commande peut être créée avec un utilisateur existant ou un guest créé à la volée à partir des téléphones fournis.

### `routes/shared-cart.js`

`POST /api/shared-carts/from-cart-items` utilise :

```js
router.post('/from-cart-items', authenticateOrCreateGuest, async (...)
```

Effet : le panier partagé peut être créé depuis le localStorage boutique sans compte préalable.

Les autres routes shared-cart owner (`/mine`, `/:id`, `/:id/finalize`, `/:id/cancel`) utilisent `authenticate`, pas `authenticateOrCreateGuest`.

## Garanties constatées

- Accepte un JWT existant via cookie `kmrc_jwt` ou header `Bearer`.
- Vérifie le JWT avec l'algorithme `HS256`.
- Recharge l'utilisateur depuis la DB si absent du cache.
- Si le token est invalide ou expiré, bascule vers la création guest au lieu de crasher.
- Identifie le guest par `tracking_phone` en priorité, sinon `recipient_phone`.
- Normalise uniquement les téléphones déjà E.164 (`+...`) ou préfixés `00`.
- Refuse les numéros locaux ambigus sans indicatif.
- Réutilise un utilisateur existant via `phone_payer`, avec fallback legacy sur `phone`.
- Met à jour `phone_payer` pour les anciens users si manquant.
- Met à jour `phone_beneficiary` à chaque nouvelle commande/panier.
- Pose un cookie `httpOnly`, `secure` en production, `sameSite: Strict`, `path: /`.
- Cache utilisateur en mémoire limité à 10 000 entrées et TTL 5 minutes.

## Risques et limites à suivre

### 1. Race condition de création guest

Deux requêtes simultanées avec le même téléphone peuvent toutes deux ne pas trouver de user puis tenter une création.

La robustesse dépend donc des contraintes DB existantes sur `users.phone_payer` ou `users.phone`.

Action recommandée : vérifier l'existence d'un index unique ou gérer `ON CONFLICT` côté création guest.

### 2. Cookie `sameSite: Strict`

Bon pour la sécurité, mais peut gêner certains retours intersites selon les parcours paiement/partage.

Action recommandée : confirmer les parcours front réels avant Go Live.

### 3. JWT_SECRET capturé au chargement du module

Le middleware lit `process.env.JWT_SECRET` au chargement.

C'est cohérent avec le runtime Node, mais un secret manquant au boot doit rester bloquant côté serveur.

Action recommandée : garder `JWT_SECRET` dans les variables strictement obligatoires.

### 4. Rattachement par téléphone payeur

Le modèle est volontaire : le payeur est l'identité stable. Cela peut néanmoins fusionner des historiques si un numéro est partagé familialement.

Action recommandée : accepter ce compromis pour le MVP ou prévoir une vérification OTP ultérieure.

### 5. Cache utilisateur mémoire

Le cache est local au process. En multi-instance, il n'est pas partagé.

Impact limité : c'est un cache de lecture, pas une source de vérité. Les updates passent par DB.

## Conclusion D3

D3 est validé côté audit.

Aucun bug évident nécessitant correction immédiate n'a été trouvé dans le scope limité.

Les points à suivre doivent rester dans les lots D5/D6 ou dans une issue dédiée si l'on veut durcir la création guest avant Go Live.
