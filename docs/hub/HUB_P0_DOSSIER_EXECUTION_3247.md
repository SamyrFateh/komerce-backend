# Hub P0 — Dossier d'approvisionnement par marché — contrat d'exécution (#3247, PR #3248)

Auteur : Opus (architecture). Réalisation : Sonnet, mode économie de tokens.
Ne relance pas la conception. Chaque lot = 1 commit, preflight vert, push, CI verte avant le suivant.

## 0. Déjà en place — ne pas reconstruire

| Maillon | Autorité existante | Garanties vérifiées |
|---|---|---|
| Commande → order_item → purchase_line | `purchasing-trigger-service` (ligne ouverte), `purchasing-grouped-service` | ligne = 1 order_item |
| Ligne → PO mono-marché/fournisseur/Hub | migration 357 + `prepare`/`attach` | trigger PG, verrou de l'en-tête |
| Soumission / confirmation | `purchasing-engagement-service` `submit` (→ `notified`), `confirm` (reliquat) | |
| Réception multi-colis | `POST /api/scans/hub/receive` → `hub-physical-identity.resolveGroupedLineEntries` | répartition par ligne, ordre `orders.created_at`, sur-réception refusée, idempotence par référence |
| Contrôle / quarantaine | `hub-operations` (`/transition`, `/revalidate`, `/outcome`) | incident obligatoire |
| Réemballage → KOM-BOX | `/api/hub/move` (SPLIT/MERGE/REPACK), `/unit` MARKET_PARCEL, `/pack`, `/seal` | `hub_allocation_overplaced` (pas de double compte), PACKED = un seul marché (trigger) |
| Expédition | `international-shipment-journey` (`international_shipments`, market-scoped) | |

**Manques réels (P0)** : (a) la soumission confond « bon émis » et « envoyé » ; (b) aucun lien KOM-BOX → expédition ; (c) aucune projection dossier par marché ; (d) achats réservés à `admin`, le Hub ne peut pas constituer ses PO ; (e) aucun test de la chaîne complète.

## Lot 1 — Débloquer la CI de #3248 (fait par Opus, à pousser)

Commits locaux à pousser après `npm run pr:preflight` vert : helper `tests/helpers/goldenJourneySetup.js` (PO avec `market_id`), `features/infrastructure.feature.js` (+`middleware/recette-isolation-guard.js`, dette de `main`), docs régénérées. Vérifié localement : E2E 61/61.
Si la branche distante est encore à `c8c42a6`, refaire ces deux corrections (5 lignes).

## Lot 2 — Migration 358 (SQL validé sur PG16 par Opus)

Créer `migrations/358_hub_po_transmission_and_box_shipment.sql` avec le SQL de l'annexe A. Déclarer le fichier dans `features/purchasing.feature.js`.
- `purchase_orders.sent_at/sent_channel/sent_by/sent_note` : `sent_channel ∈ {email, whatsapp, phone, api, other}`, immuable une fois posé, seulement si `status ∈ {notified, confirmed, shipped, hub_received}`.
- `international_shipment_hub_units(shipment_id, physical_unit_id UNIQUE, attached_by, attached_at)` : MARKET_PARCEL, état PACKED/DISPATCHED, `unit.market_id = shipment.market_id`, expédition `stage='hub_ready'`; pas d'UPDATE ; DELETE seulement si `hub_ready`.

Test PG `tests/integration/hub-p0-transmission-box-shipment-postgres.test.js` : chaque RAISE de l'annexe (1 cas négatif chacun) + 1 cas nominal par table + 2 rattachements concurrents du même carton (un seul gagne).

## Lot 3 — Services et routes (aucune nouvelle source de vérité)

1. `purchasing-engagement-service.recordPurchaseOrderSent(poId, {channel, supplier_order_id?, note}, {actor})` : verrou PO, `UPDATE … SET sent_at=NOW(), sent_channel, sent_by, sent_note`, et `supplier_order_id` si fourni et encore NULL. Idempotent : même canal déjà posé → 200 `already_sent:true` ; canal différent → 409 `PURCHASE_ORDER_ALREADY_SENT`. `submit` reste inchangé (il émet le bon et le lien `wa.me`, sans prétendre l'envoi).
   Route `POST /api/purchasing/po/:po_id/sent`.
2. `services/hub-box-shipment-service.js` : `attachBoxToShipment({unitId, shipmentReference, actor})` et `detachBoxFromShipment`. Messages lisibles des erreurs PG `hub_box_shipment_*`. Routes `POST /api/hub/box/:unit_id/shipment` et `DELETE …` (même garde que `/seal`).
3. `services/hub-procurement-dossier.js` — **projection en lecture seule**, une requête par bloc, `market_id` obligatoire :
   ```
   getDossier({ marketId, supplierId?, status? }) → {
     market, generated_at,
     kpis: { orders_waiting, lines_open, po_draft, po_issued_not_sent, po_sent_unconfirmed,
             qty_missing, qty_anomaly, boxes_open, boxes_unshipped },
     needs:   [ open lines (purchase_order_id NULL) grouped by supplier: sku, variant, qty, order refs ],
     purchase_orders: [ { id, supplier, stage, sent_channel, sent_at, supplier_order_id,
                          lines: [ { line_id, order_id, order_ref, order_item_id, product, product_sku_id,
                                     ordered, confirmed, received, missing, anomaly } ] } ],
     receipts: [ SUPPLIER_PACKAGE units: reference, external_ref, state, received_at, po ids ],
     boxes:    [ MARKET_PARCEL: reference, state, market, contents[{order_ref, line_id, qty}], shipment_ref ],
     to_handle:[ only blocking: PO issued but not sent > 24 h, PO sent unconfirmed > 72 h,
                 missing qty on confirmed PO, quarantined unit, packed box unshipped ]
   }
   getTrace({ purchaseOrderId | orderId }) → chain per order_item:
     order → order_item → purchase_line → PO → receipts[] → placements[] → box → shipment
   ```
   `stage` (dérivé, jamais stocké) : `draft`→« Brouillon », `notified ∧ sent_at NULL`→« Bon émis, envoi non prouvé », `notified ∧ sent_at`→« Envoyée », `confirmed`→« Confirmée », received>0∧missing>0→« Partiellement reçue », missing=0→« Reçue », `cancelled`→« Annulée ».
   Quantités : `ordered` = `purchase_lines.quantity` ; `confirmed`/`effective` = `purchase_line_effective_quantity(...)` ; `received` = `v_purchase_line_progress.received_quantity` ; `missing` = max(effective − received, 0) ; `anomaly` = quantités placées sur des unités QUARANTINED ou à outcome. Réutiliser `v_purchase_line_progress`, ne recalculer rien d'autre.
   Routes : `GET /api/hub/dossier?market=KM` et `GET /api/hub/trace?po_id=|order_id=` avec la garde `hubRead` existante de `routes/hub.js` (admin, agent_hub, market_operator limité à ses marchés via `addMarketScope` ; market_operator hors marché → 403).
4. Autorisations des écritures de PO : sur `routes/purchasing.js`, les routes regroupées (`open-lines`, `po/*`, `lines/*`) passent de `requireRole(['admin'])` à `requireRole(['admin','agent_hub'])`. Les autres routes restent admin. Mettre à jour `docs/SECURITY_360.*` (régénérés par le preflight) et le test de frontière d'autorisation existant.

## Lot 4 — Preuve de la chaîne physique (P0, obligatoire)

`tests/integration/hub-p0-procurement-chain-postgres.test.js`, sur la base CI (schéma + bootstrap), via les **vrais services** (`hub-operations` commands, `purchasing-*`), sans `INSERT` direct sauf pour les données de référence (marchés, utilisateurs, produits, SKU, commandes payées).

Scénario nominal : marché KM, fournisseur A, SKU S1 et S2. Commande C1 (S1×2, S2×1), commande C2 (S1×3). Préparer 1 PO KM/A, soumettre, `sent` (whatsapp), confirmer avec `supplier_order_id`. Colis 1 : S1×4. Colis 2 : S2×1. S1 reste à 1 manquant. Contrôler, créer 2 KOM-BOX, REPACK C1 → box1 et C2 → box2, pack, créer une expédition KM `hub_ready`, rattacher, seal.
Assertions exactes : C1 S1 reçu 2/2, C2 S1 reçu 2/3, manquant 1 imputé à C2 ; S2 1/1 ; `getTrace(C2)` donne la ligne, la PO, le colis 1, box2, l'expédition ; somme placée = somme reçue (aucun double compte) ; `getDossier(KM)` stage « Partiellement reçue », `to_handle` contient le manquant.
Cas négatifs, un `it` chacun : ligne CM attachée à la PO KM (`purchase_line_market_mismatch`) ; réception sur PO brouillon ; mauvaise PO pour le SKU ; variante incorrecte (`HUB_PURCHASE_SKU_MISMATCH`) ; sur-réception ; double réception même référence, idempotente, sans doublon ; box CM vers expédition KM ; box rattachée deux fois ; `sent` sur brouillon ; deuxième `sent` d'un canal différent ; fournisseur indisponible → `cancelLine` puis `createManualLine` chez B (reliquat), qui réapparaît dans `needs`. Concurrence : 2 `attach` simultanés de la même ligne vers 2 PO, une seule réussit.
Autorisations (supertest) : agent_hub prépare une PO ; market_operator KM lit le dossier KM, reçoit 403 sur CM, 403 sur `po/prepare`.

## Lot 5 — Poste de travail Hub (desktop 1440 uniquement)

Dans l'espace Achats fournisseurs existant (`public/dashboards/canonical/js/purchasing-workspace.js`), en reprenant l'ergonomie Catalogue, sans nouvel écran :
- Sélecteur de marché obligatoire, puis bandeau de 6 KPI compact (une ligne).
- « À traiter » : uniquement `to_handle`.
- Onglets : Besoins (lignes ouvertes par fournisseur, action « Constituer la PO » / « Ajouter à la PO brouillon ») · PO (une ligne par PO, stage, une action principale : Soumettre → « Enregistrer l'envoi » (canal + référence fournisseur) → Confirmer) · Réceptions · Cartons (contenu par commande, « Rattacher à une expédition »).
- Clic sur une commande ou une PO : panneau de filiation `getTrace`.
- Le lien `wa.me` reste un bouton « Ouvrir WhatsApp », jamais compté comme envoi.
Playwright Chromium 1440 avec API mockée (`page.route`) : parcours Besoins → PO → envoi → réception partielle visible → carton → expédition ; captures dans la PR.

## Critères GO

Preflight 34/34 ; CI de #3248 verte, y compris integration + E2E complets ; Lot 4 vert sur PG16 ; captures 1440 ; aucun test désactivé. Pas de fusion ni de déploiement sans recette métier de l'utilisateur.

## Annexe A — migration 358 (validée par Opus : appliquée sans erreur sur PG16, base CI)

Voir le fichier joint `docs/hub/HUB_P0_358_migration.sql` : à copier tel quel dans `migrations/358_hub_po_transmission_and_box_shipment.sql`.
