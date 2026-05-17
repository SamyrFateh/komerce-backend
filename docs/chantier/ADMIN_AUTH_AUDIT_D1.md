# D1 — Audit couverture auth routes admin

> Date : 2026-05-17
> Scope : audit/documentation uniquement

## Résumé

Audit de premier niveau des routes montées sous `/api/admin/*` et assimilées.

Aucun oubli évident d'authentification admin n'a été trouvé sur les routes inspectées.

Aucune correction de logique métier n'a été appliquée dans ce lot.

## Point de montage principal

`server.js` monte notamment les routes admin suivantes :

- `/api/admin/finance`
- `/api/admin/pilotage`
- `/api/admin/stats`
- `/api/admin/customs-shipments`
- `/api/admin/customs-categories`
- `/api/admin/boutique-categories`
- `/api/admin/pricing-components`
- `/api/admin/cost-components`
- `/api/admin/shared-carts`
- `/api/admin/risk-provisions`
- `/api/admin/dashboard`
- `/api/admin/costing`
- `/api/admin`
- `/api/admin/rules`
- `/api/admin/radar`
- `/api/admin/economic`
- `/api/admin/finance-config`
- `/api/admin/loyalty`
- `/api/admin/sourcing`
- `/api/admin/signals`
- `/api/admin/pricing-matrices`

## Routes inspectées

### `routes/admin.js`

Le fichier définit un guard commun :

```js
const guard = [authenticate, requireRole(['admin'])];
```

Les endpoints admin inspectés utilisent `...guard`, notamment :

- `GET /orders`
- `DELETE /orders/:id`
- `GET /customs`
- `GET /partners`
- `GET /partners/stats`
- `GET /partners/:id`
- `POST /partners`
- `PUT /partners/:id`
- `DELETE /partners/:id`
- `POST /reset`
- `GET /counts`
- `POST /seed-test`

Note : `POST /reset` et `POST /seed-test` ont en plus un garde production via `NODE_ENV === 'production' && ALLOW_SEED !== 'true'`.

### `routes/admin-rules.js`

Les endpoints utilisent `authenticate, requireAdmin` directement :

- `GET /`
- `GET /audit`
- `GET /:key`
- `PATCH /:key`
- `POST /:key/reset`

### `routes/admin-finance-config.js`

Le fichier définit :

```js
const adminOnly = [authenticate, requireAdmin];
```

Les endpoints `GET /schema`, `GET /`, `PUT /` utilisent ce guard.

### `routes/admin-loyalty.js`

Le fichier définit :

```js
const adminOnly = [authenticate, requireAdmin];
```

Les endpoints `GET /pending`, `POST /reward/:id`, `POST /skip/:id`, `GET /history`, `GET /stats` utilisent ce guard.

### `routes/admin-dashboard.js`

Les endpoints inspectés utilisent `authenticate, requireAdmin`, avec cache applicatif quand nécessaire.

### `routes/admin-costing.js`

Les endpoints inspectés utilisent `authenticate, requireAdmin`.

### `routes/admin-radar.js`

Les endpoints inspectés utilisent `authenticate, requireAdmin`.

### `routes/economic-engine.js`

Le routeur applique un guard global :

```js
router.use(authenticate, requireAdmin);
```

### `routes/shared-cart.js` — `adminRouter`

Les endpoints admin partagés utilisent `authenticate, requireAdmin` :

- `GET /`
- `GET /:id`
- `POST /:id/expire`
- `POST /:id/extend`
- `POST /:id/note`

## Conclusion D1

D1 peut être considéré comme validé côté audit de couverture des routes admin principales.

Aucune route admin montée et inspectée n'a été trouvée ouverte sans `authenticate` + `requireAdmin` ou `requireRole(['admin'])`.

## Suivi recommandé

- Garder D3 séparé pour `auth-guest.js`.
- Garder D4 séparé pour QR / pickup-secret.
- Garder D5 séparé pour `.env.example` vs prod.
- Une future passe automatisée peut scanner tous les fichiers `routes/admin*.js` et échouer en CI si un `router.get/post/put/delete/patch` admin est ajouté sans guard.
