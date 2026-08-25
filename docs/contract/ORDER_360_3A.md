# Order 360 Canonical — LOT 3A

## Nature

Order 360 est une **Entity 360**, pas un dashboard et pas un workspace.

Il répond à une question unique :

> « Qu’est-ce qui s’est passé avec cette commande, de bout en bout ? »

Il réunit les vérités existantes ; il ne modifie aucune donnée et ne réimplémente aucun moteur métier.

## URL stable

```text
/admin/orders/:orderReference
```

La référence métier reste lisible dans l’URL. Les UUID internes ne sont pas utilisés comme identifiant de navigation.

## API

```text
GET /api/admin/entities/orders/:orderReference
```

Cette route fait partie du contrat HTTP bloquant : elle doit être déclarée dans `scripts/contract-generate.js`, projetée dans le route-registry et présente dans `docs/contract/openapi.json` avant merge.

Chaîne d’autorité :

```text
session admin
→ résolution reference → order.market_id
→ operator_market_scopes
→ OU dashboard_global_access_grants explicite
→ chargement des facettes
```

La commande est résolue avant les facettes, mais aucune facette n’est chargée tant que le marché n’est pas autorisé.

Une commande historique sans `market_id` est fail-closed pour un opérateur pays. Seule une autorité globale explicite peut l’investiguer.

## Facettes V1

- identité commande ;
- client ;
- marché et destination ;
- paiement constaté sur la commande ;
- articles ;
- colis et affectations d’articles ;
- historique de statuts ;
- scans logistiques ;
- incidents ;
- commentaires terrain ;
- notifications client ;
- factures ;
- documents transactionnels.

## Sources

```text
orders
users
relais
markets
order_items
products
parcels
parcel_items
order_status_history
scans
order_incidents
order_comments
client_notifications
invoices
transaction_documents
```

Order 360 n’est propriétaire d’aucune de ces tables.

## Invariants

1. aucune mutation dans Order 360 ;
2. aucun calcul économique dans le navigateur ;
3. aucun `market_id`, `order_id`, `user_id`, `parcel_id` ou autre UUID technique dans le payload public ;
4. un opérateur marché ne peut lire qu’une commande appartenant à un marché autorisé ;
5. l’autorité globale vient exclusivement de `dashboard_global_access_grants` ;
6. aucun import de `admin/**`, `admin-legacy/**` ou `OrdersLogisticsView` ;
7. Order 360 utilise les primitives Canonical mais pas `DashboardSchema`, car un Entity 360 n’est pas un Overview Dashboard.

## Hors périmètre V1

- mutations de statut ;
- création/modification colis ;
- résolution d’incident ;
- remboursement ;
- édition client ;
- recherche globale de commandes ;
- Client 360 / Product 360.

Ces actes descendent vers les Workspaces propriétaires. Order 360 reste une vue d’investigation en lecture seule.
