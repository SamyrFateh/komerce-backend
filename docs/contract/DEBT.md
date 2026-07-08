# Dette de contrat — réponses UNKNOWN

Ces routes sont exposées mais leur forme de réponse n'est pas couverte.
Pour chaque route : ajouter un test d'intégration qui asserte sur `.body`
puis relancer `npm run contract:generate`.

- `GET /api/tracking`
- `GET /api/loyalty`
- `POST /api/pickup/verify`
- `POST /api/pickup/collect`
- `GET /api/dashboard`
- `POST /api/hub-dash/start-prep/{id}`
## 2026-07-07 — Routes approval-queue ajoutées manuellement

Les 4 routes de `routes/admin/catalog-approval.js` (`GET /api/admin/catalog/approval-queue`,
`POST …/{id}/approve`, `POST …/{id}/reject`, `POST …/{id}/override`) ont été ajoutées
au contrat avec `x-contract-status: UNKNOWN` car `contract-generate.js` n'avait pas
été relancé après leur création. À régulariser au prochain `npm run contract:generate`
(les schémas de réponse seront alors extraits automatiquement).
