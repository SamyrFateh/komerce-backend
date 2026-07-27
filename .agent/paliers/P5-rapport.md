# P5 — colonnes contestées et transactionnalité

**Statut : CLOS sur le périmètre audité.**

## Payment status

- Validateur central partagé par les écrivains autorisés.
- `paid → refunded` autorisé.
- `pending → refunded`, `failed → refunded`, `paid → failed` et toute sortie de `refunded` bloqués.
- No-op de même statut idempotent.

## QR de retrait

- Émission et rotation centralisées dans `services/qr-collection-core.js`.
- Verrou de ligne avant décision.
- Token et expiration écrits ensemble.
- Consommation, transition `available → collected`, effacement du token et scan restent dans la transaction appelante.
- Ancien écrivain tracking de `orders.qr_token` supprimé.

## Wallet

- `orders.total_kmf` reste la valeur faciale immuable.
- `wallet_applied_kmf` est borné par le reste réellement finançable.
- Commande verrouillée avant décision.
- Un `duplicate:true` retourne l'état persisté sans réécriture de la commande et sans appel à `markPaid()`.
- Test de régression présent : application partielle, second appel avec `checkout_<orderId>`, aucun nouveau débit, projections inchangées.

## Réserve

La fermeture porte sur les chemins actifs et colonnes ciblées de P5. Elle ne constitue pas une certification exhaustive de tous les effets de bord de la plateforme.
