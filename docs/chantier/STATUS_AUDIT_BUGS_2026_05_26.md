# STATUS — Bugs / incohérences issus de l'audit backend 5 passes

> Date : 2026-05-26  
> Source : `AUDIT_BACKEND_INCOHERENCES_2026_05_26.md` + `AUDIT_BACKEND_5_PASSES_2026_05_26.md`  
> Objectif : bloc de synthèse à intégrer dans `docs/chantier/STATUS.md`.

---

## Bugs / incohérences consolidés

### P0 — À corriger en premier

| ID | Sévérité | Bug / incohérence | Zone |
|---|---:|---|---|
| **A-BE-01** | 🔴 Haute | Deux chemins de confirmation financière du panier partagé : ancien `confirmContributionFromStripe()` encore présent alors que le webhook utilise `confirmContributionFromStripeSafely()` | `shared-cart` |
| **A-BE-12** | 🔴 Haute | `wallet.removeFromOrder()` semble non idempotent : une deuxième exécution peut recréditer deux fois le wallet | `wallet-service.js` |
| **A-BE-13** | 🔴 Haute | Une PO déjà reçue peut probablement être annulée : l'annulation vérifie `hub_received`, mais la réception écrit `received` / `partially_received` | `purchasing.js` |
| **A-BE-02** | 🟠 Moyenne/Haute | `CONTRACTS.md` documente `targetStatus`, mais le code réel de `transitionOrderStatus()` utilise `newStatus` | docs + status machine |

### P1 — À corriger avant ouverture large

| ID | Sévérité | Bug / incohérence | Zone |
|---|---:|---|---|
| **A-BE-03** | 🟠 Moyenne | Runtime collectif legacy encore monté dans `server.js` malgré le tombstone : routes/webhook/cron no-op encore présents | legacy collective |
| **A-BE-04** | 🟠 Moyenne | Normalisation téléphone différente entre front et backend : le front accepte `06...` / `3211234`, le backend attend surtout du E.164 | `auth-guest.js` |
| **A-BE-06** | 🟡 Moyenne | `processRefundWithFallback()` est moins robuste que `processRefund()` : il ne crée pas de ligne `refunds.pending` avant l'appel Stripe | refunds |
| **A-BE-07** | 🟡 Moyenne | `CONTRACTS.md` liste encore l'ancien collectif comme service critique actif | docs |
| **A-BE-08** | 🟡 Moyenne | Ancien export public `confirmContributionFromStripe` encore disponible dans `shared-cart-engine.js` | shared-cart |
| **A-BE-11** | 🟠 Moyenne/Haute | Création Stripe `PaymentIntent` non idempotente : plusieurs appels peuvent créer plusieurs PaymentIntents pour la même commande pending | `routes/payments.js` |
| **A-BE-14** | 🟠 Moyenne | Confirmation manuelle d'une PO sans guard clair sur les statuts terminaux/cancelled | `purchasing.js` |
| **A-BE-16** | 🟡 Moyenne | Tests explicites panier partagé / refund queue non retrouvés | tests |
| **A-BE-17** | 🟡 Moyenne | Migrations M1/M2 encore sous forme d'actions manuelles, risque d'oubli au déploiement | migrations |

### P2 — Dette importante mais moins urgente

| ID | Sévérité | Bug / incohérence | Zone |
|---|---:|---|---|
| **A-BE-05** | 🟠 Moyenne | `routes/purchasing.js` reste un gros bloc métier : route HTTP + moteur sourcing + notifications + réception hub + transitions | architecture |
| **A-BE-09** | 🟡 Moyenne | Expiration/annulation panier partagé avec contributions repose sur refund manuel admin | shared-cart refund |
| **A-BE-10** | 🟢 Faible | Logs Pino parfois non structurés : `log.error('msg', err.message)` au lieu de `log.error({ err }, 'msg')` | observabilité |
| **A-BE-15** | 🟠 Moyenne | `verify-qr` met l'ordre en `collected` puis synchronise les colis après commit : risque d'ordre collecté avec colis non synchronisés si crash | scans/parcels |
| **A-BE-18** | 🟡 Moyenne | `relay-dashboard.js` auto-crée des tables au runtime au lieu de passer par migrations versionnées | migrations/runtime |

---

## Ordre de correction recommandé

```txt
1. A-BE-12 — Wallet reversal idempotent
2. A-BE-13 — Purchasing PO reçue annulable
3. A-BE-01 / A-BE-08 — Retirer ancien chemin financier shared-cart
4. A-BE-02 — Aligner transitionOrderStatus contract/code
5. A-BE-11 — Idempotence PaymentIntent Stripe
6. A-BE-03 — Finir tombstone collectif legacy
7. A-BE-04 — Normalisation téléphone backend
8. A-BE-06 — Refund fallback robuste
```

---

## Lecture par domaine

### Argent / paiements

- **A-BE-12** — risque de double recrédit wallet.
- **A-BE-01 / A-BE-08** — ancien chemin financier shared-cart encore exporté.
- **A-BE-06** — fallback refund moins robuste.
- **A-BE-11** — PaymentIntent Stripe non idempotent.

### Logistique / sourcing

- **A-BE-13** — PO reçue potentiellement annulable.
- **A-BE-14** — confirmation PO sans guard terminal.
- **A-BE-15** — ordre collecté avant sync colis post-commit.

### Architecture / docs

- **A-BE-02** — drift `targetStatus` vs `newStatus`.
- **A-BE-03** — runtime collectif legacy encore monté.
- **A-BE-05** — `purchasing.js` encore trop monolithique.
- **A-BE-07** — contrats docs encore orientés ancien collectif.
- **A-BE-18** — auto-création de tables au runtime.

### Tests / déploiement

- **A-BE-16** — manque de tests shared-cart/refund queue.
- **A-BE-17** — actions migrations manuelles à sécuriser.

---

## Verdict

Le backend n'est pas cassé, mais les corrections suivantes sont prioritaires avant ouverture large :

```txt
1. Wallet idempotence
2. Purchasing PO guards
3. Nettoyage surface financière shared-cart
4. Alignement contrats machine de statut
```
