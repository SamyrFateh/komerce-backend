# 🛒 Roadmap : Boutique Live + Dashboards Temps Réel

## Objectif
Câbler la Boutique pour que les commandes arrivent en DB → les dashboards se mettent à jour en live.

## Repo : SamyrFateh/komerce-backend (branche main)

## Étapes (1 commit par étape)

### ✅ Étape 0 — Portail + Auth Guards
- `portal.html` créé
- Auth guards sur 8 dashboards
- Boutique reste publique
- **Commit** : `f40b41b`

### ✅ Étape 1 — Seed produits + relais dans server.js
- Ajouter `seedProducts()` dans server.js (20 produits Comores)
- Ajouter `seedRelais()` dans server.js (5 relais : Moroni, Mutsamudu, Fomboni, Domoni, Sima)
- Les seeds s'exécutent au démarrage (INSERT IF NOT EXISTS)
- **Routes concernées** : GET /api/products, GET /api/relais
- **Commit** : `7894ad2`
- **Fix colonnes** : `4482bd2` (price_kmf, price_eur, emoji, badge, is_active corrigés)
- **Status** : ✅ Fait

### ✅ Étape 2 — Boutique : charger vrais produits depuis l'API
- Remplacer `USE_DEMO = true` → `false`
- Fixer `loadProducts()` pour appeler `GET /api/products`
- Mapper les champs API (id, name, price, category, image_url, stock) vers le HTML existant
- Garder les images démo en fallback si `image_url` est null
- **Commit** : `18f592b`
- **Status** : ✅ Fait

### ✅ Étape 3 — Boutique : charger vrais relais + checkout réel
- Charger les relais depuis `GET /api/relais` dans le formulaire checkout
- Ajouter mini-login/register sur la Boutique (modal avant checkout)
- Fixer `submitCheckout()` pour envoyer le bon payload à `POST /api/orders` :
  ```json
  {
    "items": [{"product_id": 1, "quantity": 2, "unit_price": 5000}],
    "relais_id": 1,
    "payment_mode": "cash_relais",
    "recipient_name": "Nom client",
    "recipient_phone": "0321234567",
    "delivery_address": "Moroni centre"
  }
  ```
- Token JWT envoyé via header Authorization
- **Commit** : `18f592b`
- **Status** : ✅ Fait

### ✅ Étape 4 — Auto-refresh dashboards (15s)
- Ajouter `setInterval` sur les dashboards clés :
  - Komerce_Admin.html → refresh `loadOps()`, `loadSales()`
  - Komerce_Pilotage.html → refresh stats
  - Komerce_Hub.html → refresh colis
  - Komerce_Relais.html → refresh livraisons
- Indicateur visuel "🔴 LIVE" en haut à droite
- **Commit** : `b6c09c9`
- **Status** : ✅ Fait

### ✅ Étape 5 — Tests end-to-end + Handover v9.1
- Tester : créer commande Boutique → voir chiffres bouger sur Pilotage
- Mettre à jour HANDOVER_MASTER_FINAL.md → v9.1
- Script test_e2e.sh ajouté au repo
- **Status** : ✅ Fait

## Données de référence

### Produits Comores (20)
Catégories : épices, cosmétiques, artisanat, alimentation, textile
- Vanille bourbon (15000 KMF), Girofle (8000), Ylang-ylang huile (12000)
- Cannelle (5000), Poivre noir (6000), Curcuma (4000)
- Savon ylang (3000), Huile coco (2500), Beurre karité (4500)
- Panier tressé (7000), Chapeau kofia (5000), Natte (10000)
- Café Comores (6000), Miel (8000), Sel marin (2000)
- Tshirt Komerce (5000), Sac jute (3500), Chiromani (15000)
- Bracelet coco (2000), Tableau bois (9000)

### Relais (5)
1. Relais Moroni (Moroni centre, Grande Comore)
2. Relais Mutsamudu (Mutsamudu, Anjouan)
3. Relais Fomboni (Fomboni, Mohéli)
4. Relais Domoni (Domoni, Anjouan)
5. Relais Sima (Sima, Anjouan)

### Schéma orders (routes/orders.js)
```sql
orders: id, ref, user_id, relais_id, status, payment_mode, 
        recipient_name, recipient_phone, delivery_address,
        total_amount, created_at
order_items: id, order_id, product_id, quantity, unit_price
```

### Auth (routes/auth.js)
- POST /api/auth/register → {name, email, password, phone, address}
- POST /api/auth/login → {email, password} → {token, user}
- Admin : admin@komerce.km / Komerce2026!
