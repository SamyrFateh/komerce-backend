# Matrice de navigation Canonical

Cette matrice est le contrat **courant** entre le shell Canonical et les guards serveur. Elle complète `docs/doctrine/ADMIN_NAVIGATION_DOCTRINE_V2.md` et remplace toute lecture historique contradictoire de `docs/admin-nav-capability-map.md`.

Principe bloquant : **aucune destination visible ne peut exister sans un guard serveur correspondant**. Le navigateur n'accorde jamais un droit ; il ne fait que masquer les destinations que le serveur refuserait déjà.

## N1 — domaines métier

Ordre canonique :

1. Dashboard
2. Atelier économique
3. Catalogue
4. Commandes
5. Marchés
6. Opérations
7. Finance

`Paramètres` reste une utilité globale admin-only. `Market ID` reste un contexte transverse. Aucun workspace spécialisé ne devient un domaine N1.

## Visibilité N1 par rôle

| Rôle effectif | Domaines N1 visibles | Landing |
|---|---|---|
| `admin` | Dashboard · Atelier économique · Catalogue · Commandes · Marchés · Opérations · Finance | `/admin/pilotage` |
| `market_operator` | Dashboard · Atelier économique · Catalogue pays · Commandes · Marchés · Opérations · Finance | `/admin/pilotage` |
| `finance` | Finance | `/admin/workspaces/accounting` |
| `sourcing` | Opérations | `/admin/workspaces/sourcing` |
| `agent_hub` | Opérations | `/admin/workspaces/operations` |
| `agent_relais` | Opérations · Finance | `/admin/workspaces/operations` |
| `agent_transitaire` | Opérations | `/admin/workspaces/shipping-customs` |
| `support` | aucun domaine Canonical livré | `/portail` |

Le rôle `support` n'est pas projeté artificiellement sur Dashboard. Son Back Office historique reste sa destination tant qu'un domaine Support Canonical avec guard serveur dédié n'existe pas.

## N2 — Commandes

| Espace | Route | Rôles visibles |
|---|---|---|
| Commerce | `/admin/commerce` | `admin`, `market_operator` |
| Suivi des commandes | `/admin/orders` | `admin`, `market_operator` |

Les Entity 360 restent des drill-downs, jamais des onglets N1/N2 : `Order 360`, `Client 360`.

## N2 — Opérations

| Espace | Route | Guard de lecture constaté |
|---|---|---|
| Vue d'ensemble | `/admin/operations` | `admin`, `market_operator` |
| Hub / Relais | `/admin/workspaces/operations` | `admin`, `agent_hub`, `agent_relais`, `market_operator` (`routes/admin-operations-workspace.js`) |
| Expéditions & Douane | `/admin/workspaces/shipping-customs` | `admin`, `agent_hub`, `agent_transitaire`, `market_operator` (`routes/admin-shipping-customs-workspace.js`) |
| Sourcing | `/admin/workspaces/sourcing` | `admin`, `sourcing` + autorité globale Sourcing (`routes/admin-sourcing-workspace.js`) |

Les mutations restent plus restrictives que la lecture. La navigation ne déduit aucun droit d'action à partir d'un droit de lecture.

## N2 — Finance

| Espace | Route | Guard de lecture constaté |
|---|---|---|
| Vue d'ensemble | `/admin/finance` | `admin`, `market_operator` |
| Comptabilité | `/admin/workspaces/accounting` | `admin`, `finance`, `agent_relais`, `market_operator` (`routes/admin-finance-accounting-workspace.js`) |

L'agent relais voit Finance parce que la projection Comptabilité contient ses dépôts/relevés autorisés ; il ne reçoit pas pour autant les actions de vérification admin.

## Domaines directs

| Domaine | Route admin | Route `market_operator` | Guard principal |
|---|---|---|---|
| Dashboard | `/admin/pilotage` | identique | données unifiées `admin`, `market_operator` (`routes/admin-dashboard-market.js`) |
| Atelier économique | `/admin/workspaces/pricing` | identique, MarketScope obligatoire | `admin`, `market_operator` (`routes/admin-pricing-workspace.js`) |
| Catalogue | `/admin/workspaces/catalog` | `/dashboards/canonical/market-catalog.html` | vérité globale admin ; pays via délégation marché |
| Marchés | `/dashboards/canonical/access.html` | `/dashboards/canonical/market-autonomy.html` | provisioning global admin ; autonomie pays déléguée |

## Parentage des drill-downs

| Surface technique | Domaine parent | Espace N2 parent |
|---|---|---|
| Action Center | Dashboard | — |
| Product 360 | Catalogue | — |
| Order 360 | Commandes | Commerce |
| Client Index / Client 360 | Commandes | Commerce |
| Hub / Relais | Opérations | Hub / Relais |
| Expéditions & Douane | Opérations | Expéditions & Douane |
| Sourcing | Opérations | Sourcing |
| Comptabilité | Finance | Comptabilité |

Le bouton Retour d'une Entity 360 est un retour contextuel ; il ne crée jamais une nouvelle rubrique.

## Invariants V3

1. Dashboard n'est pas un fallback universel.
2. Un rôle spécialisé atterrit sur son premier workspace réellement lisible.
3. `market_operator` utilise Catalogue pays et Autonomie marché, pas les autorités globales admin.
4. Les workspaces spécialisés restent N2.
5. Si un rôle ne voit qu'un espace d'un domaine, le domaine N1 pointe directement sur cet espace ; aucun N2 artificiel n'est affiché.
6. Si un rôle voit plusieurs espaces d'un domaine, le N2 contextuel les expose dans l'ordre canonique.
7. Paramètres n'est jamais N1.
8. Market ID n'est jamais N1.
9. Le shell est unique sur toutes les pages Canonical, y compris Catalogue et les pages Marchés standalone.
10. Toute évolution d'un guard serveur qui change une destination visible doit mettre à jour cette matrice et `tests/unit/canonical-navigation-policy-v3.test.js` dans le même lot.
