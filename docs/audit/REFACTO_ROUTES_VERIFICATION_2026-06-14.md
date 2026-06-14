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
