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
2. Le backend applique `requireMarketScope` avant toute lecture ou mutation scopée d'un opérateur pays.
3. Les agrégats sont calculés dans le scope autorisé ; on ne charge jamais un ensemble global pour le filtrer ensuite dans le frontend.
4. Le rôle vertical ne suffit pas. Un utilisateur `admin` peut rester enfermé dans un seul marché.
5. Seul un contexte serveur explicitement global autorise une agrégation multi-marchés.
6. L'autorité globale dashboard est persistée dans `dashboard_global_access_grants`, historisée et révocable. Elle n'est jamais déduite du rôle `admin`, ni de l'absence de `operator_market_scopes`.
7. Une autorité globale explicite autorise également le drill vers un marché actif précis ; un opérateur pays reste limité à ses grants `operator_market_scopes`.
8. Le changement de marché dans l'UI est une sélection de vue parmi les marchés déjà autorisés, jamais une élévation de privilège.
9. Les métriques cross-market Komerce utilisent la référence EUR de la Currency Boundary. Le dashboard ne recalcule aucune parité.
10. `operator_market_scopes` demeure un historique d'accès utilisateur. Il ne devient ni une entité partenaire ni une source de settlement.

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

## AdminContext serveur livré

`GET /api/admin/dashboard/context` résout l'autorité depuis les sources serveur puis retourne uniquement une projection UI sans UUID de scope :

```js
{
  actor: { id, role },
  access: {
    mode: 'global' | 'market',
    allowedMarkets: ['CM', 'CG', 'KM'],
    defaultMarket: 'CM' | null,
    capabilities: [
      'pilotage.read',
      'dashboard.market.read',
      // global uniquement :
      'dashboard.global.read'
    ]
  }
}
```

Résolution :

- grant actif `dashboard_global_access_grants` → `mode='global'`, tous les marchés actifs dans `allowedMarkets`, `defaultMarket=null` ;
- sinon grants actifs `operator_market_scopes` → `mode='market'`, uniquement les codes autorisés, premier grant actif comme `defaultMarket` ;
- ni global ni market grant → 403 `dashboard_access_denied` ;
- zéro scope n'est jamais interprété comme autorité centrale.

`public/dashboards/canonical/js/admin-context.js` valide cette projection mais ne possède aucune autorité. Il n'accède ni au réseau ni au stockage local.

## Routes Pilotage livrées

- `GET /api/admin/dashboard/context` : projection d'autorité serveur, `private, no-store`.
- `GET /api/admin/dashboard/unified/market/:marketCode` : opérateur via `requireMarketScope`; central via grant global explicite ; agrégat calculé dans le marché résolu ; `market_id` client interdit.
- Les agrégats globaux historiques `/api/admin/dashboard/*` (`control-tower`, `costing`, `logistics`, `unified`, `cache/clear`) traversent `requireDashboardGlobalAuthority` avant d'atteindre leur routeur.

## Consommation Canonical

Le bootstrap Canonical suit désormais :

```text
/api/auth/me
      ↓ session valide
/api/admin/dashboard/context
      ↓ validateAdminContext()
resolveMarketView()
      ↓
mode=global  → /api/admin/dashboard/unified
mode=market  → /api/admin/dashboard/unified/market/:marketCode
```

Pilotage ne charge donc jamais l'agrégat global pour ensuite filtrer côté navigateur.

## Gate de sortie LOT 2C Pilotage

- contrat `AdminContext` testé et sans accès réseau ;
- AdminContext réellement résolu côté serveur ;
- aucun scope déduit du rôle côté client ;
- aucun `market_id` client accepté comme autorité ;
- `requireMarketScope` branché sur la source Pilotage des opérateurs pays ;
- test d'intégration d'isolation central / CM / admin sans grant ;
- vue globale disponible uniquement pour un grant actif `dashboard_global_access_grants` ;
- absence de scope marché explicitement testée comme **non globale** ;
- Canonical sélectionne l'endpoint avant la lecture des données ;
- aucun import legacy dans `canonical/**`.

Le premier Pilotage Canonical possède désormais une chaîne d'autorité complète du serveur jusqu'au renderer. Le prochain lot peut ajouter la **sélection de marché visible dans l'UI pour le contexte global/multi-market**, sans modifier la frontière de sécurité.

## LOT 4U — opérateur partenaire pays

Le rôle `market_operator` est le rôle de lecture du cockpit partenaire pays. Le rôle seul ne donne aucun accès : un grant actif `operator_market_scopes` reste obligatoire.

- `market_operator` peut résoudre `/api/admin/dashboard/context` ;
- il peut lire Pilotage, Commerce, Opérations et Finance uniquement via les routes `/market/:marketCode` ;
- il ne peut jamais atteindre les agrégats globaux, qui restent `admin` + `dashboard_global_access_grants` ;
- Cameroun (`CM`) et Congo (`CG`) sont donc isolés par le scope serveur, indépendamment de toute sélection navigateur.

Les workspaces de mutation restent hors de ce rôle dans ce lot.

