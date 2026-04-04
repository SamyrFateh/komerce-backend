# 🧪 ROADMAP TEST — Validation avant passage en Production

> **Version** : 1.0 · Avril 2026
> **Objectif** : Valider chaque aspect de Komerce avant le go-live
> **Méthode** : Test API automatisé + vérification manuelle + audit comptable

---

## 📋 Pré-requis

| Élément | Commande | Statut |
|---------|---------|--------|
| Backend déployé sur Railway | `railway up` | ⬜ |
| Variables d'env configurées | JWT_SECRET, DATABASE_URL | ⬜ |
| Seed initial exécuté | schema.sql + seed.sql | ⬜ |
| Admin connecté | admin@komerce.km / Komerce2026! | ⬜ |

---

## 🔄 Phase 1 — Tests API (simule le frontend)

> Script : `test_e2e_full.sh` — Phase 1

| # | Test | Endpoint | Résultat attendu | ✅/❌ |
|---|------|----------|-------------------|-------|
| 1.1 | Health check | `GET /api/products` | HTTP 200 | ⬜ |
| 1.2 | Register client | `POST /api/auth/register` | JWT + user object | ⬜ |
| 1.3 | Login admin | `POST /api/auth/login` | JWT admin | ⬜ |
| 1.4 | Catalogue produits | `GET /api/products` | ≥4 produits, prix KMF | ⬜ |
| 1.5 | Points relais | `GET /api/relais` | ≥1 relais actif | ⬜ |
| 1.6 | Créer commande | `POST /api/orders` | Référence KOM-xxxx, total correct | ⬜ |
| 1.7 | Mes commandes | `GET /api/orders` | Client voit sa commande | ⬜ |
| 1.8 | Changer statut | `PATCH /api/orders/:id/status` | Transition confirmed → paid | ⬜ |
| 1.9 | Statut invalide | `PATCH` avec transition illégale | HTTP 422 + message clair | ⬜ |
| 1.10 | Register doublon | `POST /api/auth/register` même email | HTTP 409 | ⬜ |

---

## 📊 Phase 2 — Seed données historiques

> Script : `test_e2e_full.sh` — Phase 2
> Endpoint : `POST /api/admin/seed-test`

| # | Vérification | Détail | ✅/❌ |
|---|-------------|--------|-------|
| 2.1 | Compteurs avant | `GET /api/admin/counts` | ⬜ |
| 2.2 | Seed 28 commandes | 5 clients × ~6 commandes sur 3 mois | ⬜ |
| 2.3 | Distribution statuts | collected(5), available(4), transit(4), prep(4), early(8), cancelled(1) | ⬜ |
| 2.4 | Clients test | Amina, Youssouf, Mariama, Hassan, Zainaba — mdp: Test123! | ⬜ |
| 2.5 | Mix paiements | stripe_eur (18) + cash_relais (10) | ⬜ |
| 2.6 | Coûts réels | cost_real_kmf renseigné sur commandes shipped+ | ⬜ |
| 2.7 | Transport + douane | Montants réalistes (5K–18K KMF) | ⬜ |

---

## 📈 Phase 3 — Validation dashboards

> Script : `test_e2e_full.sh` — Phase 3

### 3A. Dashboard Ops (Komerce_Admin.html)

| # | Métrique | Calcul attendu | ✅/❌ |
|---|---------|----------------|-------|
| 3.1 | Total commandes | = nombre réel en base | ⬜ |
| 3.2 | Pipeline logistique | Répartition par statut correcte | ⬜ |
| 3.3 | SLA livraison | % commandes livrées dans les temps | ⬜ |
| 3.4 | Alertes cash | Commandes cash_relais en attente paiement | ⬜ |

### 3B. Dashboard Sales (Komerce_Admin.html)

| # | Métrique | Calcul attendu | ✅/❌ |
|---|---------|----------------|-------|
| 3.5 | CA total KMF | = SUM(total_kmf) des commandes non-annulées | ⬜ |
| 3.6 | CA en EUR | = CA_KMF / 492 | ⬜ |
| 3.7 | Marge brute % | = (CA - coûts) / CA × 100 | ⬜ |
| 3.8 | Top produits | Classement par nombre de ventes | ⬜ |
| 3.9 | Répartition catégories | Camembert cohérent avec les produits vendus | ⬜ |
| 3.10 | Tendance 30j | Graphe montrant l'activité des 30 derniers jours | ⬜ |

### 3C. Finance (export)

| # | Métrique | Calcul attendu | ✅/❌ |
|---|---------|----------------|-------|
| 3.11 | Summary accessible | `GET /api/finance/summary` retourne objet | ⬜ |
| 3.12 | Export CSV | `GET /api/finance/export/csv` génère fichier | ⬜ |
| 3.13 | Export PDF | `GET /api/finance/export/pdf` génère fichier | ⬜ |
| 3.14 | Cohérence CA | Finance.CA = Dashboard.CA | ⬜ |

### 3D. Pilotage (Komerce_Pilotage.html)

| # | Métrique | Calcul attendu | ✅/❌ |
|---|---------|----------------|-------|
| 3.15 | CDR (Coût de revient) | Somme transport + douane / commande | ⬜ |
| 3.16 | Douane 42% | Vérification taux douane comorien | ⬜ |
| 3.17 | Marge brute | (prix vente - coût achat) / prix vente | ⬜ |
| 3.18 | Marge nette | Marge brute - transport - douane | ⬜ |
| 3.19 | Top clients | Classement par CA dépensé | ⬜ |
| 3.20 | Récurrence | Clients avec >1 commande identifiés | ⬜ |

### 3E. Hub (Komerce_Hub.html)

| # | Métrique | Calcul attendu | ✅/❌ |
|---|---------|----------------|-------|
| 3.21 | Colis en préparation | Commandes status=preparation | ⬜ |
| 3.22 | Groupage en cours | Commandes status=hub_preparation | ⬜ |
| 3.23 | Colis expédiés | Commandes status=shipped | ⬜ |

### 3F. Relais (Komerce_Relais.html)

| # | Métrique | Calcul attendu | ✅/❌ |
|---|---------|----------------|-------|
| 3.24 | Colis disponibles | Commandes status=available pour ce relais | ⬜ |
| 3.25 | Colis collectés | Commandes status=collected | ⬜ |
| 3.26 | Stats par relais | Répartition correcte par point relais | ⬜ |

---

## 🧮 Phase 4 — Audit comptable croisé

> Vérifications manuelles — calculatrice + SQL

| # | Vérification | Méthode | ✅/❌ |
|---|-------------|---------|-------|
| 4.1 | CA = Σ total_kmf | `SELECT SUM(total_kmf) FROM orders WHERE status != 'cancelled'` | ⬜ |
| 4.2 | Marge estimée cohérente | `AVG(margin_estimated_pct)` entre 20-50% | ⬜ |
| 4.3 | Marge réelle < estimée | Normal : coûts réels souvent > estimés | ⬜ |
| 4.4 | Transport proportionnel au poids | Commandes lourdes → transport plus élevé | ⬜ |
| 4.5 | Douane ≈ 20-42% de la valeur AED | Cohérent avec les taux comoriens | ⬜ |
| 4.6 | Aucune marge < -50% | Pas d'aberration comptable | ⬜ |
| 4.7 | Stripe vs Cash cohérent | Mix réaliste entre les deux modes | ⬜ |
| 4.8 | EUR = KMF / 492 | Conversion correcte partout | ⬜ |

---

## 🧹 Phase 5 — Reset & cleanup

| # | Action | Commande | ✅/❌ |
|---|--------|---------|-------|
| 5.1 | Compteurs avant reset | Panel Admin → Reset données | ⬜ |
| 5.2 | Reset mode "orders" | Nettoie commandes, garde users | ⬜ |
| 5.3 | Vérifier comptes admin intacts | Login admin toujours OK | ⬜ |
| 5.4 | Reset mode "factory" | Tout reset + re-seed | ⬜ |
| 5.5 | Re-seed test | `POST /api/admin/seed-test` fonctionne après factory | ⬜ |

---

## 🚀 Phase 6 — Checklist Go-Live

| # | Élément | Responsable | ✅/❌ |
|---|---------|------------|-------|
| 6.1 | Tous les tests Phase 1 passent | Dev | ⬜ |
| 6.2 | Dashboards affichent des données réalistes | Product | ⬜ |
| 6.3 | Audit comptable validé (Phase 4) | Finance | ⬜ |
| 6.4 | Reset factory exécuté en Prod | Ops | ⬜ |
| 6.5 | Mot de passe admin changé | Admin | ⬜ |
| 6.6 | JWT_SECRET unique en Prod | Ops | ⬜ |
| 6.7 | HTTPS activé | Ops | ⬜ |
| 6.8 | Domaine configuré | Ops | ⬜ |
| 6.9 | Monitoring / logs activés | Ops | ⬜ |
| 6.10 | Backup DB programmé | Ops | ⬜ |

---

## 📝 Notes

- **Clients test** : Mot de passe `Test123!` pour les 5 comptes
- **Commandes test** : Préfixe `KT` (vs `K` pour les vraies)
- **Reset test** : Mode `orders` nettoie les commandes test sans toucher aux comptes
- **Idempotent** : Le seed peut être relancé plusieurs fois (ON CONFLICT sur les users)

---

## ✍️ Sign-off

| Rôle | Nom | Date | Signature |
|------|-----|------|-----------|
| Développeur | | | |
| Product Owner | | | |
| Finance | | | |
| Ops | | | |
