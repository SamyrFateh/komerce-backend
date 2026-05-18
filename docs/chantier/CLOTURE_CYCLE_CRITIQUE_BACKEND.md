# Clôture — Cycle critique backend Komerce

> Date : 2026-05-18  
> Branche de référence : `main`  
> Objet : clôture du cycle audits D/G → corrections I-SWEEP → premiers tests

---

## Verdict

Le cycle critique backend est clôturé.

Les corrections métier à fort risque issues des audits D/G et des flows G1-G5 ont été appliquées, mergées et documentées dans `docs/chantier/STATUS.md`.

Ce document ne signifie pas que tout le backend est définitivement fini. Il signifie que le périmètre critique identifié pour sécuriser les invariants métier principaux est traité.

---

## Périmètre terminé

### Socle et audits

- Socle documentaire consolidé : `CARTOGRAPHY_360.md`, `ZONE_IMPACT.md`, `SCHEMA.md`, `CONTRACTS.md`.
- Audits D1 à D8 documentés.
- Audits flows G1 à G5 documentés.
- Roadmap et `STATUS.md` synchronisés.

### Corrections I-SWEEP

| Lot | Résultat |
|-----|----------|
| I-SWEEP-1 | `pay-cash` passe par `confirmPaymentCycle(...)` et ne modifie plus directement `orders.status`. |
| I-SWEEP-2 | `verify-qr` synchronise order, scan et parcels dans une transaction. |
| I-SWEEP-3A | PaymentIntent Stripe idempotent par commande. |
| I-SWEEP-3B | `triggerPurchasing` protégé contre les doublons de POs. |
| I-SWEEP-3C | Repair ordered sans PO + réception PO transactionnelle. |
| I-SWEEP-4A | Repair collectif `ready_to_capture`. |
| I-SWEEP-4B | Repair réservations stock collectives. |
| I-SWEEP-5A | Annulation commande synchronisée avec `purchase_orders`. |
| I-SWEEP-5B | Refund admin explicite ; séparation `cancelled` métier / `refunded` financier. |
| I-SWEEP-6A | Audit `price_history` sur création/update catalogue. |
| I-SWEEP-6B | `apply-price/apply-all` audités avec survival server-side. |
| I-SWEEP-6C | Garde publication catalogue + audit stock minimal. |

### Tests ajoutés

| Lot | Résultat |
|-----|----------|
| TEST-1A | Filet Jest statique + tests helpers sans DB réelle. |
| TEST-1B | Tests transactionnels avec mocks DB : cash pickup et réception PO. |

---

## Invariants protégés

Les corrections renforcent directement les invariants suivants :

- I-01 : `orders.status` passe par la machine de statut.
- I-02 : les paiements aboutissent à `pending → confirmed` par le cycle prévu.
- I-03 : transitions scan/système forward-only et idempotentes.
- I-04 : historique de statut conservé via `order_status_history`.
- I-05 : wallet traité par opérations de crédit/débit/contrepassation.
- I-06 : annulation restaure stock et wallet appliqué, avec synchronisation purchase orders.
- I-07 : webhooks Stripe préservés via body brut avant `express.json`.
- I-08 : pricing renforcé par survival server-side et audit prix.
- I-09 : parcels synchronisés dans les flows critiques.
- I-10 : retrait, QR et preuves de collecte renforcés.

---

## Backlog non bloquant

Ces lots restent utiles mais ne font plus partie du feu critique traité ici :

| Lot | Nature |
|-----|--------|
| PRICE-1 | Ajustements pricing/catalogue éventuels après tests/staging. |
| A4 | Collisions migrations 060/061 à revoir prudemment. |
| F1 | Logger structuré pour remplacer progressivement les `console.log`. |
| H1 | Refactor lourd de `server.js`. |
| H3 | Déplacement d'audits/scripts backend arch vers `scripts/`. |

---

## Recommandation de reprise

Avant de relancer un gros chantier :

1. exécuter la suite Jest ;
2. vérifier le boot Railway ;
3. tester manuellement quelques flows sensibles en staging :
   - cash pickup ;
   - QR verify ;
   - Stripe intent + webhook ;
   - trigger purchasing + réception PO ;
   - annulation + refund admin ;
   - apply-price/apply-all ;
   - publication produit avec stock/prix.

Ensuite seulement, reprendre PRICE-1 ou F1/H1 selon priorité produit.
