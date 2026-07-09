# Dette de contrat — réponses UNKNOWN

## 2026-07-09 — Compteur réinitialisé (D-06)

Le compteur `x-contract-debt.unknown_responses` était figé à **8** depuis un ancien
run de `contract-generate.js`. Vérification directe du JSON : **0 route** avec
`x-contract-status: UNKNOWN` dans les paths. Total réel : **483 routes** (était 429).
Compteur corrigé.

Les 6 routes ci-dessous + les 4 routes approval-queue (§ 2026-07-07) ont toutes
été couvertes entre-temps (statut `route-read`).

---

### Routes historiquement UNKNOWN (désormais couvertes)

- `GET /api/tracking` — couvert (route-read)
- `GET /api/loyalty` — couvert (route-read)
- `POST /api/pickup/verify` — couvert (route-read)
- `POST /api/pickup/collect` — couvert (route-read)
- `GET /api/dashboard` — couvert (route-read)
- `POST /api/hub-dash/start-prep/{id}` — couvert (route-read)
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
