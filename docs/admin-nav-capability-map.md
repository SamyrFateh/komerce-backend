# Capability Map — Navigation admin Canonical

Ce document trace, pour chacun des 6 onglets du mock approuvé, l'API réellement
appelée côté client et le middleware qui la garde côté serveur. Chaque ligne a
été vérifiée dans le code (pas déduite) — voir la colonne "Preuve".

Le principe reste : **le backend est l'autorité**. Ce document sert à aligner
le filtrage de navigation côté UI sur ce que le serveur autorise déjà — pas à
inventer une nouvelle politique.

## 1. Ce que chaque onglet du mock appelle réellement

| Onglet (mock)       | Route front            | Endpoint(s) appelé(s) côté client                                  | Middleware serveur                                              | Rôles réellement autorisés serveur |
|----------------------|-------------------------|----------------------------------------------------------------------|-------------------------------------------------------------------|--------------------------------------|
| Dashboard             | `/admin/pilotage`       | `GET /api/admin/dashboard/context`, puis `GET /api/admin/dashboard/unified` (global) ou `.../unified/market/:code` (marché) | `context` → `requireCanonicalContextRole` (admin, market_operator, agent_hub, agent_relais, agent_transitaire) ; données `unified*` → `requireMarketDashboardReadRole` (**admin, market_operator uniquement**) | **admin, market_operator** (les autres obtiennent le contexte mais pas les données — 403 sur le widget) |
| Atelier économique    | `/admin/workspaces/pricing` | `GET/POST /api/admin/workspaces/pricing/market/:code/*`         | `router.use('/market/:marketCode', requireRole(['admin','market_operator']), ...)` | **admin, market_operator** |
| Catalogue              | `/admin/workspaces/catalog` | `GET/POST /api/admin/workspaces/catalog/*`                      | `guard = [authenticate, requireRole(['admin']), requireCatalogGlobalAuthority]` | **admin uniquement** |
| Commandes              | `/admin/commerce`       | `GET /api/admin/dashboard/commerce` (global) ou `.../commerce/market/:code` | global → `requireAdmin + requireDashboardGlobalAuthority` ; marché → `requireMarketDashboardReadRole` (admin, market_operator) | **admin, market_operator** |
| Marchés                | admin → `/dashboards/canonical/access.html`<br>market_operator → `/dashboards/canonical/market-autonomy.html` | admin : `/api/admin/users?role=market_operator`, `/api/admin/dashboard/context`<br>market_operator : `/api/admin/workspaces/pricing/market/:code*` (même guard que l'Atelier économique) | admin : gestion utilisateurs (admin only, à confirmer si la route existe encore) ; market_operator : `requireRole(['admin','market_operator'])` | **admin, market_operator** |
| Paramètres             | `/admin/settings`       | `GET/PATCH/POST /api/admin/rules/*`, `GET/PUT /api/admin/pricing-matrices/*` | `authenticate, requireAdmin` sur toutes les routes | **admin uniquement** |

### Constat central

**Seuls `admin` et `market_operator` ont un accès serveur vérifié à un ou
plusieurs des 6 onglets du mock.** C'est cohérent avec l'objectif immédiat
(le manager pays arrive sur une seule URL avec ses onglets) mais ça veut dire
que les 6 autres rôles (`finance`, `sourcing`, `agent_hub`, `agent_relais`,
`agent_transitaire`, `support`) n'ont aujourd'hui **aucun accès aux données
réelles d'aucun des 6 onglets primaires**, même si `ALLOWED_ROLES` dans
`app.js` les laisse démarrer le shell Canonical.

## 2. Où travaillent réellement les rôles opérationnels aujourd'hui

Ces rôles ont un vrai accès serveur — mais sur des surfaces **hors du mock**,
soit via les workspaces Canonical secondaires, soit via le portail Legacy 1.

| Rôle               | Surface Canonical avec vrai accès serveur (hors mock) | Guard | Portail Legacy 1 encore utilisé (`portal-pilotage.js`) |
|---------------------|--------------------------------------------------------|-------|------------------------------------------------------|
| finance              | `admin-finance-accounting-workspace.js` (lecture) — `/admin/workspaces/accounting` | `requireRole(['admin','finance','agent_relais'])` | `/admin/pricing-strategy`, `/admin/pricing`, `/admin/economic-flow`, `/admin/accounting`, `/admin/customs`, `/admin/clients` |
| sourcing             | `admin-sourcing-workspace.js` — `/admin/workspaces/sourcing` | `requireRole(['admin','sourcing'])` | `/admin/sourcing`, `/admin/sourcing-scanner`, `/admin/suppliers`, `/admin/pricing-strategy`, `/admin/pricing` |
| agent_hub            | `admin-operations-workspace.js` — `/admin/workspaces/operations` | `requireRole(['admin','agent_hub','agent_relais','market_operator'])` | `/admin/hub-relais`, `/admin/transitaire`, `/admin/inventory`, `/admin/control-tower` |
| agent_relais         | idem operations-workspace + `admin-finance-accounting-workspace.js` (dépôts) | idem | `/admin/hub-relais`, `/admin/control-tower` |
| agent_transitaire    | `admin-shipping-customs-workspace.js` — `/admin/workspaces/shipping-customs` | `requireRole(['admin','agent_hub','agent_transitaire'])` | `/admin/transitaire`, `/admin/control-tower` |
| support              | aucune surface Canonical dédiée trouvée | — | `/admin/clients`, `/admin/shared-carts`, `/admin/problems`, `/admin/alerts` |

Ces workspaces existent comme `SURFACES` dans `app.js` (`OPERATIONS_WORKSPACE`,
`SOURCING_WORKSPACE`, `SHIPPING_CUSTOMS_WORKSPACE`, `ACCOUNTING_WORKSPACE`)
mais **ne sont pas dans `PRIMARY_NAV`** — ils ne sont atteignables aujourd'hui
que par lien direct, pas par un onglet du mock.

## 3. Décision de périmètre pour cette PR (F0 → F1)

Étant donné le constat ci-dessus, cette PR livre le filtrage role-aware
**pour ce qui est réellement prouvé côté serveur** :

- `admin` → les 6 onglets
- `market_operator` → Dashboard, Atelier économique, Commandes, Marchés
  (**pas** Catalogue — admin only server-side — **pas** Paramètres — admin
  only server-side)
- Les 6 autres rôles → Dashboard uniquement, en attendant une décision produit
  sur l'unification de leurs surfaces réelles dans le mock (ticket de suivi :
  soit étendre les guards serveur `requireMarketDashboardReadRole` /
  `requireCatalogGlobalAuthority`, soit exposer leurs workspaces existants
  via la sous-navigation prévue en F6). **Ne pas** élargir silencieusement
  ces rôles à plus d'onglets sans élargir d'abord le guard serveur
  correspondant — ce serait montrer un onglet qui 403.

Cette décision n'empêche aucun rôle d'utiliser ses routes Legacy existantes,
qui restent inchangées.

## 4. Landing par défaut

| Rôle               | Landing                     | Justification |
|----------------------|------------------------------|----------------|
| admin                | `/admin/pilotage`            | premier onglet visible |
| market_operator       | `/admin/pilotage`            | premier onglet visible, données marché scopées serveur |
| autres 6 rôles        | `/admin/pilotage`             | seul onglet visible (Dashboard) — le contexte se charge, les données marché peuvent 403 selon le rôle ; comportement inchangé par cette PR |

## 5. `capabilitiesFor()` — état actuel

`services/dashboard-admin-context.js::capabilitiesFor(mode)` ne renvoie que
`['pilotage.read', 'dashboard.market.read']` (+ `dashboard.global.read` en
mode global). Ces capabilities ne distinguent pas les 6 onglets entre eux —
elles ne peuvent donc pas encore servir de base au filtrage de nav. Le
filtrage de cette PR repose sur `user.role`, qui est la seule vérité
suffisamment granulaire aujourd'hui.

À noter : `admin-pricing-workspace.js` expose déjà un objet `capabilities`
beaucoup plus riche par requête (`cost_overrides`, `manage_decision_policy`,
`local_price_activation`, etc. — voir `GET /market/:marketCode`). Si un futur
chantier généralise ce pattern à `dashboard-admin-context.js`, la fonction
`visibleNavigationFor()` devra être mise à jour pour consommer ces
capabilities plutôt que le rôle brut.

## 6. Guards vérifiés (référence)

| Route famille                          | Fichier                              | Middleware                                          |
|-----------------------------------------|---------------------------------------|-------------------------------------------------------|
| `/api/admin/dashboard/context`          | `routes/admin-dashboard-market.js:114` | `requireCanonicalContextRole` (admin, market_operator, agent_hub, agent_relais, agent_transitaire) |
| `/api/admin/dashboard/unified*`         | `routes/admin-dashboard-market.js:135` | `requireMarketDashboardReadRole` (admin, market_operator) |
| `/api/admin/dashboard/commerce/market/*`| `routes/admin-dashboard-market.js:155` | `requireMarketDashboardReadRole` (admin, market_operator) |
| `/api/admin/dashboard/commerce` (global)| `routes/admin-dashboard-market.js:216+` | `requireAdmin + requireDashboardGlobalAuthority` |
| `/api/admin/workspaces/pricing/market/*`| `routes/admin-pricing-workspace.js:181` | `requireRole(['admin','market_operator'])` |
| `/api/admin/workspaces/catalog/*`       | `routes/admin-catalog-workspace.js:29` | `requireRole(['admin']) + requireCatalogGlobalAuthority` |
| `/api/admin/workspaces/sourcing/*`      | `routes/admin-sourcing-workspace.js:27`| `requireRole(['admin','sourcing']) + requireSourcingGlobalAuthority` |
| `/api/admin/workspaces/operations/*`    | `routes/admin-operations-workspace.js` | `requireRole(['admin','agent_hub','agent_relais','market_operator'])` (lecture) |
| `/api/admin/workspaces/shipping-customs/*` | `routes/admin-shipping-customs-workspace.js` | `requireRole(['admin','agent_hub','agent_transitaire'])` (lecture) |
| `/api/admin/workspaces/accounting/*`    | `routes/admin-finance-accounting-workspace.js` | `requireRole(['admin','finance','agent_relais'])` (lecture) |
| `/api/admin/rules/*`                    | `routes/admin-rules.js`                | `requireAdmin` |
| `/api/admin/pricing-matrices/*`         | `routes/admin-pricing-matrices.js`     | `requireAdmin` |

## 7. Frontière assets pour la migration Paramètres (F1 point 4)

`SettingsView.js` (`public/dashboards/admin/js/views/SettingsView.js`) ne
dépend que de `global.KmcApi` (défini dans
`public/dashboards/admin/js/api-client.js`, zéro couplage DOM, `BASE_API =
'/api'`, appelle exactement les routes ci-dessus). Son CSS utilise des
variables (`--text-primary`, `--bg-card`, `--border`, `--fs-sm`, …) définies
dans `public/dashboards/admin/css/tokens.css`, absentes de
`public/dashboards/canonical/css/base.css`. Pour monter `SettingsView` dans
Canonical sans le casser visuellement, il faut charger `tokens.css` (tokens
purs, pas de dépendance DOM) et `api-client.js` dans
`public/dashboards/canonical/index.html`, en plus de `SettingsView.js`
lui-même.
