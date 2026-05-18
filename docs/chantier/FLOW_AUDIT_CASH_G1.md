# G1 — Flow création commande → paiement cash → retrait relais

> Date : 2026-05-17
> Scope : audit/documentation uniquement

## Résumé

Audit du flow cash bout-en-bout :

1. création commande cash relais ;
2. confirmation paiement cash classique ;
3. transition vers préparation / logistique ;
4. livraison relais ;
5. retrait par `pickup_code` ou QR.

Aucune correction de code n'a été appliquée dans ce lot. Les violations d'invariants restent rattachées à `I-SWEEP`.

## Étape 1 — Création commande cash

Surface : `POST /api/orders` dans `routes/orders/create.js`.

### Garanties constatées

- Route protégée par `authenticateOrCreateGuest`.
- Validation payload via `validate(orders.create)`.
- `payment_mode` limité à `stripe_eur` ou `cash_relais`.
- Relais actif vérifié.
- Stock produit verrouillé avec `FOR UPDATE` avant création.
- Stock global et variantes vérifiés avant création.
- Commande créée avec `status = 'pending'`.
- `payment_status = 'pending'` sauf cas wallet couvrant 100 %.
- `cash_ref_code` généré uniquement pour `cash_relais`.
- `pickup_code` généré dès la création.
- `order_status_history` reçoit une entrée `pending`.
- Wallet partiel ou total traité dans la transaction.
- Notifications post-commit pour la commande créée.

### Point à surveiller

- La création insère directement `status = 'pending'` puis insère l'historique manuellement. C'est cohérent avec la création initiale, mais à couvrir par TEST-1 pour garantir l'historique initial.

## Étape 2 — Paiement cash classique

Surface : `POST /api/payments/cash/confirm` dans `routes/payments.js`.

### Garanties constatées

- Route protégée par `authenticate` + `requireRole(['admin', 'agent_relais'])`.
- Payload validé via `validate(payments.cashConfirm)`.
- Recherche uniquement les commandes `payment_mode = 'cash_relais'` et `payment_status = 'pending'`.
- Transaction explicite `BEGIN/COMMIT`.
- Cross-relais check strict pour `agent_relais`.
- Agent relais sans `relais_id` : refus strict + alerte.
- Cross-relais : refus strict + alerte.
- Passage par `confirmPaymentCycle(...)`.
- `confirmPaymentCycle` utilise `transitionOrderStatus(...)` pour `pending → confirmed`, puis `confirmed → ordered`.
- Stock décrémenté dans la même transaction avec `FOR UPDATE`.
- Si stock insuffisant : rollback + 409, puisque le cash n'est pas encore encaissé.
- `cash_paid_at` positionné avec `COALESCE` après cycle nominal.
- Notifications, facture et sourcing sont post-commit et non bloquants.

### Conclusion sur ce chemin

Le flow cash classique est aligné avec les invariants I-01/I-02/I-04/I-06 côté paiement.

## Étape 2 bis — Paiement cash via pickup-secret `/pay-cash`

Surface : `routes/pickup-secret.js`.

### Violation confirmée

Le endpoint `/pay-cash` met directement à jour :

```sql
payment_status = 'paid',
status = 'confirmed',
confirmed_at = $3
```

sans passer par `confirmPaymentCycle(...)` ni `transitionOrderStatus(...)`.

### Impact

- Violation I-01 : modification directe de `orders.status` hors machine.
- Risque I-04 : historique de statut non garanti.
- Stock non décrémenté par `confirmPaymentCycle`.
- Passage `confirmed → ordered` non garanti.
- Sourcing / notifications ne sont pas alignés avec le flow cash classique.

### Décision

Pas de correction dans G1. Ce point reste dans `I-SWEEP`, avec priorité critique.

## Étape 3 — Préparation / logistique

Surface : `POST /api/scans` et `triggerScan3(...)` dans `routes/scans.js`.

### Garanties constatées

- `collected` est exclu du endpoint générique `POST /api/scans`.
- Rôles autorisés par étape via `STEP_ROLES`.
- Scan logistique inséré dans `scans`.
- `safeSyncScanToParcels(...)` est awaité dans la transaction.
- Si aucun colis n'existe, fallback machine via `transitionOrderStatus(...)`.
- Les SMS des étapes `shipped`, `in_transit`, `relais_received` sont post-commit ou non bloquants.

### Point à surveiller

- Le flow dépend de `parcelSync` et de la cohérence des parcels. TEST-1 doit couvrir au moins un chemin avec parcels et un chemin legacy sans parcels.

## Étape 4 — Arrivée relais / disponibilité

Surface : scan `relais_received`.

### Garanties constatées

- `relais_received` autorisé à `admin` et `agent_relais`.
- La transition effective passe par `safeSyncScanToParcels` ou fallback machine.
- Le destinataire reçoit un SMS avec le `pickup_code` si `recipient_phone` est présent.

### Point à surveiller

- Le SMS expose le `pickup_code` classique. Le modèle `pickup_secret` coexiste avec ce code ; il faut clarifier la doctrine opérationnelle pour éviter confusion agent/client.

## Étape 5 — Retrait par pickup_code

Surface : `POST /api/scans/collect`.

### Garanties constatées

- Route protégée par `authenticate` + `requireRole(['admin', 'agent_relais'])`.
- Payload validé via `validate(scans.collect)`.
- Recherche commande par `pickup_code` uniquement si `status = 'available'`.
- `SELECT ... FOR UPDATE OF o` pour éviter double retrait simultané.
- Code inconnu : alerte low avec IP/agent/user-agent.
- Commande bloquée temporairement si `pickup_secret_blocked_until` actif.
- Cross-relais check strict pour `agent_relais`.
- Cross-relais échoué : compteur d'échecs + blocage temporaire après 5 tentatives.
- Scan `collected` inséré.
- Transition via `safeSyncScanToParcels(...)` dans la transaction.
- Fallback machine si aucun parcel.
- Reset des compteurs d'échecs au succès.
- SMS confirmation au commanditaire post-commit.

### Point à surveiller

- Les tentatives sur code inconnu ne peuvent pas incrémenter un compteur par commande, car aucune commande n'est identifiée. Le rate-limit IP reste donc essentiel.

## Étape 5 bis — Retrait par QR

Surface : `POST /api/scans/verify-qr` + `routes/orders/qr.js`.

### Garanties constatées

- Génération QR réservée `admin` / `agent_relais`.
- Génération seulement si `status = 'available'`.
- Vérification QR réservée `admin` / `agent_relais`.
- `verify-qr` valide `status = available`, token, expiration.
- Transition `collected` via `transitionOrderStatus(...)` dans la transaction.
- QR invalidé dans la même transaction.
- Scan `collected` inséré.
- SMS confirmation au commanditaire.

### Points à surveiller

- D4 a déjà isolé l'absence de cross-relais check dans `verify-qr`.
- `safeSyncScanToParcels(...)` est appelé après commit dans `verify-qr`. Si le process crash après commit mais avant sync parcels, l'order est `collected` mais les parcels peuvent rester en retard. À tester ou réparer par job de cohérence.
- `QR_SECRET` reste à garantir au runtime.

## Conclusion G1

Le flow cash classique `/api/orders` → `/api/payments/cash/confirm` → scans → retrait est globalement solide et aligné sur la machine de statut.

Les violations ou dettes critiques sont hors du chemin cash classique principal, mais restent dans le domaine cash/retrait :

1. `/pay-cash` dans `pickup-secret.js` court-circuite la machine et le cycle central.
2. QR verify manque un cross-relais check équivalent à `/collect`.
3. QR verify sync parcels après commit : risque de divergence order/parcels si crash.
4. Coexistence `pickup_code` et `pickup_secret` à clarifier opérationnellement.

## À rattacher à I-SWEEP / TEST-1

- Corriger `/pay-cash` pour utiliser `confirmPaymentCycle(...)` ou le même contrat métier que `/cash/confirm`.
- Ajouter tests G1 : création cash → confirmation cash → stock décrémenté → historique `pending/confirmed/ordered`.
- Ajouter tests retrait pickup_code : double retrait impossible, cross-relais refusé, compteur d'échecs.
- Ajouter tests QR : token expiré, replay impossible, cross-relais à décider, invalidation atomique.
- Ajouter job ou test de cohérence order/parcels pour `verify-qr` après commit.
