# LOT 2C-CANON — Contrat Dashboard × MarketScope

## Décision

Le runtime canonical reste unique. Il ne crée ni frontend, ni schema, ni dashboard dupliqué par pays.

Deux audiences consomment les mêmes quatre dashboards :

| Audience | Portée | Finalité |
|---|---|---|
| Komerce central | globale ou marché sélectionné | gouvernance, comparaison, pilotage et consolidation |
| partenaire opérateur pays | marchés explicitement autorisés | pilotage fonctionnel et exploitation locale |

`MARKET` est l'unité de délégation business : qui voit, qui agit, qui opère. `CORRIDOR` reste une dimension technique et logistique : comment la marchandise circule. Un corridor ne donne jamais une autorisation.

## Frontière d'autorité

Vue market-scoped :

```text
operator_market_scopes
        ↓ résolution serveur
requireMarketScope
        ↓ requête déjà enfermée
agrégateur dashboard market
        ↓ données autorisées
AdminContext canonical
        ↓ présentation
DashboardSchema + renderer
```

Vue globale Komerce :

```text
dashboard_global_access_grants
        ↓ résolution serveur
requireDashboardGlobalAuthority
        ↓ agrégateurs globaux autorisés
AdminContext canonical mode=global
        ↓ présentation
DashboardSchema + renderer
```

Règles non négociables :

1. Le navigateur ne choisit jamais son autorité avec `market_id`, une query string, un stockage local ou un rôle supposé.
2. Le backend applique `requireMarketScope` avant toute lecture ou mutation scopée.
3. Les agrégats sont calculés dans le scope autorisé ; on ne charge jamais un ensemble global pour le filtrer ensuite dans le frontend.
4. Le rôle vertical ne suffit pas. Un utilisateur `admin` peut rester enfermé dans un seul marché.
5. Seul un contexte serveur explicitement global autorise une agrégation multi-marchés.
6. L'autorité globale dashboard est persistée dans `dashboard_global_access_grants`, historisée et révocable. Elle n'est jamais déduite du rôle `admin`, ni de l'absence de `operator_market_scopes`.
7. Le changement de marché dans l'UI est une sélection de vue parmi les marchés déjà autorisés, jamais une élévation de privilège.
8. Les métriques cross-market Komerce utilisent la référence EUR de la Currency Boundary. Le dashboard ne recalcule aucune parité.
9. `operator_market_scopes` demeure un historique d'accès utilisateur. Il ne devient ni une entité partenaire ni une source de settlement.

### Bootstrap legacy de l'autorité globale

La migration `145_dashboard_global_access_grants.sql` transforme une seule fois l'état legacy en grants persistés : les admins existants sans scope marché actif reçoivent un grant `legacy-central-bootstrap-2026-08-24`.

Ce bootstrap n'est **pas** une règle runtime. Après la migration :

- un nouvel utilisateur `admin` sans grant global reçoit 403 sur les agrégats globaux ;
- un admin avec un scope CM/CG/KM mais sans grant global reçoit également 403 ;
- seul un grant actif dans `dashboard_global_access_grants` ouvre la vue cross-market ;
- une révocation conserve l'historique et ferme immédiatement l'accès.

## Projection des dashboards

| Dashboard canonical | Komerce central | Partenaire pays |
|---|---|---|
| Pilotage | santé globale, comparaison et drill pays | santé, objectifs et signaux de son marché |
| Commerce | performance consolidée et comparaison | ventes, clients, offre et paiements locaux |
| Opérations | capacité et exceptions cross-market | commandes, douane, hub, relais, livraison, SAV et SLA locaux |
| Finance | économie, trésorerie et gouvernance globale | encaissements, rapprochements et commissions autorisés du marché |

Le Dashboard observe. Les actes terrain restent dans les workspaces scopés par marché. Les mutations continuent d'appartenir à leurs features métier.

## Contrat client

`public/dashboards/canonical/js/admin-context.js` valide uniquement une projection déjà résolue par le serveur :

```js
{
  actor: { id, role },
  access: {
    mode: 'global' | 'market',
    allowedMarkets: ['KM', 'CM', 'CG'],
    defaultMarket: 'CM' | null,
    capabilities: ['operations.read']
  }
}
```

Ce contrat pilote la navigation et l'affichage. Il n'est pas une barrière de sécurité. Chaque future source du LOT 2C devra prouver son enforcement backend indépendamment.

## Routes Pilotage livrées

- `GET /api/admin/dashboard/unified/market/:marketCode` : `requireMarketScope`, agrégat calculé dans le marché autorisé, `market_id` client interdit.
- Les agrégats globaux historiques `/api/admin/dashboard/*` (`control-tower`, `costing`, `logistics`, `unified`, `cache/clear`) traversent `requireDashboardGlobalAuthority` avant d'atteindre leur routeur.

## Gate de sortie avant données Pilotage

- contrat `AdminContext` testé et sans accès réseau ;
- aucun scope déduit du rôle côté client ;
- aucun `market_id` client accepté comme autorité ;
- `requireMarketScope` branché sur chaque source Pilotage market-scoped ;
- test d'intégration d'isolation CM/CG/KM sur les routes effectivement exposées ;
- vue globale disponible uniquement pour un grant actif `dashboard_global_access_grants` ;
- absence de scope marché explicitement testée comme **non globale** ;
- aucun import legacy dans `canonical/**`.

Le contrat de sécurité backend Pilotage est désormais matérialisé. Le prochain lot peut projeter cette autorité dans un `AdminContext` serveur sans inventer de privilège côté client.
