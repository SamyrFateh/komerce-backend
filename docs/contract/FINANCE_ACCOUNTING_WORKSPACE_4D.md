# LOT 4D — Finance / Comptabilité Workspace Canonical

## Mission

Le Workspace Finance / Comptabilité est la surface d’action mono-marché pour le cash relais :

- rapprocher cash attendu, collecté et déposé ;
- déclarer un dépôt relais ;
- vérifier ou contester un dépôt ;
- identifier les commandes cash non encaissées ;
- consulter les factures du marché sans les modifier.

La doctrine reste :

> Dashboard observe. Workspace agit. Entity 360 explique.

`/admin/finance` reste le dashboard économique. `Order 360` reste le drill-down commande/document.

## Surface stable

- HTML : `GET /admin/workspaces/accounting`
- alias build : `/admin-next/workspaces/accounting`
- API : `/api/admin/workspaces/accounting/market/:marketCode`

LOT 4P fait converger les anciennes entrées vers cette surface :

- `/admin/accounting` → `/admin/workspaces/accounting`
- `/admin/invoices` → `/admin/workspaces/accounting`
- `?legacy=1` conserve le rollback Legacy 1 sur chacun des deux anciens pathnames.

Les fichiers Legacy restent présents pendant la fenêtre de rollback ; aucune suppression n’est incluse dans LOT 4P.

## Frontière Feature First

LOT 4D ne déplace pas l’autorité cash dans le Dashboard :

- la feature `payments` possède `cash-deposit-service`, la migration `148` et les mutations de dépôt ;
- la feature `dashboard` possède uniquement la projection, la route d’orchestration et l’UI du Workspace Canonical ;
- `routes/cash.js` Legacy et le Workspace Canonical délèguent à la même autorité `payments`.

Cette séparation garantit qu’une évolution de l’UI Finance ne crée jamais une seconde vérité métier pour les dépôts.

## Marché obligatoire

Contrairement au Catalogue 4C, la comptabilité opérationnelle est toujours liée à un marché explicite.

Ordre d’autorisation :

1. session authentifiée ;
2. rôle Workspace ;
3. rejet d’un `market_id` / `marketId` fourni par le navigateur ;
4. résolution du marché actif via `:marketCode` ;
5. chargement de `operator_market_scopes` ;
6. autorisation du marché exact, ou autorité dashboard globale explicite ;
7. contrôle du rôle de mutation ;
8. re-résolution de la ressource dans ce marché ;
9. délégation à l’autorité métier.

Le Workspace n’expose aucune mutation globale.

## Autorités et rôles

### Lecture

- `admin`
- `finance`
- `agent_relais`

### Déclarer un dépôt

- `agent_relais`
- `admin` uniquement s’il est lui-même affecté à un relais du marché

Le navigateur ne fournit jamais `agent_id` : le déposant est toujours la session authentifiée.

### Vérifier / contester

- `admin` uniquement

LOT 4D ne transforme pas le rôle `finance` en autorité de mutation. Il reste lecture seule tant qu’une décision métier distincte ne l’autorise pas.

## Référence métier dépôt

Migration `148_cash_deposit_business_reference.sql` ajoute :

- `cash_deposits.deposit_ref`
- format `KDP-xxxxxx`
- unicité
- valeur par défaut via séquence

Le navigateur manipule `deposit_ref`, jamais l’UUID de `cash_deposits`.

Avant `verify` ou `dispute`, le serveur résout :

`deposit_ref -> cash_deposits.id`

uniquement si :

`cash_deposits.agent_id -> users.relais_id -> relais.market_id == marché sélectionné`.

Un dépôt hors marché retourne 404 et ne révèle pas son existence.

## Autorité métier dépôt partagée

LOT 4D extrait les mutations directes de `routes/cash.js` dans :

`services/cash-deposit-service.js`

Legacy et Canonical délèguent au même service pour :

- création ;
- vérification ;
- contestation.

Les validations historiques sont conservées :

- montant > 0 ;
- méthode parmi `mobile_money | bank | physical` ;
- période requise ;
- raison obligatoire pour une contestation.

## Projection de lecture

`GET /api/admin/workspaces/accounting/market/:marketCode?from=&to=&hours=`

```json
{
  "scope": {},
  "filters": {},
  "summary": {},
  "reconciliation": {},
  "deposits": [],
  "uncollected": [],
  "collections": [],
  "invoices": []
}
```

### Sources et frontière marché

- `cash_collections` -> `orders.market_id`
- `cash_deposits` -> `users.relais_id` -> `relais.market_id`
- commandes non encaissées -> `orders.market_id`
- factures -> `invoices.order_id` -> `orders.market_id`

Aucun rattachement par île, libellé ou texte libre.

Les dépôts historiques sans relais résolvable sont exclus des actions Canonical : ils ne peuvent pas être arbitrairement affectés à un marché.

## Routes d’action

### Dépôt

`POST /api/admin/workspaces/accounting/market/:marketCode/deposits`

Body métier :

```json
{
  "amount_kmf": 50000,
  "deposit_method": "mobile_money",
  "period_start": "2026-08-20",
  "period_end": "2026-08-26",
  "reference": "MM-123",
  "proof_url": null,
  "notes": null
}
```

`agent_id`, `agentId`, `market_id`, `marketId` sont interdits.

### Vérification

`POST /api/admin/workspaces/accounting/market/:marketCode/deposits/:depositRef/verify`

### Contestation

`POST /api/admin/workspaces/accounting/market/:marketCode/deposits/:depositRef/dispute`

Body :

```json
{ "reason": "Montant du justificatif différent" }
```

## Factures

Les factures sont des snapshots immuables produits par `invoice-service`.

LOT 4D :

- les liste dans le marché ;
- indique si le PDF privé est disponible ;
- renvoie vers `Order 360` ;
- ne modifie pas une facture ;
- ne recrée pas une facture manuellement.

Le besoin historique `InvoicesView` est donc absorbé par cette projection et son drill vers Order 360 ; LOT 4P fait converger son pathname sans recréer une seconde vue Factures.

## Browser invariants

Le module Canonical :

- appelle uniquement `/api/admin/workspaces/accounting...` ;
- n’appelle pas `/api/cash` ;
- n’appelle pas `/api/invoices` ;
- n’importe pas `AccountingView`, `InvoicesView`, `ApiClient` ou `KmcApi` ;
- n’envoie jamais `market_id`, `agent_id` ou UUID dépôt ;
- recharge la projection après mutation ;
- utilise `Order 360` comme drill-down.

## Hors périmètre

LOT 4D / 4P ne :

- remplace pas le dashboard `/admin/finance` ;
- bascule pas `/admin/economic` ni `/admin/pilotage-fin` sans audit séparé ;
- modifie pas les règles du moteur économique ;
- ne crée pas d’écriture comptable générale ;
- ne modifie pas les factures immuables ;
- ne donne pas de mutation au rôle `finance` ;
- ne supprime pas les fichiers Legacy pendant la fenêtre de rollback ;
- ne traite pas les dépôts historiques impossibles à rattacher à un marché.
