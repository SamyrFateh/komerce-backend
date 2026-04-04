# 🎨 Roadmap Sprint UX — Boutique Komerce

> **Version** : 1.0 · Avril 2026  
> **Objectif** : Polir l'UX de la boutique avant go-live — stabilité, feedback panier, accessibilité mobile  
> **Repo** : SamyrFateh/komerce-backend · branche `main`

---

## ✅ Sprint UX — Terminé (4 avril 2026)

### Phase A — Sécurité & Infrastructure

| # | Feature | Commit | Statut |
|---|---------|--------|--------|
| A1 | **BUG-014** : Migration JWT localStorage → httpOnly cookies | `a8934c88` | ✅ |
| A2 | **Helmet CSP** : `unsafe-inline` autorisé pour scripts inline | `a8934c88` | ✅ |
| A3 | **Fallback route** : `Komerce_Web.html` → `Komerce_Boutique.html` (fichier inexistant → 500) | `2fb72fc3` | ✅ |
| A4 | **Cache-Control** : `no-cache, no-store` sur tous les `.html` servis par Express | `2fb72fc3` | ✅ |

### Phase B — Hero & Mise en page

| # | Feature | Commit | Statut |
|---|---------|--------|--------|
| B1 | Hero banner : centrage image, padding responsive mobile | sprint | ✅ |
| B2 | Modal header sticky : `overflow-y` déplacé de `.modal-box` vers `.modal-body` (✕ toujours visible) | `a8934c88` | ✅ |
| B3 | Toast repositionné en bas (z-index < croix modale) | sprint | ✅ |

### Phase C — Feedback Panier

| # | Feature | Commit | Statut |
|---|---------|--------|--------|
| C1 | **Animation fly-to-cart** : produit vole vers l'icône panier au clic | `6c4dc3d` | ✅ |
| C2 | **Drawer Amazon-Komores** : s'ouvre automatiquement à chaque ajout | `a8934c88` | ✅ |
| C3 | Nouvel article surligné en ambre (bordure + badge "✨ Ajouté") | `a8934c88` | ✅ |
| C4 | Header panier flash gold 1.6s au moment de l'ajout | `a8934c88` | ✅ |
| C5 | CTA "← Continuer mes achats" (ferme le drawer) | `a8934c88` | ✅ |
| C6 | CTA "Commander →" (ouvre le modal checkout) | `a8934c88` | ✅ |
| C7 | Toast panier supprimé (remplacé par le drawer) | `a8934c88` | ✅ |
| C8 | Suppression doublon `openCartWithHighlight` (bug JS silencieux) | `2fb72fc3` | ✅ |

---

## ✅ Sprint UX+2 — Terminé (4 avril 2026)

### Priorité HAUTE (bloquant pour go-live)

| # | Feature | Détail | Commit | Statut |
|---|---------|--------|--------|--------|
| D1 | **Images produits** | `middleware/upload.js` (multer) + routes `POST /api/products/:id/image` et `/images` | `9cb89b8` | ✅ |
| D2 | **Email confirmation commande** | `utils/email.js` (nodemailer) + envoi auto après commande | `9cb89b8` | ✅ |
| D3 | **Mot de passe admin** | `fixAdminHash()` lit `ADMIN_PASSWORD` depuis env vars → à configurer sur Railway | `9cb89b8` | ✅ |
| D4 | **JWT_SECRET + Sécurité prod** | `SECURITY_CHECKLIST.md` créé avec toutes les instructions | `9cb89b8` | ✅ |

### Priorité MOYENNE (avant lancement marketing)

| # | Feature | Détail | Effort |
|---|---------|--------|--------|
| E1 | **Filtrage produits** | Filtre par catégorie (épices, cosmétiques, artisanat…) opérationnel | 2h |
| E2 | **Recherche produits** | Barre de recherche par nom | 1h |
| E3 | **Responsive mobile** | Tester et corriger sur iPhone SE / Galaxy A — grille produits, drawer panier, modal checkout | 3h |
| E4 | **Page produit détaillée** | Clic sur un produit → modal avec description longue, ingrédients, origine Comores | 4h |
| E5 | **Stock en temps réel** | Badge "Rupture de stock" si `stock = 0`, désactiver bouton Ajouter | 1h |

### Priorité BASSE (nice to have)

| # | Feature | Détail | Effort |
|---|---------|--------|--------|
| F1 | **Avis produits** | Étoiles + commentaires clients (nécessite table `reviews`) | 6h |
| F2 | **Wishlist** | Bouton "♡ Sauvegarder" (localStorage) | 2h |
| F3 | **Partage produit** | Lien direct vers un produit (#product-42) | 1h |
| F4 | **Mode sombre** | Toggle clair/sombre — DaisyUI natif | 2h |
| F5 | **PWA** | Manifest + Service Worker pour installation mobile | 4h |

---

## 🚀 Phase 6 — Go-Live Checklist (depuis ROADMAP_TEST.md)

| # | Élément | Responsable | Statut |
|---|---------|------------|--------|
| 6.1 | Tous les tests Phase 1 passent | Dev | ⬜ |
| 6.2 | Dashboards affichent données réalistes | Product | ⬜ |
| 6.3 | Audit comptable validé | Finance | ⬜ |
| 6.4 | Reset factory exécuté en Prod | Ops | ⬜ |
| 6.5 | **Mot de passe admin changé** | Admin | ⬜ |
| 6.6 | **JWT_SECRET unique en Prod** | Ops | ⬜ |
| 6.7 | HTTPS activé (Railway : ✅ natif) | Ops | ✅ |
| 6.8 | Domaine configuré (ex: boutique.komerce.km) | Ops | ⬜ |
| 6.9 | Monitoring / logs activés | Ops | ⬜ |
| 6.10 | Backup DB programmé (pg_dump quotidien) | Ops | ⬜ |

---

## 📐 Architecture actuelle (référence)

```
komerce-backend/
├── server.js              # Express + Helmet + rate-limit + no-cache headers
├── middleware/auth.js     # JWT via httpOnly cookies (BUG-014)
├── middleware/upload.js   # Multer — upload images produits (D1)
├── utils/email.js         # Nodemailer — emails confirmation (D2)
├── routes/
│   ├── auth.js            # POST /api/auth/login|register
│   ├── orders.js          # POST /api/orders + PATCH status + SELECT FOR UPDATE
│   ├── admin.js           # Seed, reset, counts
│   ├── dashboard.js       # Stats sales, ops (guards DIV/0)
│   ├── pilotage.js        # CDR, marges, top clients
│   └── finance.js         # Summary, export CSV/PDF
├── db/schema.sql          # 5 index ajoutés (BUG-010)
└── public/
    ├── Komerce_Boutique.html   # 🎯 FICHIER PRINCIPAL — drawer panier ✅
    ├── Komerce_Admin.html      # Dashboard Ops + Sales
    ├── Komerce_Pilotage.html   # Marges, KPIs
    ├── Komerce_Hub.html        # Gestion colis
    ├── Komerce_Relais.html     # Points relais
    └── portal.html             # Portail d'accès
```

---

## 🐛 Bugs connus (tous résolus ✅)

| # | Bug | Résolution | Issue | Statut |
|---|-----|-----------|-------|--------|
| BUG-015 | 7 PRs stale sur GitHub | 6 PRs fermées avec commentaires | [#16](https://github.com/SamyrFateh/komerce-backend/issues/16) | ✅ |
| BUG-016 | Images produits : placeholders gris | Routes upload + middleware multer | [#17](https://github.com/SamyrFateh/komerce-backend/issues/17) | ✅ |
| BUG-017 | Pas d'email de confirmation commande | nodemailer + template HTML | [#18](https://github.com/SamyrFateh/komerce-backend/issues/18) | ✅ |

---

*Mis à jour le 4 avril 2026 — Sprint UX+2 terminé (D1–D4 + BUG-015/016/017) — Tasklet*
