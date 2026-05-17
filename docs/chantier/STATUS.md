# Komerce Backend — État du chantier
> Mis à jour : 2026-05-17
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
| **SOCLE-1** | ✅ Fait | **Socle architectural à 4 docs gravé** : ajout `SCHEMA.md` + `CONTRACTS.md` ; `AGENTS.md` enrichi avec règle de divergence et règle de mise à jour ; `SCHEMA.md` généré contre `pg_dump` Railway 17/05/2026 |
| **SOCLE-2** | ✅ Fait | **CARTOGRAPHY aligné sur les 9 tables manquantes** : sections 6 bis (modules cérémonie : `fabrics`, `garment_models`, `ceremony_order_type`, colonnes `confection_*` et `module_*`), 8 bis (notifications : `notification_log`, `sms_log`, `stripe_events_processed`), 8 ter (clarification `/api/shares` vs `/api/shared-carts` : `cart_shares`/`cart_contributions` ne sont pas legacy) ; `/api/products` mentionne `product_variants` ; `/api/auth/otp` mentionne `otp_codes` |
| **SOCLE-3** | ✅ Fait | **`server.js` documenté comme point névralgique** : section 3 bis dédiée dans `ZONE_IMPACT.md` (responsabilités cumulées, règles avant modif, dette d'archi vers lot H1) ; checklist §10 enrichie ; dette §11 mise à jour. Audit factuel : 1200 lignes, 80 routes API, 92 DDL inline, 3 webhooks Stripe (lignes 129-131) |
| **H-SYNC** | ✅ Fait | **Synchronisation `BACKEND_GOLIVE_ROADMAP.md` ↔ `STATUS.md`** : 10 lots cochés ☐ → ✅ dans la roadmap (A1, A3, A5, A6, A7, D1, D3, D4, D5, D6), §0 Score global recalculé (20 % réel vs 0 % affiché auparavant), note de méthode ajoutée. Vieux audits avril archivés (`docs/audit/` → `docs/_archive/2026-04-22_audits/`). |
| A1 | ✅ Fait | Fichier fantôme `routes/orders/order-api-v2.js` supprimé |
| A3 | ✅ Fait | Script groupe paiement déplacé vers `tests/integration/groupe-paiement.manual.js` ; manuel, non Jest |
| A6 | ✅ Fait | Issue #387 créée ; TODO backend principaux rattachés au backlog central sans changement métier |
| D0 | ✅ Fait avec hotfix | Fallback QR supprimé ; démarrage Railway restauré via commande `npm start` non bloquante |
| D1 | ✅ Fait | Audit couverture auth admin documenté ; aucun oubli évident trouvé sur routes inspectées |
| D2 | ✅ Fait | Audit webhooks Stripe/idempotence documenté ; aucun code modifié |
| D3 | ✅ Fait | Audit `auth-guest.js` documenté ; risques suivis sans changement métier |
| D4 | ✅ Fait | Audit QR / pickup-secret documenté ; risques sensibles isolés sans correction métier |
| D5 | ✅ Fait partiel | Audit env documenté ; modification `.env.example` bloquée par le connecteur, à reprendre localement |
| D6 | ✅ Fait | Audit rate limiting documenté ; aucun quota modifié |
| D7 | ✅ Fait | Audit CORS production documenté ; aucun code modifié |
| D8 | ✅ Fait | Audit Helmet/CSP production documenté ; aucun code modifié |
| G1 | ✅ Fait | Audit flow cash → retrait documenté ; violations rattachées à I-SWEEP |
| G2 | ✅ Fait | Audit flow Stripe → préparation hub documenté ; side-effects post-commit rattachés à I-SWEEP/TEST-1 |
| G3 | ✅ Fait | Audit flow collectif → contributions → commande documenté ; crash-recovery/idempotence rattachés à I-SWEEP/TEST-1 |
| G4 | ✅ Fait | Audit annulation après paiement documenté ; refund/purchasing/stock rattachés à I-SWEEP/TEST-1 |
| G5 | ✅ Fait | Audit sourcing → produit → mise en vente documenté ; pricing/publication/stock rattachés à I-SWEEP/TEST-1 |
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
- **Tests** : 5 fichiers seulement pour 75 routes + 44 services. Filet quasi inexistant — la doc est aujourd'hui le seul rempart, d'où l'importance du socle.
- 🔴 **VIOLATION I-01 ACTIVE en prod** : `routes/pickup-secret.js` ligne 286 (`/pay-cash`) fait `UPDATE orders SET status = 'confirmed'` en direct, court-circuitant `services/order-status-machine.js`. **Détectée par l'audit D4, confirmée par G1 le 17/05/2026.** Conséquences possibles : pas d'entrée dans `order_status_history` (violation I-04 aussi), `pickup_code` pas garanti généré, notifications post-paiement non déclenchées, décrément stock potentiellement absent. **Correction différée — voir stratégie `I-SWEEP` ci-dessous.** Aucune modification de ce code à la volée pendant le chantier d'audits.
- 🟠 **À revoir dans I-SWEEP** : flow collectif `_createOrderFromSession(...)` insère directement une order `status='confirmed'` puis ajoute l'historique manuellement avant transition `ordered`. Ce n'est pas aussi critique que `/pay-cash`, mais l'alignement strict avec `confirmPaymentCycle` doit être étudié.
- 🟠 **QR verify** : `POST /api/scans/verify-qr` transitionne l'order en `collected` dans la transaction puis appelle `safeSyncScanToParcels` après commit. Risque de divergence order/parcels si crash entre commit et sync ; à couvrir par TEST-1 ou job de repair.
- 🟠 **Stripe intent / purchasing** : G2 a isolé plusieurs points à tester ou durcir : création PaymentIntent sans idempotency key apparente, `triggerPurchasing` post-commit fire-and-forget, possible double purchase_order si replay, commandes `ordered` sans POs après crash, réception hub sans transaction globale apparente.
- 🟠 **Collectif G3** : risques de reprise après crash à couvrir : session 100 % cash sans order, session `ready_to_capture` ancienne, transition `ordered` collective post-commit non fatale, réservations stock non consommées explicitement après order.
- 🔴 **Refund/annulation G4** : aucun flux refund Stripe explicite trouvé pour commandes classiques ; `cancelled` restaure stock/wallet mais ne garantit pas remboursement externe. Annulation commande ne synchronise pas automatiquement les `purchase_orders`. À traiter par lot dédié refund/purchasing dans I-SWEEP ou REFUND-1.
- 🟠 **Sourcing/catalogue G5** : un admin peut créer/modifier un produit visible avec prix/stock manuel sans passer par pricing-engine, sans `price_history` complet et sans stock movement log. `apply-price` protège le seuil survival seulement si le body fournit `survival_price_kmf`; `apply-all` n'a pas d'audit price_history par item.

---

## Prochain lot recommandé

### I-SWEEP — Correction groupée des violations d'invariants détectées

```text
Branche   : fix/backend-I-SWEEP-invariants
Charge    : 3-5 jours
Risque    : élevé — touches paiement, statut, stock, refund, purchasing
Prérequis : D1-D8 terminés, G1-G5 terminés
```

Objectif : corriger en cohérence les violations et dettes critiques révélées par les audits, avec tests ciblés.

Périmètre minimal identifié :

1. `/pay-cash` dans `routes/pickup-secret.js` : aligner sur `confirmPaymentCycle(...)` / machine.
2. `verify-qr` : éviter divergence order/parcels après commit ou ajouter repair/test.
3. Stripe intent/purchasing : idempotence PaymentIntent, `triggerPurchasing`, commandes `ordered` sans PO.
4. Collectif : crash-recovery `ready_to_capture`, 100 % cash sans order, transition `ordered` obligatoire/alertée, réservations stock.
5. Refund/annulation : doctrine `cancelled` vs `refunded`, refund Stripe, cash refund/wallet, synchro order cancel ↔ purchase_orders.
6. Sourcing/catalogue : pricing hardening, `price_history`, stock movement log, doctrine publication.

À faire avant correction :

- créer ou mettre à jour une checklist `I-SWEEP` ;
- choisir les sous-lots à corriger en premier ;
- écrire au minimum des tests de non-régression sur I-01/I-04/I-06 et les flows G1-G5.

---

## File d'attente après I-SWEEP

| Lot | Priorité | Note |
|-----|----------|------|
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
