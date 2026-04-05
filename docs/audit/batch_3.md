# Audit Dashboard — Lot 3

> **Fichiers audités** : Komerce_Simulateur.html, Komerce_Tests.html, Komerce_Web.html
> **Date** : 05/04/2026
> **Contexte** : Plateforme e-commerce/logistique Comores — interfaces client et outils internes

---

## Komerce_Simulateur.html (140 KB)

**Rôle** : Simulateur de tarification v17 — calcul de coûts d'expédition, douanes, marges. Interface admin.

### Sécurité

- 🔴 **CRITIQUE** : URL de production Railway hardcodée en clair dans le code source
  - L1566 : `KOMERCE_API = 'https://komerce-backend-production.up.railway.app'`
  - Expose l'infrastructure backend à tout visiteur du fichier HTML

- 🔴 **CRITIQUE** : Identifiants admin pré-remplis dans le formulaire HTML
  - L639 : `<input type="email" id="auth-email" value="admin@komerce.km">`
  - Le mot de passe n'est pas pré-rempli mais l'email admin est exposé publiquement

- 🟠 **IMPORTANT** : innerHTML utilisé 7 fois avec des données potentiellement non sanitisées
  - L2188 : `alertesEl.innerHTML = alertes.map(a => \`<div>${a}</div>\`).join('')` — injection possible si `alertes` contient du HTML
  - L2389 : `tbody.innerHTML = data.map(p => {...})` — données produits injectées via innerHTML
  - Pas de fonction `sanitize()` définie dans ce fichier

- 🟠 **IMPORTANT** : Token d'authentification stocké dans un champ hidden + localStorage
  - L662 : `<input type="hidden" id="scan-token" value="">` — token JWT accessible via DOM
  - localStorage clés : `komerce_prix_terrain`, `kmrc_token`, `komerce_hist_douane`, `komerce_token`

- 🟠 **IMPORTANT** : Messages d'erreur backend exposés directement à l'utilisateur
  - L1539 : `alert('Erreur réseau : ' + err.message)` — fuite d'informations serveur
  - L1657 : `status.textContent = '❌ ' + err.message`

- 🟡 **MINEUR** : Pas de Content-Security-Policy (CSP) défini
- 🟡 **MINEUR** : 0 attributs `aria-*` — accessibilité absente
- 🟡 **MINEUR** : Pas de protection CSRF visible sur les requêtes POST

### Qualité du code

- ⚠️ Fichier monolithique de **140 KB** (1409 lignes JS, 604 lignes CSS, 835 lignes HTML, 47 fonctions) — devrait être découpé en modules
- `console.error` présent 1 fois en production (L1657)
- 1 URL de production hardcodée (Railway) — devrait être une variable d'environnement ou relative
- 3 appels `fetch` pour seulement 2 blocs `catch` — gestion d'erreur incomplète
- 4 media queries (responsive basique)
- `window.location` manipulé (1 fois) — potentiel redirect non contrôlé

### Endpoints API appelés

| Méthode | Endpoint | Contexte |
|---------|----------|----------|
| POST | `/api/auth/login` | Authentification admin (L1520) |
| GET | `/api/products?limit=200&in_stock=true` | Chargement catalogue produits (L1611) |
| PUT | `/api/products/{id}` | Mise à jour prix produit (L2534) |

### Observations

- ✅ Validation basique des entrées avec `.trim()`
- ❌ Pas de fonction `sanitize()` — contrairement à Komerce_Web.html
- ❌ 0 attributs `aria-*` — accessibilité totalement absente
- 🏗️ Architecture : 1 `<style>`, 2 `<script>` — fichier monolithique
- 📊 Logique de calcul complexe (douanes, marges, frais hub) entièrement côté client — les formules de tarification sont exposées publiquement

---

## Komerce_Tests.html (147 KB)

**Rôle** : Dashboard de tests E2E — exécution de scénarios automatisés, seeding, diagnostic, QR code scanning.

### Sécurité

- 🔴 **CRITIQUE** : Token de démonstration hardcodé dans le code source
  - L1721 : `S.token = 'demo-token-komerce-2026'` — si ce token fonctionne en production, accès non autorisé possible

- 🔴 **CRITIQUE** : Mots de passe hardcodés en clair
  - L2150 : `password:'password'` — utilisé pour les tests d'authentification
  - L2151 : `password:'password'` — pour l'enregistrement test
  - Si ces credentials fonctionnent en prod, c'est une faille majeure

- 🔴 **CRITIQUE** : Email admin exposé et numéros de téléphone de test hardcodés
  - L844 : `<input value="admin@komerce.km">` — email admin pré-rempli
  - Téléphones de test : `+2697700099`, `971501234567`, `971502345678`, etc.
  - Nom de test : `Ahmed Test`

- 🟠 **IMPORTANT** : innerHTML utilisé **50 fois** avec des données non sanitisées — risque XSS massif
  - L1596 : `d.innerHTML = \`<span class="l-${type}">${msg}</span>\`` — injection si `msg` contient du HTML
  - L2765 : `innerHTML = \`...Erreur : ${e.message}...\`` — messages d'erreur injectés en HTML
  - Au moins **15 cas** d'innerHTML avec des template literals contenant des variables
  - Pas de fonction `sanitize()` dans ce fichier

- 🟠 **IMPORTANT** : Messages d'erreur serveur exposés massivement dans l'UI
  - **18 blocs catch** affichant `e.message` directement dans le DOM via innerHTML
  - Fuite potentielle de stack traces, noms de tables, messages SQL

- 🟠 **IMPORTANT** : QR tokens générés/manipulés côté client
  - L2583 : `S.qrToken = 'DEMO-' + Math.random().toString(36)` — fallback en token démo prévisible
  - `Math.random()` n'est pas cryptographiquement sûr

- 🟡 **MINEUR** : 2 scripts externes sans SRI (Subresource Integrity)
  - `https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js`
  - `https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js`
  - Risque de supply chain attack si les CDN sont compromis

- 🟡 **MINEUR** : Pas de Content-Security-Policy (CSP)
- 🟡 **MINEUR** : Token stocké dans localStorage (`komerce_token`)
- 🟡 **MINEUR** : 0 attributs `aria-*` — accessibilité absente

### Qualité du code

- ⚠️ Fichier monolithique de **147 KB** (1809 lignes JS, 743 lignes CSS, 641 lignes HTML, 70 fonctions) — le plus gros fichier du projet
- 1 bloc de code commenté détecté
- 3 URLs hardcodées
- Excellente gestion du rate limiting Railway : debounce, retry exponentiel, pauses anti-429 (L1427-1509)
- 29 blocs `catch` pour 1 appel `fetch` centralisé — bonne architecture de gestion d'erreurs (via la fonction `api()`)
- Architecture: 1 `<style>`, 4 `<script>` — fichier monolithique
- 2 media queries (responsive minimal)

### Endpoints API appelés

| Méthode | Endpoint | Contexte |
|---------|----------|----------|
| GET | `/api/health` | Vérification connectivité serveur (L1679) |
| POST | `/api/auth/login` | Authentification admin (L1680, L2102, L2110, L2150) |
| POST | `/api/auth/register` | Inscription utilisateur test (L2151) |
| GET | `/api/auth/me` | Vérification token existant (L2095) |
| GET | `/api/products?limit=100/200/500` | Chargement produits (L1759, L1830, L1901, L2154, L2899, L3109) |
| POST | `/api/products` | Création/seed produits (L1866) |
| DELETE | `/api/products/{id}` | Suppression produits test (L3113) |
| GET | `/api/purchasing/suppliers` | Liste fournisseurs (L1760, L1831, L1902, L2129, L2900, L3116) |
| POST | `/api/purchasing/suppliers` | Création fournisseurs (L1888) |
| POST | `/api/purchasing/suppliers/{id}/map` | Mapping fournisseur-produit (L1930) |
| DELETE | `/api/purchasing/suppliers/{id}` | Suppression fournisseur test (L3130) |
| GET | `/api/purchasing` | Liste bons de commande (L2447, L2843, L2902, L3122) |
| GET | `/api/purchasing/{id}` | Détail bon de commande (L2249) |
| POST | `/api/purchasing/{id}/confirm` | Confirmation bon de commande (L2309) |
| POST | `/api/purchasing/{id}/receive` | Réception marchandise (L2417) |
| DELETE | `/api/purchasing/po/{id}` | Suppression bon de commande test (L3127) |
| POST | `/api/orders` | Création commande test (L2164) |
| GET | `/api/orders/{ref}` | Suivi commande (L2243, L2437, L2590, L2796) |
| POST | `/api/orders/{id}/qr-token` | Génération QR token (L2563) |
| GET | `/api/admin/orders?limit=50/500` | Liste commandes admin (L2596, L2759, L2901) |
| POST | `/api/payments/cash/confirm` | Confirmation paiement cash (L2228, L2820) |
| POST | `/api/scans` | Enregistrement scan colis (L2496, L2550) |
| GET | `/api/scans/hub/pending` | Colis en attente au hub (L2330) |
| POST | `/api/scans/verify-qr` | Vérification QR code (L2676) |
| POST | `/api/scans/collect` | Collecte colis (L2681) |

### Observations

- ✅ Excellente gestion du rate limiting avec retry exponentiel et pauses anti-429
- ✅ Architecture centralisée des appels API via la fonction `api()` avec headers auth automatiques
- ⚠️ Ce fichier est un outil de test E2E **accessible publiquement** — il contient des fonctions DELETE destructrices et des credentials
- ⚠️ Les données de test (numéros de téléphone, noms) pourraient être des données réelles
- ❌ Pas de séparation test/production — le dashboard pointe vers l'API de production
- 📋 Couverture de test : login → seed → commande → paiement → achat → hub → scans → QR → cleanup

---

## Komerce_Web.html (81 KB)

**Rôle** : Interface e-commerce client-facing — catalogue produits, panier, commande, suivi tracking.

### Sécurité

- 🟠 **IMPORTANT** : innerHTML utilisé 16 fois, mais la plupart des cas sont contrôlés
  - Le fichier possède une fonction `sanitize()` (L1139) utilisant `textContent` → bonne pratique
  - Cependant, certains innerHTML n'utilisent PAS sanitize (ex: bloom navigation, L1007-1062)
  - L1007 : `header.innerHTML = '<span>'+sit.icon+'</span>'` — données de `_situations` (statique, OK)

- 🟠 **IMPORTANT** : Pas de protection CSRF sur les requêtes POST
  - 4 appels POST détectés (`/api/auth/auto-register`, `/api/orders`) sans token CSRF
  - `credentials: 'include'` utilisé — cookies envoyés automatiquement

- 🟠 **IMPORTANT** : Auto-enregistrement sans validation côté client
  - L2017 : `apiPost('/api/auth/auto-register', {...})` — crée un compte automatiquement
  - Seule validation : nom et téléphone non vides — pas de validation format

- 🟡 **MINEUR** : localStorage utilisé pour le panier (`kmrc_cart`) — acceptable mais vulnérable au XSS
- 🟡 **MINEUR** : `credentials: 'include'` utilisé 2 fois — configuration CORS côté serveur critique
- 🟡 **MINEUR** : Pas de Content-Security-Policy (CSP)
- 🟡 **MINEUR** : URL HTTP détectée (`http://www.w3.org/2000/svg`) — faux positif, namespace SVG standard

### Qualité du code

- Fichier monolithique de **81 KB** (1463 lignes JS, 502 lignes CSS, 323 lignes HTML, 58 fonctions)
- `console.error` présent 3 fois en production (L1232, L1724, L2047)
- Fonction `loadCategoryCircles` définie **2 fois** (redéfinition — la 2ème écrase la 1ère)
- Bonne gestion d'erreurs avec `try/catch` sur les appels API et messages utilisateur via `toast()`
- Fonction `updateBottomCartBadge` référence `cart` au lieu de `_cart` (L2196) — **bug potentiel**
- Bonne architecture DOM : createElement plutôt qu'innerHTML pour la majorité du rendu

### Endpoints API appelés

| Méthode | Endpoint | Contexte |
|---------|----------|----------|
| GET | `/api/products` | Chargement catalogue (L1221) |
| GET | `/api/products/categories` | Catégories pour navigation (L1093) |
| GET | `/api/relais` | Points relais pour livraison (L1717) |
| POST | `/api/auth/auto-register` | Auto-inscription client (L2017) |
| POST | `/api/orders` | Création commande (L2030) |
| GET | `/api/orders/{ref}` | Suivi commande par référence (L2143) |

### Observations

- ✅ Fonction `sanitize()` présente et utilisée pour la protection XSS
- ✅ `encodeURIComponent` utilisé pour les paramètres URL (tracking)
- ✅ Validation basique des entrées avec `.trim()`
- ✅ Bonne accessibilité : 18 attributs `aria-*`, labels, rôles
- ✅ Bon responsive : 4 media queries + bottom tab bar mobile
- ✅ Gestion du panier via DOM API (createElement) plutôt qu'innerHTML
- 🎨 Navigation catégories innovante "Bloom" avec animations
- 🌍 Support multi-devises (KMF/EUR) avec détection automatique par timezone
- 🐛 Bug L2196 : `cart.reduce` devrait être `_cart.reduce` dans `updateBottomCartBadge`

---

## Résumé du lot 3

### Comptage des issues

| Sévérité | Simulateur | Tests | Web | **Total** |
|----------|-----------|-------|-----|-----------|
| 🔴 Critiques | 2 | 3 | 0 | **5** |
| 🟠 Importants | 3 | 3 | 3 | **9** |
| 🟡 Mineurs | 3 | 4 | 4 | **11** |

- **Critiques** : 5
- **Importants** : 9
- **Mineurs** : 11
- **Endpoints uniques** : 25

### Endpoints uniques consolidés (25)

| Méthode | Endpoint | Appelé depuis |
|---------|----------|---------------|
| GET | `/api/health` | Tests |
| POST | `/api/auth/login` | Simulateur, Tests |
| POST | `/api/auth/register` | Tests |
| GET | `/api/auth/me` | Tests |
| POST | `/api/auth/auto-register` | Web |
| GET | `/api/products` | Tests, Web |
| GET | `/api/products/categories` | Web |
| POST | `/api/products` | Tests |
| PUT | `/api/products/{id}` | Simulateur |
| DELETE | `/api/products/{id}` | Tests |
| POST | `/api/orders` | Tests, Web |
| GET | `/api/orders/{ref}` | Tests, Web |
| POST | `/api/orders/{id}/qr-token` | Tests |
| GET | `/api/admin/orders` | Tests |
| GET | `/api/relais` | Web |
| POST | `/api/payments/cash/confirm` | Tests |
| GET | `/api/purchasing` | Tests |
| GET | `/api/purchasing/{id}` | Tests |
| POST | `/api/purchasing/{id}/confirm` | Tests |
| POST | `/api/purchasing/{id}/receive` | Tests |
| DELETE | `/api/purchasing/po/{id}` | Tests |
| GET | `/api/purchasing/suppliers` | Tests |
| POST | `/api/purchasing/suppliers` | Tests |
| POST | `/api/purchasing/suppliers/{id}/map` | Tests |
| DELETE | `/api/purchasing/suppliers/{id}` | Tests |
| POST | `/api/scans` | Tests |
| GET | `/api/scans/hub/pending` | Tests |
| POST | `/api/scans/verify-qr` | Tests |
| POST | `/api/scans/collect` | Tests |

### Endpoints non-standard ou potentiellement manquants

- `/api/scans/hub/pending` — le code Tests inclut un commentaire « vérifiez que la route existe » (L2350)
- `/api/purchasing/suppliers/{id}/map` — mapping fournisseur-produit, non standard REST
- `/api/purchasing/po/{id}` — DELETE avec préfixe `po/` différent des autres purchasing routes
- `/api/auth/auto-register` — auto-inscription sans mot de passe, potentiellement risqué
- `/api/orders/{id}/qr-token` — sous-ressource QR, vérifier l'existence côté backend

### Problèmes transversaux critiques

1. **🔴 Fichiers de test/admin accessibles publiquement** — Komerce_Tests.html et Komerce_Simulateur.html contiennent des credentials, tokens démo, et des fonctions destructrices (DELETE) accessibles sans authentification serveur
2. **🔴 URL de production Railway exposée** — L'URL backend est hardcodée dans le Simulateur
3. **🔴 Pas de séparation des environnements** — Les outils de test pointent vers la production
4. **🟠 Architecture monolithique** — Les 3 fichiers totalisent ~368 KB de HTML/CSS/JS monolithique, sans bundling ni minification
5. **🟠 innerHTML massif sans sanitisation** — 73 utilisations totales, dont 17 avec des variables template — risque XSS systémique
6. **🟠 Pas de CSRF protection** — Aucun des fichiers n'implémente de tokens CSRF sur les POST
