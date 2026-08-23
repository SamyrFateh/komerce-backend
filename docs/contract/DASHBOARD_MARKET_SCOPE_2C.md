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

```text
operator_market_scopes
        ↓ résolution serveur
requireMarketScope
        ↓ requête déjà enfermée
agrégateur dashboard
        ↓ données autorisées
AdminContext canonical
        ↓ présentation
DashboardSchema + renderer
```

Règles non négociables :

1. Le navigateur ne choisit jamais son autorité avec `market_id`, une query string, un stockage local ou un rôle supposé.
2. Le backend applique `requireMarketScope` avant toute lecture ou mutation scopée.
3. Les agrégats sont calculés dans le scope autorisé ; on ne charge jamais un ensemble global pour le filtrer ensuite dans le frontend.
4. Le rôle vertical ne suffit pas. Un utilisateur `admin` peut rester enfermé dans un seul marché.
5. Seul un contexte serveur explicitement global autorise une agrégation multi-marchés.
6. Le changement de marché dans l'UI est une sélection de vue parmi les marchés déjà autorisés, jamais une élévation de privilège.
7. Les métriques cross-market Komerce utilisent la référence EUR de la Currency Boundary. Le dashboard ne recalcule aucune parité.
8. `operator_market_scopes` demeure un historique d'accès utilisateur. Il ne devient ni une entité partenaire ni une source de settlement.

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

## Gate de sortie avant données Pilotage

- contrat `AdminContext` testé et sans accès réseau ;
- aucun scope déduit du rôle côté client ;
- aucun `market_id` client accepté comme autorité ;
- `requireMarketScope` branché sur chaque source Pilotage market-scoped ;
- test d'intégration d'isolation CM/CG/KM sur les routes effectivement exposées ;
- vue globale disponible uniquement pour l'autorité Komerce centrale ;
- aucun import legacy dans `canonical/**`.

Le présent lot fige la forme et les invariants. Il ne prétend pas que les routes Pilotage scopées existent déjà.
