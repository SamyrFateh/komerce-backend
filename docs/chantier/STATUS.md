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
| D3 | ✅ Fait | Audit `auth-guest.js` documenté ; risques suivis sans changement métier |
| D4 | ✅ Fait | Audit QR / pickup-secret documenté ; risques sensibles isolés sans correction métier |
| D5 | ✅ Fait partiel | Audit env documenté ; modification `.env.example` bloquée par le connecteur, à reprendre localement |
| D6 | ✅ Fait | Audit rate limiting documenté ; aucun quota modifié |
| A5 | ✅ Fait | `docs/chantier/MIGRATIONS_FOLDERS_A5.md` ajouté ; runner réel documenté |
| A7 | ✅ Fait | Docs parasites archivées dans `docs/_archive/` ; `AGENTS.md` corrigé |

---

## Pièges critiques à retenir

- `console.log` : environ 365 occurrences ; F1 est un gros lot, pas un petit nettoyage.
- `routes/parcels.js` et `routes/orders/parcels.js` sont deux fichiers distincts : ne pas supprimer comme doublon.
- Les collisions de migrations SQL ne bloquent pas le boot actuel : le runner actif ne parcourt pas automatiquement les fichiers SQL.
- Les webhooks Stripe sont déjà protégés par body brut + logique d'idempotence ; D2 est un audit formel.
- Toujours vérifier le scope d'un lot avant de modifier un fichier sensible.
- **Dette doc SCHEMA-2** : trou apparent migrations 026-032. Vérifier l'historique git ou archiver le constat. Voir `SCHEMA.md` §12 pt 5.
- **Tests** : 5 fichiers seulement pour 75 routes + 44 services. Filet quasi inexistant — la doc est aujourd'hui le seul rempart, d'où l'importance du socle.
- 🔴 **VIOLATION I-01 ACTIVE en prod** : `routes/pickup-secret.js` ligne 286 (`/pay-cash`) fait `UPDATE orders SET status = 'confirmed'` en direct, court-circuitant `services/order-status-machine.js`. **Détectée par l'audit D4 le 17/05/2026.** Conséquences possibles : pas d'entrée dans `order_status_history` (violation I-04 aussi), `pickup_code` pas garanti généré, notifications post-paiement non déclenchées, décrément stock potentiellement absent. **À corriger par un lot dédié** (proposé : `G1-fix` — remplacer l'UPDATE par appel à `confirmPaymentCycle()` de `services/order-payment-confirmation.js`).

---

## Prochain lot recommandé

### G1-fix — Corriger la violation I-01 dans `routes/pickup-secret.js`

```text
Branche   : fix/backend-G1fix-pickup-secret-i01
Charge    : 1-2 h
Risque    : 🔴 critique métier (paiement cash) — tests obligatoires
Prérequis : aucun, doit passer avant tout autre lot D / G
```

**Contexte** :
Audit D4 du 17/05 a détecté que `routes/pickup-secret.js` ligne 286 fait :
```sql
UPDATE orders SET payment_status = 'paid', status = 'confirmed', confirmed_at = $3, ...
```
en direct, sans passer par `transitionOrderStatus()`. C'est une violation active de l'invariant I-01 (et probablement I-04).

**Actions** :

1. Lire `services/order-payment-confirmation.js` et son contrat (`CONTRACTS.md` §4).
2. Refactorer le bloc lignes ~275-292 de `routes/pickup-secret.js` : remplacer l'`UPDATE` global par un `UPDATE` qui met à jour uniquement les champs spécifiques au cash (`pickup_secret_hash`, `pickup_secret_salt`, `payment_received_at`, `payer_*`, `tracking_phone_*`), **puis** appeler `confirmPaymentCycle({ orderId, source: 'cash_confirm', actor, dbClient })` qui s'occupe de `payment_status = paid`, `status = confirmed`, `confirmed_at`, `order_status_history` et déclenche les effets (pickup_code, notifications, stock).
3. Maintenir le passage en une seule transaction DB (passer `dbClient` à `confirmPaymentCycle`).
4. Ajouter un test d'intégration : `tests/integration/pickup-secret-cash-confirm.test.js` vérifiant qu'après `/pay-cash`, il y a bien une ligne dans `order_status_history`.
5. Mettre à jour `STATUS.md`, `BACKEND_GOLIVE_ROADMAP.md` (cocher G1-fix) et retirer le piège critique I-01.

**À ne pas casser** :
- Le hash et le salt du pickup_secret doivent être posés avant le passage `confirmed` (sinon le client n'a pas son code).
- Le log d'audit `cash_collections` doit toujours être posé.
- Le hook fidélité `loyaltyService.handleOrderConfirmed` doit toujours être déclenché.

---

### D7 — CORS production (après G1-fix)

```text
Branche   : audit/backend-D7-cors-production
Charge    : 1 jour
Risque    : faible si audit/documentation, moyen si modification CORS
Prérequis : G1-fix mergé
```

Actions :

1. Lire la configuration CORS dans `server.js`.
2. Vérifier `FRONTEND_URL`, `ALLOWED_ORIGINS`, localhost, absence d'origin et credentials.
3. Documenter garanties et risques restants.
4. Corriger uniquement les oublis évidents sans bloquer les pages existantes.
5. Mettre à jour ce fichier et `docs/BACKEND_GOLIVE_ROADMAP.md` dans la même PR.

---

## File d'attente après D7

| Lot | Priorité | Note |
|-----|----------|------|
| **G1-fix** | 🔴 **Critique** | **Corriger la violation I-01 dans `routes/pickup-secret.js:286`** : remplacer l'`UPDATE orders SET status = 'confirmed'` direct par un appel à `confirmPaymentCycle()` de `services/order-payment-confirmation.js`. Restaure l'entrée `order_status_history`, garantit `pickup_code`, déclenche notifications et décrément stock. **À traiter avant tout nouveau lot D / G.** |
| A4 | Prudence | Collisions migrations 060/061 ; approbation humaine recommandée avant merge |
| D8 | Moyenne | Helmet production |
| F1 | Haute mais gros lot | Logger structuré à la place des `console.log` |
| H1 | Stratégique (lourd) | Refacto `server.js` — sortir les 92 DDL inline vers `scripts/fix-schema.js`, manifeste de montage des routes, cible < 300 lignes. Cf. `ZONE_IMPACT.md §3 bis`. |
| H3 | Moyenne | Déplacer l'audit backend arch vers `scripts/` |
| TEST-1 | Stratégique | Tests d'intégration sur invariants I-01 à I-10 (filet minimal) |

Pour la liste complète et les détails de chaque lot, utiliser `docs/BACKEND_GOLIVE_ROADMAP.md`.

---

## Règle de fin de session

Avant de terminer une session avec commit ou PR :

1. cocher ou annoter le lot traité ici ;
2. mettre à jour le prochain lot recommandé ;
3. vérifier que `AGENTS.md` continue de pointer vers ce fichier en premier ;
4. si une divergence doc ↔ code ↔ DB a été détectée pendant la session : ajouter une ligne dans "Pièges critiques" ;
5. si un des 4 documents socle a été modifié structurellement, vérifier la cohérence avec les 3 autres.
