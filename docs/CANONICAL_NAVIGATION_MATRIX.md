# Matrice de navigation Canonical

Cette matrice est le contrat **courant** entre le shell Canonical et les guards serveur. Elle complète `docs/doctrine/ADMIN_NAVIGATION_DOCTRINE_V3.md` et remplace toute lecture historique contradictoire de `docs/admin-nav-capability-map.md`.

Principe bloquant : **aucune destination visible ne peut exister sans un guard serveur correspondant**. Le navigateur n'accorde jamais un droit ; il ne fait que projeter les destinations que le serveur autorise déjà.

## Représentation du shell

- N1 = **sidebar verticale persistante** ;
- N2 = **onglets horizontaux contextuels** ;
- N3 = filtres, sous-vues et actions locales ;
- topbar = recherche de rubrique + Market ID + compte ;
- Paramètres = utilitaire, jamais N1.

Le même shell est utilisé sur toutes les pages Canonical.

## N1 — domaines métier

Ordre canonique :

1. Dashboard
2. Atelier économique
3. Catalogue
4. Commandes
5. Marchés
6. Opérations
7. Finance

`Analyse` reste réservé tant qu'aucune surface + guard Canonical dédié n'existent.

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

## N2 — Atelier économique

Les onglets internes restent sur **la même autorité Pricing** ; ils ne créent aucun endpoint :

| Onglet | Cible réelle | Rôles visibles |
|---|---|---|
| Vue d'ensemble | `/admin/workspaces/pricing` | `admin`, `market_operator` |
| Produits | section `Décision produit` | `admin`, `market_operator` |
| Coûts | section `Atelier des coûts` | `admin`, `market_operator` |
| Stratégie | section `Stratégie & concurrence` | `admin`, `market_operator` |

## N2 — Catalogue

Pour l'admin global, les onglets organisent la Control Tower déjà existante :

| Onglet | Cible réelle | Rôle |
|---|---|---|
| Vue catalogue | `/admin/workspaces/catalog` | `admin` |
| Sources | `#catalog-sources` | `admin` |
| Raffinerie | `#catalog-refinery` | `admin` |
| Produits | `/admin/workspaces/catalog?view=advanced` | `admin` |
| Boutique | `#catalog-boutique` | `admin` |

Le `market_operator` ne reçoit jamais cette autorité globale ; son entrée Catalogue reste `/dashboards/canonical/market-catalog.html`.

## N2 — Commandes

| Onglet | Route | Rôles visibles |
|---|---|---|
| Vue d'ensemble | `/admin/commerce` | `admin`, `market_operator` |
| Commandes | `/admin/orders` | `admin`, `market_operator` |
| Clients | `/admin/clients` | `admin` uniquement selon guard actuel |

Order 360 et Client 360 restent des drill-downs.

## N2 — Marchés

| Onglet | Route | Rôle |
|---|---|---|
| Accès pays | `/dashboards/canonical/access.html` | `admin` |
| Autonomie marché | `/dashboards/canonical/market-autonomy.html` | `market_operator` |

Un profil ne voit qu'une destination Marchés aujourd'hui ; aucun faux second onglet n'est fabriqué.

## N2 — Opérations

| Onglet | Route | Guard de lecture constaté |
|---|---|---|
| Vue d'ensemble | `/admin/operations` | `admin`, `market_operator` |
| Hub / Relais | `/admin/workspaces/operations` | `admin`, `agent_hub`, `agent_relais`, `market_operator` |
| Expéditions & Douane | `/admin/workspaces/shipping-customs` | `admin`, `agent_hub`, `agent_transitaire`, `market_operator` |
| Sourcing | `/admin/workspaces/sourcing` | `admin`, `sourcing` + autorité globale Sourcing |

## N2 — Finance

| Onglet | Route | Guard de lecture constaté |
|---|---|---|
| Vue d'ensemble | `/admin/finance` | `admin`, `market_operator` |
| Comptabilité | `/admin/workspaces/accounting` | `admin`, `finance`, `agent_relais`, `market_operator` |

## Parentage des drill-downs

| Surface technique | Domaine parent | Onglet parent |
|---|---|---|
| Action Center | Dashboard | — |
| Product 360 | Catalogue | Produits |
| Order 360 | Commandes | Commandes |
| Client Index / Client 360 | Commandes | Clients |
| Hub / Relais | Opérations | Hub / Relais |
| Expéditions & Douane | Opérations | Expéditions & Douane |
| Sourcing | Opérations | Sourcing |
| Comptabilité | Finance | Comptabilité |

## Invariants V4

1. N1 est vertical, jamais une top-nav métier concurrente.
2. N2 est horizontal et contextuel au domaine actif.
3. N3 reste local à la page.
4. Dashboard n'est pas un fallback universel.
5. Un rôle spécialisé atterrit sur son premier workspace réellement lisible.
6. `market_operator` utilise les surfaces pays, pas les autorités globales admin.
7. Paramètres n'est jamais N1.
8. Market ID n'est jamais N1/N2.
9. Catalogue et Atelier économique utilisent exactement le même shell que les autres domaines.
10. Les mocks sont traduits par `docs/doctrine/CANONICAL_UI_STYLE_CONTRACT_V1.md` en valeurs mesurables.
11. Toute évolution d'un guard serveur qui change une destination visible met à jour cette matrice et les tests de navigation dans le même lot.
