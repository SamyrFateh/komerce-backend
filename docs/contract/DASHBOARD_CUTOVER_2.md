# DASHBOARD CUTOVER 2 — contrat de bascule Canonical

**Statut :** cutover contrôlé, additif, réversible.  
**Date :** 2026-09.

## Objectif

Faire de `public/dashboards/canonical/**` le runtime courant des quatre dashboards déjà reconstruits et prouvés, sans supprimer les capacités Legacy 1 qui n'ont pas encore d'équivalent Canonical.

Le cutover ne change aucune autorité métier, aucun calcul économique et aucun MarketScope. Il change uniquement la résolution des routes HTML d'administration et les destinations de navigation déjà prouvées.

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

Les autres témoins historiques restent accessibles via leurs URLs existantes, avec `?legacy=1` lorsque leur entrée normale a déjà convergé vers Canonical.

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

## Extension LOT 4L — convergence Sourcing

Les deux points d’entrée strictement Sourcing ne conservent plus deux runtimes produit distincts :

| Ancien point d’entrée | Destination Canonical |
|---|---|
| `/admin/sourcing` | `/admin/workspaces/sourcing` |
| `/admin/sourcing-scanner` | `/admin/workspaces/sourcing` |

Chaque ancien pathname accepte encore `?legacy=1` pour servir Legacy 1 pendant la fenêtre de rollback. Cette query ne modifie aucune autorité backend.

`/admin/suppliers` reste Legacy : la vue historique couvre des familles de partenaires au-delà du seul `partner_type = sourcing` possédé par le Workspace 4E.

## Extension LOT 4N — convergence Action Center

Les deux anciennes surfaces de constats ne conservent plus deux runtimes produit parallèles :

| Ancien point d’entrée | Destination Canonical |
|---|---|
| `/admin/alerts` | `/admin/action-center` |
| `/admin/problems` | `/admin/action-center` |

Chaque ancien pathname accepte encore `?legacy=1` pour servir Legacy 1 pendant la fenêtre de rollback. Cette query ne modifie aucune autorité backend.

`ProblemsView` n’est pas recopié : LOT 4H a audité ses règles une par une. Les prédicats faux ou non prouvables restent volontairement absents du moteur `decision-signals`.

## Extension LOT 4O — convergence Opérations

Les trois anciennes entrées de pilotage et d’exécution opérationnels convergent vers les deux natures de surface prévues par la doctrine : le Dashboard observe, le Workspace agit.

| Ancien point d’entrée | Destination Canonical | Besoin absorbé |
|---|---|---|
| `/admin/orders-logistics` | `/admin/operations` | KPI, file active, retards et signaux opérationnels |
| `/admin/hub-relais` | `/admin/workspaces/operations` | commander, répartir, expédier, encaisser, réceptionner et remettre |
| `/admin/inventory` | `/admin/workspaces/operations` | file inventaire, colis ouverts et affectation mono-marché |

Chaque ancien pathname accepte encore `?legacy=1` pour servir Legacy 1 pendant la fenêtre de rollback.

L’ancienne mutation globale `hubInventoryProposeAll` n’est pas reconstruite. Elle ne possède pas l’autorité mono-marché exigée par Canonical ; l’affectation explicite d’un article à un colis autorisé remplace ce raccourci sans réintroduire une mutation globale.

Cette extension ne bascule pas `/admin/transitaire` ni `/admin/customs`. Le Workspace Expéditions & Douane reste additif jusqu’à complétude de la saisie douane et réconciliation des anciennes expéditions sans `market_id` autoritatif.

## Extension LOT 4P — convergence Finance / Comptabilité

Les anciennes vues de comptabilité opérationnelle et de factures convergent vers le Workspace Comptabilité, tandis que le Dashboard Finance reste la surface d’observation économique.

| Ancien point d’entrée | Destination Canonical | Besoin absorbé |
|---|---|---|
| `/admin/accounting` | `/admin/workspaces/accounting` | rapprochement cash, dépôts, vérification/contestation, non-encaissé |
| `/admin/invoices` | `/admin/workspaces/accounting` | liste des factures du marché et drill vers Order 360 |

Chaque ancien pathname accepte encore `?legacy=1` pour servir Legacy 1 pendant la fenêtre de rollback.

LOT 4P ne bascule pas `/admin/economic` ni `/admin/pilotage-fin`. Ces vues historiques restent Legacy jusqu’à un audit séparé de leurs besoins par rapport au Dashboard Finance et aux Workspaces existants.

## Extension LOT 4Q — convergence Control Tower

`ControlTowerView` est une surface de lecture. Ses besoins légitimes sont déjà répartis entre Pilotage, Opérations et Action Center ; elle ne justifie donc plus une destination produit autonome.

| Ancien point d’entrée | Destination Canonical |
|---|---|
| `/admin/control-tower` | `/admin/pilotage` |

`/admin/control-tower?legacy=1` conserve le témoin Legacy 1 pendant la fenêtre de rollback. L’ancien `/control-tower.html` garde son mécanisme de dépréciation existant.

## Normalisation des destinations internes

Une surface Canonical ne doit pas renvoyer normalement vers une URL déjà cutover. Les projections et métriques utilisent donc directement les destinations stables suivantes :

- commandes / logistique → `/admin/operations` ;
- alertes critiques → `/admin/action-center` ;
- pricing → `/admin/workspaces/pricing` ;
- Control Tower → `/admin/pilotage`.

Les query strings de contexte peuvent être conservées pour exprimer le drill demandé, même si une surface Canonical ne les exploite pas encore toutes.

Cette normalisation ne masque pas les besoins encore incomplets. Les destinations `costing`, `economic`, `pilotage-fin` et `recalibration` restent Legacy tant que Finance/Pricing Canonical n’ont pas prouvé leur couverture fonctionnelle complète.

Dans Pilotage Canonical, la table « Chaîne économique » n’affiche plus des pathnames techniques ; elle affiche la destination fonctionnelle (`Pricing`, `Opérations`, `Finance`). Les liens d’alertes reçus du backend sont normalisés vers leur destination Canonical lorsqu’un cutover est déjà prouvé.

## Migration additive

Le cutover ne détourne pas les routes correspondant à des capacités non encore reconstruites, notamment :

- Expéditions / Transitaire
- Douane
- Partenaires multi-familles / Suppliers
- Economique / Pilotage financier historique
- Costing détaillé / recalibrage
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
- les anciennes routes Opérations convergent, avec `?legacy=1` comme rollback ;
- les anciennes routes Accounting/Invoices convergent vers le Workspace Comptabilité, avec `?legacy=1` comme rollback ;
- `/admin/control-tower` converge vers Pilotage et `?legacy=1` garde le témoin ;
- les métriques/drills déjà cutover ne ciblent plus `orders-logistics`, `alerts` ou `pricing` Legacy ;
- une route non reconstruite telle que `/admin/customs` reste Legacy 1 ;
- `surfaceForPath()` résout les quatre URLs stables ;
- Canonical reste sans import de `admin/**` ou `admin-legacy/**` ;
- les gates Backend et Governance restent vertes.

## Après cutover

La séquence doctrine reprend avec la couverture fonctionnelle manquante des surfaces encore Legacy, en priorité Finance (`EconomicView`, `CostingView`, `PilotageFinView`) et Commerce (`SalesView`). La purge de Legacy 1 reste interdite tant que ces besoins ne sont pas prouvés remplacés.
