# I-SWEEP — Correction groupée des violations d'invariants

> Date : 2026-05-17
> Scope : plan d'exécution avant modifications code sensibles

## Objectif

Corriger les violations et dettes critiques révélées par les audits D1-D8 et G1-G5, sans patch opportuniste isolé susceptible de casser les flows paiement/statut/stock.

## Règles d'exécution

1. Aucun changement direct de `orders.status` hors `transitionOrderStatus(...)` ou contrat central documenté.
2. Toute correction paiement doit préciser : transaction, idempotence, rollback/commit, side-effects post-commit.
3. Chaque sous-lot doit ajouter ou préparer un test minimal de non-régression.
4. Les corrections doivent rester petites et vérifiables.
5. `STATUS.md` doit être mis à jour après chaque sous-lot.

---

## I-SWEEP-1 — `/pay-cash` pickup-secret hors machine

### Fichier principal

- `routes/pickup-secret.js`

### Problème

`POST /api/pickup/pay-cash/:orderId` modifie directement :

```sql
payment_status = 'paid',
status = 'confirmed',
confirmed_at = $3
```

Ce chemin court-circuite :

- `transitionOrderStatus(...)` ;
- `confirmPaymentCycle(...)` ;
- l'historique garanti `order_status_history` ;
- le décrément stock transactionnel ;
- le passage `confirmed → ordered` ;
- le déclenchement sourcing aligné avec `/api/payments/cash/confirm`.

### Correction attendue

Remplacer le bloc direct update par :

1. transaction `BEGIN/COMMIT` ;
2. `SELECT ... FOR UPDATE` sur la commande ;
3. cross-relais check strict pour `agent_relais` ;
4. `confirmPaymentCycle({ source: 'cash_confirm', dbClient })` ;
5. si `stockBlocked` : `ROLLBACK + 409` ;
6. `generateAndStoreSecret({ dbClient, channel: 'cash_relais', extraUpdates })` ;
7. `cash_collections ON CONFLICT DO NOTHING` dans la transaction ;
8. `cash_paid_at = COALESCE(cash_paid_at, NOW())` ;
9. post-commit : loyalty + `triggerPurchasing(orderId)` + notifications si disponibles.

### Tests attendus

- `/pay-cash` crée `order_status_history` pending/confirmed/ordered.
- `/pay-cash` décrémente stock exactement une fois.
- replay `/pay-cash` refuse si pickup secret existe.
- cross-relais refusé pour agent hors relais.
- stock insuffisant renvoie 409 et ne génère pas de code.

---

## I-SWEEP-2 — QR verify et sync parcels après commit

### Fichier principal

- `routes/scans.js`

### Problème

`POST /api/scans/verify-qr` transitionne l'order en `collected` dans une transaction, puis appelle `safeSyncScanToParcels(...)` après commit.

Risque : crash entre commit order et sync parcels.

### Correction attendue

Option A : intégrer `safeSyncScanToParcels(...)` dans la transaction comme `/api/scans/collect`.

Option B : ajouter un repair job + alerte si order `collected` et parcels non alignés.

### Tests attendus

- QR valide invalide le token et passe collected.
- QR replay impossible.
- parcels alignés avec order après verify-qr.

---

## I-SWEEP-3 — Stripe intent et purchasing idempotence

### Fichiers principaux

- `routes/payments.js`
- `routes/purchasing.js`

### Problèmes

- création PaymentIntent sans idempotency key apparente ;
- `triggerPurchasing(orderId)` post-commit fire-and-forget ;
- risque commandes `ordered` sans POs après crash ;
- idempotence anti-double PO à confirmer ;
- réception hub sans transaction globale apparente.

### Corrections attendues

1. Réutiliser `stripe_payment_id` existant ou créer avec idempotency key `pi_order_<orderId>`.
2. Ajouter guard/contrainte anti-double PO `(order_id, product_id)` ou équivalent métier.
3. Ajouter job/endpoint repair : commandes `ordered` sans purchase_orders.
4. Rendre réception PO transactionnelle ou verrouiller order/PO.

---

## I-SWEEP-4 — Collectif crash-recovery

### Fichiers principaux

- `services/collective-payment-orchestrator.js`
- `services/collective-stock-reservation-service.js`

### Problèmes

- `_createOrderFromSession(...)` insère une order directement en `confirmed` ;
- transition `ordered` post-commit non fatale ;
- 100 % cash peut être sécurisé sans order si crash ;
- session `ready_to_capture` ancienne sans reprise ;
- réservations stock non consommées/libérées explicitement après order.

### Corrections attendues

1. Documenter ou aligner `_createOrderFromSession` sur un contrat central.
2. Rendre transition `ordered` obligatoire ou créer alerte critique.
3. Ajouter repair `ready_to_capture` et `secured_without_order`.
4. Consommer/libérer explicitement les réservations stock.

---

## I-SWEEP-5 — Refund / annulation / purchase_orders

### Fichiers principaux

- `routes/orders/status.js`
- `services/order-status-machine.js`
- `routes/purchasing.js`

### Problèmes

- aucun refund Stripe explicite trouvé pour commandes classiques ;
- `cancelled` restaure stock/wallet mais ne garantit pas remboursement externe ;
- annulation order ne synchronise pas automatiquement `purchase_orders` ;
- doctrine `cancelled` vs `refunded` à clarifier.

### Corrections attendues

1. Créer un lot `REFUND-1` si remboursement automatique confirmé.
2. Stripe refund avec idempotency key `refund_<orderId>_<type>`.
3. Cash refund : doctrine cash physique vs wallet/avoir.
4. Annulation order : annuler POs pending/notified ou créer alerte si déjà confirmed/received.

---

## I-SWEEP-6 — Pricing / catalogue / publication

### Fichiers principaux

- `routes/products.js`
- `routes/pricing.js`
- `routes/sourcing-engine.js`

### Problèmes

- prix manuel possible hors pricing-engine ;
- `PUT /api/products/:id` modifie `price_kmf` sans `price_history` ;
- `apply-price` protège le seuil survival seulement si le body le fournit ;
- `apply-all` sans `price_history` par item ;
- stock manuel sans stock movement log ;
- produit visible sans supplier mapping / coût / qualité validée.

### Corrections attendues

1. Recalculer survival côté serveur dans `apply-price`.
2. Ajouter `price_history` pour `apply-all` et `PUT products` si prix change.
3. Ajouter stock movement log pour changements manuels.
4. Définir doctrine de publication : `is_active && is_available && quality_validated` ou exception auditable.

---

## Ordre recommandé

1. I-SWEEP-1 `/pay-cash` hors machine.
2. TEST minimal I-01/I-04/I-06 sur cash.
3. I-SWEEP-2 QR verify parcels.
4. I-SWEEP-3 purchasing idempotence.
5. I-SWEEP-4 collectif crash-recovery.
6. I-SWEEP-5 refund/annulation.
7. I-SWEEP-6 pricing/catalogue.

## État

- I-SWEEP-0 plan : ✅ créé
- I-SWEEP-1 : ☐ à implémenter
- I-SWEEP-2 : ☐ à implémenter
- I-SWEEP-3 : ☐ à implémenter
- I-SWEEP-4 : ☐ à implémenter
- I-SWEEP-5 : ☐ à implémenter
- I-SWEEP-6 : ☐ à implémenter
