# TEST_CHECKLIST_KOMERCE.md
> Version 1.0 — Mai 2026  
> À exécuter avant chaque merge sur `main` et chaque déploiement Railway.

---

## 0. Prérequis

- [ ] Variables d'environnement Railway présentes : `DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `META_WA_APP_SECRET`, `JWT_SECRET`, `FOUNDER_SECRET`
- [ ] Migration `migrate.js` passée sans erreur (`node migrate.js` en local ou Railway deploy log)
- [ ] `GET /healthz` → `200 OK`

---

## 1. Authentification

| # | Test | Résultat attendu |
|---|------|-----------------|
| 1.1 | `POST /api/auth/register` avec email valide | 201 + token JWT |
| 1.2 | `POST /api/auth/login` avec mauvais mot de passe | 401 |
| 1.3 | `POST /api/client-auth/send-otp` (numéro WhatsApp) | OTP reçu sur WhatsApp |
| 1.4 | `POST /api/client-auth/verify-otp` avec bon code | token client retourné |
| 1.5 | Accès route admin sans token | 401 |
| 1.6 | Accès route admin avec token client | 403 |

---

## 2. Catalogue & Catégories (LOT 10)

| # | Test | Résultat attendu |
|---|------|-----------------|
| 2.1 | `GET /api/categories` | JSON avec 8 catégories + subcategories |
| 2.2 | `GET /api/categories` (2e appel < 5 min) | Réponse identique (cache hit, log `[categories] cache hit`) |
| 2.3 | API down → boutique chargée | Fallback hardcodé actif, rail visible |
| 2.4 | Admin `/admin/categories` → liste catégories | 8 lignes affichées |
| 2.5 | Admin → créer catégorie → reload | Nouvelle catégorie visible |
| 2.6 | Admin → modifier label catégorie | Modifié en DB, rail boutique mis à jour au prochain chargement |
| 2.7 | Admin → supprimer catégorie (sans produits liés) | Supprimée |
| 2.8 | Boutique → click catégorie rail | Grille filtrée |
| 2.9 | Boutique → pager subcat | Sous-catégories paginées correctement |

---

## 3. Commande Stripe (paiement en ligne)

| # | Test | Résultat attendu |
|---|------|-----------------|
| 3.1 | `POST /api/orders` avec produits valides | Commande créée, `status=pending` |
| 3.2 | Stripe webhook `payment_intent.succeeded` | `order-payment-confirmation.js` appelé, stock décrémenté, `status=confirmed`, `confirmed_at` renseigné |
| 3.3 | Stripe webhook rejoué (même `payment_intent_id`) | Idempotence : aucun double traitement |
| 3.4 | Paiement échoué (`payment_intent.payment_failed`) | `status` reste `pending`, aucun stock touché |
| 3.5 | Commande `pending` > 30 min sans paiement | Auto-annulation par cron, stock restauré |

---

## 4. Commande Cash / Relay

| # | Test | Résultat attendu |
|---|------|-----------------|
| 4.1 | `POST /api/orders` avec `payment_mode=cash` | Commande créée, `status=pending` |
| 4.2 | Reminder J+1 (SMS) | SMS envoyé au client |
| 4.3 | Reminder J+3 (SMS) | SMS envoyé |
| 4.4 | Cash non payé > 7 jours | Auto-annulation, stock restauré |
| 4.5 | `POST /api/cash/confirm/:orderId` | `status=confirmed`, `confirmed_at` renseigné |

---

## 5. Machine à états commande (LOT 3)

| # | Test | Résultat attendu |
|---|------|-----------------|
| 5.1 | Transition valide (`confirmed` → `processing`) | Acceptée |
| 5.2 | Transition invalide (`pending` → `delivered`) | 400 + message d'erreur |
| 5.3 | Transition par rôle non autorisé | 403 |
| 5.4 | `GET /api/orders/:id/history` | Log de toutes les transitions |

---

## 6. Panier partagé (LOT 4)

| # | Test | Résultat attendu |
|---|------|-----------------|
| 6.1 | Créer workspace collectif | `collective_workspace` créé |
| 6.2 | Partager lien → autre utilisateur rejoint | Panier partagé visible |
| 6.3 | Paiement groupe (`pending_group_payment`) | Statut machine accepte la transition |
| 6.4 | Tous membres payés | Commande passe en `confirmed` |
| 6.5 | Membre abandonne → commande groupe | Comportement documenté (pas de blocage silencieux) |

---

## 7. Parcels & Scans (LOT 7)

| # | Test | Résultat attendu |
|---|------|-----------------|
| 7.1 | Créer colis lié à une commande `confirmed` | Colis créé |
| 7.2 | Scanner colis (`POST /api/parcels/:id/scan`) | Scan enregistré, statut commande avancé si règle atteinte |
| 7.3 | Scan hors séquence | 400 ou log d'avertissement, pas de corruption |
| 7.4 | `GET /api/parcels/:id/scans` | Historique complet |
| 7.5 | Notification WhatsApp au scan | Message envoyé via Meta API |

---

## 8. Wallet

| # | Test | Résultat attendu |
|---|------|-----------------|
| 8.1 | `GET /api/wallet` (client authentifié) | Solde retourné |
| 8.2 | Crédit wallet après remboursement | Solde mis à jour |
| 8.3 | Utilisation wallet sur commande | Montant déduit, différentiel Stripe correct |

---

## 9. Sécurité (LOT 6)

| # | Test | Résultat attendu |
|---|------|-----------------|
| 9.1 | Webhook Meta sans signature `X-Hub-Signature-256` | 401 rejeté |
| 9.2 | Webhook Meta avec mauvaise signature | 401 rejeté |
| 9.3 | `GET /api/transit-dashboard` sans token admin | 401 |
| 9.4 | Données sensibles dans réponse API client (`/api/orders/:id`) | Aucun `password_hash`, `stripe_secret`, `otp_code` exposé |

---

## 10. Desktop UI (LOT 11)

| # | Test | Résultat attendu |
|---|------|-----------------|
| 10.1 | Viewport ≥ 900px → sidebar visible | Sidebar catégories à gauche, grille à droite |
| 10.2 | Click item sidebar | Grille filtrée, chip rail synchronisé |
| 10.3 | Click chip rail | Sidebar active synchronisée |
| 10.4 | Viewport < 900px | Layout mobile inchangé (0 régression) |
| 10.5 | Modal produit desktop | Image gauche + détails droite + thumbnails verticaux |
| 10.6 | Ajout panier depuis modal desktop | Panier mis à jour, badge header incrémenté |

---

## 11. Migrations & DB (LOT 5)

| # | Test | Résultat attendu |
|---|------|-----------------|
| 11.1 | `SELECT key FROM boutique_categories ORDER BY display_order` | 8 lignes |
| 11.2 | `SELECT column_name FROM information_schema.columns WHERE table_name='orders'` | `pending_at`, `confirmed_at` présents |
| 11.3 | `SELECT enumlabel FROM pg_enum` | ENUMs `order_status`, `payment_mode`, `payment_status` présents |
| 11.4 | `node scripts/fix-schema.js` | Exit 0, aucune colonne manquante signalée |

---

## 12. Non-régression globale

| # | Test | Résultat attendu |
|---|------|-----------------|
| 12.1 | `GET /` (boutique) | Page chargée, hero visible |
| 12.2 | `GET /admin` | Dashboard admin chargé |
| 12.3 | `GET /transit` | Dashboard transit chargé |
| 12.4 | Service Worker enregistré (DevTools > Application) | 1 seul SW, pas de doublon |
| 12.5 | Scroll mobile fluide | Pas de rebond, pager fonctionnel |
| 12.6 | `parcelSync-v2.js` non importé | `grep -r "parcelSync-v2" server.js routes/` → 0 résultat |

---

## Dead code à supprimer (post-validation)

- [ ] `utils/parcelSync-v2.js` — jamais importé (confirmé LOT 0)

---

*Généré automatiquement — LOT 12 Komerce*
