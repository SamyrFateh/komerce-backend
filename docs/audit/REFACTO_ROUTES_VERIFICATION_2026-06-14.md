# Vérification refacto routes — 2026-06-14

> Scope : vérification statique du repo GitHub courant.  
> Instruction : ne pas se baser sur le statut déclaratif du fichier `REFACTO_ROUTES_STATUS.md`, mais sur le code réel.

---

## Verdict

Le refacto routes est **très avancé**, mais **pas complètement terminé** au sens strict de la doctrine :

```txt
Route = auth + validation + appel service + réponse.
Service = transaction + décision métier + idempotence + mutation DB.
```

Plusieurs lots ont été fortement traités, notamment R3, R4, R5 partiel, R8 partiel. Mais il reste encore :

- des transactions inline dans certaines routes ;
- des requêtes métier/mutation dans des routes ;
- un vieux fichier `routes/routes_orders_parcels.js` non refactoré encore présent ;
- des tests manquants ou non retrouvés pour R5 paiement ;
- des lectures complexes dans des routes que la cible voulait sortir ou réduire.

---

## Points validés

### R3 — scans

`routes/scans.js` est devenu une façade pour les opérations critiques : `recordScan`, `collectParcel`, `verifyQr` sont délégués à `services/scan-operations.js`.

Reste acceptable : deux lectures simples restent dans la route (`hub/pending`, `/:order_id`).

État : **quasi terminé**.

---

### R4 — orders/parcels actif

`routes/orders/parcels.js` délègue les mutations critiques à :

- `services/parcel-operations.js`
- `services/parcel-guards.js`

Les handlers mutationnels sont minces : `markAvailability`, `partialShip`, `updateParcelStatus`, `cancelBackorder`.

Tests retrouvés : `tests/unit/parcel-operations.test.js`.

État : **bon sur le fichier actif**.

Reste : `GET /:id/parcels` contient encore plusieurs queries d'enrichissement dans la route. C'est lecture-only, mais pas totalement façade.

---

### R5 — Stripe / PayPal / cash

Stripe :

- `routes/payments.js` délègue la création intent et le traitement webhook à `services/payment-stripe.js`.
- Le service utilise `confirmPaymentCycle`.

PayPal :

- `routes/payments-paypal.js` délègue create-order, capture et webhook à `services/payment-paypal.js`.
- Le service utilise `confirmPaymentCycle`.

Cash :

- `routes/cash.js` délègue `collect/:orderId` à `services/cash-operations.js`.

État : **partiel**.

Restes importants :

- `routes/payments.js` garde encore `/cash/confirm` avec transaction inline.
- `routes/cash.js` garde encore des lectures/reconciliation inline.
- `routes/payments-paypal.js` garde `refund/:orderId` inline.
- Tests unitaires explicites `payment-stripe.test.js`, `payment-paypal.test.js`, `cash-operations.test.js` non retrouvés dans cette passe.

---

### R6 — shared-cart

`routes/shared-cart.js` utilise beaucoup de services et `shared-cart-queries.js` est importé.

État : **partiel / correct**, mais le fichier reste gros et garde encore le langage V4.1 dans l'en-tête. Il n'est pas une façade modulaire stricte.

---

### R8 — pricing-strategy / products

`routes/pricing-strategy.js` est bien devenu une façade vers `services/pricing-strategy-service.js`.

`routes/products.js` est partiellement refactoré : `productAdminService` est utilisé, mais les handlers create/update/delete/image gardent encore beaucoup de validation, mutations et audit inline.

État : **R8 partiel**.

---

## Points bloquants à la qualification “100 % terminé”

### 1. Ancien fichier non refactoré encore présent

`routes/routes_orders_parcels.js` existe encore et contient le vieux code avec `BEGIN`, `COMMIT`, queries et logique inline.

Même si le fichier actif monté semble être `routes/orders/parcels.js`, ce vieux fichier est une dette : un agent ou dev peut le modifier par erreur.

Action recommandée : supprimer, archiver ou transformer en tombstone explicite.

---

### 2. Transactions inline encore dans routes

Recherche `BEGIN/getClient/COMMIT/ROLLBACK routes` remonte encore notamment :

- `routes/routes_orders_parcels.js` ;
- `routes/cash.js` ;
- `routes/payments.js` ;
- `routes/admin-pricing-matrices.js` ;
- `routes/wallet.js`.

Certaines routes peuvent être hors scope du plan initial, mais cela empêche de dire que l'objectif global “transactions inline routes = 0” est atteint.

---

### 3. R5 paiements pas totalement sorti

Le cœur Stripe et PayPal est bien sorti. Mais cash confirm et refund PayPal restent en partie dans la route.

Pour un lot argent réel, la qualification complète demande aussi les tests de caractérisation. Ceux-ci n'ont pas été retrouvés sous noms évidents.

---

### 4. Products pas totalement façade

`routes/products.js` utilise `productAdminService`, mais les handlers admin contiennent encore validations, updates, audit price/stock, upload image et variantes partiellement inline.

---

## Conclusion

Statut réel recommandé :

```txt
Refacto routes : 75–85 % réalisé.
Pas encore 100 % terminé.
```

Ce qui est excellent : les flows les plus sensibles commencent à être dans des services et les routes critiques sont beaucoup plus lisibles.

Ce qui reste avant de dire “terminé” :

1. Supprimer/archiver/tombstoner `routes/routes_orders_parcels.js`.
2. Finir R5 : sortir `/cash/confirm`, refund PayPal, reconciliation cash ou documenter ce qui reste volontairement inline.
3. Finir R8 products ou le sortir explicitement du scope.
4. Ajouter ou retrouver les tests R5 paiement.
5. Mettre à jour le document de statut réel avec une colonne “vérifié dans code”.

---

## Ajustements appliqués après vérification (2026-06-14)

### Fichiers supprimés

- `routes/routes_orders_parcels.js` — confirmé orphelin (aucun `require`, aucune route montée). L'actif est `routes/orders/parcels.js`, monté via `routes/orders.js` ligne 36. Recherches `grep -R "routes_orders_parcels"` et `grep -R "orders/parcels" routes bootstrap server.js` confirment l'absence de toute référence active.

  Note : `routes/routes_orders_status.js` et `routes/routes_orders_cancel.js` (mêmes orphelins FRESH-003) **n'ont pas été supprimés** dans ce lot — leur suppression nécessite un arbitrage fonctionnel distinct (cf `routes/ORPHELINS_FRESH003.md`, option B : la version orpheline `cancel.js` exploite des colonnes `phone_payer`/`phone_beneficiary` non utilisées par l'actif, à valider avant suppression). Hors scope de ce lot routes.

### Services créés / étendus

- `services/payment-cash-confirm.js` (nouveau) — extrait `POST /api/payments/cash/confirm` : transaction propre, vérification cross-relais, appel `confirmPaymentCycle`, mise à jour `cash_paid_at`, notifications/purchasing post-commit non bloquantes. Export : `confirmCashByReference({ cashRefCode, actor, triggerPurchasing, db })`.
- `services/payment-paypal.js` (étendu) — ajout de `refundPaypalOrder({ orderId, amountEur, reason, adminUser, paypal, db })`, extrait de `POST /api/payments/paypal/refund/:orderId`. Préconditions (capture absente, non payé) + appel `paypal.refundCapture` + logging, iso-comportement.

### Routes allégées

- `routes/payments.js` — `/cash/confirm` devient une façade : auth + validation + appel `confirmCashByReference` + réponse. Plus aucune transaction inline.
- `routes/payments-paypal.js` — `/refund/:orderId` devient une façade : auth admin + appel `refundPaypalOrder` + réponse.

### Tests ajoutés

- `tests/unit/payment-stripe.test.js` — `createStripeIntent` (réutilisation intent, création nouvelle, fallback si retrieve échoue) + `handleStripePaymentFailed` (guard ne pas dégrader `paid`→`failed`, ignoré si pas d'`order_id`).
- `tests/unit/payment-paypal.test.js` — `createPaypalOrder` nominal, `capturePaypalOrder` amount mismatch + idempotence `already_paid`, `handlePaypalWebhookEvent` idempotence event déjà traité + signature invalide, `refundPaypalOrder` nominal + préconditions (404, capture absente, non payé, échec PayPal 502).
- `tests/unit/payment-cash-confirm.test.js` — `confirmCashByReference` : 400 si code manquant, 404 si code introuvable, 403 cross-relais (avec et sans `relais_id`), 409 + rollback si stock bloqué, 409 si cycle rejeté, nominal admin et agent_relais (commit + notif/purchasing post-commit).

Tous les nouveaux tests passent (`24/24`). Les 2 échecs préexistants dans `tests/unit/confirm-payment-cycle.test.js` (assertion `toBeUndefined()` qui matche par erreur une requête `SELECT ... FOR UPDATE`) sont antérieurs à ce lot et non liés aux changements de cette passe.

### Routes encore volontairement semi-façades (documenté, hors scope de ce lot)

- `routes/cash.js` — `/deposit`, `/deposits/:id/verify`, `/deposits/:id/dispute` restent inline : ce sont des insert/update simples sur une seule table, sans transaction, sans décision métier complexe (cf doctrine étape 3.3 : seules les mutations avec transaction/décision métier/update critique doivent être extraites). `/collect/:orderId` utilise déjà `services/cash-operations.js` (`collectCash`) — la route ne fait que l'orchestration BEGIN/COMMIT/ROLLBACK, conforme au modèle déjà en place ailleurs.
- `routes/wallet.js` — hors scope, service owner historique du wallet (cf étape 6 de la doctrine).
- `routes/admin-pricing-matrices.js` — hors scope, non critique go-live (cf étape 6 de la doctrine).
- `routes/admin/system.js`, `routes/transitaire-api.js`, `routes/shared-cart-from-order.js`, `routes/hub-dashboard.js` — transactions inline présentes mais hors périmètre R5/R8/parcels de ce lot ; non auditées dans cette passe.

### Décision sur `routes/products.js`

**Option B retenue.** `routes/products.js` (576 lignes) reste semi-façade : `productAdminService` est utilisé pour certaines opérations mais create/update/delete/image/variants gardent une logique inline importante. Une extraction complète (Option A) constituerait un refacto massif disproportionné par rapport au périmètre de ce lot (« ne pas faire de refacto massif »). `routes/products.js` est donc explicitement **hors scope** de la clôture « refacto routes terminé ». Un lot séparé `R8B-products-admin` est à planifier, ciblant l'extraction vers `services/product-admin-service.js` : `createProduct`, `updateProduct`, `deleteProduct`, `setMainImage`, `appendImages`, `deleteVariant`.

### Vérification finale (état post-ajustements)

```txt
auth + validation + appel service + réponse
```

- `routes/payments.js` : conforme (Stripe intent, webhook, cash/confirm, rates, config).
- `routes/payments-paypal.js` : conforme (create-order, capture, webhook, refund).
- `routes/cash.js` : conforme pour `/collect`, lectures et mutations simples documentées comme volontairement inline.
- `routes/orders/parcels.js` : conforme, déjà façade ; `GET /:id/parcels` garde des lectures d'enrichissement (lecture seule, hors scope de durcissement de ce lot).
- `routes/products.js` : explicitement hors scope (R8B à planifier).

Aucun montage raw body Stripe n'a été déplacé. `confirmPaymentCycle` reste le seul point de confirmation paiement (`services/payment-cash-confirm.js` et `services/payment-paypal.js` l'appellent exclusivement).

### Risques restants

- `routes/products.js` reste un fichier à fort risque de dérive métier tant que R8B n'est pas planifié.
- Les trois fichiers `routes_orders_*.js` orphelins ne sont plus que deux (`status`, `cancel`) ; ils restent un piège potentiel de merge accidentel tant que l'arbitrage FRESH-003 n'est pas tranché.
- `routes/cash.js` reconciliation (`/reconciliation`, `/reconciliation/agents`, `/uncollected`) n'a pas été auditée en détail dans ce lot — lectures complexes potentiellement à surveiller pour performance, pas pour conformité doctrine (lecture seule).
