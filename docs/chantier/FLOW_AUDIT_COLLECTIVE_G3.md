# G3 — Flow panier collectif → contributions → confirmation

> Date : 2026-05-17
> Scope : audit/documentation uniquement

## Résumé

Audit du flow panier collectif bout-en-bout :

1. création workspace collectif ;
2. ajout items et intentions ;
3. finalisation / réservation stock / tokens ;
4. contribution cash ou carte ;
5. capture carte atomique ;
6. création commande ;
7. reprise / expiration / frontière irréversible.

Aucune correction de code n'a été appliquée dans ce lot. Les écarts restent rattachés à `I-SWEEP` / `TEST-1`.

## Étape 1 — Création workspace

Surfaces : `routes/collective-workspaces.js` + `services/collective-workspace-engine.js`.

### Garanties constatées

- Création publique possible via `POST /api/collective-workspaces`.
- Tokens séparés : `public_token` pour partage, `creator_token` pour contrôle créateur.
- Tokens hashés en DB.
- Workspace initial en `conception`.
- Événement `workspace_created` journalisé.
- Aucune commande créée à ce stade.

### Risques / limites

- Création publique non authentifiée : cohérente avec le modèle viral/WhatsApp, mais dépend du rate limiting global.
- Le `creator_token` brut est retourné une seule fois : si perdu côté client, reprise créateur difficile sans procédure dédiée.

## Étape 2 — Items et intentions

### Garanties constatées

- Les mutations items utilisent `SELECT ... FOR UPDATE` sur le workspace.
- Les mutations ne sont autorisées que si `status = 'conception'`.
- Les produits actifs sont vérifiés lors de l'ajout.
- Les intentions sont publiques mais transactionnelles.
- Une intention peut contenir montant, suggestion ou message.
- Annulation publique directe désactivée ; annulation par créateur possible.

### Risques / limites

- Les intentions avec montant nullable doivent être bien filtrées avant finalisation : `finalizeWorkspace` exige une somme d'intentions suffisante.
- Les mutations publiques reposent sur le public token : le token doit rester non devinable et non exposé inutilement.

## Étape 3 — Review et finalisation

Surfaces : `finalizationReview`, `finalizeWorkspace`, `collective-stock-reservation-service.js`.

### Garanties constatées

- Review recalcule les prix actuels côté serveur.
- Finalisation fait `SELECT ... FOR UPDATE` sur workspace, items et contributions.
- Finalisation refuse : pas d'items, produit inactif, total invalide, pas d'intentions, intentions insuffisantes.
- Prix et images sont figés en snapshots.
- Sur-financement ajusté proportionnellement aux tokens.
- Tokens de paiement générés avec hash, raw token retourné une seule fois.
- Workspace passe en `payment_pending`.
- Stock réservé temporairement avant finalisation route, avec release si finalize échoue.
- Réservation stock tient compte des autres réservations actives.

### Risques / limites

- La réservation stock est séparée de `finalizeWorkspace` côté route : elle se fait avant l'appel engine, puis libération si échec. Le risque est réduit, mais l'opération n'est pas une seule transaction globale.
- `collective_stock_reservations` est créée via `CREATE TABLE IF NOT EXISTS` runtime. Cohérent avec l'existant, mais à sortir un jour des DDL inline/runtime.
- Les réservations sont consommables via `consumeForWorkspace`, mais le flow de création order audité ne montre pas d'appel évident à cette consommation après commande.

## Étape 4 — Paiement cash collectif

Surface : `POST /api/collective-payments/:token/confirm-cash` + `confirmCashContribution(...)`.

### Garanties constatées

- Confirmation cash réservée à `admin` ou `agent_relais`.
- Agent relais doit avoir un `relais_id` configuré.
- Cross-relais check contre le `relais_id` du workspace.
- Token, session et workspace verrouillés `FOR UPDATE`.
- Token déjà `paid` : réponse idempotente.
- Token `authorized` : refus pour éviter mélange cash/carte.
- Session doit être `open` et workspace `payment_pending`.
- Token passe `paid`, session `amount_secured_kmf` incrémente.
- À 100 %, `_createOrderFromSession(... paymentMode: 'cash_relais')` est appelé.

### Risques / limites

- À 100 %, `_createOrderFromSession` est appelé après commit de la contribution cash. Si crash entre commit et création order, la session peut être entièrement sécurisée mais sans commande créée.
- Un mécanisme de reprise pour sessions à 100 % sans order est nécessaire.

## Étape 5 — Paiement carte collectif

Surface : `POST /api/collective-payments/:token/pay-card` + webhook Stripe collectif.

### Garanties constatées

- `createOrGetPaymentIntent` réutilise un PaymentIntent existant si présent et non annulé.
- Création Stripe avec `capture_method = manual`.
- Idempotency key Stripe `cpt_<token_id>` à la création.
- Webhook raw body monté avant `express.json`.
- Signature Stripe vérifiée.
- Event idempotence via `stripe_events_processed`.
- Autorisation carte verrouille le token `FOR UPDATE`.
- Token déjà `authorized` ou `paid` : idempotent.
- Session `amount_secured_kmf` incrémentée uniquement si session `open`.
- À 100 %, session passe `ready_to_capture`.

### Risques / limites

- `markStripeEventProcessed` intervient après le traitement webhook. Si traitement OK puis marquage KO, replay dépend de l'idempotence token/session.
- Les événements `payment_failed` ne changent que les tokens `active`, ce qui protège les tokens déjà authorized/paid.

## Étape 6 — Capture atomique et création order

Surface : `captureAllAndCreateOrder(...)` et `_createOrderFromSession(...)`.

### Garanties constatées

- Capture de chaque PaymentIntent avec idempotency key `cap_<token_id>`.
- Si toutes les captures réussissent : tokens marqués `paid`, puis création order.
- Si capture partielle échoue : refund best-effort des captures réussies avec idempotency key `refund_<token_id>`.
- Session marquée `failed`, workspace `session_ended` en cas d'échec capture.
- `_createOrderFromSession` verrouille session et workspace `FOR UPDATE`.
- Idempotence : si `ws.order_id` existe, retour idempotent.
- Liaison workspace → order via `UPDATE ... WHERE order_id IS NULL AND status = 'payment_pending'`.
- Stock vérifié `FOR UPDATE`, alerte `paid_but_stock_blocked` si rupture après capture.
- Snapshot économique tenté via `order-cost-snapshot`.
- Notifications et purchasing post-commit.

### Violations / écarts à suivre

- `_createOrderFromSession` insère directement `orders.status = 'confirmed'` et `payment_status = 'paid'`, puis insère `order_status_history` manuellement.
- La transition `confirmed → ordered` se fait via machine, mais après commit et en non-fatal.
- Si transition `ordered` échoue après commit, la commande reste `confirmed` avec paiement capturé et workspace lié.
- Si crash après order créée et avant transition/purchasing, commande confirmée mais pas lancée.
- `triggerPurchasing` reste post-commit fire-and-forget, avec les mêmes risques que G2.

## Étape 7 — Expiration et reprise

### Garanties constatées

- Cron d'expiration des sessions.
- Annulation des PaymentIntents actifs/autorisés avec idempotency key `cancel_<token_id>`.
- Tokens actifs/autorisés passent `expired`.
- Session passe `ended`.
- Workspace `payment_pending` passe `session_ended`.
- Reprise créateur impossible si `order_id` existe.
- Reprise protégée par trois verrous : Node `order_id`, Node status, SQL `order_id IS NULL AND status = 'session_ended'`.

### Risques / limites

- En cas de capture partielle ou de crash pendant capture, le cron d'expiration ne suffit pas forcément à réparer les états intermédiaires.
- Un repair job dédié aux sessions `ready_to_capture` anciennes et workspaces `payment_pending` sécurisés à 100 % sans order est nécessaire.

## Conclusion G3

Le flow collectif est bien architecturé : séparation workspace/order, tokens hashés, finalisation sous verrou, réservation stock, préautorisation carte, capture manuelle, idempotency keys Stripe et frontière irréversible après création order.

Les risques restants sont essentiellement des risques de reprise après crash et d'alignement strict avec les invariants de statut :

1. `_createOrderFromSession` insère une commande directement en `confirmed` ;
2. transition `ordered` post-commit non fatale ;
3. création order après contribution cash à 100 % post-commit ;
4. capture collective asynchrone `setImmediate` ;
5. réservations stock potentiellement non consommées explicitement ;
6. repair job manquant pour `ready_to_capture` / 100 % sécurisé sans order.

## À rattacher à I-SWEEP / TEST-1

- Aligner `_createOrderFromSession` avec un contrat central de création/confirmation order ou documenter l'exception.
- Test : double webhook card authorization ne double pas `amount_secured_kmf`.
- Test : deux cash confirm simultanés sur même token restent idempotents.
- Test : session 100 % cash mais crash avant order → repair doit créer ou signaler.
- Test : session `ready_to_capture` ancienne → repair capture ou alerte.
- Test : order collective créée → transition `ordered` obligatoire ou alerte critique.
- Consommer ou libérer explicitement `collective_stock_reservations` après création order / échec.
