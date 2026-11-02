# Commande locale — réception directe au relais (P0, 2026-11-02)

## Deux circuits, une commande et une remise canonique

- **IMPORT** : checkout → PO/Hub → réception physique Hub → carton/expédition/transitaire/douane → relais → retrait.
- **LOCAL_STOCK** : checkout (allocation sous verrou) → paiement (allocation consommée) → **réception physique attestée au relais** → colis `available` → retrait canonique.
- Aucun dossier Hub, PO d'import, fret, douane, `shipped` ou `in_transit` artificiel pour une commande entièrement locale.
- `order_items.fulfillment_source` est immuable et porte la provenance ; `availability_status` porte l'avancement opérationnel.
- Le stock local commercialement disponible n'est pas automatiquement « prêt au retrait » : l'attestation de l'agent est nécessaire.
- En présence de plusieurs lignes locales, une réception couvre toutes les lignes ; la quantité payée consommée doit correspondre exactement à la somme des lignes.

## Point d'exécution P0

`POST /api/orders/:id/local-relay-receipt` authentifié avec `admin` ou `agent_relais`, corps `{"physical_received":true,"note":"..." }`. La portée `agent_relais` est limitée au `relais_id` de la commande. Le service bloque l'ordre jusqu'au COMMIT et journalise dans la même transaction : colis `available` rattaché à ses lignes, scan `relais_received`, événement colis, disponibilités de ligne et historique statutaire via `transitionOrderStatus`. Une notification « prêt au retrait » est projetée après le COMMIT ; son échec n'efface jamais la vérité opérationnelle.

Codes d'échec : `LOCAL_RECEIPT_ROLE_FORBIDDEN`, `LOCAL_RECEIPT_RELAY_FORBIDDEN`, `LOCAL_RECEIPT_PROOF_REQUIRED`, `LOCAL_RECEIPT_ORDER_NOT_READY`, `LOCAL_RECEIPT_INVALID_PROVENANCE`, `LOCAL_RECEIPT_ALLOCATION_MISMATCH`, `LOCAL_RECEIPT_PARCEL_ALREADY_EXISTS`, `LOCAL_RECEIPT_PROOF_INVALID`.

## Périmètre explicitement non clos

Une **commande mixte** conserve une seule commande commerciale : la route réceptionne exclusivement les lignes `LOCAL_STOCK`, les lignes `IMPORT` restant à l'achat/Hub. Le retrait one-shot du colis local laisse la commande `available` tant qu'au moins une quantité import n'a pas été remise, même si cette quantité n'a encore aucun parcel. Le second retrait utilise un nouveau code et ne clôture à `collected` qu'après couverture de toutes les lignes par des parcels collectés. Les provenances `NULL`/inconnues sont interdites dans ce parcours. La réception locale **n'exige pas** de douane ou de couverture Hub pour les lignes non locales ; ces contrôles restent applicables à la branche import lors de son propre parcours. La migration 366 autorise `qty_received > qty_shipped` seulement si la ligne est `LOCAL_STOCK` et possède un `scans.relais_received` pour le colis, sans simuler `qty_shipped`. **L'E2E du flux import physique complet reste à prouver indépendamment.**

Le deuxième cas « produit commandé à un fournisseur national, sans stock Komerce avant achat » n'est pas représenté par `LOCAL_STOCK` actuel ; il demande une qualification de provenance distincte avant tout changement de catalogue. Ne jamais classifier ce cas en `IMPORT` ou `LOCAL_STOCK` par défaut silencieux.

## Recette

1. `tests/unit/local-relay-receipt-service.test.js` : paiement, relais, provenance, allocation, doublon, transaction, notification.
2. `tests/unit/order-status-local-receipt.test.js` : source de transition, preuve scan, rôle et composition.
3. `tests/e2e-api/orders.local-relay-receipt.e2e.test.js` : PostgreSQL isolé, réception locale sans faux shipment, garde provenance et relais, retrait local d'une commande mixte avant import, rotation du code, puis deuxième retrait après arrivée d'un parcel import simulé pour isoler la réconciliation des retraits.
4. Avant GO global : E2E **physique complet** de l'import via Hub/expédition/douane jusqu'au relais (la seconde étape du test ci-dessus injecte un parcel disponible et ne constitue PAS cette preuve), E2E fournisseur national livré au relais, recette Relais Live Chromium et CI verte. Aucun GO global sans ces preuves.
