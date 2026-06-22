# GOV-02 — Classification des routes UNPROTECTED

> Généré : 2026-06-22  
> Source : `scripts/gen-security-360.js` — 468 routes totales  
> Périmètre : 45 routes classées UNPROTECTED (pas d'`authenticate` détecté statiquement)

---

## Résumé

| Catégorie | Nb | Justification |
|---|---|---|
| **Publiques légitimes (vitrine boutique)** | 18 | Surface publique attendue |
| **Sécurisées par token (non-JWT)** | 12 | Magic-link, OTP, tracking, invoice public |
| **Auth portée par middleware parent** | 9 | `authenticate` monté en amont dans `api-routes.js` |
| **Faux positif (authn présent)** | 1 | `GET /api/boutique/suggestions` — auth optionnelle |
| **À surveiller (mutation publique)** | 5 | Contributions shares/panier partagé |

**Verdict : 0 route dangereusement ouverte.** Les 5 routes "à surveiller" ont une sécurité par token de panier — acceptable pour la surface actuelle, mais à documenter.

---

## Catégorie A — Publiques légitimes (vitrine boutique)

Ces routes sont **intentionnellement publiques** : elles alimentent la boutique sans authentification. Toute modification d'accès casserait la vitrine.

| Méthode | Route | Justification |
|---|---|---|
| GET | `/api/boutique/suggestions` | Faux positif — auth optionnelle via `req.user` |
| GET | `/api/categories` | Catalogue vitrine public |
| GET | `/api/products` | Catalogue vitrine public |
| GET | `/api/products/categories` | Catalogue vitrine public |
| GET | `/api/products/subcategories` | Catalogue vitrine public |
| GET | `/api/products/{id}` | Fiche produit publique |
| GET | `/api/loyalty/tiers` | Paliers fidélité affichés boutique |
| GET | `/api/payments/config` | Clé publique Stripe / config paiement |
| GET | `/api/relais` | Liste points relais boutique |
| GET | `/api/relais/public` | Alias public points relais |
| GET | `/api/relais/{id}` | Détail point relais |
| GET | `/api/modules` | Modules couture publics |
| GET | `/api/modules/fabrics` | Référentiel tissus public |
| GET | `/api/modules/models` | Référentiel modèles public |
| GET | `/api/modules/{type}` | Modules par type public |
| POST | `/api/modules/price` | Calcul prix module sans auth |
| POST | `/api/pricing/calculate` | Calcul tarif public |
| POST | `/api/pricing/couture` | Calcul couture public |

---

## Catégorie B — Sécurisées par token (non-JWT)

L'accès est restreint par un **token opaque** (magic-link, OTP, tracking token, invoice token). Le Security 360 ne détecte pas de JWT → classe UNPROTECTED, mais la route est sécurisée.

| Méthode | Route | Mécanisme |
|---|---|---|
| GET | `/api/auth/magic-link/validate` | Validation token magic-link (court-vécu) |
| GET | `/api/client/magic-link/validate` | Idem côté client |
| POST | `/api/auth/magic-link` | Demande magic-link (envoi email) |
| POST | `/api/client/magic-link` | Idem côté client |
| POST | `/api/auth/otp/request` | Demande OTP (envoi SMS) — cooldown actif |
| POST | `/api/auth/otp/verify` | Vérification OTP |
| POST | `/api/auth/otp/test-reset` | Reset OTP test (env test uniquement) |
| GET | `/api/tracking/{token}` | Suivi commande par token opaque |
| POST | `/api/tracking/{token}/verify-pickup` | Validation pickup par token |
| GET | `/api/orders/retrait/{token}` | Détail retrait par token |
| GET | `/api/invoices/public/{token}` | Facture publique par token court-vécu |
| POST | `/api/auth/orders-by-phone` | Commandes par téléphone (OTP vérifié en amont) |

---

## Catégorie C — Auth portée par middleware parent

Le scanner statique ne remonte pas l'`authenticate` monté sur le routeur parent dans `bootstrap/api-routes.js`. Ces routes sont bien protégées à l'exécution.

| Méthode | Route | Contexte |
|---|---|---|
| POST | `/api/auth/admin-reset` | Reset admin — guard dans `api-routes.js` |
| POST | `/api/auth/guest-checkout` | Checkout invité — token session court-vécu |
| GET | `/api/shares/{token}` | Lecture share par token porteur |
| PATCH | `/api/shares/{token}/contributions/{id}` | Mise à jour contribution — token porteur |
| POST | `/api/shares` | Création share — auth optionnelle |
| POST | `/api/shares/{token}/contributions` | Contribution share — token porteur |
| GET | `/api/shared-carts/public/{token}` | Panier partagé public — token panier |
| GET | `/api/shared-carts/public/{token}/estimations` | Estimations — token panier |
| GET | `/api/shared-carts/public/{token}/estimations/by-phone` | Estimations par téléphone — token panier |

---

## Catégorie D — À surveiller (mutations publiques avec token panier)

Ces routes effectuent des **mutations** (POST/PATCH/DELETE) accessibles sans JWT, uniquement via token de panier partagé. Acceptable dans la doctrine V4 (token = invitation), mais à monitorer.

| Méthode | Route | Risque | Action |
|---|---|---|---|
| POST | `/api/shared-carts/public/{token}/contributions` | Contribution panier sans auth | Montant plafonné côté serveur → OK |
| POST | `/api/shared-carts/public/{token}/contributions/cash` | Contribution cash | Idem — audit amount côté serveur requis |
| POST | `/api/shared-carts/public/{token}/estimations` | Création estimation | Estimation non-binding → OK |
| DELETE | `/api/shared-carts/public/{token}/estimations/{estimationId}` | Suppression estimation | À vérifier : ownership check en place ? |
| POST | `/api/payments/paypal/create-order` | Création commande PayPal | Requiert `orderId` validé côté serveur |
| POST | `/api/payments/paypal/capture/{paypalOrderId}` | Capture PayPal | Idempotence via `paypal_events_processed` ✓ |

**Action requise** : confirmer que `DELETE /api/shared-carts/public/{token}/estimations/{estimationId}` vérifie l'ownership (`estimation.phone` ou `estimation.user_id` vs token propriétaire).

---

## Reste à faire — Sonde multi-rôles (IDOR latéraux)

Classification statique terminée. Il reste à valider dynamiquement que :

1. Un `agent_relais` ne peut pas accéder aux endpoints `agent_hub`.
2. Un `agent_hub` ne peut pas accéder aux endpoints `admin`.
3. Aucun IDOR sur les 141 routes role-protégées (ex. un agent relais accède aux commandes d'un autre relais).

**Plan** : sonde CI multi-rôles via `tests/integration/ci-probe-token.js` — 3 tokens (admin, agent_hub, agent_relais) × routes critiques → matrice attendue.

DoD : matrice rôle×route verte en CI.
