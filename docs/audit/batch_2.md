# Audit Dashboard — Lot 2 : Interfaces Principales

> **Date** : 2026-04-05  
> **Fichiers** : `Komerce_Admin.html`, `Komerce_Boutique.html`, `Komerce_Pilotage.html`  
> **Contexte** : Plateforme e-commerce/logistique comorienne — dashboards front-end monolithiques

---

## Komerce_Admin.html (121 KB)

### Sécurité

- 🔴 **CRITIQUE — Identifiants par défaut en dur dans le HTML** : Le champ email du formulaire de login contient `value="admin@komerce.km"` (L261). Tout visiteur voit l'email administrateur et n'a qu'à deviner le mot de passe. Le placeholder également révèle l'adresse.

- 🔴 **CRITIQUE — `apiFetch()` manque `credentials: 'include'`** (L1215-1221) : La fonction `apiFetch()` (utilisée pour les écrans fusionnés v2) ne transmet PAS les cookies httpOnly, contrairement à `api()` (L731). Les requêtes passant par `apiFetch()` (/dashboard/ops, /dashboard/sales) échouent silencieusement en authentification ou contournent la vérification côté serveur.

- 🔴 **CRITIQUE — Bug syntaxique dans `apiFetch()` : commentaire dans l'objet headers** (L1217) : `headers: { 'Content-Type': 'application/json', // Authorization handled by httpOnly cookie }` — le commentaire `//` coupe la fermeture `}` du headers, ce qui provoque un bug de parsing potentiel. L'objet headers est mal formé. En réalité JS tolère cela car le `}` sur la ligne suivante ferme le fetch options, pas les headers — mais le `credentials: 'include'` manquant reste un vrai problème.

- 🟠 **IMPORTANT — 28 usages de `innerHTML` avec données serveur non sanitisées** : Les données provenant de l'API (commandes, alertes, produits, finances) sont injectées directement via `innerHTML` avec des template literals. Si un champ de commande ou produit contient du HTML/JS malveillant, il sera exécuté (Stored XSS). Exemples critiques :
  - L832 : `tbody.innerHTML = orders.map(o => ...)` — noms clients, références
  - L847-850 : alertes injectées directement
  - L1076 : catalogue produits
  - L1409, L1631, L1686 : messages d'erreur via `e.message`

- 🟠 **IMPORTANT — Auth guard contournable côté client** (L243-249) : La vérification `if(!localStorage.getItem('kmrc_logged_in'))` redirige vers le login, mais il suffit d'exécuter `localStorage.setItem('kmrc_logged_in','1')` dans la console pour accéder à l'interface. La vraie protection repose sur les cookies httpOnly côté serveur, mais l'UI affiche le dashboard complet avant toute vérification API.

- 🟠 **IMPORTANT — Deux systèmes d'authentification en conflit** : Le code historique utilise `token` dans localStorage (L718, L1132) PLUS les cookies httpOnly (L730 "BUG-014"). Le token est stocké en localStorage (`komerce_token`) mais n'est jamais envoyé dans les headers (commenté). Confusion architecturale entre JWT en localStorage et cookies httpOnly.

- 🟡 **MINEUR — `alert()` utilisé pour validation** (L1706) : `alert('Choisissez une date cible')` — UX inadaptée pour un dashboard admin professionnel.

### Qualité du code

- 🟠 **IMPORTANT — Fonction `badge()` définie deux fois** (L787 et L1229) : Deux implémentations différentes avec des signatures différentes (`badge(status)` vs `badge(text, type)`). La seconde écrase la première. Résidu de la fusion admin_v2.

- 🟠 **IMPORTANT — Code fusionné admin_v2 avec duplication** : Marqueurs de fusion explicites (L164, L1129, L1131, L1880). Deux systèmes parallèles coexistent :
  - `api()` (L728) — système original avec `credentials: 'include'`
  - `apiFetch()` (L1215) — système v2 SANS `credentials: 'include'`
  - Logique de dashboard dupliquée entre les deux systèmes

- 🟡 **MINEUR — `console.log` en production** (L1875) : `console.log('[Komerce Admin] Auto-refresh activé (15s)')` — devrait être supprimé.

- 🟡 **MINEUR — 10 `console.error/warn` restants** : Utiles pour le debug mais exposent la structure interne en production.

- 🟡 **MINEUR — 12 blocs de commentaires volumineux** : Code commenté résiduel de la fusion.

- 🟡 **MINEUR — Email support en dur** (L686) : `value="support@komerce.app"` — devrait être configurable.

### Endpoints API appelés

| Méthode | Endpoint | Contexte |
|---------|----------|----------|
| GET | /api/dashboard/ops | Dashboard KPIs opérationnels |
| GET | /api/dashboard/sales?period=30 | Ventes 30 jours |
| GET | /api/dashboard/retards | Retards livraison |
| GET | /api/payments/rates | Taux de change paiements |
| GET | /api/orders | Liste commandes (avec querystring filtres) |
| GET | /api/logistics/shipments | Expéditions en cours |
| PATCH | /api/logistics/shipments/{id} | Marquer arrivée/dédouanement |
| GET | /api/finance/stripe-proofs?month={m}&year={y} | Preuves Stripe |
| GET | /api/finance/report?month={m}&year={y} | Rapport financier (via fetch+template) |
| GET | /api/finance/export?month={m}&year={y} | Export financier |
| GET | /api/pricing/rates | Taux de tarification |
| PUT | /api/pricing/rates | Mise à jour taux |
| GET | /api/products | Catalogue produits |
| GET | /api/relais | Points relais |
| GET | /api/health | Santé serveur |
| POST | /api/auth/login | Connexion |
| POST | /api/auth/logout | Déconnexion |
| GET | /api/admin/counts | Compteurs sidebar |
| POST | /api/admin/reset | Reset admin |
| GET | /api/logistics/manifest/{id} | Manifeste logistique |

### Observations

- Architecture monolithique : tout le HTML/CSS/JS dans un seul fichier de 121KB
- Fusion v2 incomplète laissant deux systèmes d'API parallèles
- Auto-refresh toutes les 15 secondes (L1869) — charge serveur potentielle
- 34+ fonctions nommées, architecture procédurale sans modules
- Endpoints non-standard détectés : `/api/admin/reset`, `/api/dashboard/retards`, `/api/finance/stripe-proofs` — à vérifier côté backend
- L'endpoint `/api/logistics/manifest/` est construit dynamiquement mais non vérifié

---

## Komerce_Boutique.html (143 KB)

### Sécurité

- 🔴 **CRITIQUE — XSS reflété dans la recherche** (L2513) : `dd.innerHTML = '...Aucun produit trouvé pour «' + q + '»...'` — la variable `q` provient de l'input utilisateur et est injectée dans `innerHTML` SANS sanitisation. Un utilisateur peut taper `<img src=x onerror=alert(1)>` dans la barre de recherche pour exécuter du JS arbitraire. **Note** : les résultats (L2521-2522) utilisent correctement `sanitize()`, mais le message "aucun résultat" ne le fait pas.

- 🟠 **IMPORTANT — Données produit (image_url) non sanitisées** (L2517) : `'<img class="search-item-img" src="' + p.image_url + '">'` — si `image_url` provient du serveur avec des données malveillantes (ex: `" onerror="alert(1)`), cela crée une XSS stockée. Même problème pour `p.emoji` (L2518).

- 🟠 **IMPORTANT — 21 usages de `innerHTML`** : La plupart injectent du contenu serveur sans sanitisation complète. Bien que `sanitize()` soit défini et utilisé dans certains endroits (L2404, L2521, L2625, L2747), il est absent dans d'autres (L2513, L2517, L3373, L3394).

- 🟠 **IMPORTANT — Cart stocké en localStorage sans validation** (L2088) : `_cart = JSON.parse(localStorage.getItem('kmrc_cart') || '[]')` — avec un try/catch (L2093), mais les données du panier sont utilisées directement pour construire des commandes sans validation côté client. Un utilisateur peut manipuler les prix via localStorage.

- 🟡 **MINEUR — Service Worker enregistré** (L3750-3751) : `navigator.serviceWorker.register('/sw.js')` — nécessite que `sw.js` existe et soit correctement configuré. Bon pour le offline mais augmente la surface d'attaque si mal configuré.

- 🟡 **MINEUR — URL externe MVola en dur** (L3373) : `https://www.mvola.km/wp-content/uploads/2023/12/logo.svg` — dépendance externe pour le logo, pourrait casser si le site MVola change.

### Qualité du code

- 🟠 **IMPORTANT — `apiGet()` et `apiPost()` sans `try/catch` interne** : Les fonctions wrapper (L2149-2160) ne gèrent pas les erreurs réseau (TypeError). Les appelants doivent tous avoir leur propre try/catch. `loadProducts` (L2365) et `loadRelais` (L3041) ont des try/catch, mais `submitOrder` pourrait laisser passer des erreurs réseau.

- 🟡 **MINEUR — `console.log` en production** (L3752) : `console.log('[App] SW registered, scope:', reg.scope)`.

- 🟡 **MINEUR — 7 `console.error/warn` restants** : Exposent des détails internes.

- 🟡 **MINEUR — 52 fonctions dans un seul fichier** : Architecture monolithique de 3763 lignes sans modules ni composants. Maintenance difficile.

- 🟡 **MINEUR — Liens réseaux sociaux en dur** (facebook.com, instagram.com, wa.me) — pourraient être configurables.

- 🟡 **MINEUR — Versioning du panier** (CART_VERSION) : Bon pattern pour gérer les migrations de structure du panier.

### Endpoints API appelés

| Méthode | Endpoint | Contexte |
|---------|----------|----------|
| GET | /api/products | Chargement catalogue produits |
| GET | /api/relais/public | Points relais publics |
| POST | /api/auth/guest-checkout | Création/récupération client guest |
| POST | /api/orders | Création commande |
| GET | /api/orders/{ref} | Suivi commande par référence |

### Observations

- Interface boutique publique (pas de login requis) — surface d'attaque plus large
- Bon usage de `sanitize()` dans la majorité des cas, mais incohérent (XSS sur recherche)
- Pattern guest-checkout : crée ou retrouve le client par téléphone avant de passer commande
- Modes de paiement : `cash_relais` (actif), `mvola` (disabled/bientôt), `stripe_eur` (disabled/bientôt)
- Endpoint `/api/relais/public` non listé dans les routes backend connues — **à vérifier**
- Endpoint `/api/auth/guest-checkout` non listé dans les routes backend connues — **à vérifier**

---

## Komerce_Pilotage.html (181 KB)

### Sécurité

- 🔴 **CRITIQUE — URL de production backend hardcodée** (L2515) : `const KOMERCE_API_URL = 'https://komerce-backend-production.up.railway.app'` — expose l'URL exacte du backend de production. Tout attaquant peut cibler directement cette URL. De plus, cela empêche le déploiement sur d'autres environnements (staging, dev) sans modifier le code source.

- 🔴 **CRITIQUE — Identifiants par défaut en dur** (L498) : `value="admin@komerce.km"` dans le champ email du login Pilotage. Même problème que l'Admin.

- 🟠 **IMPORTANT — 27 usages de `innerHTML` sans sanitisation** : Données serveur (pilotage, pipeline, commandes) injectées directement. Exemples :
  - L2396 : données de simulation utilisateur
  - L2761 : données dashboard
  - L2997 : tableau mix produits
  - L3366-3450 : KPIs opérationnels
  - L3553 : top clients
  - L3605 : données invendus

- 🟠 **IMPORTANT — Auth guard côté client facilement contournable** (L478) : `if(!localStorage.getItem('komerce_token') && !localStorage.getItem('kmrc_logged_in')){ window.location.replace('/portal.html'); }` — même pattern fragile que l'Admin, contournable en 1 ligne de console.

- 🟠 **IMPORTANT — 5 appels `JSON.parse(localStorage)` sans try/catch** (L1751, L1822, L1913, L1914, L1947) : Des données localStorage corrompues (manipulation manuelle, quota dépassé) provoqueront un crash JavaScript complet de la page. Les données incluent les prix terrain et l'historique douane.

- 🟠 **IMPORTANT — Propriété `credentials` dupliquée dans fetch** (L2552) : `fetch(URL, { credentials: 'include', method: 'POST', credentials: 'include' })` — doublon qui masque un copier-coller bâclé. JS prend la dernière valeur, donc pas de bug fonctionnel, mais code smell significatif.

- 🟠 **IMPORTANT — 8 usages de `alert()` pour la logique métier** (L1904, 1905, 1908, 1930, 2001, 2521, 2530, 2544) : `alert('Connexion échouée')`, `alert('Erreur réseau')` — expose les erreurs techniques et bloque l'UI. Particulièrement grave pour la connexion (L2530) où l'erreur serveur est affichée brute.

- 🟡 **MINEUR — localStorage comme base de données partagée** : Les prix terrain et l'historique douane sont stockés en localStorage et partagés entre les onglets Simulateur et Pilotage. Pas de mécanisme de synchronisation — données potentiellement incohérentes.

### Qualité du code

- 🟠 **IMPORTANT — Fichier monolithique de 181KB / 3669 lignes** : Le plus gros fichier du projet. Contient simultanément : simulateur de tarification, historique douane, dashboard temps réel, opérations, mix produits, fidélité, invendus, et pipeline. Devrait être éclaté en modules.

- 🟠 **IMPORTANT — 63 fonctions dans un seul scope global** : Aucune modularisation. Risque élevé de collision de noms et de couplage fort.

- 🟠 **IMPORTANT — Valeurs métier hardcodées** : Taux AED par défaut 139, taux EUR par défaut 495 (L1777, L2373), taux fret 180 EUR/m³ (L2064, L2088, L2422, L2614, L2840, L3099), forfait 450 KMF (L741, L775, L802). Ces valeurs devraient être dans une configuration ou provenir de l'API.

- 🟡 **MINEUR — Dépendance Chart.js chargée localement** (L5) : `<script src="/chart.umd.min.js">` — pas de version ni intégrité SRI. 14 instanciations de charts.

- 🟡 **MINEUR — `console.log` en production** (L3663) : `console.log('[Komerce Pilotage] Auto-refresh activé (15s)')`.

- 🟡 **MINEUR — Variable `--text` CSS potentiellement incorrecte** (L6) : `--text: #f0f2f5` — couleur très claire pour le texte principal, pourrait être un bug (identique à `--bg3`). Le texte principal devrait être sombre.

### Endpoints API appelés

| Méthode | Endpoint | Contexte |
|---------|----------|----------|
| POST | /api/auth/login | Connexion (via KOMERCE_API_URL absolu) |
| POST | /api/auth/logout | Déconnexion |
| GET | /api/pilotage?mois={n} | Snapshot mensuel coûts & marges |
| GET | /api/pilotage/history?mois=12 | Historique 12 mois |
| GET | /api/admin/orders?limit=200 | Commandes admin (opérations) |
| GET | /api/purchasing | Données achats/fournisseurs |
| GET | /api/loyalty/users | Utilisateurs programme fidélité |
| GET | /api/loyalty/tiers | Paliers fidélité |
| GET | /api/unsold/stats/summary | Résumé invendus |
| GET | /api/unsold | Liste détaillée invendus |

### Observations

- Auto-refresh 15 secondes identique à Admin — 2 dashboards rafraîchissant simultanément = charge×2
- Endpoints non listés dans les routes backend connues : `/api/pilotage`, `/api/pilotage/history`, `/api/purchasing`, `/api/loyalty/users`, `/api/loyalty/tiers`, `/api/unsold`, `/api/unsold/stats/summary` — **7 endpoints à vérifier**
- Le module Pilotage utilise des URLs absolues (KOMERCE_API_URL) tandis que Admin/Boutique utilisent des URLs relatives — incohérence architecturale
- Le simulateur de tarification fait tous ses calculs côté client — pas de validation serveur des prix
- Données sensibles (marges, coûts réels, taux de change) exposées côté client

---

## Résumé du lot 2

### Compteurs

| Sévérité | Admin | Boutique | Pilotage | **Total** |
|----------|-------|----------|----------|-----------|
| 🔴 Critiques | 3 | 1 | 2 | **6** |
| 🟠 Importants | 4 | 3 | 6 | **13** |
| 🟡 Mineurs | 5 | 5 | 4 | **14** |
| **Total** | **12** | **9** | **12** | **33** |

### Endpoints uniques : 28

#### Endpoints communs entre fichiers
| Endpoint | Admin | Boutique | Pilotage |
|----------|-------|----------|----------|
| /api/auth/login | ✅ | ❌ | ✅ |
| /api/auth/logout | ✅ | ❌ | ✅ |
| /api/products | ✅ | ✅ | ❌ |
| /api/orders | ✅ | ✅ | ❌ |
| /api/admin/orders | ❌ | ❌ | ✅ |
| /api/dashboard/ops | ✅ | ❌ | ❌ |
| /api/pilotage | ❌ | ❌ | ✅ |

#### Endpoints potentiellement manquants du backend (non listés dans les routes connues)
1. `/api/relais/public` (Boutique)
2. `/api/auth/guest-checkout` (Boutique)
3. `/api/pilotage` (Pilotage)
4. `/api/pilotage/history` (Pilotage)
5. `/api/purchasing` (Pilotage)
6. `/api/loyalty/users` (Pilotage)
7. `/api/loyalty/tiers` (Pilotage)
8. `/api/unsold` (Pilotage)
9. `/api/unsold/stats/summary` (Pilotage)
10. `/api/dashboard/retards` (Admin)
11. `/api/finance/stripe-proofs` (Admin)
12. `/api/admin/counts` (Admin)
13. `/api/admin/reset` (Admin)
14. `/api/logistics/manifest` (Admin)

### Top 5 problèmes critiques à résoudre en priorité

1. **XSS dans la recherche Boutique** (L2513) — exploitable par n'importe quel visiteur
2. **`apiFetch()` sans credentials dans Admin** — les écrans v2 fusionnés ne fonctionnent pas correctement
3. **URL production hardcodée dans Pilotage** — expose l'infrastructure et empêche le multi-environnement
4. **Identifiants admin par défaut visibles** dans Admin et Pilotage
5. **`JSON.parse(localStorage)` sans try/catch** dans Pilotage — crash potentiel de toute la page

### Patterns systémiques identifiés

- **Monolithisme** : 3 fichiers totalisant 445 KB de HTML/CSS/JS mélangés
- **Incohérence auth** : localStorage token vs httpOnly cookies, auth guard client-side, deux fonctions API parallèles
- **innerHTML omniprésent** : 76 usages totaux, sanitisation incohérente
- **Pas de build system** : ni minification, ni tree-shaking, ni code splitting
- **Pas de CSP** (Content Security Policy) sur aucun fichier
