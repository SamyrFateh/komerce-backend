# Komerce Backend — État du chantier
> Mis à jour : 2026-05-18
> Repo : `SamyrFateh/komerce-backend` — branche de référence : `main`
> **Ce fichier est la PREMIÈRE chose à ouvrir au début de chaque session.**

---

## Point d'entrée obligatoire

Lire dans cet ordre avant toute modification :

1. `docs/chantier/STATUS.md` — état du jour et prochain lot réel
2. **Socle architectural (4 documents canoniques)** :
   - `docs/CARTOGRAPHY_360.md` — quoi existe (domaines, surfaces, points de vérité)
   - `docs/ZONE_IMPACT.md` — quoi protéger (10 invariants + checklist)
   - `docs/SCHEMA.md` — quoi est vrai en base (91 tables, 14 ENUMs, triggers)
   - `docs/CONTRACTS.md` — qui appelle quoi (contrats services critiques)
3. `docs/BACKEND_AUDIT_CORRECTIONS.md` — corrections post-lecture code, fait foi contre l'audit initial
4. `docs/BACKEND_GOLIVE_ROADMAP.md` — détail complet des lots
5. `docs/BACKEND_AUDIT_SESSIONS_PLAN.md` — sessions d'audit approfondies

Voir `AGENTS.md` §1 pour la règle de socle et §2 pour la règle de divergence doc ↔ code ↔ DB.

---

## Invariants à garder en tête

| ID | Invariant |
|----|-----------|
| I-01 | Ne jamais modifier `orders.status` hors machine de statut |
| I-02 | Paiements Stripe/cash/wallet/shared cart/collectif → uniquement `pending → confirmed` |
| I-03 | Transitions scan/système : forward-only + idempotentes |
| I-04 | Toute transition effective → trace dans `order_status_history` |
| I-05 | Wallet : pas de suppression — créditer, débiter, contre-passer |
| I-06 | Annulation → restaurer stock ET wallet appliqué |
| I-07 | Webhooks Stripe : body brut avant `express.json` |
| I-08 | Pricing : lire les composantes DB, jamais de coefficient dur |
| I-09 | Colis = unité opérationnelle autonome |
| I-10 | Codes retrait et preuves de collecte = éléments de confiance |

---

## État réel confirmé sur `main`

| Lot | État | Notes |
|-----|------|-------|
| INIT-0 | ✅ Fait | Référentiels lus en session |
| DOC-0 | ✅ Fait | `CARTOGRAPHY_360.md` et `ZONE_IMPACT.md` déjà à jour |
| **SOCLE-1** | ✅ Fait | Socle architectural à 4 docs gravé : ajout `SCHEMA.md` + `CONTRACTS.md` ; `AGENTS.md` enrichi avec règle de divergence et règle de mise à jour ; `SCHEMA.md` généré contre `pg_dump` Railway 17/05/2026 |
| **SOCLE-2** | ✅ Fait | CARTOGRAPHY aligné sur les 9 tables manquantes |
| **SOCLE-3** | ✅ Fait | `server.js` documenté comme point névralgique |
| **H-SYNC** | ✅ Fait | Synchronisation `BACKEND_GOLIVE_ROADMAP.md` ↔ `STATUS.md` |
| A1 | ✅ Fait | Fichier fantôme `routes/orders/order-api-v2.js` supprimé |
| A3 | ✅ Fait | Script groupe paiement déplacé vers `tests/integration/groupe-paiement.manual.js` ; manuel, non Jest |
| A6 | ✅ Fait | Issue #387 créée ; TODO backend principaux rattachés au backlog central sans changement métier |
| D0 | ✅ Fait avec hotfix | Fallback QR supprimé ; démarrage Railway restauré via commande `npm start` non bloquante |
| D1 | ✅ Fait | Audit couverture auth admin documenté |
| D2 | ✅ Fait | Audit webhooks Stripe/idempotence documenté |
| D3 | ✅ Fait | Audit `auth-guest.js` documenté |
| D4 | ✅ Fait | Audit QR / pickup-secret documenté |
| D5 | ✅ Fait partiel | Audit env documenté ; modification `.env.example` bloquée par le connecteur, à reprendre localement |
| D6 | ✅ Fait | Audit rate limiting documenté |
| D7 | ✅ Fait | Audit CORS production documenté |
| D8 | ✅ Fait | Audit Helmet/CSP production documenté |
| G1 | ✅ Fait | Audit flow cash → retrait documenté |
| G2 | ✅ Fait | Audit flow Stripe → préparation hub documenté |
| G3 | ✅ Fait | Audit flow collectif → contributions → commande documenté |
| G4 | ✅ Fait | Audit annulation après paiement documenté |
| G5 | ✅ Fait | Audit sourcing → produit → mise en vente documenté |
| I-SWEEP-0 | ✅ Fait | Checklist d'exécution créée dans `docs/chantier/I_SWEEP_PLAN.md` |
| I-SWEEP-1 | ✅ Fait | Service transactionnel `confirm-pickup-cash-payment.js` créé ; route sûre `pickup-pay-cash.js` créée ; PR #395 mergée. `POST /api/pickup/pay-cash/:orderId` passe par `confirmPaymentCycle(...)`. |
| I-SWEEP-2 | ✅ Fait | Service transactionnel `verify-qr-collection.js` créé ; PR #396 mergée. `POST /api/scans/verify-qr` fait transition `collected`, invalidation QR, scan et `safeSyncScanToParcels(...)` dans la même transaction. |
| I-SWEEP-3A | ✅ Fait | Service `create-stripe-order-intent.js` créé ; PR #397 mergée. `POST /api/payments/stripe/intent` réutilise un PaymentIntent existant ou crée avec idempotency key `pi_order_<orderId>`. |
| I-SWEEP-3B | ✅ Fait | PR #398 mergée. `triggerPurchasing(orderId)` vérifie une PO active existante pour `order_id + product_supplier_id` avant insertion et retourne `already_exists` en cas de replay. |
| I-SWEEP-3C | ✅ Fait | Service `receive-purchase-order.js` créé ; repair `ordered` sans PO déjà présent ; PR #401 mergée. `POST /api/purchasing/:id/receive` passe par réception transactionnelle. |
| A5 | ✅ Fait | `docs/chantier/MIGRATIONS_FOLDERS_A5.md` ajouté ; runner réel documenté |
| A7 | ✅ Fait | Docs parasites archivées dans `docs/_archive/` ; `AGENTS.md` corrigé |

---

## Pièges critiques à retenir

- `console.log` : environ 365 occurrences ; F1 est un gros lot, pas un petit nettoyage.
- `routes/parcels.js` et `routes/orders/parcels.js` sont deux fichiers distincts : ne pas supprimer comme doublon.
- Les collisions de migrations SQL ne bloquent pas le boot actuel : le runner actif ne parcourt pas automatiquement les fichiers SQL.
- Les webhooks Stripe sont protégés par body brut + signature + idempotence, mais D2 a isolé des durcissements à traiter dans I-SWEEP/TEST-1 : secrets dédiés obligatoires, replay tests, shared-cart transactionnel, reprise collective `ready_to_capture`.
- Toujours vérifier le scope d'un lot avant de modifier un fichier sensible.
- **Dette doc SCHEMA-2** : trou apparent migrations 026-032. Vérifier l'historique git ou archiver le constat. Voir `SCHEMA.md` §12 pt 5.
- **Tests** : 5 fichiers seulement pour 75 routes + 44 services. Filet quasi inexistant — tests manuels/API encore recommandés après I-SWEEP-1/2/3A/3B/3C.
- ✅ **I-01 / pickup cash** : violation `/api/pickup/pay-cash/:orderId` corrigée par I-SWEEP-1.
- ✅ **QR verify / parcels** : divergence potentielle order/parcels corrigée par I-SWEEP-2.
- ✅ **Stripe intent** : risque de PaymentIntents multiples réduit par I-SWEEP-3A.
- ✅ **Purchasing replay** : risque de double `purchase_order` réduit par I-SWEEP-3B.
- ✅ **Purchasing repair/réception** : repair `ordered` sans PO existe ; réception hub transactionnelle ajoutée par I-SWEEP-3C.
- 🟠 **À revoir dans I-SWEEP** : flow collectif `_createOrderFromSession(...)` insère directement une order `status='confirmed'` puis ajoute l'historique manuellement avant transition `ordered`. Ce n'est pas aussi critique que `/pay-cash`, mais l'alignement strict avec `confirmPaymentCycle` doit être étudié.
- 🟠 **Collectif G3** : risques de reprise après crash à couvrir : session 100 % cash sans order, session `ready_to_capture` ancienne, transition `ordered` collective post-commit non fatale, réservations stock non consommées explicitement après order.
- 🔴 **Refund/annulation G4** : aucun flux refund Stripe explicite trouvé pour commandes classiques ; `cancelled` restaure stock/wallet mais ne garantit pas remboursement externe. Annulation commande ne synchronise pas automatiquement les `purchase_orders`. À traiter par lot dédié refund/purchasing dans I-SWEEP ou REFUND-1.
- 🟠 **Sourcing/catalogue G5** : un admin peut créer/modifier un produit visible avec prix/stock manuel sans passer par pricing-engine, sans `price_history` complet et sans stock movement log. `apply-price` protège le seuil survival seulement si le body fournit `survival_price_kmf`; `apply-all` n'a pas d'audit price_history par item.

---

## Prochain lot recommandé

### I-SWEEP-4 — Collectif crash-recovery

```text
Branche   : fix/backend-I-SWEEP-4-collective-crash-recovery
Charge    : 2 jours
Risque    : élevé — touche paiement collectif, capture, commande, stock reservations
Prérequis : I-SWEEP-3C terminé
```

Objectif : traiter les risques G3 restants : session 100 % cash sans order, session `ready_to_capture` ancienne, transition `ordered` collective post-commit non fatale, réservations stock non consommées/libérées explicitement.

---

## File d'attente après I-SWEEP-4

| Lot | Priorité | Note |
|-----|----------|------|
| I-SWEEP-5 | Haute | Refund / annulation / purchase_orders |
| I-SWEEP-6 | Moyenne/haute | Pricing/catalogue publication hardening |
| TEST-1 | 🔴 Stratégique | Tests d'intégration sur invariants I-01 à I-10 + flows G1-G5 avant/après I-SWEEP |
| REFUND-1 | 🔴 Critique si non inclus I-SWEEP | Remboursement Stripe/cash/wallet et doctrine `cancelled` vs `refunded` |
| PRICE-1 | Haute | Durcissement pricing/catalogue : survival recalculé serveur, price_history complet, stock movement log |
| A4 | Prudence | Collisions migrations 060/061 ; approbation humaine recommandée avant merge |
| F1 | Haute mais gros lot | Logger structuré à la place des `console.log` |
| H1 | Stratégique (lourd) | Refacto `server.js` — sortir les 92 DDL inline vers `scripts/fix-schema.js`, manifeste de montage des routes, cible < 300 lignes. Cf. `ZONE_IMPACT.md §3 bis`. |
| H3 | Moyenne | Déplacer l'audit backend arch vers `scripts/` |

Pour la liste complète et les détails de chaque lot, utiliser `docs/BACKEND_GOLIVE_ROADMAP.md`.

---

## Règle de fin de session

Avant de terminer une session avec commit ou PR :

1. cocher ou annoter le lot traité ici ;
2. mettre à jour le prochain lot recommandé ;
3. vérifier que `AGENTS.md` continue de pointer vers ce fichier en premier ;
4. si une divergence doc ↔ code ↔ DB a été détectée pendant la session : ajouter une ligne dans "Pièges critiques" ;
5. si un des 4 documents socle a été modifié structurellement, vérifier la cohérence avec les 3 autres.
