# LOT 4G — Action Center Canonical

## Mission

Faire naître un Centre d’actions Canonical à partir de la capability métier `decision-signals`, sans recopier `ActionCenterView` ni ses accès UUID historiques.

Doctrine :

> Le signal est un constat dérivé. Le Centre d’actions peut gérer le cycle de vie du signal, mais il ne modifie jamais directement la donnée métier qui a provoqué ce signal.

## Surface

- UI stable : `/admin/action-center`
- alias de construction : `/admin-next/action-center`
- API Canonical : `/api/admin/action-center`
- Legacy conservé pendant la preuve : `/admin/alerts`

Cette surface n’est ni un Dashboard pur ni un Workspace métier classique : ses actions `acknowledge / snooze / resolve` ne changent que le constat dérivé `signals`.

## Portée d’autorité

### Global central, pas market-scoped

La table `signals` ne porte actuellement aucun `market_id` canonique. Le LOT 4G ne fabrique donc pas une fausse dimension pays.

L’Action Center est central/global jusqu’à ce que la génération des signaux porte une vraie propriété marché vérifiable côté serveur.

Le navigateur ne peut fournir aucun :

- `market_id`
- `market_code`
- `signal_id`
- `entity_id`
- UUID interne

### Grant explicite

La migration `153_action_center_signal_authority.sql` crée `decision_signal_global_access_grants`.

- le rôle `admin` seul ne constitue pas l’autorité Canonical ;
- les admins existants au moment de la migration sont bootstrappés pour continuité ;
- les futurs comptes admin n’obtiennent pas automatiquement le grant ;
- un grant révoqué (`revoked_at`) coupe l’accès.

## Identité navigateur

La migration ajoute `signals.signal_ref` :

- format : `KSG-XXXXXX`
- unique
- non-null
- généré côté DB

Toutes les actions Canonical utilisent exclusivement `signal_ref`.

`signals.id`, `resolved_by`, `entity_id` et les autres UUID restent internes.

## Cycle métier corrigé

La lecture du code Legacy a révélé deux défauts de cycle :

1. `snoozed` n’était pas inclus dans la déduplication de génération ; un signal reporté pouvait donc être recréé `open` immédiatement ;
2. l’auto-résolution ne ciblait que `open` ; un signal `acknowledged` ou `snoozed` dont la condition avait disparu pouvait rester actif indéfiniment.

LOT 4G fixe le modèle actif :

- états actifs : `open`, `acknowledged`, `snoozed` ;
- un snooze non expiré reste unique et n’est pas recréé ;
- à expiration du snooze, le signal redevient `open` ;
- si la condition métier disparaît, les trois états actifs sont auto-résolus ;
- `resolve` remet `snoozed_until` à `NULL`.

### Invariant DB — un seul fait actif

La migration résorbe les éventuels doublons historiques actifs en conservant l’intention opérateur la plus forte (`snoozed` > `acknowledged` > `open`), puis crée un index unique partiel sur `(signal_type, entity_type, entity_id)` avec `NULLS NOT DISTINCT` pour les trois états actifs. La déduplication est ainsi garantie jusque sous concurrence entre génération et action opérateur.

## Autorités backend

### `services/signal-service.js`

Reste l’autorité de génération/déduplication des constats.

### `services/signal-admin-service.js`

Nouvelle autorité partagée pour :

- liste et stats ;
- `acknowledge` ;
- `snooze` ;
- `resolve` ;
- hard delete Legacy uniquement ;
- réveil des snoozes expirés ;
- recherche d’un signal actif par `(signal_type, entity_type, entity_id)`.

`routes/signals.js` devient une façade Legacy mince autour de ce service et conserve son contrat HTTP historique.

### `services/action-center-workspace.js`

Orchestre la projection Canonical et délègue toute mutation aux deux autorités ci-dessus.

## Projection Canonical

`GET /api/admin/action-center`

```json
{
  "scope": {
    "mode": "global_decision_signals",
    "label": "Centre d’actions central Komerce",
    "market_dimension": "unavailable"
  },
  "summary": {
    "total_active": 0,
    "urgent": 0,
    "warning": 0,
    "info": 0,
    "ops": 0,
    "economic": 0,
    "sourcing": 0,
    "disputes": 0
  },
  "signals": [],
  "pagination": {
    "total": 0,
    "limit": 100,
    "offset": 0
  }
}
```

Un signal public contient notamment :

- `signal_ref`
- `family`
- `signal_type`
- `severity`
- titre / résumé / recommandation
- statut
- rôle propriétaire
- actions autorisées
- éventuelle référence métier résolue côté serveur

Il ne contient aucun UUID interne.

## Drill-down

Le Legacy exposait `target_view`, `target_filters` et `entity_id` au navigateur.

Canonical ne fait pas confiance à ces identifiants comme autorité.

Le serveur résout uniquement les drill-down qu’il sait convertir en référence métier :

- order → Order 360 par `reference`
- product → Product 360 par `product_ref`
- parcel → Order 360 parent lorsque la commande est résoluble
- cash collection → Order 360 parent lorsque la commande est résoluble

Sinon aucun lien n’est inventé.

## API d’action

- `POST /api/admin/action-center/generate`
- `POST /api/admin/action-center/signals/:signalRef/acknowledge`
- `POST /api/admin/action-center/signals/:signalRef/snooze`
- `POST /api/admin/action-center/signals/:signalRef/resolve`

Aucune suppression hard n’est exposée dans Canonical.

## Boundary UI

`public/dashboards/canonical/js/action-center.js` :

- appelle uniquement `/api/admin/action-center...` ;
- n’importe aucun module Legacy ;
- n’utilise jamais `signal.id` ou `entity_id` ;
- affiche les familles calculées côté serveur ;
- utilise uniquement les drill-down fournis par le serveur ;
- ne possède aucun sélecteur marché.

## Legacy

`/admin/alerts` et `/api/admin/signals` restent disponibles pendant la preuve.

Le refactor du routeur Legacy corrige également son bug d’erreur historique : les handlers déclarent désormais `next`, donc une erreur DB atteint bien le middleware d’erreur au lieu de laisser la requête pendante.

## Security 360

Après intégration de la PR sécurité #950, `docs/SECURITY_360.{json,md}` est régénéré sur la branche 4G avant merge.

La preuve CI dédiée impose que les cinq opérations Canonical `/api/admin/action-center...` soient toutes classées `PROTECTED` par Security 360. Le contrôle `npm run security:360:check` doit ensuite rester read-only et frais sur le même head.

Cette preuve s’ajoute aux gardes runtime `authenticate + requireAdmin + requireDecisionSignalGlobalAuthority` et interdit qu’un simple oubli de projection dérivée masque une nouvelle route admin.

## Feature First

- capability métier : `decision-signals`
  - génération
  - lifecycle
  - API Action Center
  - migration d’autorité
- `dashboard`
  - projection UI Canonical uniquement

## Hors scope 4G

- délégation Action Center par pays tant qu’un `market_id` fiable n’existe pas sur les signaux ;
- mutation d’une commande, d’un colis, d’un produit ou d’un encaissement depuis le Centre d’actions ;
- suppression du Legacy ;
- reconstruction de `ProblemsView` ;
- Shared Carts ;
- Settings ;
- simulateur opérationnel staging.
