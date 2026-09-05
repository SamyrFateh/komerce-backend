# Market Operator Provisioning

## Autorité

`users.role = market_operator` identifie un opérateur partenaire. Ce rôle seul ne donne accès à aucun pays : l’autorité effective vient exclusivement d’un grant actif `operator_market_scopes` résolu côté serveur.

- `viewer` : lecture des surfaces market-scoped autorisées, y compris l’Atelier des coûts ;
- `manager` : mêmes lectures + mutations des overrides de coûts du marché ;
- révocation : `revoked_at` / `revoked_by`, jamais `DELETE` ;
- un grant pays ne confère jamais `pricing_global_access_grants`.

## Provisioning central

Routes strictement `admin` :

- `GET /api/admin/market-operators` — liste les comptes partenaires et leurs grants actifs ;
- `POST /api/admin/market-operators` — crée un compte `market_operator` via `user-mutation-service` et son premier grant pays dans une transaction ;
- `PUT /api/admin/market-operators/:userId/markets/:marketCode` — attribue ou change le rôle du grant pays ;
- `DELETE /api/admin/market-operators/:userId/markets/:marketCode` — révoque le grant actif en conservant l’historique.

Le code marché (`CM`, `CG`, etc.) est une référence publique résolue côté serveur. Aucun `market_id` fourni par le navigateur n’est utilisé comme autorité.

## Atelier des coûts

- `GET /api/admin/workspaces/pricing/market/:marketCode` : `viewer` ou `manager` ;
- `POST .../cost-components/:key/update` : `manager` seulement ;
- `POST .../cost-components/:key/toggle` : `manager` seulement ;
- `POST .../cost-components/:key/reset` : `manager` seulement.

Une autorité Pricing globale centrale explicite reste autorisée à intervenir sur un override pays. Un `market_operator` ne peut jamais emprunter cette branche globale.

## Invariants

1. La frontière pays est le grant serveur `(user_id, market_id, role)` actif, jamais un paramètre navigateur.
2. `viewer` ne produit aucun effet de bord économique.
3. Un changement `viewer -> manager` ou `manager -> viewer` révoque l’ancien grant et en crée un nouveau : l’historique n’est jamais réécrit.
4. La création de l’identité passe par `auth-identity/user-mutation-service`; Market ne réimplémente pas l’INSERT `users`.
5. Les overrides de coûts restent isolés par marché et héritent du modèle central quand aucune valeur locale n’existe.
