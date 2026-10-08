# Dashboards 360 — Canonical (généré)

> ⚠️ Fichier **généré** par `scripts/gen-dashboards-360-canonical.js`. Ne pas éditer à la main.
> Régénéré le 2026-10-07T23:58:25.318Z.
> Contrepartie de `docs/DASHBOARDS_360.md` (Legacy 1). Les deux coexistent tant que le rollback `?legacy=1` existe (`bootstrap/html-routes.js`).
> Chaîne de preuve : `navigation-policy-v4.js` (item × rôle) → `hrefFor()` → `app.js::surfaceForPath()` → module (`global.Komerce*`) → `fetch()` → `docs/contract/openapi.json`.

## Synthèse

- Items de navigation déclarés : **12** → **28** entrées (item × rôle visible)
- Modules JS Canonical scannés : **69**
- Arêtes API tracées (`fetch()` vers `/api/`) : **189**
- 🔴 Surfaces de navigation sans module résolu : **0**
- 🔴 Destination de navigation dont l'URL ne résout vers aucune surface connue (retombe sur Pilotage par défaut) : **0**
- 🔴 Endpoints appelés mais absents du contrat OpenAPI (statiques) : **0**
- 🟠 Endpoints appelés absents du contrat (URL dynamique — à vérifier à la main) : **12**
- ⚪ Endpoints appelés mais non prouvés par un test (`UNKNOWN` dans le contrat) : **47**
- ❓ `fetch()` dont l'URL n'a pas pu être résolue statiquement : **10**
- 🟣 Modules Canonical avec une dépendance textuelle vers Legacy 1 : **0**
- 🟡 Modules avec un motif `market_id`/`marketId` construit côté navigateur (à vérifier — le serveur rejette déjà ceci sur Action Center, cf. `rejectBrowserAuthority`) : **0**
- Modules sans header `@komerce-arch` : **0**

## 2. Signaux informatifs (non bloquants, jamais inventés)

- 🟠 Endpoint dynamique absent du contrat (à vérifier à la main) : `GET* /api/admin/workspaces/accounting/market/{param}{param}{param} (finance-accounting-workspace.js)`, `GET* /api/admin/workspaces/operations/market/{param}{param} (operations-workspace.js)`, `GET* /api/admin/workspaces/pricing/market/{param}/strategy (pricing-workspace.js)`, `GET* /api/admin/workspaces/shipping-customs/market/{param}{param} (shipping-customs-workspace.js)`, `GET* /api/admin/workspaces/sourcing/sources{param} (import-runtime.js)`, `POST /api/admin/workspaces/accounting/market/{param}{param}{param} (finance-accounting-workspace.js)`, `POST /api/admin/workspaces/operations/market/{param}{param} (operations-workspace.js)`, `POST /api/admin/workspaces/shipping-customs/market/{param}{param} (shipping-customs-workspace.js)`, `POST /api/admin/workspaces/sourcing/sources/{param}/{param} (import-runtime.js)`, `POST /api/admin/workspaces/sourcing/suppliers/{param}/{param} (sourcing-workspace.js)`, `POST /api/market-delegation/markets/{param}/network/relais/{param}/{param} (market-network.js)`, `PUT /api/market-delegation/markets/{param}/local-offer/{param}/{param} (market-local-offer.js)`
- ⚪ Contrats non prouvés réellement appelés : `DELETE /api/market-delegation/markets/{marketCode}/team/invitations/{invitationId}`, `DELETE /api/market-delegation/markets/{marketCode}/team/{membershipId}`, `GET /api/admin/workspaces/pricing/market/{marketCode}/commercial-prices`, `GET /api/admin/workspaces/pricing/market/{marketCode}/products/{productRef}/local-price/activation-preview`, `GET /api/admin/workspaces/sourcing/import-passages`, `GET /api/admin/workspaces/sourcing/import-runs/{runRef}`, `GET /api/admin/workspaces/sourcing/import-runs/{runRef}/items/{supplierProductId}`, `GET /api/admin/workspaces/sourcing/import-runs/{runRef}/population`, `GET /api/admin/workspaces/sourcing/sources/catalog`, `GET /api/market-delegation/central/team-matrix`, `GET /api/market-delegation/markets/{marketCode}/cash-control-policy`, `GET /api/market-delegation/markets/{marketCode}/catalog/exposure`, `GET /api/market-delegation/markets/{marketCode}/client-cases/disputes`, `GET /api/market-delegation/markets/{marketCode}/local-offer/physical-offers`, `GET /api/market-delegation/markets/{marketCode}/local-offer/services`, `GET /api/market-delegation/markets/{marketCode}/network/providers`, `GET /api/market-delegation/markets/{marketCode}/network/relais`, `GET /api/market-delegation/markets/{marketCode}/settlements`, `GET /api/market-delegation/markets/{marketCode}/team`, `GET /api/purchasing/open-lines`, `GET /api/purchasing/po/{po_id}`, `POST /api/admin/reset`, `POST /api/admin/seed-test`, `POST /api/admin/workspaces/pricing/market/{marketCode}/products/{productRef}/local-price`, `POST /api/admin/workspaces/pricing/market/{marketCode}/products/{productRef}/local-price/activate`, `POST /api/admin/workspaces/pricing/market/{marketCode}/products/{productRef}/local-price/reset`, `POST /api/admin/workspaces/sourcing/sources/{sourceRef}/prepare`, `POST /api/admin/workspaces/sourcing/sources/{sourceRef}/test-connection`, `POST /api/auth/register`, `POST /api/market-delegation/markets/{marketCode}/network/providers`, `POST /api/market-delegation/markets/{marketCode}/network/providers/{providerId}/activate`, `POST /api/market-delegation/markets/{marketCode}/network/providers/{providerId}/suspend`, `POST /api/market-delegation/markets/{marketCode}/network/relais`, `POST /api/market-delegation/markets/{marketCode}/settlements/{settlementId}/receive`, `POST /api/market-delegation/markets/{marketCode}/settlements/{settlementId}/request`, `POST /api/market-delegation/markets/{marketCode}/team/invitations`, `POST /api/market-delegation/team/invitations/{token}/accept`, `POST /api/purchasing/lines/{id}/cancel`, `POST /api/purchasing/po/prepare`, `POST /api/purchasing/po/{po_id}/confirm`, `POST /api/purchasing/po/{po_id}/detach`, `POST /api/purchasing/po/{po_id}/discard`, `POST /api/purchasing/po/{po_id}/submit`, `PUT /api/market-delegation/markets/{marketCode}/cash-control-policy`, `PUT /api/market-delegation/markets/{marketCode}/catalog/exposure/{productId}`, `PUT /api/market-delegation/markets/{marketCode}/client-cases/disputes/{disputeId}`, `PUT /api/market-delegation/markets/{marketCode}/team/{membershipId}/capabilities`
- ❓ `fetch()` non résolus statiquement : `config.chargesEndpoint (pricing-structure-event-panel.js)`, `config.submitEndpoint (pricing-structure-event-panel.js)`, `context.loadEndpoint (action-center.js)`, `endpoint (client-360.js)`, `endpoint (operations.js)`, `endpoint (orders.js)`, `endpoint (pilotage.js)`, `endpoint(workspace, options.requestedMarket) (pricing-workspace-simulation.js)`, `path (action-center.js)`, `url (pricing-workspace.js)`

## 3. Matrice navigation × rôle × surface × module

| Rôle | Item nav | Destination | Surface résolue | Module(s) |
|---|---|---|---|---|
| admin | Comptabilité | `/admin/workspaces/accounting` | accounting-workspace | `finance-accounting-workspace-decision.js`, `finance-accounting-workspace.js` |
| agent_relais | Comptabilité | `/admin/workspaces/accounting` | accounting-workspace | `finance-accounting-workspace-decision.js`, `finance-accounting-workspace.js` |
| finance | Comptabilité | `/admin/workspaces/accounting` | accounting-workspace | `finance-accounting-workspace-decision.js`, `finance-accounting-workspace.js` |
| market_operator | Comptabilité | `/admin/workspaces/accounting` | accounting-workspace | `finance-accounting-workspace-decision.js`, `finance-accounting-workspace.js` |
| admin | Commerce | `/admin/commerce` | commerce | `commerce-decision.js`, `commerce.js` |
| market_operator | Commerce | `/admin/commerce` | commerce | `commerce-decision.js`, `commerce.js` |
| admin | Vue d’ensemble | `/admin/finance` | finance | `finance-decision.js`, `finance.js` |
| market_operator | Vue d’ensemble | `/admin/finance` | finance | `finance-decision.js`, `finance.js` |
| admin | Hub live | `/admin/hub-live` | hub-live | `hub-live.js` |
| agent_hub | Hub live | `/admin/hub-live` | hub-live | `hub-live.js` |
| admin | Sourcing live | `/admin/import-runtime` | import-runtime | `import-runtime.js` |
| sourcing | Sourcing live | `/admin/import-runtime` | import-runtime | `import-runtime.js` |
| admin | Vue d’ensemble | `/admin/operations` | operations | `operations-decision.js`, `operations.js` |
| market_operator | Vue d’ensemble | `/admin/operations` | operations | `operations-decision.js`, `operations.js` |
| admin | Hub / Relais | `/admin/workspaces/operations` | operations-workspace | `operations-workspace-decision.js`, `operations-workspace.js` |
| agent_hub | Hub / Relais | `/admin/workspaces/operations` | operations-workspace | `operations-workspace-decision.js`, `operations-workspace.js` |
| agent_relais | Hub / Relais | `/admin/workspaces/operations` | operations-workspace | `operations-workspace-decision.js`, `operations-workspace.js` |
| market_operator | Hub / Relais | `/admin/workspaces/operations` | operations-workspace | `operations-workspace-decision.js`, `operations-workspace.js` |
| admin | Suivi des commandes | `/admin/orders` | orders | `orders-decision.js`, `orders.js` |
| market_operator | Suivi des commandes | `/admin/orders` | orders | `orders-decision.js`, `orders.js` |
| admin | Achats fournisseurs | `/admin/workspaces/purchasing` | purchasing-workspace | `purchasing-workspace.js` |
| admin | Relais live | `/admin/relais-live` | relais-live | `relay-live.js` |
| agent_relais | Relais live | `/admin/relais-live` | relais-live | `relay-live.js` |
| admin | Paramètres | `/admin/settings` | settings | `settings-workspace.js` |
| admin | Expéditions & Douane | `/admin/workspaces/shipping-customs` | shipping-customs-workspace | `shipping-customs-workspace-decision.js`, `shipping-customs-workspace.js` |
| agent_hub | Expéditions & Douane | `/admin/workspaces/shipping-customs` | shipping-customs-workspace | `shipping-customs-workspace-decision.js`, `shipping-customs-workspace.js` |
| agent_transitaire | Expéditions & Douane | `/admin/workspaces/shipping-customs` | shipping-customs-workspace | `shipping-customs-workspace-decision.js`, `shipping-customs-workspace.js` |
| market_operator | Expéditions & Douane | `/admin/workspaces/shipping-customs` | shipping-customs-workspace | `shipping-customs-workspace-decision.js`, `shipping-customs-workspace.js` |

## 4. Chaîne module → fetch() → contrat

| Module | Méthode | URL appelée | Statut contrat |
|---|---|---|---|
| `action-center.js` | `GET` | `/api/admin/dashboard/context` | 🟢 prouvé |
| `action-center.js` | `POST` | `path` | ❓ url non résolue |
| `action-center.js` | `?` | `context.loadEndpoint` | ❓ url non résolue |
| `action-center.js` | `GET` | `/api/admin/dashboard/context` | 🟢 prouvé |
| `action-center.js` | `POST` | `path` | ❓ url non résolue |
| `action-center.js` | `?` | `context.loadEndpoint` | ❓ url non résolue |
| `app.js` | `GET` | `/api/admin/dashboard/context` | 🟢 prouvé |
| `app.js` | `GET` | `/api/auth/me` | 🟢 prouvé |
| `app.js` | `GET` | `/api/admin/dashboard/context` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/approval/${encodeURIComponent(row.product_ref)}/prepare-fr` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/approval/${encodeURIComponent(row.product_ref)}/approve` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/approval/${encodeURIComponent(row.product_ref)}/override` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/approval/${encodeURIComponent(row.product_ref)}/reject` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/products/${encodeURIComponent(row.product_ref)}/deactivate` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/categories` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/categories/${encodeURIComponent(row.key)}/update` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/categories/${encodeURIComponent(row.key)}/subcategories` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/approval/${encodeURIComponent(row.product_ref)}/prepare-fr` | 🟢 prouvé |
| `catalog-workspace.js` | `GET` | `/api/admin/workspaces/catalog?${params.toString()}` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/approval/${encodeURIComponent(row.product_ref)}/prepare-fr` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/approval/${encodeURIComponent(row.product_ref)}/approve` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/approval/${encodeURIComponent(row.product_ref)}/override` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/approval/${encodeURIComponent(row.product_ref)}/reject` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/products/${encodeURIComponent(row.product_ref)}/deactivate` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/categories` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/categories/${encodeURIComponent(row.key)}/update` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/categories/${encodeURIComponent(row.key)}/subcategories` | 🟢 prouvé |
| `catalog-workspace.js` | `POST` | `/api/admin/workspaces/catalog/approval/${encodeURIComponent(row.product_ref)}/prepare-fr` | 🟢 prouvé |
| `catalog-workspace.js` | `GET` | `/api/admin/workspaces/catalog?${params.toString()}` | 🟢 prouvé |
| `client-360.js` | `?` | `endpoint` | ❓ url non résolue |
| `client-360.js` | `?` | `endpoint` | ❓ url non résolue |
| `demo-order-flow.js` | `PATCH` | `/api/orders/${selectedId}/status` | 🟢 prouvé |
| `demo-order-flow.js` | `GET` | `/api/admin/demo/orders/${orderId}/timeline` | 🟢 prouvé |
| `demo-order-flow.js` | `GET` | `/api/admin/orders?limit=30` | 🟢 prouvé |
| `demo-order-flow.js` | `PATCH` | `/api/orders/${selectedId}/status` | 🟢 prouvé |
| `demo-order-flow.js` | `GET` | `/api/admin/demo/orders/${orderId}/timeline` | 🟢 prouvé |
| `demo-order-flow.js` | `GET` | `/api/admin/orders?limit=30` | 🟢 prouvé |
| `finance-accounting-workspace.js` | `POST` | `/api/admin/workspaces/accounting/market/${param}${param}${param}` | 🟠 absent (dynamique) |
| `finance-accounting-workspace.js` | `GET*` | `/api/admin/workspaces/accounting/market/${param}${param}${param}` | 🟠 absent (dynamique) |
| `finance-accounting-workspace.js` | `POST` | `/api/admin/workspaces/accounting/market/${param}${param}${param}` | 🟠 absent (dynamique) |
| `finance-accounting-workspace.js` | `GET*` | `/api/admin/workspaces/accounting/market/${param}${param}${param}` | 🟠 absent (dynamique) |
| `import-runtime.js` | `GET` | `/api/admin/workspaces/sourcing/import-cockpit?${param}` | 🟢 prouvé |
| `import-runtime.js` | `GET` | `/api/admin/workspaces/sourcing/import-runs/${encodeURIComponent(activationState.runRef)}` | ⚪ non prouvé |
| `import-runtime.js` | `POST` | `/api/admin/workspaces/sourcing/sources/${encodeURIComponent(ref)}/${path}` | 🟠 absent (dynamique) |
| `import-runtime.js` | `POST` | `/api/admin/workspaces/sourcing/sources/${encodeURIComponent(sourceRef)}/${action}` | 🟠 absent (dynamique) |
| `import-runtime.js` | `GET` | `/api/admin/workspaces/sourcing/import-runs/${encodeURIComponent(activationState.runRef)}` | ⚪ non prouvé |
| `import-runtime.js` | `GET` | `/api/admin/workspaces/sourcing/import-runs/${encodeURIComponent(activationState.runRef)}` | ⚪ non prouvé |
| `import-runtime.js` | `POST` | `/api/admin/workspaces/sourcing/sources/${encodeURIComponent(sourceRef)}/import-now` | 🟢 prouvé |
| `import-runtime.js` | `GET` | `/api/admin/workspaces/sourcing/sources/catalog` | ⚪ non prouvé |
| `import-runtime.js` | `POST` | `/api/admin/workspaces/sourcing/sources` | 🟢 prouvé |
| `import-runtime.js` | `POST` | `/api/admin/workspaces/sourcing/sources/${encodeURIComponent(sourceRef)}/test-connection` | ⚪ non prouvé |
| `import-runtime.js` | `POST` | `/api/admin/workspaces/sourcing/sources/${encodeURIComponent(sourceRef)}/prepare` | ⚪ non prouvé |
| `import-runtime.js` | `POST` | `/api/admin/workspaces/sourcing/sources/requests` | 🟢 prouvé |
| `import-runtime.js` | `GET*` | `/api/admin/workspaces/sourcing/sources${path}` | 🟠 absent (dynamique) |
| `import-runtime.js` | `POST` | `/api/admin/workspaces/sourcing/candidates/${encodeURIComponent(ref)}/update` | 🟢 prouvé |
| `import-runtime.js` | `GET` | `/api/admin/workspaces/sourcing/import-cockpit?${param}` | 🟢 prouvé |
| `import-runtime.js` | `GET` | `/api/admin/workspaces/sourcing/import-passages?limit=50&offset=${offset}` | ⚪ non prouvé |
| `import-runtime.js` | `GET` | `/api/admin/workspaces/sourcing/import-runs/${encodeURIComponent(payload.selected.run_ref)}/population?kind=${populationKind}` | ⚪ non prouvé |
| `import-runtime.js` | `GET` | `/api/admin/workspaces/sourcing/import-runs/${encodeURIComponent(payload.selected.run_ref)}/items/${encodeURIComponent(item)}` | ⚪ non prouvé |
| `market-autonomy.js` | `POST` | `/api/admin/workspaces/pricing/market/${encodeURIComponent(marketCode)}/products/${encodeURIComponent(row.product_ref)}/local-price` | ⚪ non prouvé |
| `market-autonomy.js` | `GET` | `/api/admin/workspaces/pricing/market/${encodeURIComponent(marketCode)}/products/${encodeURIComponent(row.product_ref)}/local-price/activation-preview` | ⚪ non prouvé |
| `market-autonomy.js` | `POST` | `/api/admin/workspaces/pricing/market/${encodeURIComponent(marketCode)}/products/${encodeURIComponent(row.product_ref)}/local-price/activate` | ⚪ non prouvé |
| `market-autonomy.js` | `POST` | `/api/admin/workspaces/pricing/market/${encodeURIComponent(marketCode)}/products/${encodeURIComponent(row.product_ref)}/local-price/reset` | ⚪ non prouvé |
| `market-autonomy.js` | `GET` | `/api/admin/dashboard/context` | 🟢 prouvé |
| `market-autonomy.js` | `GET` | `/api/admin/workspaces/pricing/market/${encodeURIComponent(marketCode)}` | 🟢 prouvé |
| `market-autonomy.js` | `GET` | `/api/admin/workspaces/pricing/market/${encodeURIComponent(marketCode)}/commercial-prices` | ⚪ non prouvé |
| `market-cash-control.js` | `GET` | `/api/admin/dashboard/context` | 🟢 prouvé |
| `market-cash-control.js` | `PUT` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/cash-control-policy` | ⚪ non prouvé |
| `market-cash-control.js` | `GET` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/cash-control-policy` | ⚪ non prouvé |
| `market-catalog.js` | `PUT` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/catalog/exposure/${encodeURIComponent(row.product_id)}` | ⚪ non prouvé |
| `market-catalog.js` | `GET` | `/api/auth/me` | 🟢 prouvé |
| `market-catalog.js` | `GET` | `/api/admin/dashboard/context` | 🟢 prouvé |
| `market-catalog.js` | `GET` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/catalog/exposure` | ⚪ non prouvé |
| `market-client-case.js` | `GET` | `/api/admin/dashboard/context` | 🟢 prouvé |
| `market-client-case.js` | `PUT` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/client-cases/disputes/${encodeURIComponent(dispute.id)}` | ⚪ non prouvé |
| `market-client-case.js` | `GET` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/client-cases/disputes` | ⚪ non prouvé |
| `market-local-offer.js` | `GET` | `/api/admin/dashboard/context` | 🟢 prouvé |
| `market-local-offer.js` | `PUT` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/local-offer/${segment}/${encodeURIComponent(offer.id)}` | 🟠 absent (dynamique) |
| `market-local-offer.js` | `GET` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/local-offer/services` | ⚪ non prouvé |
| `market-local-offer.js` | `GET` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/local-offer/physical-offers` | ⚪ non prouvé |
| `market-network.js` | `GET` | `/api/admin/dashboard/context` | 🟢 prouvé |
| `market-network.js` | `POST` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/network/relais` | ⚪ non prouvé |
| `market-network.js` | `POST` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/network/relais/${encodeURIComponent(relais.id)}/${endpoint}` | 🟠 absent (dynamique) |
| `market-network.js` | `POST` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/network/providers` | ⚪ non prouvé |
| `market-network.js` | `POST` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/network/providers/${encodeURIComponent(provider.id)}/activate` | ⚪ non prouvé |
| `market-network.js` | `POST` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/network/providers/${encodeURIComponent(provider.id)}/suspend` | ⚪ non prouvé |
| `market-network.js` | `GET` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/network/relais` | ⚪ non prouvé |
| `market-network.js` | `GET` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/network/providers` | ⚪ non prouvé |
| `market-settlement.js` | `GET` | `/api/admin/dashboard/context` | 🟢 prouvé |
| `market-settlement.js` | `POST` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/settlements/${encodeURIComponent(item.id)}/request` | ⚪ non prouvé |
| `market-settlement.js` | `POST` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/settlements/${encodeURIComponent(item.id)}/receive` | ⚪ non prouvé |
| `market-settlement.js` | `GET` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/settlements` | ⚪ non prouvé |
| `market-team.js` | `POST` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/team/invitations` | ⚪ non prouvé |
| `market-team.js` | `PUT` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/team/${encodeURIComponent(member.membership_id)}/capabilities` | ⚪ non prouvé |
| `market-team.js` | `DELETE` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/team/${encodeURIComponent(member.membership_id)}` | ⚪ non prouvé |
| `market-team.js` | `DELETE` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/team/invitations/${encodeURIComponent(invitation.id)}` | ⚪ non prouvé |
| `market-team.js` | `GET` | `/api/admin/dashboard/context` | 🟢 prouvé |
| `market-team.js` | `GET` | `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/team` | ⚪ non prouvé |
| `markets-decision-bootstrap.js` | `GET` | `/api/market-delegation/central/team-matrix` | ⚪ non prouvé |
| `markets-decision-bootstrap.js` | `GET` | `/api/admin/dashboard/context` | 🟢 prouvé |
| `markets-decision-bootstrap.js` | `GET` | `/api/admin/workspaces/pricing/market/${encodeURIComponent(marketCode)}` | 🟢 prouvé |
| `markets-decision-bootstrap.js` | `GET` | `/api/admin/workspaces/pricing/market/${encodeURIComponent(marketCode)}/commercial-prices` | ⚪ non prouvé |
| `navigation-policy-v4.js` | `POST` | `/api/auth/logout` | 🟢 prouvé |
| `navigation-policy-v4.js` | `GET` | `/api/admin/dashboard/reference/resolve?reference=${param}` | 🟢 prouvé |
| `navigation-policy-v4.js` | `POST` | `/api/admin/reset` | ⚪ non prouvé |
| `navigation-policy-v4.js` | `POST` | `/api/admin/seed-test` | ⚪ non prouvé |
| `operations-workspace.js` | `POST` | `/api/admin/workspaces/operations/market/${param}${param}` | 🟠 absent (dynamique) |
| `operations-workspace.js` | `GET*` | `/api/admin/workspaces/operations/market/${param}${param}` | 🟠 absent (dynamique) |
| `operations-workspace.js` | `POST` | `/api/admin/workspaces/operations/market/${param}${param}` | 🟠 absent (dynamique) |
| `operations-workspace.js` | `GET*` | `/api/admin/workspaces/operations/market/${param}${param}` | 🟠 absent (dynamique) |
| `operations.js` | `?` | `endpoint` | ❓ url non résolue |
| `operations.js` | `?` | `endpoint` | ❓ url non résolue |
| `order-360.js` | `GET` | `/api/admin/entities/orders/${param}` | 🟢 prouvé |
| `order-360.js` | `GET` | `/api/admin/entities/orders/${param}` | 🟢 prouvé |
| `orders.js` | `?` | `endpoint` | ❓ url non résolue |
| `orders.js` | `?` | `endpoint` | ❓ url non résolue |
| `pilotage.js` | `?` | `endpoint` | ❓ url non résolue |
| `pilotage.js` | `?` | `endpoint` | ❓ url non résolue |
| `pricing-structure-event-panel.js` | `?` | `config.chargesEndpoint` | ❓ url non résolue |
| `pricing-structure-event-panel.js` | `POST` | `config.submitEndpoint` | ❓ url non résolue |
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
| `pricing-workspace.js` | `GET` | `/api/admin/workspaces/pricing/market/${encodeURIComponent(context.requestedMarket)}/decision` | 🟢 prouvé |
| `pricing-workspace.js` | `GET` | `/api/admin/workspaces/pricing/market/${encodeURIComponent(context.requestedMarket)}/decision-policy/history` | 🟢 prouvé |
| `pricing-workspace.js` | `?` | `url` | ❓ url non résolue |
| `pricing-workspace.js` | `GET*` | `/api/admin/workspaces/pricing/market/${encodeURIComponent(context.requestedMarket)}/strategy?product_ref=${encodeURIComponent(productRef)}` | 🟠 absent (dynamique) |
| `pricing-workspace.js` | `GET*` | `/api/admin/workspaces/pricing/market/${encodeURIComponent(context.requestedMarket)}/strategy?product_ref=${encodeURIComponent(productRef)}` | 🟠 absent (dynamique) |
| `pricing-workspace.js` | `GET*` | `/api/admin/workspaces/pricing/market/${encodeURIComponent(context.requestedMarket)}/strategy?product_ref=${encodeURIComponent(productRef)}` | 🟠 absent (dynamique) |
| `pricing-workspace.js` | `GET` | `/api/admin/workspaces/pricing/market/${encodeURIComponent(context.requestedMarket)}` | 🟢 prouvé |
| `product-360.js` | `GET` | `/api/admin/entities/products/${param}` | 🟢 prouvé |
| `product-360.js` | `GET` | `/api/admin/entities/products/${param}` | 🟢 prouvé |
| `purchasing-workspace.js` | `GET` | `/api/purchasing/open-lines` | ⚪ non prouvé |
| `purchasing-workspace.js` | `GET` | `/api/purchasing/po/${encodeURIComponent(context.poId)}` | ⚪ non prouvé |
| `purchasing-workspace.js` | `POST` | `/api/purchasing/lines/${encodeURIComponent(line.line_id)}/cancel` | ⚪ non prouvé |
| `purchasing-workspace.js` | `POST` | `/api/purchasing/po/prepare` | ⚪ non prouvé |
| `purchasing-workspace.js` | `POST` | `/api/purchasing/po/${encodeURIComponent(po.id)}/confirm` | ⚪ non prouvé |
| `purchasing-workspace.js` | `POST` | `/api/purchasing/po/${encodeURIComponent(po.id)}/detach` | ⚪ non prouvé |
| `purchasing-workspace.js` | `POST` | `/api/purchasing/po/${encodeURIComponent(po.id)}/discard` | ⚪ non prouvé |
| `purchasing-workspace.js` | `POST` | `/api/purchasing/po/${encodeURIComponent(po.id)}/submit` | ⚪ non prouvé |
| `purchasing-workspace.js` | `GET` | `/api/purchasing/open-lines` | ⚪ non prouvé |
| `purchasing-workspace.js` | `GET` | `/api/purchasing/po/${encodeURIComponent(context.poId)}` | ⚪ non prouvé |
| `purchasing-workspace.js` | `POST` | `/api/purchasing/lines/${encodeURIComponent(line.line_id)}/cancel` | ⚪ non prouvé |
| `purchasing-workspace.js` | `POST` | `/api/purchasing/po/prepare` | ⚪ non prouvé |
| `purchasing-workspace.js` | `POST` | `/api/purchasing/po/${encodeURIComponent(po.id)}/confirm` | ⚪ non prouvé |
| `purchasing-workspace.js` | `POST` | `/api/purchasing/po/${encodeURIComponent(po.id)}/detach` | ⚪ non prouvé |
| `purchasing-workspace.js` | `POST` | `/api/purchasing/po/${encodeURIComponent(po.id)}/discard` | ⚪ non prouvé |
| `purchasing-workspace.js` | `POST` | `/api/purchasing/po/${encodeURIComponent(po.id)}/submit` | ⚪ non prouvé |
| `shipping-customs-workspace.js` | `POST` | `/api/admin/workspaces/shipping-customs/market/${param}${param}` | 🟠 absent (dynamique) |
| `shipping-customs-workspace.js` | `GET*` | `/api/admin/workspaces/shipping-customs/market/${param}${param}` | 🟠 absent (dynamique) |
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
| `standalone-shell-bootstrap-v4.js` | `GET` | `/api/auth/me` | 🟢 prouvé |
| `standalone-shell-bootstrap-v4.js` | `GET` | `/api/admin/dashboard/context` | 🟢 prouvé |
| `supplier-360.js` | `GET` | `/api/admin/entities/suppliers/${param}` | 🟢 prouvé |
| `supplier-360.js` | `GET` | `/api/admin/entities/suppliers/${param}` | 🟢 prouvé |
| `team-invite.js` | `GET` | `/api/auth/me` | 🟢 prouvé |
| `team-invite.js` | `POST` | `/api/auth/register` | ⚪ non prouvé |
| `team-invite.js` | `POST` | `/api/market-delegation/team/invitations/${encodeURIComponent(token)}/accept` | ⚪ non prouvé |
| `team-invite.js` | `GET` | `/api/admin/dashboard/context` | 🟢 prouvé |

## 5. Pages HTML autonomes (hors dispatch app.js)

Ces surfaces ne passent pas par `app.js::surfaceForPath()` — chacune est
une page HTML servie telle quelle par `bootstrap/html-routes.js`, avec ses
propres `<script>`. Inventaire non couvert par la matrice ci-dessus :

- `/dashboards/canonical/access.html` → surface `market-access`
- `/dashboards/canonical/market-autonomy.html` → surface `market-autonomy`
- `/dashboards/canonical/market-catalog.html` → surface `market-catalog`

---
*Carte vérifiée par `dashboards:canonical:360:check` (cliquet sur les anomalies §1 ; les signaux §2 ne bloquent jamais). Agrégée avec Legacy dans `dashboards:360:check`.*
