# Dashboards 360 — Canonical (généré)

> ⚠️ Fichier **généré** par `scripts/gen-dashboards-360-canonical.js`. Ne pas éditer à la main.
> Régénéré le 2026-09-12T22:43:27.731Z.
> Contrepartie de `docs/DASHBOARDS_360.md` (Legacy 1). Les deux coexistent tant que le rollback `?legacy=1` existe (`bootstrap/html-routes.js`).
> Chaîne de preuve : `navigation.js` (item × rôle) → `hrefFor()` → `app.js::surfaceForPath()` → module (`global.Komerce*`) → `fetch()` → `docs/contract/openapi.json`.

## Synthèse

- Items de navigation déclarés : **12** → **35** entrées (item × rôle visible)
- Modules JS Canonical scannés : **49**
- Arêtes API tracées (`fetch()` vers `/api/`) : **58**
- 🔴 Surfaces de navigation sans module résolu : **0**
- 🔴 Destination de navigation dont l'URL ne résout vers aucune surface connue (retombe sur Pilotage par défaut) : **0**
- 🔴 Endpoints appelés mais absents du contrat OpenAPI (statiques) : **0**
- 🟠 Endpoints appelés absents du contrat (URL dynamique — à vérifier à la main) : **8**
- ⚪ Endpoints appelés mais non prouvés par un test (`UNKNOWN` dans le contrat) : **0**
- ❓ `fetch()` dont l'URL n'a pas pu être résolue statiquement : **15**
- 🟣 Modules Canonical avec une dépendance textuelle vers Legacy 1 : **0**
- 🟡 Modules avec un motif `market_id`/`marketId` construit côté navigateur (à vérifier — le serveur rejette déjà ceci sur Action Center, cf. `rejectBrowserAuthority`) : **0**
- Modules sans header `@komerce-arch` : **0**

## 2. Signaux informatifs (non bloquants, jamais inventés)

- 🟠 Endpoint dynamique absent du contrat (à vérifier à la main) : `GET* /api/admin/workspaces/accounting/market/{param}{param}{param} (finance-accounting-workspace.js)`, `GET* /api/admin/workspaces/operations/market/{param}{param} (operations-workspace.js)`, `GET* /api/admin/workspaces/pricing/market/{param}/strategy (pricing-workspace.js)`, `GET* /api/admin/workspaces/shipping-customs/market/{param}{param} (shipping-customs-workspace.js)`, `POST /api/admin/workspaces/accounting/market/{param}{param}{param} (finance-accounting-workspace.js)`, `POST /api/admin/workspaces/operations/market/{param}{param} (operations-workspace.js)`, `POST /api/admin/workspaces/shipping-customs/market/{param}{param} (shipping-customs-workspace.js)`, `POST /api/admin/workspaces/sourcing/suppliers/{param}/{param} (sourcing-workspace.js)`
- ❓ `fetch()` non résolus statiquement : `config.chargesEndpoint (pricing-structure-event-panel.js)`, `config.submitEndpoint (pricing-structure-event-panel.js)`, `context.endpoint (action-center.js)`, `endpoint (operations.js)`, `endpoint (pilotage.js)`, `endpoint(workspace, options.requestedMarket) (pricing-workspace-simulation.js)`, `path (action-center.js)`, `url (market-autonomy.js)`, `url (market-cash-control.js)`, `url (market-catalog.js)`, `url (market-team.js)`, `url (markets-decision-bootstrap.js)`, `url (pricing-workspace.js)`, `url (settings-workspace.js)`, `url (team-invite.js)`

## 3. Matrice navigation × rôle × surface × module

| Rôle | Item nav | Destination | Surface résolue | Module(s) |
|---|---|---|---|---|
| admin | Comptabilité | `/admin/workspaces/accounting` | accounting-workspace | `finance-accounting-workspace-decision.js`, `finance-accounting-workspace.js` |
| agent_relais | Comptabilité | `/admin/workspaces/accounting` | accounting-workspace | `finance-accounting-workspace-decision.js`, `finance-accounting-workspace.js` |
| finance | Comptabilité | `/admin/workspaces/accounting` | accounting-workspace | `finance-accounting-workspace-decision.js`, `finance-accounting-workspace.js` |
| market_operator | Comptabilité | `/admin/workspaces/accounting` | accounting-workspace | `finance-accounting-workspace-decision.js`, `finance-accounting-workspace.js` |
| admin | Catalogue | `/admin/workspaces/catalog` | catalog-workspace | `catalog-workspace-decision.js`, `catalog-workspace.js` |
| market_operator | Catalogue | `/dashboards/canonical/market-catalog.html` | market-catalog | _(page HTML autonome — voir §5)_ |
| admin | Dashboard | `/admin/pilotage` | pilotage | `pilotage-decision.js`, `pilotage.js` |
| agent_hub | Dashboard | `/admin/pilotage` | pilotage | `pilotage-decision.js`, `pilotage.js` |
| agent_relais | Dashboard | `/admin/pilotage` | pilotage | `pilotage-decision.js`, `pilotage.js` |
| agent_transitaire | Dashboard | `/admin/pilotage` | pilotage | `pilotage-decision.js`, `pilotage.js` |
| finance | Dashboard | `/admin/pilotage` | pilotage | `pilotage-decision.js`, `pilotage.js` |
| market_operator | Dashboard | `/admin/pilotage` | pilotage | `pilotage-decision.js`, `pilotage.js` |
| sourcing | Dashboard | `/admin/pilotage` | pilotage | `pilotage-decision.js`, `pilotage.js` |
| support | Dashboard | `/admin/pilotage` | pilotage | `pilotage-decision.js`, `pilotage.js` |
| admin | Vue d’ensemble | `/admin/finance` | finance | `finance-decision.js`, `finance.js` |
| market_operator | Vue d’ensemble | `/admin/finance` | finance | `finance-decision.js`, `finance.js` |
| admin | Marchés | `/dashboards/canonical/access.html` | market-access | _(page HTML autonome — voir §5)_ |
| market_operator | Marchés | `/dashboards/canonical/market-autonomy.html` | market-autonomy | _(page HTML autonome — voir §5)_ |
| admin | Vue d’ensemble | `/admin/operations` | operations | `operations-decision.js`, `operations.js` |
| market_operator | Vue d’ensemble | `/admin/operations` | operations | `operations-decision.js`, `operations.js` |
| admin | Hub / Relais | `/admin/workspaces/operations` | operations-workspace | `operations-workspace-decision.js`, `operations-workspace.js` |
| agent_hub | Hub / Relais | `/admin/workspaces/operations` | operations-workspace | `operations-workspace-decision.js`, `operations-workspace.js` |
| agent_relais | Hub / Relais | `/admin/workspaces/operations` | operations-workspace | `operations-workspace-decision.js`, `operations-workspace.js` |
| market_operator | Hub / Relais | `/admin/workspaces/operations` | operations-workspace | `operations-workspace-decision.js`, `operations-workspace.js` |
| admin | Commandes | `/admin/commerce` | commerce | `commerce-decision.js`, `commerce.js` |
| market_operator | Commandes | `/admin/commerce` | commerce | `commerce-decision.js`, `commerce.js` |
| admin | Atelier économique | `/admin/workspaces/pricing` | pricing-workspace | `pricing-workspace.js` |
| market_operator | Atelier économique | `/admin/workspaces/pricing` | pricing-workspace | `pricing-workspace.js` |
| admin | Paramètres | `/admin/settings` | settings | `settings-workspace.js` |
| admin | Expéditions & Douane | `/admin/workspaces/shipping-customs` | shipping-customs-workspace | `shipping-customs-workspace-decision.js`, `shipping-customs-workspace.js` |
| agent_hub | Expéditions & Douane | `/admin/workspaces/shipping-customs` | shipping-customs-workspace | `shipping-customs-workspace-decision.js`, `shipping-customs-workspace.js` |
| agent_transitaire | Expéditions & Douane | `/admin/workspaces/shipping-customs` | shipping-customs-workspace | `shipping-customs-workspace-decision.js`, `shipping-customs-workspace.js` |
| market_operator | Expéditions & Douane | `/admin/workspaces/shipping-customs` | shipping-customs-workspace | `shipping-customs-workspace-decision.js`, `shipping-customs-workspace.js` |
| admin | Sourcing | `/admin/workspaces/sourcing` | sourcing-workspace | `sourcing-workspace-decision.js`, `sourcing-workspace.js` |
| sourcing | Sourcing | `/admin/workspaces/sourcing` | sourcing-workspace | `sourcing-workspace-decision.js`, `sourcing-workspace.js` |

## 4. Chaîne module → fetch() → contrat

| Module | Méthode | URL appelée | Statut contrat |
|---|---|---|---|
| `action-center.js` | `GET` | `/api/admin/dashboard/context` | 🟢 prouvé |
| `action-center.js` | `POST` | `path` | ❓ url non résolue |
| `action-center.js` | `?` | `context.endpoint` | ❓ url non résolue |
| `app.js` | `GET` | `/api/admin/dashboard/context` | 🟢 prouvé |
| `app.js` | `GET` | `/api/auth/me` | 🟢 prouvé |
| `app.js` | `GET` | `/api/admin/dashboard/context` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/approval/${encodeURIComponent(row.product_ref)}/approve` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/approval/${encodeURIComponent(row.product_ref)}/override` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/approval/${encodeURIComponent(row.product_ref)}/reject` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/products/${encodeURIComponent(row.product_ref)}/deactivate` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/categories` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/categories/${encodeURIComponent(row.key)}/update` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/categories/${encodeURIComponent(row.key)}/subcategories` | 🟢 prouvé |
| `catalog-workspace.js` | `GET` | `/api/admin/workspaces/catalog` | 🟢 prouvé |
| `client-360.js` | `GET` | `/api/admin/entities/clients/${param}` | 🟢 prouvé |
| `demo-order-flow.js` | `PATCH` | `/api/orders/${selectedId}/status` | 🟢 prouvé |
| `demo-order-flow.js` | `GET` | `/api/admin/demo/orders/${orderId}/timeline` | 🟢 prouvé |
| `demo-order-flow.js` | `GET` | `/api/admin/orders?limit=30` | 🟢 prouvé |
| `finance-accounting-workspace.js` | `POST` | `/api/admin/workspaces/accounting/market/${param}${param}${param}` | 🟠 absent (dynamique) |
| `finance-accounting-workspace.js` | `GET*` | `/api/admin/workspaces/accounting/market/${param}${param}${param}` | 🟠 absent (dynamique) |
| `market-autonomy.js` | `?` | `url` | ❓ url non résolue |
| `market-cash-control.js` | `?` | `url` | ❓ url non résolue |
| `market-catalog.js` | `?` | `url` | ❓ url non résolue |
| `market-team.js` | `?` | `url` | ❓ url non résolue |
| `markets-decision-bootstrap.js` | `?` | `url` | ❓ url non résolue |
| `navigation.js` | `POST` | `/api/auth/logout` | 🟢 prouvé |
| `operations-workspace.js` | `POST` | `/api/admin/workspaces/operations/market/${param}${param}` | 🟠 absent (dynamique) |
| `operations-workspace.js` | `GET*` | `/api/admin/workspaces/operations/market/${param}${param}` | 🟠 absent (dynamique) |
| `operations.js` | `?` | `endpoint` | ❓ url non résolue |
| `order-360.js` | `GET` | `/api/admin/entities/orders/${param}` | 🟢 prouvé |
| `pilotage.js` | `?` | `endpoint` | ❓ url non résolue |
| `pricing-structure-event-panel.js` | `?` | `config.chargesEndpoint` | ❓ url non résolue |
| `pricing-structure-event-panel.js` | `POST` | `config.submitEndpoint` | ❓ url non résolue |
| `pricing-workspace-simulation.js` | `POST` | `endpoint(workspace, options.requestedMarket)` | ❓ url non résolue |
| `pricing-workspace.js` | `GET` | `/api/admin/workspaces/pricing/market/${encodeURIComponent(context.requestedMarket)}/decision` | 🟢 prouvé |
| `pricing-workspace.js` | `GET` | `/api/admin/workspaces/pricing/market/${encodeURIComponent(context.requestedMarket)}/decision-policy/history` | 🟢 prouvé |
| `pricing-workspace.js` | `?` | `url` | ❓ url non résolue |
| `pricing-workspace.js` | `GET*` | `/api/admin/workspaces/pricing/market/${encodeURIComponent(context.requestedMarket)}/strategy?product_ref=${encodeURIComponent(productRef)}` | 🟠 absent (dynamique) |
| `pricing-workspace.js` | `GET*` | `/api/admin/workspaces/pricing/market/${encodeURIComponent(context.requestedMarket)}/strategy?product_ref=${encodeURIComponent(productRef)}` | 🟠 absent (dynamique) |
| `pricing-workspace.js` | `GET*` | `/api/admin/workspaces/pricing/market/${encodeURIComponent(context.requestedMarket)}/strategy?product_ref=${encodeURIComponent(productRef)}` | 🟠 absent (dynamique) |
| `pricing-workspace.js` | `GET` | `/api/admin/workspaces/pricing/market/${encodeURIComponent(context.requestedMarket)}` | 🟢 prouvé |
| `product-360.js` | `GET` | `/api/admin/entities/products/${param}` | 🟢 prouvé |
| `settings-workspace.js` | `?` | `url` | ❓ url non résolue |
| `shipping-customs-workspace.js` | `POST` | `/api/admin/workspaces/shipping-customs/market/${param}${param}` | 🟠 absent (dynamique) |
| `shipping-customs-workspace.js` | `GET*` | `/api/admin/workspaces/shipping-customs/market/${param}${param}` | 🟠 absent (dynamique) |
| `sourcing-workspace.js` | `POST` | `/api/admin/workspaces/sourcing/candidates/${encodeURIComponent(row.candidate_ref)}/update` | 🟢 prouvé |
| `sourcing-workspace.js` | `POST` | `/api/admin/workspaces/sourcing/candidates/${encodeURIComponent(row.candidate_ref)}/scan` | 🟢 prouvé |
| `sourcing-workspace.js` | `POST` | `/api/admin/workspaces/sourcing/candidates/${encodeURIComponent(row.candidate_ref)}/watchlist` | 🟢 prouvé |
| `sourcing-workspace.js` | `POST` | `/api/admin/workspaces/sourcing/candidates/${encodeURIComponent(row.candidate_ref)}/promote` | 🟢 prouvé |
| `sourcing-workspace.js` | `POST` | `/api/admin/workspaces/sourcing/candidates/${encodeURIComponent(row.candidate_ref)}/reject` | 🟢 prouvé |
| `sourcing-workspace.js` | `POST` | `/api/admin/workspaces/sourcing/imports` | 🟢 prouvé |
| `sourcing-workspace.js` | `POST` | `/api/admin/workspaces/sourcing/products/${encodeURIComponent(row.product_ref)}/update` | 🟢 prouvé |
| `sourcing-workspace.js` | `POST` | `/api/admin/workspaces/sourcing/suppliers` | 🟢 prouvé |
| `sourcing-workspace.js` | `POST` | `/api/admin/workspaces/sourcing/suppliers/${encodeURIComponent(row.partner_ref)}/update` | 🟢 prouvé |
| `sourcing-workspace.js` | `POST` | `/api/admin/workspaces/sourcing/suppliers/${encodeURIComponent(row.partner_ref)}/${row.is_active ? 'deactivate' : 'activate'}` | 🟠 absent (dynamique) |
| `sourcing-workspace.js` | `GET` | `/api/admin/workspaces/sourcing` | 🟢 prouvé |
| `team-invite.js` | `?` | `url` | ❓ url non résolue |
| `team-invite.js` | `GET` | `/api/auth/me` | 🟢 prouvé |

## 5. Pages HTML autonomes (hors dispatch app.js)

Ces surfaces ne passent pas par `app.js::surfaceForPath()` — chacune est
une page HTML servie telle quelle par `bootstrap/html-routes.js`, avec ses
propres `<script>`. Inventaire non couvert par la matrice ci-dessus :

- `/dashboards/canonical/access.html` → surface `market-access`
- `/dashboards/canonical/market-autonomy.html` → surface `market-autonomy`
- `/dashboards/canonical/market-catalog.html` → surface `market-catalog`

---
*Carte vérifiée par `dashboards:canonical:360:check` (cliquet sur les anomalies §1 ; les signaux §2 ne bloquent jamais). Agrégée avec Legacy dans `dashboards:360:check`.*
