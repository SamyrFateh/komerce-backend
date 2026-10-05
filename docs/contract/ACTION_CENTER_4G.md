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

### Scope global central et scopes marché explicites

Le modèle actuel porte `signals.market_id` : `NULL` est un fait global explicite, une valeur non nulle est un fait borné au Market ID canonique résolu côté serveur. L’Action Center global et les vues marché restent strictement isolés.

Un générateur ne peut produire un signal marché que lorsqu’une propriété marché vérifiable appartient à sa source. Le nouveau `supplier_payment_review` reste volontairement global : une PO fournisseur peut être multi-marchés et aucune ventilation financière canonique ne permet de lui attribuer un Market ID sans invention.

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
- supplier payment → détail exact de la PO dans Achats fournisseurs, **global uniquement**, via la population Purchasing canonique `ambiguous` / `rejected` / `mismatched`

Sinon aucun lien n’est inventé. Un signal `supplier_payment` porteur d’un Market ID ne résout jamais de PO : aucune allocation marché du paiement fournisseur n’est fabriquée.

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

## Legacy / cutover 4N

LOT 4N ferme le point d’entrée UI `/admin/alerts` après preuve : sans query de rollback, il redirige vers `/admin/action-center`. `/admin/alerts?legacy=1` sert encore Legacy 1 pendant la fenêtre de rollback.

L’API historique `/api/admin/signals` reste disponible pour les consommateurs Legacy ; le cutover 4N est un changement de surface UI, pas une suppression d’API.

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


## Extension 2026-10 — paiement fournisseur

Le type `supplier_payment_review` dérive exclusivement du lecteur Purchasing `services/supplier-payment-review.js`. L’identité active est le paiement fournisseur (`entity_type=supplier_payment`), pas la PO : plusieurs paiements à revoir d’une même PO restent des faits distincts.

Le générateur est global (`market_id=NULL`) et reprend exactement la condition canonique : `status IN ('ambiguous','rejected') OR reconciliation_status='mismatched'`. `requested`, `real_debit_verified=false` seul et l’absence de preuve ne deviennent pas des alertes par inférence. Une divergence de rapprochement reprend la sévérité critique déjà utilisée par Finance ; les autres cas restent warning.

La génération lit au plus 50 éléments par passe. Si la population est tronquée, elle **n’auto-résout aucun ancien signal** afin de ne pas conclure à tort qu’un paiement non lu est revenu à la normale. Quand la population complète est visible, la disparition de la condition Purchasing auto-résout le signal dérivé. Les actions Action Center ne modifient toujours que `signals`.
