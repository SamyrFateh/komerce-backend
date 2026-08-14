# tests/e2e/authenticated/

Tests E2E nécessitant une **vraie session** (compte de test dédié + `storageState`).

## Setup

`tests/e2e/auth.setup.js` s'exécute une fois (projet `setup`), authentifie un
compte de test via OTP et sauvegarde la session dans `playwright/.auth/user.json`.
Le projet `authenticated` injecte ce `storageState` dans chaque test.

```bash
# Variables requises
TEST_ACCOUNT_PHONE=3211234    # 7 chiffres locaux, sans +269
TEST_ACCOUNT_OTP=123456       # OTP fixe du compte de test (staging)
BASE_URL=https://staging.komerce.co/boutique/
```

## Tests par domaine

### Commandes (orders)

| Fichier | ID | Flags requis | Description |
|---------|----|----|-------------|
| `order-flow.spec.js` | F01 | — | Commande cash : catalogue → panier → checkout → payload vérifié |
| `order-confirmation.spec.js` | F04p | `ALLOW_ORDER_SUBMIT` | Écran confirmation : référence, code cash, suivi pré-rempli |
| `order-history.spec.js` | F06 | — | Historique chrono, statut initial, dernier = actuel |
| `stock-after-order.spec.js` | F07 | `ALLOW_ORDER_SUBMIT` | Stock décrémenté exactement de la qty commandée |
| `tracking-public.spec.js` | F31 | — | Détail par référence sans session + UI recherche |

### Wallet & Fidélité

| Fichier | ID | Flags requis | Description |
|---------|----|----|-------------|
| `wallet-flow.spec.js` | F10 | — | Solde wallet cohérent UI ↔ API |
| `wallet-payment.spec.js` | F02 | `ALLOW_ORDER_SUBMIT` | Commande wallet 100% → paid immédiat |
| `cancel-refund.spec.js` | F03 | `ALLOW_ORDER_CANCEL` | Annulation → wallet re-crédité |
| `wallet-lifecycle.spec.js` | F02→F03→F11 | `ALLOW_ORDER_SUBMIT` + `ALLOW_ORDER_CANCEL` | Cycle complet : débit → crédit → solde restauré |
| `loyalty-tier.spec.js` | F12p | — | Paliers fidélité + cohérence orders_count |

### Panier partagé (groupe)

| Fichier | ID | Flags requis | Description |
|---------|----|----|-------------|
| `group-flow.spec.js` | F20 | `ALLOW_GROUP_FLOW` | Création panier partagé |
| `group-full-cycle.spec.js` | F21 | `ALLOW_GROUP_FLOW` | Créateur + participant (2 contextes) |

### Documents

| Fichier | ID | Flags requis | Description |
|---------|----|----|-------------|
| `invoice-public.spec.js` | F05 | — | Facture privée dans Mon Komerce ; PDF avec session, refus sans session (nom de fichier legacy) |

### Admin

| Fichier | ID | Flags requis | Description |
|---------|----|----|-------------|
| `admin-status-transition.spec.js` | F30 | `ALLOW_STATUS_CHANGE` | PATCH status → API + historique |

### Contrats & Robustesse

| Fichier | Description |
|---------|-------------|
| `api-contracts.spec.js` | Payloads frontend vs schéma backend Joi |
| `business-resilience.spec.js` | Double clic, réseau coupé, wallet 0, panier vide, même numéro |

## Flags de sécurité

Chaque flag empêche une action destructive accidentelle :

| Flag | Protège contre | Tests concernés |
|------|---------------|-----------------|
| `ALLOW_ORDER_SUBMIT` | Soumission de commande réelle | F02, F04p, F07 |
| `ALLOW_ORDER_CANCEL` | Annulation de commande réelle | F03, lifecycle |
| `ALLOW_GROUP_FLOW` | Création de panier partagé réel | F20, F21 |
| `ALLOW_STATUS_CHANGE` | Modification de statut commande | F30 |

Sans flag, le test se **skip proprement** avec un message clair — jamais de crash.

## Ce qu'il ne faut jamais faire ici

- Soumettre contre la production sans `ALLOW_ORDER_SUBMIT`
- Utiliser un compte personnel ou un OTP de production
- Committer `playwright/.auth/*.json`
