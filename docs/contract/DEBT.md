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

## fully_funded — status label dans les vues admin (non bloquant)

Le `contract-check` signale `.fully_funded` comme champ consommé absent du contrat.
Il s'agit d'une **clé de mapping statut → libellé d'affichage** dans `SharedCartsView.js`
et `ct-views-shared-carts.js`, pas d'un champ de réponse API.
Le contrat n'a pas à le déclarer. À exclure du scanner via la liste `contract-check-ignore`.
