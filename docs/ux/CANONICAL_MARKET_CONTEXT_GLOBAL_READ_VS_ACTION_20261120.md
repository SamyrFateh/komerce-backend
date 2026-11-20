# UX MarketScope — lecture globale puis cible d'exécution (20 novembre 2026)

## Doctrine

Le **serveur** résout les autorisations à la connexion et les revérifie sur chaque API. Le filtre marché n'est **jamais** une autorisation. Un rôle `admin` sans grant actif `dashboard_global_access_grants` ne devient pas global. Un compte `agent_hub` a une lecture logistique centrale distincte de la consolidation commerciale/financière. Un opérateur pays ne voit que les marchés explicitement autorisés, et les données multi-marchés ne sont pas chargées côté navigateur pour être filtrées après coup.

**Règle UX :** si le serveur autorise une lecture consolidée et qu'un lecteur canonique existe, la vue s'ouvre sur **Tous les marchés** sans demander de pays. Une **mutation** exige le marché cible ou le marché déduit de la ressource. Le sélecteur ne change pas les droits.

## Audit des entrées `app.js`

| Surface | Ancien contexte | Après la correction | Justification |
|---|---|---|---|
| Pilotage / Commerce / Commandes / Clients / Opérations / Finance | Marché facultatif, global si grant explicite | **Inchangé** | Dashboards GET globaux et endpoints pays déjà séparés |
| Hub `/admin/hub` | Board central global, sans sélecteur | **Inchangé** | `GET /api/hub/board`, scoped côté serveur si responsable marché ; marché sur chaque ligne |
| Hub `/admin/hub-live?view=execute` | `requireMarket: true`, invite même pour Hub central | **Lecture initiale du board Hub central**, puis marché cible pour les actions physiques | Utilise `renderGlobalBoard` existant, aucune action sans marché |
| Expéditions & Douane | `requireMarket: true`, invite même pour admin global | **Vue Opérations consolidée** si grant global, puis pays pour l'atelier Douane | `KomerceCanonicalOperations` sait interroger l'agrégat global ; module Shipping Customs continue d'exiger un code |
| Finance / Comptabilité | `requireMarket: true`, invite même pour admin global | **Vue Finance consolidée** si grant global, puis pays pour les opérations comptables | `KomerceCanonicalFinance` interroge l'agrégat global ; module Accounting reste scoped |
| Relais exécution / remises | `requireMarket: true` | **Inchangé** | Le geste physique concerne un relais / un marché ; le relais mono-marché est résolu automatiquement côté serveur |
| Atelier Pricing | `requireMarket: true` | **Inchangé** | Prix, règles et décisions sont intrinsèquement locaux ; aucune vue globale canonique de pricing n'est disponible ici |
| Ancien Workspace Opérations | Redirect vers Hub / Relais | **Inchangé** | Pas de second workspace ou de second writer |

Le retour à **Tous les marchés** est possible dans les trois nouveaux écrans consolidés, **sans** lancer un writer avec `marketCode=null`. Si `?market=XX` est interdit, un écran de refus apparaît sans repli implicite sur l'agrégat global.

## Limites délibérées

1. Un utilisateur avec **plusieurs** marchés autorisés mais **sans grant global** ne peut pas inventer un agrégat multi-marchés en concaténant des réponses frontend. Une projection serveur dédiée est requise avant d'offrir cette vue.
2. Les opérations physique/financière et Pricing gardent le marché explicite, ou celui de la ressource déjà identifiée. Le choix d'un marché dans l'atelier est un **contexte d'action**, pas une obligation d'accès à la consultation globale.
3. Ce chantier ne modifie aucune route API, grant, mutation, migration, paramètre de marché ni écriture staging.

## Preuves attendues

- Jest : ouverture consolidée admin avec grant, choix d'un pays, retour Tous, refus d'un marché non autorisé, acteur Hub sans autorité Dashboard globale et refus d'agrégation pour utilisateur scopé.
- Jest : Pricing et Relais conservent le choix explicite.
- CI : `npm run pr:preflight`, contrôles Dashboard et `Required verdict` verts sur le SHA final.
- **Non couvert par la CI seule** : revue visuelle des écrans réels et Golden M01 KM/CM/CG sur staging et SHA déployé.
