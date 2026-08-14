# Inventaire E2E — Flux business réels partant d'une commande boutique

Construit à partir du registry `features/*.feature.js` (backend), pas d'une
liste inventée : chaque ligne correspond à un `perimeter.in` réel d'une
feature qui consomme ou est déclenchée par `orders`. Convention de nommage
alignée sur l'existant (`F01`, `F10`, `F20` déjà écrits) — dizaine = domaine.

Statuts : ✅ fait · 🟡 à écrire (pas de blocage connu) · 🔴 bloqué (prérequis
listé) · ⚪ hors périmètre E2E boutique (couvert ailleurs ou pas de surface UI).

## 0x — `orders` + `payments` + `refunds` (cycle de vie de la commande)

| ID | Scénario | Départ frontend | Vérif backend | Statut |
|---|---|---|---|---|
| F01 | Commande cash complète : catalogue → panier → checkout → persistée | `POST /api/orders` (payment_mode=cash_relais) | `GET /api/orders/:ref` | ✅ fait |
| F02 | Commande payée 100% wallet : `use_wallet=true`, solde couvre le total → `payment_status='paid'` immédiat | idem F01 + toggle wallet en checkout | `GET /api/orders/:ref` → `payment_status: paid` | 🔴 le compte de test doit avoir un solde wallet ≥ total panier en staging |
| F03 | Annulation avec remboursement : commande F02 (`paid`) → `POST /:id/cancel` → wallet crédité | bouton annulation (si exposé en boutique) ou API directe | `verifyWalletBalance` avant/après | 🔴 dépend de F02 pour avoir une commande `paid` |
| F04 | Retrait QR : commande jusqu'au statut `collected` via `GET /api/orders/retrait/:token` | page "Mes commandes" → QR affiché | statut final `collected` | 🔴 nécessite un acteur relais/hub pour scanner le QR (pas d'UI client pour ça) |
| F05 | Facture privée téléchargeable dans Mon Komerce | bloc « Mes documents » sous le wallet | `GET /api/auth/me/documents` puis téléchargement PDF authentifié ; même URL refusée sans session | ✅ fait |
| F06 | Historique commande reflète bien chaque transition | page suivi commande | `GET /api/orders/:id/history` | 🟡 |
| F07 | Stock décrémenté après commande | `GET /api/products/:id` avant/après F01 | delta stock == qty commandée | 🟡 — `products.stock` est exposé publiquement (`in_stock` filter), pas besoin d'auth admin |
| F08 | Commande carte Stripe → webhook confirme `payment_status=paid` | checkout, chip "Carte" | webhook serveur-à-serveur, pas de requête navigateur directe | 🔴 hors portée d'un test Playwright pur navigateur — nécessite Stripe test mode + déclenchement webhook côté service (à faire côté backend, pas boutique) |

## 1x — `wallet-loyalty`

| ID | Scénario | Départ frontend | Vérif backend | Statut |
|---|---|---|---|---|
| F10 | Solde wallet cohérent UI ↔ API | onglet wallet | `GET /api/wallet` | ✅ fait |
| F11 | Wallet crédité après remboursement | = le volet wallet de F03 | `verifyWalletBalance` | 🔴 même blocage que F03 |
| F12 | Palier fidélité déclenché sur paiement wallet intégral gros panier (hook `LOY-01`, `total_kmf===0` après crédit) | F02 avec panier ≥ seuil fidélité | `loyalty-service` — pas de lecture publique connue, à vérifier | 🔴 solde test + seuil fidélité à connaître (règle métier, pas dans le code frontend) |

## 2x — `shared-cart` (panier partagé / groupe)

| ID | Scénario | Départ frontend | Vérif backend | Statut |
|---|---|---|---|---|
| F20 | Création panier partagé (créateur) | bouton "Partager" | `GET /api/shared-carts/public/:token` | ✅ fait |
| F21 | Cycle complet : créateur crée → 2e contexte participant rejoint/contribue → clôture → statut final | 2 `browser.newContext()` Playwright | `verifySharedCart` avant/après chaque étape | 🟡 pas de blocage identifié |
| F22 | Panier groupe créé **à partir d'une commande déjà passée** ("Payer en groupe" post-checkout, `POST /api/shared-carts/from-order`, commande → `pending_group_payment`) | à confirmer | `GET /api/orders/:ref` → `status: pending_group_payment` | 🔴 aucun point d'entrée UI trouvé dans le source boutique (`js/*.js`, hors bundles minifiés) — le code backend le mentionne comme "LOT 4". À confirmer si c'est branché côté frontend ou encore en attente |

## 3x — `logistics`

| ID | Scénario | Départ frontend | Vérif backend | Statut |
|---|---|---|---|---|
| F30 | Transition statut admin (`PATCH /:id/status`) → page tracking boutique reflète le nouveau statut | commande F01 + PATCH admin + reload page tracking | comparaison statut API vs texte affiché | 🔴 nécessite un 2e compte de test avec rôle `admin`/`agent_hub`/`agent_relais` + son propre `storageState` |
| F31 | Page tracking publique par référence, sans session | recherche par référence (onglet suivi) | `GET /api/tracking/:token` | 🟡 |

## 4x — `documents`

| ID | Scénario | Départ frontend | Vérif backend | Statut |
|---|---|---|---|---|
| F40 | Reçu de remboursement généré après annulation payée | = sous-produit de F03 | visible via `GET /api/auth/me/documents`, jamais public | 🔴 dépend de F03 |

## Hors périmètre E2E boutique

- **`notifications`** — SMS/WhatsApp sortants déclenchés par la création de commande : aucune surface cliente vérifiable autrement qu'un toast déjà couvert par les tests UI existants (`E*.spec.js`). Le contenu réel du message est déjà testé côté backend (`notification-service` unit tests).
- **`customs`** — déclaration douanière : action admin pure, aucun déclenchement ni lecture côté boutique client.
- **`economic-engine`** — pricing/marge : déjà vérifié indirectement dans F01 (`total_kmf` comparé au payload), pas de flux séparé côté client.

## Ordre recommandé (sans blocage → avec blocage croissant)

1. **F21** (panier groupe complet) — aucun prérequis
2. **F07** (stock décrémenté) — aucun prérequis, rapide
3. **F05 / F06 / F31** (facture privée / historique / tracking public) — lecture seule, aucun prérequis
4. **F02** — dès que le solde wallet test est confirmé disponible en staging
5. **F03 / F11 / F40** — enchaînés après F02
6. **F30** — dès qu'un compte de test admin/agent est décidé et provisionné
7. **F12** — dès que le seuil fidélité est connu
8. **F22** — après confirmation que "Payer en groupe" est bien branché côté UI
9. **F04, F08** — nécessitent un acteur externe (agent relais / Stripe test mode) hors portée d'un test Playwright pur boutique ; à traiter côté backend ou via un second harnais dédié
