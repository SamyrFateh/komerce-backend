# G4 — Flow annulation commande après paiement

> Date : 2026-05-17
> Scope : audit/documentation uniquement

## Résumé

Audit des chemins d'annulation après paiement :

1. annulation via PATCH statut commande ;
2. restauration stock ;
3. reversal wallet ;
4. statut `refunded` ;
5. interactions avec Stripe, cash, collectif et purchase_orders.

Aucune correction de code n'a été appliquée dans ce lot. Les écarts restent rattachés à `I-SWEEP` / `TEST-1`.

## Surface principale — PATCH statut commande

Surface : `PATCH /api/orders/:id/status` dans `routes/orders/status.js`.

### Garanties constatées

- Route protégée par `authenticate`.
- Rôles autorisés : `admin`, `agent_hub`, `agent_relais`.
- Validation payload via `validate(orders.updateStatus)`.
- Toute transition passe par `transitionOrderStatus(...)`.
- Le motif d'annulation est passé comme `cancelReason` si `status = 'cancelled'`.
- Transaction explicite `BEGIN/COMMIT` autour de la transition.
- Notification statut post-commit non bloquante.

### Limite importante

- La machine limite `cancelled` au rôle `admin` via `TRANSITION_ROLES`, donc même si la route accepte `agent_hub`/`agent_relais`, ces rôles doivent être refusés par la machine pour `cancelled`.

## Machine de statut — annulation

Surface : `services/order-status-machine.js`.

### Garanties constatées

- `cancelled` autorisé depuis plusieurs états non terminaux.
- `collected` ne peut plus être annulé via forward-only.
- `cancelReason` est stocké sur `orders.cancel_reason`.
- Timestamp `cancelled_at` positionné via `COALESCE`.
- Historique `order_status_history` inséré systématiquement.
- Si wallet appliqué : tentative `walletService.removeFromOrder(...)`.
- Si `removeFromOrder` échoue : fallback `walletService.credit(...)` avec idempotency key `wallet_reversal_<orderId>`.
- Stock restauré via `UPDATE products SET stock = stock + quantity` sur tous les `order_items`.
- La transition retourne les effets d'annulation (`cancelEffects`).

### Points forts

- Annulation centralisée dans la machine : bonne conformité I-01/I-04.
- Wallet reversal dans le même client transactionnel.
- Stock restore dans le même client transactionnel.
- Wallet fallback idempotent en cas d'échec de la restauration par consommations.

## Wallet reversal

Surface : `services/wallet-service.js`.

### Garanties constatées

- Wallet transactions immutables : crédit, débit, reversal.
- `applyToOrder` débite via idempotency key `checkout_<orderId>`.
- `removeFromOrder` remet les lots consommés à `active`, supprime les consommations, crédite le solde wallet et insère une transaction `reversal`.
- Fallback machine crédite avec idempotency key `wallet_reversal_<orderId>`.

### Risques / limites

- `removeFromOrder` n'a pas d'idempotency key dédiée. Si la transaction d'annulation rollback, pas d'effet durable ; si elle commit, l'ordre devient cancelled et ne devrait pas repasser par la même transition. À couvrir par test replay.
- Le fallback `credit(...)` est idempotent, mais il peut créer un lot de crédit neuf plutôt que restaurer les lots FIFO d'origine.

## Stock restore

### Garanties constatées

- La machine restaure le stock pour tous les `order_items` lors du passage à `cancelled`.
- Cette restauration est dans la même transaction que le statut et l'historique.

### Risques / limites

- La machine restaure le stock quel que soit l'état précédent, tant que la transition vers `cancelled` est autorisée.
- Pour une commande annulée avant décrément stock effectif, cela pourrait sur-créditer le stock si un chemin créait des `order_items` sans stock décrémenté puis permettait annulation.
- Les flows classiques décrémentent le stock au paiement, pas à la création, donc une commande `pending` annulée par machine peut être un cas à tester.

## Refund Stripe

### Constat

Aucun endpoint ou service de refund Stripe explicite n'a été trouvé dans le scope de recherche : pas d'appel évident `stripe.refunds.create(...)` pour les commandes classiques.

### Impact

- Le statut `refunded` existe dans la machine, mais le remboursement financier Stripe ne semble pas automatisé pour une commande classique.
- Une commande Stripe peut donc être `cancelled` côté métier avec stock/wallet restaurés, mais sans remboursement Stripe automatique.
- Le passage `cancelled → refunded` est autorisé par la machine, mais le lien avec un vrai remboursement externe doit être clarifié.

### Décision

Pas de correction dans G4. À rattacher à `I-SWEEP` ou à un lot `REFUND-1`, car toucher aux remboursements est critique.

## Cash relais

### Garanties constatées

- Annulation d'une commande cash payée via flow classique passe par machine si effectuée via PATCH statut.
- Stock et wallet sont restaurés.

### Risques / limites

- Il n'y a pas de workflow explicite de remboursement cash/relais ou d'avoir client hors wallet.
- Pour du cash encaissé physiquement, la décision opérationnelle reste à définir : remboursement cash, avoir wallet, ou traitement manuel.

## Collectif

### Garanties constatées

- Le workspace collectif devient irréversible dès qu'un `order_id` existe.
- L'annulation de la commande collective elle-même devrait ensuite passer par le flow standard `orders/:id/status`.

### Risques / limites

- Les réservations `collective_stock_reservations` ne sont pas explicitement consommées/libérées dans l'audit G3. En cas d'annulation après order créée, leur état doit être clarifié.
- Les captures Stripe collectives sont réelles ; il n'y a pas de refund Stripe collectif automatisé identifié après création order.

## Purchase orders / sourcing

### Garanties constatées

- `purchase_orders` peuvent être annulées individuellement via `DELETE /api/purchasing/po/:po_id`.
- Une PO reçue au hub ne peut pas être annulée sans `x-force-delete`.
- Soft delete fournisseur annule les POs `pending/notified` ou plus largement en mode test forcé.

### Risques / limites

- L'annulation d'une commande ne semble pas annuler automatiquement les `purchase_orders` liées.
- Si une commande est annulée après sourcing déclenché, il faut clarifier : annuler POs pending/notified, bloquer si confirmed/received, ou traiter manuellement.
- Les POs ont leur propre lifecycle ; il manque un orchestrateur d'annulation commande ↔ purchasing.

## Conclusion G4

Le cœur technique d'annulation via machine est bon pour les invariants internes : statut, historique, wallet et stock.

Les trous critiques sont autour des effets externes ou périphériques :

1. refund Stripe classique non automatisé ou non trouvé ;
2. remboursement cash/relais non formalisé ;
3. annulation order ne synchronise pas automatiquement les purchase_orders ;
4. risque de sur-restauration stock pour annulation avant décrément réel à tester ;
5. réservations stock collectif à clarifier après annulation order ;
6. statut `refunded` pas clairement lié à un vrai remboursement externe.

## À rattacher à I-SWEEP / TEST-1

- Test : annuler une commande pending sans stock décrémenté ne doit pas sur-créditer le stock.
- Test : annuler une commande paid Stripe restaure stock + wallet, mais doit exiger/produire une action refund claire.
- Test : annuler une commande cash payée définit la doctrine remboursement cash/wallet.
- Test : annuler après purchase_orders pending/notified annule ou signale les POs.
- Test : annuler après PO confirmed/received bloque ou crée alerte manuelle.
- Ajouter un vrai lot refund Stripe avec idempotency key `refund_<orderId>_<type>` si remboursement automatique confirmé.
- Clarifier `cancelled` vs `refunded` dans la doctrine : cancelled métier, refunded financier.
