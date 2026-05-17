# G2 — Flow création commande → paiement Stripe → préparation hub

> Date : 2026-05-17
> Scope : audit/documentation uniquement

## Résumé

Audit du flow Stripe bout-en-bout :

1. création commande `stripe_eur` ;
2. création PaymentIntent ;
3. webhook Stripe `payment_intent.succeeded` ;
4. confirmation paiement + stock + statut ;
5. génération du pickup secret ;
6. déclenchement sourcing/purchasing ;
7. réception hub et passage en préparation.

Aucune correction de code n'a été appliquée dans ce lot. Les écarts restent rattachés à `I-SWEEP` / `TEST-1`.

## Étape 1 — Création commande Stripe

Surface : `POST /api/orders` dans `routes/orders/create.js`.

### Garanties constatées

- Route protégée par `authenticateOrCreateGuest`.
- Payload validé via `validate(orders.create)`.
- `payment_mode` limité à `stripe_eur` ou `cash_relais`.
- Relais actif vérifié.
- Stock produit et variante vérifié avant création.
- Produits verrouillés `FOR UPDATE` pendant la création.
- Commande créée avec `status = 'pending'`.
- `payment_status = 'pending'`.
- `stripe_payment_intent` peut être stocké si fourni, mais le flow normal crée l'intent via `/api/payments/stripe/intent`.
- Historique initial `pending` inséré.
- Notifications de création post-commit.

### Point à surveiller

- Comme en G1, le statut initial est inséré directement puis historisé manuellement. C'est acceptable pour la création initiale, mais à couvrir par TEST-1.

## Étape 2 — Création PaymentIntent

Surface : `POST /api/payments/stripe/intent`.

### Garanties constatées

- Route protégée par `authenticate`.
- Payload validé via `validate(payments.stripeIntent)`.
- Vérifie que la commande existe.
- Vérifie propriétaire ou rôle privilégié.
- Vérifie `payment_mode = 'stripe_eur'`.
- Refuse une commande déjà `payment_status = 'paid'`.
- Crée un PaymentIntent Stripe en EUR avec metadata :
  - `order_reference`
  - `order_id`
  - `komerce = true`
- Stocke `stripe_payment_id` sur la commande.

### Risques / limites

- Pas d'idempotency key Stripe lors de la création du PaymentIntent. Si le frontend ou réseau rejoue la requête avant que `stripe_payment_id` ne soit réutilisé, plusieurs PaymentIntents peuvent être créés pour la même commande.
- La route ne semble pas réutiliser un `stripe_payment_id` existant. À étudier dans I-SWEEP ou TEST-1.

## Étape 3 — Webhook Stripe succès

Surface : `POST /api/payments/stripe/webhook`.

### Garanties constatées

- Raw body monté avant `express.json`.
- Signature vérifiée via `stripe.webhooks.constructEvent`.
- Idempotence forte via `stripe_events_processed` en tête.
- Ignore les PaymentIntents sans `metadata.order_id`.
- Garde de défense : si `payment_status = 'paid'`, skip idempotent.
- Transaction explicite pour le cœur paiement.
- Appel à `confirmPaymentCycle(...)`.
- `confirmPaymentCycle(...)` utilise la machine pour `pending → confirmed`, puis `confirmed → ordered`.
- `payment_status = 'paid'` est positionné dans la machine.
- Stock décrémenté dans la même transaction avec `FOR UPDATE`.
- Variantes vérifiées et décrémentées aussi.
- `stripe_events_processed` est marqué dans la transaction nominale.

### Cas stock insuffisant

- Le paiement Stripe est déjà encaissé.
- Le code ne rollback pas ; il annote la commande, crée une alerte critique `paid_but_stock_blocked`, committe, et ne déclenche pas purchasing.
- C'est cohérent avec la doctrine : traitement manuel nécessaire car l'argent est encaissé.

### Risques / limites

- Si `stripe_events_processed` est indisponible, l'idempotence se dégrade sur `payment_status`.
- Si `confirmPaymentCycle` réussit puis la génération pickup secret échoue, le webhook continue. Le code loggue l'erreur, mais la commande peut être payée/ordered sans pickup secret.
- Les notifications et sourcing post-commit ne sont pas transactionnels.

## Étape 4 — Pickup secret Stripe

Surface : `generateAndStoreSecret(...)` dans `routes/pickup-secret.js`, appelé depuis le webhook Stripe.

### Garanties constatées

- Génération anti-collision par relais sur `pickup_secret_last4`.
- Code hashé avec salt.
- Code expirant à 60 jours.
- Channel `stripe` stocké.
- Code clair mis en cache via `cacheCodeForReveal(orderId, code)`.
- Les updates pickup secret sont exécutées avec le `dbClient` du webhook, donc dans la transaction principale.

### Risques / limites

- Si la génération échoue, le paiement reste confirmé et ordered ; le système loggue seulement l'erreur.
- `cacheCodeForReveal` est probablement mémoire process. En cas de crash/restart, le reveal one-shot peut être perdu.
- À couvrir avec une procédure de régénération admin et un test de reprise.

## Étape 5 — Notifications et sourcing post-commit

Surface : fin du webhook `payment_intent.succeeded` dans `routes/payments.js`.

### Garanties constatées

- SMS paiement confirmé non bloquant.
- `notifyPaymentConfirmed(...)` non bloquant.
- `triggerPurchasing(orderId)` appelé seulement si paiement nominal et pas stock bloqué.
- Erreur `triggerPurchasing` logguée et alerte DB `purchasing` créée.

### Risques / limites

- `triggerPurchasing` est post-commit fire-and-forget. Si le process crash après commit paiement mais avant ou pendant purchasing, la commande peut rester `ordered` sans purchase orders créés.
- Il n'y a pas dans ce flow audit un job de reprise garanti pour commandes `ordered` sans purchase_orders.
- À traiter via repair job ou test d'audit opérationnel.

## Étape 6 — Purchasing / préparation hub

Surface : `triggerPurchasing(...)` et `POST /api/purchasing/:id/receive`.

### Garanties constatées

- `triggerPurchasing` crée une `purchase_order` par item si fournisseur mappé.
- Si aucun fournisseur mappé, notification admin et résultat `no_supplier`.
- Le statut order reste `ordered` pendant le sourcing.
- `POST /api/purchasing/:id/receive` est admin-only.
- Réception partielle maintient l'order en `ordered`.
- Quand toutes les POs sont reçues, transition vers `preparation` via `transitionOrderStatus(...)`.
- `triggerScan3(...)` est appelé après passage préparation pour notifier/logguer.

### Risques / limites

- `triggerPurchasing` ne semble pas idempotent par défaut : rejouer la fonction pourrait créer des purchase_orders en double si aucune contrainte DB ne l'empêche.
- `POST /api/purchasing/:id/receive` ne démarre pas de transaction englobant update PO + calcul complétude + transition order. Une course entre deux réceptions simultanées peut être à tester.
- `triggerScan3` est appelé après transition `preparation`; si son logging/SMS échoue, la préparation reste valide mais l'observabilité peut être incomplète.

## Conclusion G2

Le cœur Stripe est robuste : raw body, signature, idempotence, machine de statut, stock verrouillé et décrémenté dans une transaction.

Les points critiques restants sont autour de l'idempotence périphérique et des side-effects post-commit :

1. création PaymentIntent sans idempotency key ni réutilisation évidente ;
2. génération pickup secret non bloquante en cas d'échec ;
3. sourcing post-commit fire-and-forget ;
4. `triggerPurchasing` potentiellement non idempotent ;
5. réception hub sans transaction globale apparente.

## À rattacher à I-SWEEP / TEST-1

- Test replay `/stripe/intent` : ne doit pas créer plusieurs PaymentIntents actifs pour une même commande.
- Test replay webhook `payment_intent.succeeded` : pas de double stock, pas de double purchase_order.
- Test stock insuffisant après paiement : alerte créée, pas de purchasing, statut cohérent.
- Test failure pickup secret : stratégie admin/regenerate documentée.
- Repair job : commandes `ordered` sans `purchase_orders` après crash post-commit.
- Idempotence `triggerPurchasing(orderId)` : contrainte DB ou guard applicatif.
- Transaction ou verrou sur réception hub complète.
