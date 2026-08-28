# DASHBOARD CUTOVER 2 — contrat de bascule Canonical

**Statut :** cutover contrôlé, additif, réversible.  
**Date :** 2026-08.

## Objectif

Faire de `public/dashboards/canonical/**` le runtime courant des quatre dashboards déjà reconstruits et prouvés, sans supprimer les capacités Legacy 1 qui n'ont pas encore d'équivalent Canonical.

Le cutover ne change aucune autorité métier, aucun calcul économique et aucun MarketScope. Il change uniquement la résolution des routes HTML d'administration.

## Routes stables Canonical

| URL | Surface |
|---|---|
| `/admin` | Pilotage |
| `/admin/pilotage` | Pilotage |
| `/admin/commerce` | Commerce |
| `/admin/operations` | Opérations |
| `/admin/finance` | Finance |
| `/admin/demo` | Cockpit commande staging |

Toutes ces routes servent `public/dashboards/canonical/index.html` avec `X-Admin-Generation: canonical`.

## Aliases de construction

Les URLs suivantes restent valides pendant la fenêtre de cutover :

- `/admin-next`
- `/admin-next/commerce`
- `/admin-next/operations`
- `/admin-next/finance`
- `/admin-next/demo`
- `/admin/pilotage-v2`

Elles ne constituent plus les URLs produit de référence.

## Rollback

Pilotage est la seule URL stable qui existait déjà dans Legacy 1. Le rollback immédiat est :

`/admin/pilotage?legacy=1`

Le serveur sert alors `public/dashboards/admin/index.html` avec `X-Admin-Generation: legacy-1` tout en laissant le pathname navigateur à `/admin/pilotage`. Le routeur SPA historique retrouve donc `PilotageView` sans adaptation du code Legacy 1.

Les autres témoins historiques restent accessibles via leurs URLs existantes, par exemple :

- Commerce historique : `/admin/sales`
- Opérations historique : `/admin/orders-logistics`
- Finance historique : `/admin/economic`, `/admin/pilotage-fin`

## Extension LOT 4J — convergence Pricing

Les quatre besoins historiques explicitement absorbés par le Pricing Workspace ne conservent plus quatre runtimes produit distincts :

| Ancien point d’entrée | Destination Canonical |
|---|---|
| `/admin/pricing` | `/admin/workspaces/pricing` |
| `/admin/pricing-workshop` | `/admin/workspaces/pricing` |
| `/admin/pricing-strategy` | `/admin/workspaces/pricing` |
| `/admin/economic-flow` | `/admin/workspaces/pricing` |

Chaque ancien pathname accepte encore `?legacy=1` pour servir Legacy 1 pendant la fenêtre de rollback. Cette query ne modifie aucune autorité backend.

`/admin/costing`, `/admin/economic`, `/admin/settings` et `/admin/simulator` ne font pas partie de LOT 4J.

## Extension LOT 4K — convergence Catalogue

Les trois besoins historiques explicitement absorbés par le Catalog Workspace ne conservent plus trois runtimes produit distincts :

| Ancien point d’entrée | Destination Canonical |
|---|---|
| `/admin/products` | `/admin/workspaces/catalog` |
| `/admin/categories` | `/admin/workspaces/catalog` |
| `/admin/catalog-approval` | `/admin/workspaces/catalog` |

Chaque ancien pathname accepte encore `?legacy=1` pour servir Legacy 1 pendant la fenêtre de rollback. Cette query ne modifie aucune autorité backend.

Le détail produit reste `/admin/products/:productRef` → Product 360 Canonical.

## Migration additive

Le cutover ne détourne pas les routes correspondant à des capacités non encore reconstruites, notamment :

- Hub / Relais
- Inventaire
- Expéditions / Transitaire
- Douane
- Sourcing
- Clients / Entity 360
- Factures / Comptabilité
- Action Center
- Paramètres

Ces URLs continuent de servir Legacy 1 jusqu'à preuve de remplacement par un Workspace, un Entity 360, l'Action Center ou une autre surface Canonical autorisée par la doctrine.

## Sécurité

Le changement de route n'altère pas les frontières d'autorité :

1. session via `GET /api/auth/me` ;
2. `AdminContext` via `GET /api/admin/dashboard/context` ;
3. autorité globale explicite ou MarketScope serveur ;
4. aucune autorisation déduite du pathname, du query string ou du navigateur.

`?legacy=1` sélectionne uniquement une génération UI historique ; il ne confère aucun droit supplémentaire.

## Preuves obligatoires

Avant merge :

- les quatre routes stables servent Canonical ;
- `/admin/pilotage?legacy=1` sert Legacy 1 ;
- une route non reconstruite telle que `/admin/hub-relais` reste Legacy 1 ;
- `surfaceForPath()` résout les quatre URLs stables ;
- Canonical reste sans import de `admin/**` ou `admin-legacy/**` ;
- les gates Backend et Governance restent vertes.

## Après cutover

La séquence doctrine reprend avec les surfaces d'action et d'investigation : Entity 360, Workspaces et Action Center. La purge de Legacy 1 reste interdite tant que ces besoins ne sont pas prouvés remplacés.