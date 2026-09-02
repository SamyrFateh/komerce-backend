# Dette de contrat — réponses UNKNOWN

Ces routes sont exposées mais leur forme de réponse n'est pas couverte.
Pour chaque route : ajouter un test d'intégration qui asserte sur `.body`
puis relancer `npm run contract:generate`.

- `DELETE /api/auth/passkey/credentials`
- `GET /api/tracking`
- `GET /api/loyalty`
- `POST /api/pickup/verify`
- `POST /api/pickup/collect`
- `GET /api/admin/workspaces/pricing/market/{marketCode}`
- `POST /api/admin/workspaces/pricing/market/{marketCode}/cost-components/{key}/update`
- `POST /api/admin/workspaces/pricing/market/{marketCode}/cost-components/{key}/toggle`
- `POST /api/admin/workspaces/pricing/market/{marketCode}/cost-components/{key}/reset`
- `GET /api/dashboard`
- `POST /api/hub-dash/start-prep/{id}`