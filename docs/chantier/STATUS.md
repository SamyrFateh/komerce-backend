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
| SOCLE-1 | ✅ Fait | Socle architectural à 4 docs gravé |
| SOCLE-2 | ✅ Fait | CARTOGRAPHY aligné sur les 9 tables manquantes |
| SOCLE-3 | ✅ Fait | `server.js` documenté comme point névralgique |
| H-SYNC | ✅ Fait | Synchronisation roadmap ↔ STATUS |
| A1 | ✅ Fait | Fichier fantôme supprimé |
| A3 | ✅ Fait | Script groupe paiement déplacé en manuel |
| A6 | ✅ Fait | Issue #387 créée |
| D0 | ✅ Fait avec hotfix | Fallback QR supprimé ; démarrage Railway restauré |
| D1 | ✅ Fait | Audit couverture auth admin documenté |
| D2 | ✅ Fait | Audit webhooks Stripe/idempotence documenté |
| D3 | ✅ Fait | Audit `auth-guest.js` documenté |
| D4 | ✅ Fait | Audit QR / pickup-secret documenté |
| D5 | ✅ Fait partiel | Audit env documenté ; `.env.example` à reprendre localement |
| D6 | ✅ Fait | Audit rate limiting documenté |
| D7 | ✅ Fait | Audit CORS production documenté |
| D8 | ✅ Fait | Audit Helmet/CSP production documenté |
| G1 | ✅ Fait | Audit flow cash → retrait documenté |
| G2 | ✅ Fait | Audit flow Stripe → préparation hub documenté |
| G3 | ✅ Fait | Audit flow collectif → contributions → commande documenté |
| G4 | ✅ Fait | Audit annulation après paiement documenté |
| G5 | ✅ Fait | Audit sourcing → produit → mise en vente documenté |
| I-SWEEP-0 | ✅ Fait | Checklist créée |
| I-SWEEP-1 | ✅ Fait | `/api/pickup/pay-cash/:orderId` passe par `confirmPaymentCycle(...)` |
| I-SWEEP-2 | ✅ Fait | `verify-qr` synchronise order/scan/parcels dans une transaction |
| I-SWEEP-3A | ✅ Fait | Stripe intent idempotent par commande |
| I-SWEEP-3B | ✅ Fait | `triggerPurchasing` idempotent par `order_id + product_supplier_id` |
| I-SWEEP-3C | ✅ Fait | Repair ordered sans PO existant ; réception PO transactionnelle ajoutée |
| I-SWEEP-4A | ✅ Fait | PR #402 mergée. Repair admin dry-run `POST /api/admin/collective/repair-ready-to-capture` pour sessions collectives `ready_to_capture` anciennes sans order liée. |
| I-SWEEP-4B | ✅ Fait | PR #403 mergée. Repair admin dry-run `POST /api/admin/collective/repair-stock-reservations` : consomme les réservations des workspaces avec order et libère/expire celles des sessions/workspaces terminés sans order. |
| I-SWEEP-5A | ✅ Fait | PR #404 mergée. Lors d'une annulation commande, les `purchase_orders` `pending/notified` sont annulées automatiquement ; les POs fournisseur déjà engagées créent une alerte opérationnelle. |
| A5 | ✅ Fait | `docs/chantier/MIGRATIONS_FOLDERS_A5.md` ajouté |
| A7 | ✅ Fait | Docs parasites archivées ; `AGENTS.md` corrigé |

---

## Pièges critiques à retenir

- `console.log` : environ 365 occurrences ; F1 est un gros lot, pas un petit nettoyage.
- `routes/parcels.js` et `routes/orders/parcels.js` sont deux fichiers distincts : ne pas supprimer comme doublon.
- Les collisions de migrations SQL ne bloquent pas le boot actuel : le runner actif ne parcourt pas automatiquement les fichiers SQL.
- Tests : filet encore faible — tests manuels/API recommandés après I-SWEEP.
- ✅ `pay-cash` corrigé par I-SWEEP-1.
- ✅ QR verify/parcels corrigé par I-SWEEP-2.
- ✅ Stripe intent idempotent par I-SWEEP-3A.
- ✅ Purchasing replay corrigé par I-SWEEP-3B.
- ✅ Purchasing repair/réception amélioré par I-SWEEP-3C.
- ✅ Collectif `ready_to_capture` : repair admin ajouté par I-SWEEP-4A.
- ✅ Collectif réservations stock : repair admin ajouté par I-SWEEP-4B.
- ✅ Annulation ↔ purchase_orders : synchronisation ajoutée par I-SWEEP-5A.
- 🟠 Collectif restant : transition `ordered` collective post-commit reste non fatale ; à couvrir par test/alerte si nécessaire.
- 🔴 Refund/annulation G4 : aucun flux refund Stripe explicite trouvé pour commandes classiques ; `cancelled` ne garantit pas remboursement externe. Cash refund/wallet et `cancelled` vs `refunded` restent à formaliser.
- 🟠 Sourcing/catalogue G5 : prix/stock manuels hors pricing-engine, price_history incomplet, stock movement log absent.

---

## Prochain lot recommandé

### I-SWEEP-5B — Doctrine refund : Stripe / cash / cancelled vs refunded

```text
Branche   : fix/backend-I-SWEEP-5B-refund-doctrine
Charge    : 1-2 jours
Risque    : élevé — touche remboursement externe et doctrine financière
Prérequis : I-SWEEP-5A terminé
```

Objectif : formaliser et exposer un flux sécurisé de remboursement : Stripe avec idempotency key, cash en traitement manuel/avoir wallet, et différence claire entre `cancelled` métier et `refunded` financier.

---

## File d'attente après I-SWEEP-5B

| Lot | Priorité | Note |
|-----|----------|------|
| I-SWEEP-6 | Moyenne/haute | Pricing/catalogue publication hardening |
| TEST-1 | 🔴 Stratégique | Tests d'intégration invariants + flows G1-G5 |
| REFUND-1 | 🔴 Critique si non inclus I-SWEEP | Remboursement Stripe/cash/wallet et doctrine `cancelled` vs `refunded` |
| PRICE-1 | Haute | Durcissement pricing/catalogue |
| A4 | Prudence | Collisions migrations 060/061 |
| F1 | Haute mais gros lot | Logger structuré |
| H1 | Stratégique lourd | Refacto `server.js` |
| H3 | Moyenne | Déplacer audit backend arch vers `scripts/` |

---

## Règle de fin de session

Avant de terminer une session avec commit ou PR : mettre à jour ce fichier, vérifier le prochain lot, et vérifier `AGENTS.md` si un document socle bouge.
