# 🔍 KOMERCE BOUTIQUE — Audit Frontend Complet

**Date :** 4 avril 2026  
**Fichiers analysés :**
- `Komerce_Boutique.html` (HTML + inline JS, ~2037 lignes)
- `komerce-api.js` (API client externe, ~2800 lignes)
- `routes-products.js` (Backend routes produits)
- `routes-orders.js` (Backend routes commandes)
- `routes-auth.js` (Backend routes auth)

---

## 🔴 Bugs CRITIQUES (empêchent le fonctionnement)

### BUG-C1 : `openCart()` non définie — le bouton panier ne fonctionne pas

**Description :** Le bouton panier dans la navbar appelle `openCart()` via `onclick`, mais cette fonction n'est **jamais définie** dans le script inline du HTML. Seule `openCartWithHighlight(productId)` existe (ligne 1470). Cliquer sur le panier provoque un `ReferenceError: openCart is not defined`.

**Fichier :** `Komerce_Boutique.html`  
**Ligne :** 771 (HTML) — la fonction manque dans le `<script>` inline

**Code problématique :**
```html
<!-- Ligne 771 -->
<button class="cart-btn" onclick="openCart()" aria-label="Ouvrir le panier">
```

**Correction proposée :**  
Ajouter la fonction `openCart()` dans le script inline (après `closeCart`, vers ligne 1495) :
```javascript
function openCart() {
  renderCartBody();
  $('cart-header-title').textContent = 'Mon Panier (' + cartQty() + ')';
  $('cart-overlay').classList.add('open');
  $('cart-drawer').classList.add('open');
  document.body.style.overflow = 'hidden';
}
```

---

### BUG-C2 : `saveCart()` non définie — le panier ne persiste pas et crash

**Description :** La fonction `saveCart()` est appelée à 3 endroits (ajout au panier, suppression, commande confirmée) mais n'est **jamais définie**. Résultat : `ReferenceError` à chaque ajout au panier. Le panier ne se sauvegarde jamais en `localStorage`.

**Fichier :** `Komerce_Boutique.html`  
**Lignes d'appel :** 1451 (addToCart), 1465 (removeFromCart), 1905 (submitOrder)

**Code problématique :**
```javascript
// Ligne 1451 dans addToCart()
saveCart(); // ← ReferenceError: saveCart is not defined

// Ligne 1465 dans removeFromCart()
saveCart();

// Ligne 1905 dans submitOrder()
saveCart();
```

**Correction proposée :**  
Ajouter la fonction `saveCart()` dans le script inline (avant `addToCart`, vers ligne 1442) :
```javascript
function saveCart() {
  try {
    localStorage.setItem('kmrc_cart', JSON.stringify(_cart));
  } catch (e) {
    console.warn('saveCart: localStorage indisponible', e);
  }
  refreshCartBadge();
}
```

---

### BUG-C3 : `refreshCartBadge()` non définie — le badge panier ne se met pas à jour

**Description :** Appelée dans `DOMContentLoaded` (ligne 2017), cette fonction n'existe pas dans le script inline. L'initialisation de la page échoue partiellement (les instructions suivantes dans l'init ne s'exécutent pas si l'erreur n'est pas rattrapée). Le badge `#cart-count` ne montre jamais le nombre d'articles.

**Fichier :** `Komerce_Boutique.html`  
**Ligne d'appel :** 2017

**Code problématique :**
```javascript
// Ligne 2017 dans DOMContentLoaded
refreshCartBadge(); // ← ReferenceError
```

**Correction proposée :**  
Ajouter la fonction `refreshCartBadge()` dans le script inline (avant `addToCart`) :
```javascript
function refreshCartBadge() {
  var badge = $('cart-count');
  if (!badge) return;
  var count = cartQty();
  badge.textContent = count;
  if (count > 0) {
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}
```

---

### BUG-C4 : `setQty()` non définie — impossible de modifier la quantité dans le panier

**Description :** Les boutons +/− de quantité dans le drawer panier appellent `setQty(id, qty)` mais cette fonction n'est pas définie. Modifier la quantité d'un article dans le panier crashe.

**Fichier :** `Komerce_Boutique.html`  
**Lignes d'appel :** 1570, 1583 (dans `renderCartBody`)

**Code problématique :**
```javascript
// Ligne 1570
minusBtn.addEventListener('click', function() { setQty(id, q - 1); });
// Ligne 1583
plusBtn.addEventListener('click', function() { setQty(id, q + 1); });
```

**Correction proposée :**  
Ajouter la fonction `setQty()` dans le script inline (après `removeFromCart`, vers ligne 1467) :
```javascript
function setQty(productId, newQty) {
  if (newQty < 1) {
    removeFromCart(productId);
    return;
  }
  var item = _cart.find(function(i) { return i.product.id === productId; });
  if (item) {
    item.qty = newQty;
    saveCart();
    renderCartBody();
  }
}
```

---

### BUG-C5 : `/api/auth/auto-register` protégé par clé interne — commande impossible

**Description :** Le flux de commande (ligne 1887) appelle `apiPost('/api/auth/auto-register', {...})` pour créer/authentifier le client. Mais côté backend, cette route est protégée par le middleware `requireInternalKey` qui exige un header `X-Internal-Key` (routes-auth.js ligne 262). Le frontend ne l'envoie JAMAIS. Résultat : **toute tentative de commande échoue avec erreur 401** "Clé interne invalide ou absente".

**Fichier :** `Komerce_Boutique.html` ligne 1887 ↔ `routes-auth.js` ligne 250-262

**Code problématique (frontend) :**
```javascript
// Ligne 1887-1892 — submitOrder()
await apiPost('/api/auth/auto-register', {
  full_name: _orderData.full_name,
  phone: _orderData.phone,
  email: _orderData.email || undefined,
  country: _orderData.country
});
// ↑ Aucun header X-Internal-Key envoyé !
```

**Code backend (routes-auth.js) :**
```javascript
// Ligne 250-258
function requireInternalKey(req, res, next) {
  const provided = req.headers['x-internal-key'];
  if (!provided || provided !== INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Clé interne invalide ou absente' });
  }
  next();
}
// Ligne 262
router.post('/auto-register', requireInternalKey, async (req, res) => { ... });
```

**Correction proposée :**  
**Option A (recommandée)** : Créer une nouvelle route publique `/api/auth/guest-checkout` qui crée ou retrouve un utilisateur et définit un cookie httpOnly JWT avec un scope limité. Cette route ne doit PAS être protégée par `requireInternalKey` mais par un rate-limit IP :

```javascript
// routes-auth.js — ajouter après /auto-register
router.post('/guest-checkout', guestCheckoutRateLimit, async (req, res) => {
  // Même logique que auto-register mais accessible publiquement
  // avec rate-limit strict (5 req/15min par IP)
  const { full_name, phone, email, country = 'KM' } = req.body;
  if (!phone) return res.status(400).json({ error: 'Téléphone obligatoire' });
  // ... (logique identique à auto-register)
});
```

Et côté frontend :
```javascript
// Ligne 1887 — remplacer '/api/auth/auto-register' par:
await apiPost('/api/auth/guest-checkout', { ... });
```

**Option B (rapide mais moins sécurisée)** : Retirer `requireInternalKey` de la route auto-register et la remplacer par un rate-limit applicatif.

---

### BUG-C6 : `payment_mode: 'card'` rejeté par le backend — paiement carte impossible

**Description :** Le frontend propose `'card'` comme mode de paiement (ligne 1851) mais le backend n'accepte que `'stripe_eur'` ou `'cash_relais'` (routes-orders.js ligne 207). Toute commande par carte sera rejetée avec erreur 400.

**Fichier :** `Komerce_Boutique.html` ligne 1851 ↔ `routes-orders.js` ligne 207

**Code problématique (frontend) :**
```javascript
// Ligne 1849-1852
var modes = [
  { v: 'cash_relais', t: '🏪 Paiement au relais' },
  { v: 'card', t: '💳 Carte bancaire' }       // ← 'card' au lieu de 'stripe_eur'
];
```

**Code backend (routes-orders.js) :**
```javascript
// Ligne 207-208
if (!['stripe_eur', 'cash_relais'].includes(payment_mode)) {
  return res.status(400).json({ error: 'payment_mode invalide — valeurs : stripe_eur | cash_relais' });
}
```

**Correction proposée :**
```javascript
// Ligne 1849-1852 — remplacer 'card' par 'stripe_eur'
var modes = [
  { v: 'cash_relais', t: '🏪 Paiement au relais' },
  { v: 'stripe_eur', t: '💳 Carte bancaire (€)' }
];
```

---

### BUG-C7 : Route `/api/relais` inexistante — liste des points relais vide

**Description :** Le frontend appelle `apiGet('/api/relais')` (ligne 1617) pour charger la liste des points relais. Mais cette route n'existe PAS dans le backend. La seule route relais est `GET /api/orders/relais` (routes-orders.js ligne 535) qui nécessite une authentification avec rôle `admin` ou `agent_relais`. Résultat : le dropdown de choix du point relais à l'étape 2 du checkout est **toujours vide**.

**Fichier :** `Komerce_Boutique.html` ligne 1617 ↔ Aucune route backend correspondante

**Code problématique (frontend) :**
```javascript
// Ligne 1615-1623
async function loadRelais() {
  try {
    var data = await apiGet('/api/relais');  // ← 404 Not Found
    _relais = data.relais || data || [];
  } catch (e) {
    console.error('loadRelais:', e);
    _relais = [];
  }
}
```

**Correction proposée :**  
**Backend :** Ajouter une route publique GET `/api/relais` qui retourne les relais actifs (données non sensibles) :

```javascript
// Nouveau fichier routes-relais.js ou dans routes-orders.js
router.get('/public-relais', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, city, zone, address, phone, hours FROM relais WHERE is_active = TRUE ORDER BY zone, name'
    );
    res.json({ relais: rows });
  } catch (err) {
    res.status(500).json({ error: 'Erreur chargement relais' });
  }
});
```

Et monter cette route en tant que `app.use('/api/relais', relaisRouter)` ou corriger le frontend pour pointer vers la bonne URL.

**Frontend alternative :**
```javascript
var data = await apiGet('/api/orders/public-relais');
```

---

## 🟡 Bugs IMPORTANTS (dégradent l'UX)

### BUG-I1 : Mapping des statuts de suivi incorrect — timeline tracking cassée

**Description :** Le frontend définit 7 étapes de suivi (lignes 1952-1960) avec des clés qui ne correspondent PAS aux statuts du backend. Le suivi ne montre jamais correctement la progression.

**Fichier :** `Komerce_Boutique.html` lignes 1952-1960

**Statuts frontend vs backend :**

| Frontend (`TRACKING_STEPS`) | Backend (réels) | Match ? |
|---|---|---|
| `ordered` | `confirmed` | ❌ |
| `purchasing` | `purchasing` | ✅ |
| `preparation` | `preparation` | ✅ |
| `shipped` | `shipped` | ✅ |
| `transit` | `transit_comores` | ❌ |
| `available` | `available` | ✅ |
| `delivered` | `collected` | ❌ |

**Statuts backend manquants dans le frontend :** `draft`, `paid`, `cancelled`, `refunded`

**Code problématique :**
```javascript
// Lignes 1952-1960
var TRACKING_STEPS = [
  { key: 'ordered', label: 'Commande reçue', icon: '📋' },       // ← devrait être 'confirmed'
  { key: 'purchasing', label: 'Achat en cours', icon: '🛒' },
  { key: 'preparation', label: 'Préparation', icon: '📦' },
  { key: 'shipped', label: 'Expédié', icon: '✈️' },
  { key: 'transit', label: 'En transit', icon: '🚚' },            // ← devrait être 'transit_comores'
  { key: 'available', label: 'Disponible au relais', icon: '🏪' },
  { key: 'delivered', label: 'Livré', icon: '✅' }                // ← devrait être 'collected'
];
```

**Correction proposée :**
```javascript
var TRACKING_STEPS = [
  { key: 'confirmed', label: 'Commande confirmée', icon: '📋' },
  { key: 'paid', label: 'Paiement reçu', icon: '💳' },
  { key: 'purchasing', label: 'Achat en cours', icon: '🛒' },
  { key: 'preparation', label: 'Préparation', icon: '📦' },
  { key: 'shipped', label: 'Expédié', icon: '✈️' },
  { key: 'transit_comores', label: 'Arrivé aux Comores', icon: '🚚' },
  { key: 'available', label: 'Disponible au relais', icon: '🏪' },
  { key: 'collected', label: 'Remis au client', icon: '✅' }
];
```

Ajouter aussi la gestion des statuts `cancelled` et `refunded` dans le rendu de la timeline.

---

### BUG-I2 : `komerce-api.js` jamais chargé — fonctionnalités avancées inaccessibles

**Description :** Le fichier `komerce-api.js` (127KB, ~2800 lignes) contient de nombreuses fonctionnalités avancées : panier partagé (K-XXXX), module cérémonie (3 types de commande), favoris avec tracking de prix, bannière utilisateur récurrent, bouton WhatsApp, lookup commande par téléphone. Ce fichier n'est **jamais référencé** via `<script src>` dans le HTML. Toutes ces fonctionnalités sont donc **inaccessibles**.

**Fichier :** `Komerce_Boutique.html` — aucun `<script src="komerce-api.js">` trouvé

**Code problématique :**
```html
<!-- Le seul script est inline, à la ligne 964 -->
<script>
/* ── State ── */
let _cart = JSON.parse(localStorage.getItem('kmrc_cart') || '[]');
...
</script>
<!-- Fin du HTML à la ligne 2037 — PAS de <script src="komerce-api.js"> -->
```

**Correction proposée :**  
⚠️ **Attention : on ne peut PAS simplement ajouter `<script src="komerce-api.js">`** car les deux fichiers définissent les mêmes fonctions (`apiGet`, `apiPost`, `toast`, `loadProducts`, `checkoutCart`, etc.) avec des implémentations différentes. Il y aurait des conflits de noms de variables (`_cart` déclaré avec `let` dans les deux).

**Deux stratégies possibles :**

1. **Fusionner** : Intégrer les fonctionnalités manquantes de `komerce-api.js` dans le script inline du HTML (favoris, cérémonie, panier partagé, etc.)
2. **Remplacer** : Supprimer le script inline et charger uniquement `komerce-api.js`, après avoir vérifié qu'il cible les bons éléments DOM du HTML.

La **stratégie 2** est risquée car `komerce-api.js` référence des éléments DOM différents (ex: `tracking-ref-input` au lieu de `tracking-input`, `promo-carousel`/`promo-grid` au lieu de `product-track`, etc.).

---

### BUG-I3 : `product_id` potentiellement numérique vs validation string côté backend

**Description :** Le backend valide `typeof item.product_id !== 'string'` (routes-orders.js ligne 264). Si la base de données retourne des IDs UUID (string), c'est OK. Mais si les IDs sont numériques (integer), le frontend les enverrait comme `number` dans le JSON, et le backend rejetterait la commande.

**Fichier :** `Komerce_Boutique.html` ligne 1893-1895 ↔ `routes-orders.js` ligne 264

**Code problématique :**
```javascript
// Ligne 1893-1895 — submitOrder
var items = _cart.map(function(i) {
  return { product_id: i.product.id, quantity: i.qty, confection_type: 'aucun' };
  //                   ^^^^^^^^^^^^^ Si c'est un number, rejeté par le backend
});
```

**Correction proposée :**
```javascript
var items = _cart.map(function(i) {
  return { product_id: String(i.product.id), quantity: i.qty, confection_type: 'aucun' };
});
```

---

### BUG-I4 : Réponse tracking minimale sans authentification

**Description :** La route publique `GET /api/orders/:ref` sans authentification ne retourne que `{ reference, status, created_at }` (routes-orders.js lignes 1016-1021). Le frontend essaie d'afficher `order.reference` (OK) et de mapper `order.status` (OK), mais aucune info sur les articles, le relais, ou le total n'est disponible.

**Fichier :** `routes-orders.js` lignes 1016-1021

**Impact :** La page de suivi fonctionne mais affiche un minimum d'informations.

**Correction proposée (backend) :**  
Enrichir la réponse publique avec des données non sensibles :
```javascript
if (!req.user) {
  return res.json({
    reference: order.reference,
    status: order.status,
    created_at: order.created_at,
    // Ajouter des infos non sensibles utiles pour le suivi
    items: items.map(i => ({ product_name: i.product_name, quantity: i.quantity, emoji: i.emoji })),
    relais: order.relais_name ? { name: order.relais_name, zone: order.relais_zone } : null,
  });
}
```

---

### BUG-I5 : Champ `sizes` absent de la réponse produits — sélecteur de taille jamais affiché

**Description :** Le frontend vérifie `p.sizes && p.sizes.length` (ligne 1326) dans le modal produit pour afficher un sélecteur de taille. Mais le backend ne retourne PAS de champ `sizes` dans la requête GET `/api/products` (routes-products.js lignes 59-88). Le sélecteur de taille ne s'affiche **jamais**.

**Fichier :** `Komerce_Boutique.html` ligne 1326 ↔ `routes-products.js` lignes 59-88

**Code problématique :**
```javascript
// Ligne 1326-1341 — le sélecteur de taille
if (p.sizes && p.sizes.length) {  // ← p.sizes est toujours undefined
  // ... sélecteur de taille jamais rendu
}
```

**Correction proposée :**  
**Option A (backend)** : Ajouter un champ `sizes` à la table `products` et l'inclure dans le SELECT.

**Option B (frontend)** : Inférer les tailles par catégorie :
```javascript
var defaultSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
var productSizes = p.sizes || (p.has_couture ? defaultSizes : []);
if (productSizes.length) {
  // ... afficher le sélecteur
}
```

---

## 🟢 Améliorations suggérées

### IMP-1 : URL API en dur vs relative — risque de 404 selon l'hébergement

**Description :** Le script inline utilise des URL relatives (`/api/products`, `/api/orders`, etc.) qui ne fonctionnent que si le HTML est servi par le même serveur que l'API. Le fichier `komerce-api.js` (non chargé) définit `KOMERCE_API = 'https://komerce-backend-production.up.railway.app'` comme URL absolue.

Si le HTML est hébergé séparément (Netlify, Vercel, S3, etc.), toutes les requêtes API renvoient 404.

**Correction proposée :**  
Ajouter une constante configurable en tête du script :
```javascript
var API_BASE = window.KOMERCE_CONFIG?.api_url || '';
// Puis dans apiGet/apiPost :
async function apiGet(path) {
  var res = await fetch(API_BASE + path, { credentials: 'include' });
  // ...
}
```

---

### IMP-2 : Pas de gestion des statuts `cancelled` et `refunded` dans le tracking

**Description :** Le suivi ne gère que la progression linéaire. Si une commande est annulée (`cancelled`) ou remboursée (`refunded`), le statut n'apparaît nulle part dans la timeline.

**Correction proposée :**  
Après le rendu de la timeline, ajouter un badge conditionnel :
```javascript
if (['cancelled', 'refunded'].includes(currentStatus)) {
  var statusBadge = document.createElement('div');
  statusBadge.style.cssText = 'background:#fef2f2;color:#dc2626;padding:12px;border-radius:8px;text-align:center;font-weight:700;margin-top:16px;';
  statusBadge.textContent = currentStatus === 'cancelled' ? '❌ Commande annulée' : '💰 Commande remboursée';
  result.appendChild(statusBadge);
}
```

---

### IMP-3 : CORS potentiel si frontend et backend sont sur des domaines différents

**Description :** Le frontend utilise `credentials: 'include'` dans les fetch (lignes 1008, 1017). C'est correct pour les cookies httpOnly cross-origin, mais le backend devra avoir configuré :
```javascript
cors({
  origin: 'https://komerce.km',  // ou l'URL du frontend
  credentials: true
})
```

Et le cookie `sameSite: 'Strict'` (routes-auth.js ligne 49) **bloquera** les requêtes cross-origin. Il faudrait `sameSite: 'None'` + `secure: true` si frontend ≠ backend origin.

---

### IMP-4 : Le `flyToCart` ne s'exécute jamais dans `addToCart`

**Description :** La fonction `flyToCart()` (ligne 1055) est définie mais n'est jamais appelée dans `addToCart()` (ligne 1443). L'animation de particule volant vers le panier ne se déclenche pas.

**Correction proposée :**  
Dans `addToCart`, ajouter l'appel :
```javascript
function addToCart(product, qty, btn) {
  qty = qty || 1;
  // ... (existing code)
  
  /* Animation fly-to-cart */
  if (btn) {
    flyToCart(btn, product);
    var orig = btn.textContent;
    btnAddedFeedback(btn, orig);
  }
  // ...
}
```

---

### IMP-5 : Pas de CDN externe (Tailwind/DaisyUI) — ce n'est pas un problème

**Description :** Le HTML utilise un CSS personnalisé pur (variables CSS, pas de framework). Aucun Tailwind/DaisyUI n'est chargé ni nécessaire. Le fichier `komerce-api.js` non chargé utilise du inline style dans ses composants dynamiques.

✅ Pas de bug ici — le CSS est autonome et bien structuré.

---

## 📋 Récapitulatif

| # | Sévérité | Bug | Impact |
|---|---|---|---|
| C1 | 🔴 CRITIQUE | `openCart()` non définie | Bouton panier cassé |
| C2 | 🔴 CRITIQUE | `saveCart()` non définie | Ajout panier crash |
| C3 | 🔴 CRITIQUE | `refreshCartBadge()` non définie | Init page crash |
| C4 | 🔴 CRITIQUE | `setQty()` non définie | Modification quantité crash |
| C5 | 🔴 CRITIQUE | auto-register protégé par clé interne | Commande impossible |
| C6 | 🔴 CRITIQUE | `payment_mode: 'card'` vs `'stripe_eur'` | Paiement carte rejeté |
| C7 | 🔴 CRITIQUE | Route `/api/relais` inexistante | Dropdown relais vide |
| I1 | 🟡 IMPORTANT | Statuts tracking incorrects | Timeline fausse |
| I2 | 🟡 IMPORTANT | `komerce-api.js` jamais chargé | Fonctionnalités avancées manquantes |
| I3 | 🟡 IMPORTANT | `product_id` type mismatch | Commande potentiellement rejetée |
| I4 | 🟡 IMPORTANT | Tracking response minimale | Infos insuffisantes au suivi |
| I5 | 🟡 IMPORTANT | `sizes` absent de l'API | Sélecteur taille invisible |

**Verdict : La boutique est non-fonctionnelle en l'état.** Les 7 bugs critiques empêchent le fonctionnement de base : le panier crash, les commandes sont impossibles, et le checkout est bloqué côté serveur.
