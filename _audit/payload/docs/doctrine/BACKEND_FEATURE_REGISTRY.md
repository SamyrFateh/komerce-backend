# Registre Canonique des Features Backend — Komerce

> **Version** : 1.0 — 2026-06
> **Statut** : registre actif — gouverné par `docs/doctrine/FEATURE_DOCTRINE.md`
> **Construit à partir de** : headers `@komerce-arch` réels (`@domain`) sur `services/`,
> `routes/`, `middleware/`, `utils/`, `validators/`, `core/`. Pas de feature inventée.
> **Vérifié par** : `node scripts/feature-registry-check.js`

---

## Comment lire ce registre

Chaque ligne = une feature ou un domaine transversal (voir distinction dans
`FEATURE_DOCTRINE.md`). Le manifest associé contient le détail (périmètre exact,
interfaces, autorité, invariants). Ce registre est l'index — pas le détail.

| # | Feature | Type | Manifest | Statut | Service rendu (résumé) |
|---:|---|---|---|---|---|
| 1 | `shared-cart` | feature | [`shared-cart.feature.js`](../../features/shared-cart.feature.js) | production | Panier partagé multi-participants, de la création au règlement |
| 2 | `orders` | feature | [`orders.feature.js`](../../features/orders.feature.js) | production | Commande : création, statut, coût, rattachement colis/achats |
| 3 | `payments` | feature | [`payments.feature.js`](../../features/payments.feature.js) | production | Encaissement (Stripe, PayPal, cash) et confirmation de paiement |
| 4 | `wallet-loyalty` | feature | [`wallet-loyalty.feature.js`](../../features/wallet-loyalty.feature.js) | production | Solde client (wallet) et programme de fidélité |
| 5 | `logistics` | feature | [`logistics.feature.js`](../../features/logistics.feature.js) | production | Colis : scan, transit, tracking, relais, transporteurs |
| 6 | `economic-engine` | feature | [`economic-engine.feature.js`](../../features/economic-engine.feature.js) | production | Pricing, coûts, marges, stratégies tarifaires |
| 7 | `catalog` | feature | [`catalog.feature.js`](../../features/catalog.feature.js) | production | Produits, connecteurs fournisseurs, publication boutique |
| 8 | `customs` | feature | [`customs.feature.js`](../../features/customs.feature.js) | production | Classification douanière, déclaration, analytics douane |
| 9 | `notification` | feature | [`notification.feature.js`](../../features/notification.feature.js) | production | Alertes et messages sortants (WhatsApp, notifications internes) |
| 10 | `documents` | feature | [`documents.feature.js`](../../features/documents.feature.js) | production | Génération de documents (preuve retrait, facture douane, reçu) |
| 11 | `recommendations` | feature | [`recommendations.feature.js`](../../features/recommendations.feature.js) | staging | Classement et suggestions boutique |
| 12 | `inventory` | feature | [`inventory.feature.js`](../../features/inventory.feature.js) | staging | Suivi de stock |
| 13 | `refunds` | feature | [`refunds.feature.js`](../../features/refunds.feature.js) | production | Remboursement transverse (wallet, cash, panier partagé) |
| 14 | `dashboard` | feature | [`dashboard.feature.js`](../../features/dashboard.feature.js) | production | Tableaux de bord et back-office (admin, hub, relais, finance) |
| 15 | `auth` | transversal | [`auth.feature.js`](../../features/auth.feature.js) | production | Authentification, OTP, identité vérifiée — consommé par toutes les features |
| 16 | `operations` | transversal | [`operations.feature.js`](../../features/operations.feature.js) | production | Santé applicative, config, modules — infrastructure d'exploitation |

---

## Lecture rapide des interfaces inter-features

```
            ┌───────────────┐
            │ auth │  (transversal — consommé par tout le reste)
            └───────┬───────┘
                     │
   ┌─────────────────┼──────────────────────────────────────┐
   ▼                 ▼                                      ▼
catalog ──► shared-cart ──► orders ──► payments      economic-engine
              │                │           │           (pricing pour
              │                │           ▼            catalog, orders,
              ▼                ▼       refunds          shared-cart)
        wallet     logistics       │
              │                │           ▼
              └──────► refunds ◄───── documents (génère les preuves
                          │                       pour orders, refunds,
                          ▼                       customs)
                    notifications (émission, consommée par toutes)
                          │
                    customs (déclaration, consommée par logistics,
                              dashboard)
                          │
                    dashboard (lecture agrégée de toutes les features
                              ci-dessus — n'écrit jamais dans leur domaine)
```

Règle de lecture du schéma : une flèche `A ──► B` signifie *A consomme un service de B*,
jamais l'inverse. `dashboard` est en lecture seule sur tout le reste — voir son manifest
pour l'invariant explicite.

---

## Fichiers actuellement sans feature déclarée (dette connue)

`scripts/feature-registry-check.js --orphans` liste en continu les fichiers de
`services/`, `routes/`, `middleware/`, `utils/`, `validators/`, `core/` non couverts par
un manifest. Au moment de la rédaction de ce registre, les familles suivantes restent à
cartographier précisément (rattachées provisoirement par approximation de nommage, à
corriger au fil de l'eau plutôt qu'en bloquant ce registre) :

- fichiers historiques sans header `@komerce-arch` du tout (`@domain unknown`, 35 fichiers
  au moment de la rédaction) — chacun doit recevoir un header daté avant ou pendant son
  prochain changement, puis rejoindre le manifest de la feature correspondante ;
- sous-domaines `purchasing` / `sourcing` mentionnés dans les doctrines produit mais pas
  encore portés par un `@domain` dédié — actuellement répartis entre `orders` et
  `dashboard` (ex. `purchasing-admin-service.js`). À scinder en feature `purchasing`
  propre dès que son périmètre métier sera tranché.

Cette section n'est pas un satisfecit : c'est la liste de ce que le registre ne couvre
**pas encore**, à traiter explicitement plutôt qu'à laisser invisible.

---

## Règle de mise à jour

Toute feature nouvelle, fusionnée, scindée ou dépréciée met à jour ce tableau et son
manifest dans la même PR. `feature-registry-check.js --strict` échoue si un manifest
référence un fichier absent du disque — il ne détecte pas (encore) l'inverse de manière
automatique pour tous les répertoires ; la liste de dette ci-dessus reste donc à jour
manuellement jusqu'à ce que tous les `@domain unknown` soient résorbés.
