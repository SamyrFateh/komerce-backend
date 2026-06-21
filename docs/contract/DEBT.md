# Dette de contrat — réponses UNKNOWN

Ces routes sont exposées mais leur forme de réponse n'est pas couverte.
Pour chaque route : ajouter un test d'intégration qui asserte sur `.body`
puis relancer `npm run contract:generate`.

- `POST /api/shared-carts/from-cart-items`
- `GET /api/shared-carts/mine`
- `GET /api/parcels`
- `GET /api/v2/parcels`
- `POST /api/scans`
- `GET /api/hub/pending`
- `GET /api/hub/inventory/buffer`
- `GET /api/hub/inventory/proposals`
- `GET /api/tracking`
- `GET /api/wallet`
- `GET /api/logistics/shipments`
- `GET /api/categories`
- `GET /api/relais/public`
- `GET /api/loyalty`
- `POST /api/pickup/verify`
- `POST /api/pickup/collect`
- `GET /api/unsold/stats/summary`
- `GET /api/dashboard`
- `POST /api/hub-dash/start-prep/{id}`
- `GET /api/transitaire/parcels`
- `POST /api/simulator/start`
- `GET /api/simulator/status`