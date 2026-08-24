# Dashboard Finance Canonical — LOT 2F

## Mission

Finance Canonical expose l’argent réellement encaissé, les coûts réels, la marge consolidée et les écarts financiers qui nécessitent une action. Il ne remplace pas encore les vues Finance historiques : il constitue une projection neuve dans le runtime Canonical.

## Autorité

### Vue marché

```text
marketCode de route
→ résolution du marché actif côté serveur
→ operator_market_scopes / autorité globale explicite pour drill
→ requireDashboardMarketRead
→ dashboard-finance-canonical
```

Le client ne fournit jamais de `market_id` autoritatif. Toute présence de `market_id` dans la requête est refusée.

### Vue globale

```text
dashboard_global_access_grants
→ requireDashboardGlobalAuthority
→ dashboard-finance-canonical
```

Le rôle `admin` seul ne suffit pas à ouvrir la vue globale.

## Période financière

La période sélectionnée est limitée à 7, 30 ou 90 jours.

Deux dates sources restent volontairement distinctes :

- commandes, CA et coûts : `orders.created_at` via les métriques dashboard canoniques ;
- remboursements : `refunds.completed_at`, car le remboursement appartient à la période où l’événement financier est réellement finalisé.

Le marché d’un remboursement est résolu par `refunds.order_id → orders.market_id`.

## Projection V1

KPI :

- CA encaissé ;
- coût réel ;
- marge consolidée ;
- complétude coûts ;
- commandes à coût incomplet ;
- paiements en attente ;
- montant remboursé.

Tables :

- encaissements par mode de paiement ;
- remboursements récents ;
- commandes à coût incomplet.

Les produits et catégories restent dans Commerce. La logistique et les incidents restent dans Opérations.

## Invariants

1. aucune UUID de marché n’est exposée dans le payload public ;
2. aucune recomputation métier n’est effectuée dans le navigateur ;
3. une vue marché ne peut lire qu’un marché autorisé côté serveur ;
4. les remboursements d’un autre marché ne peuvent pas entrer dans une vue pays ;
5. le dashboard Finance legacy reste inchangé jusqu’à preuve de remplacement.
