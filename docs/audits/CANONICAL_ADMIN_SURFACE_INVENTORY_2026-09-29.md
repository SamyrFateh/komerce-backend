# Inventaire surfaces Admin — après convergence Sourcing → Catalogue

_Date : 2026-09-29_

## Règle

Le Canonical devient la seule référence fonctionnelle. Une surface Legacy absorbée n'est plus
un rollback valide : son ancien pathname redirige vers la surface Canonical correspondante.

Les détails techniques restent disponibles uniquement lorsqu'ils servent à expliquer une
exception ou dans un diagnostic explicitement demandé.

## Surfaces Canonical actives

| Domaine | Point d'entrée | Rôle |
|---|---|---|
| Pilotage | `/admin/pilotage` | décisions de gestion transverses |
| Atelier économique | `/admin/workspaces/pricing` | prix, coûts, arbitrages économiques |
| Catalogue global | `/admin/workspaces/catalog` | curation + assortiment commercial global |
| Commerce | `/admin/commerce` | cockpit commerce |
| Commandes | `/admin/orders` | suivi et décisions commandes |
| Marchés | `/dashboards/canonical/access.html` | accès / délégation |
| Marché local | `/dashboards/canonical/market-autonomy.html` | stratégie locale |
| Prêts à vendre | `/dashboards/canonical/market-catalog.html` | décision commerciale locale |
| Opérations | `/admin/operations` | cockpit opérations |
| **Cockpit imports** | `/admin/import-runtime` | **point d'entrée Sourcing → KIR → Catalogue → vente → clôture** |
| Sourcing | `/admin/workspaces/sourcing` | configuration détaillée sources/candidats/fournisseurs |
| Hub / Relais | `/admin/workspaces/operations` | actions terrain |
| Expéditions & Douane | `/admin/workspaces/shipping-customs` | actions logistiques/douane |
| Finance | `/admin/finance` | décisions de gestion financières |
| Comptabilité | `/admin/workspaces/accounting` | workspace comptable |
| Action Center | `/admin/action-center` | signaux transverses nécessitant action |
| Product 360 | `/admin/products/:productRef` | drill-down produit |
| Order 360 | `/admin/orders/:reference` | drill-down commande |
| Client 360 | `/admin/clients/:phone` | drill-down client |

Pour le rôle `sourcing`, le landing Canonical est désormais `/admin/import-runtime`.
Le Workspace Sourcing est un drill-down de configuration, pas le cockpit principal.

## Surfaces retirées dans cette convergence

Ces vues sont absorbées et supprimées du runtime Legacy :

- `SourcingView` → Workspace Sourcing + Cockpit imports
- `SourcingScannerView` → Workspace Sourcing
- `ImportRuntimeView` → Cockpit imports Canonical
- `ProductsView` → Catalogue global + Product 360
- `CategoriesView` → Catalogue Workspace
- `CatalogApprovalView` → File de curation Catalogue
- `product-card-model.admin.js` → aucun consommateur restant après retrait de ProductsView

Les anciens pathnames Catalogue/Sourcing restent compatibles **uniquement par redirection**.
Le query `?legacy=1` ne ressuscite plus ces surfaces absorbées.

## Legacy encore présent — à auditer domaine par domaine

Les surfaces suivantes ne sont pas supprimées dans cette passe car leur absorption complète
n'est pas encore prouvée ou leur périmètre dépasse Sourcing → Catalogue :

- `SuppliersView` — couvre aussi des familles de partenaires hors sourcing
- `CustomsView`
- `TransitaireView`
- `SalesView`
- `SanteView`
- `SharedCartsView`
- `SimulatorView`
- plusieurs anciennes vues Pricing / Finance / Operations encore conservées comme rollback

### Règle de prochaine passe

Pour chaque surface restante :

1. identifier la décision de gestion réellement portée ;
2. prouver l'équivalent Canonical ;
3. déplacer l'éventuel diagnostic technique dans un drill-down ;
4. retirer la route Legacy normale ;
5. retirer le rollback quand l'absorption est prouvée ;
6. supprimer fichier + tests dédiés + références de manifest.

Aucune nouvelle surface Canonical ne doit être créée pour préserver un écran Legacy :
on converge vers les cockpits et workspaces existants.
