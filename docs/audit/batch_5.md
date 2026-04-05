# 🔍 Audit Dashboard — Lot 5 (Dashboards opérationnels)

> Fichiers analysés : 5 dashboards opérationnels (Hub, Mobile, PWA Mobile, Pipeline, Relais)
> Date : 2025-04-05
> Taille totale : ~264 KB

---

## Komerce_Hub.html (38.7 KB)

### Sécurité

- 🟠 **IMPORTANT**: URL d'API en dur `https://komerce-backend-production.up.railway.app` — devrait être configurable ou déduite de `window.location.origin`.
- 🟠 **IMPORTANT**: Token JWT stocké dans `localStorage` (clé `komerce_token`) — vulnérable aux attaques XSS. Préférer les cookies HttpOnly.
- 🟠 **IMPORTANT**: Authentification côté client via `localStorage.getItem('komerce_token')` — un utilisateur peut falsifier le token. La validation réelle ne se fait que via `/api/auth/me` (correct), mais le guard initial est bypassable.
- 🟠 **IMPORTANT**: Script externe `html5-qrcode@2.3.8` chargé depuis unpkg.com sans Subresource Integrity (SRI). Un compromis du CDN injecterait du code malveillant.
- 🟡 **MINEUR**: `innerHTML` utilisé 7 fois avec des données dynamiques (réponses API, statuts). La fonction `escHtml()` est définie et utilisée sur les champs texte, mais les badges HTML (statusBadge, paymentBadge) sont injectés directement — risque XSS limité car les valeurs viennent du serveur.
- 🟡 **MINEUR**: Cookies envoyés avec `credentials: 'include'` — vérifier la configuration SameSite et les flags Secure/HttpOnly côté serveur.

### Qualité du code

- Architecture monolithique : HTML (structure), CSS (6.2 KB inline) et JS (19 KB inline) dans un seul fichier — rend la maintenance difficile.
- `console.log`/`console.warn`/`console.error` laissés dans le code de production (5 occurrences).
- Valeurs de timing codées en dur : `countdown = 30`, refresh interval — devraient être configurables.
- Logique de scan `SCAN 4` (hub dispatch) intégrée avec les vues admin — mélange de responsabilités.
- Double login : possède son propre formulaire de login ET redirige vers `portal.html` — flow de connexion ambigu.

### Endpoints API appelés

| Méthode | Endpoint | Contexte |
|---------|----------|----------|
| POST | `/api/auth/login` | Authentification |
| GET | `/api/auth/me` | Vérification session (auto-login) |
| GET | `/api/dashboard/ops` | Statistiques opérationnelles hub |
| GET | `/api/admin/orders` | Liste commandes (queue + expéditions) |
| GET | `/api/relais` | Liste des points relais |
| GET | `/api/orders/relais` | Commandes par relais |
| POST | `/api/scans` | Enregistrement scan (SCAN 4 — hub dispatch) |

### Observations

- Intégration scanner QR (html5-qrcode) pour le dispatch hub (SCAN 4).
- Communication inter-onglets via BroadcastChannel pour synchronisation en temps réel.
- Interface adaptée aux opérations logistiques hub (Dubai) avec vue sur les expéditions et la queue.
- Utilise la même base API que Relais — bonne cohérence.

---

## Komerce_Mobile.html (52.8 KB)

### Sécurité

- 🔴 **CRITIQUE**: URL d'API en dur `https://komerce-backend-production.up.railway.app` dans `KOMERCE_API_BASE` — exposée dans le code source client. Pipeline utilise `window.location.origin` (meilleure approche).
- 🟠 **IMPORTANT**: Token (`komerce_token`) stocké dans localStorage puis envoyé via `credentials: 'include'` (cookies). Approche mixte confuse : si les cookies sont utilisés pour l'auth, le token localStorage est redondant. Si le token est nécessaire, il manque dans les en-têtes Authorization des fetch.
- 🟡 **MINEUR**: Les appels `fetch()` vers `/api/baskets/share` et `/api/baskets/gift` n'envoient pas le token dans les headers Authorization — ils s'appuient uniquement sur `credentials: 'include'`. Si le backend attend un Bearer token, ces appels échoueront.

### Qualité du code

- CSS inline très volumineux (19.4 KB dans `<style>`) — plus de la moitié du fichier est du CSS.
- JavaScript inline modeste (4.3 KB) — principalement fonctions panier/cadeau.
- `console.error` utilisé 4 fois — acceptable mais à retirer en production.
- Fichier principalement **présentationnel/vitrine** — beaucoup de contenu HTML statique (produits, catégories, UI mobile).
- Fonctions `pwaOpenShare`, `pwaShareWA`, `pwaOpenGift`, `pwaConfirmGift` préfixées "pwa" alors que c'est le fichier Mobile (pas PWA) — confusion de nommage.
- ⚠️ **Code dupliqué** : 60%+ de similarité avec `Komerce_PWA_Mobile.html` (voir analyse ci-dessous).

### Endpoints API appelés

| Méthode | Endpoint | Contexte |
|---------|----------|----------|
| POST | `/api/baskets/share` | Partage de panier client |
| GET | `/api/baskets/{code}` | Chargement panier cadeau par code |
| POST | `/api/baskets/gift` | Envoi d'un cadeau panier |

### Observations

- App mobile orientée client (pas opérations) : navigation par catégories produits, panier, suivi colis.
- Contenu très spécifique à Anjouan/Comores avec détection de devise EUR/KMF.
- Sélecteur de relais intégré pour le retrait.
- Intégration WhatsApp pour le partage de panier.
- Redirection vers `portal.html` si non authentifié via auth guard.

---

## Komerce_PWA_Mobile.html (52.6 KB)

### Sécurité

- 🔴 **CRITIQUE**: **Pas de garde d'authentification** (auth guard) — contrairement à `Komerce_Mobile.html` qui a un script vérifiant `localStorage.getItem('komerce_token')` et redirigeant vers `/portal.html`, la version PWA **n'a aucune vérification de token**. Le contenu est directement accessible sans authentification.
- 🟠 **IMPORTANT**: URL d'API en dur `https://komerce-backend-production.up.railway.app` — même problème que Mobile.
- 🟠 **IMPORTANT**: Les appels API utilisent `credentials: 'include'` mais aucun token n'est vérifié côté client — si le cookie de session est expiré, les appels API échoueront silencieusement sans redirection vers la page de login.
- 🟡 **MINEUR**: Aucune référence à `komerce_token` dans localStorage — le fichier ne lit ni n'écrit de token.

### Qualité du code

- ⚠️ **DUPLICATION MAJEURE** : ~60% des lignes sont identiques à `Komerce_Mobile.html`. Les 704 lignes différentes concernent principalement :
  - Titre ("App Anjouan" vs "📱 Mobile")
  - Absence du bloc auth guard (8 lignes)
  - Quelques différences mineures de contenu HTML
- CSS inline identique (19.4 KB) — devrait être extrait dans un fichier commun.
- JavaScript inline identique (mêmes fonctions pwa*).
- `console.error` 4 fois.
- Pas de meta `manifest.json` ni d'enregistrement de Service Worker malgré le nom "PWA" — **ce n'est pas une vraie PWA**.

### Endpoints API appelés

| Méthode | Endpoint | Contexte |
|---------|----------|----------|
| POST | `/api/baskets/share` | Partage de panier client |
| GET | `/api/baskets/{code}` | Chargement panier cadeau par code |
| POST | `/api/baskets/gift` | Envoi d'un cadeau panier |

### Observations

- ⚠️ **Fausse PWA** : malgré le nom du fichier, aucune fonctionnalité PWA réelle (pas de Service Worker, pas de manifest, pas de cache offline).
- Possède les meta tags `apple-mobile-web-app-capable` et `mobile-web-app-capable` mais c'est insuffisant pour une vraie PWA.
- Contenu quasi-identique à Mobile — forte recommandation de fusionner les deux fichiers.

---

## Komerce_Pipeline.html (29.1 KB)

### Sécurité

- 🟠 **IMPORTANT**: Utilise la clé `km_token` dans localStorage au lieu de `komerce_token` utilisée par tous les autres dashboards. **Incohérence** : un utilisateur connecté via Hub/Relais ne sera pas reconnu par Pipeline et vice-versa.
- 🟠 **IMPORTANT**: Token envoyé dans l'en-tête `Authorization: Bearer ${TOKEN}` — approche correcte et plus sécurisée que cookies seuls, mais incohérente avec les autres dashboards qui utilisent `credentials: 'include'`.
- 🟡 **MINEUR**: ✅ Bonne pratique : `API = window.location.origin` — pas d'URL hardcodée, s'adapte à l'environnement de déploiement.

### Qualité du code

- Architecture monolithique : CSS (5.5 KB) + JS (12 KB) inline, mais la plus propre des 5 fichiers.
- Thème sombre (dark mode) unique parmi tous les dashboards — incohérence visuelle avec le reste de la plateforme.
- Vue Kanban bien structurée avec filtrage par statut et recherche.
- `console.error` utilisé (2 occurrences).
- Fonction `apiFetch()` bien encapsulée avec gestion de token et erreurs 401.
- Seul dashboard à ne **pas** avoir de redirection vers `portal.html` — possède uniquement son propre formulaire de login.

### Endpoints API appelés

| Méthode | Endpoint | Contexte |
|---------|----------|----------|
| POST | `/api/auth/login` | Authentification locale |
| GET | `/api/dashboard/pipeline` | Données pipeline (commandes par statut) |

### Observations

- Vue Kanban avec colonnes par statut : draft → confirmed → paid → preparation → shipped → relais_received → available → collected → cancelled.
- Interface minimaliste avec seulement 2 endpoints — très focalisée.
- Pas de scan, pas de QR, pas de WhatsApp — purement visualisation du flux.
- Refresh automatique toutes les 30 secondes.
- Modal de détail pour chaque commande.
- Seul dashboard en dark mode.

---

## Komerce_Relais.html (90.7 KB)

### Sécurité

- 🟠 **IMPORTANT**: URL d'API en dur `https://komerce-backend-production.up.railway.app` — même problème que Hub.
- 🟠 **IMPORTANT**: Token JWT stocké dans `localStorage` (clé `komerce_token`) — vulnérable aux attaques XSS.
- 🟠 **IMPORTANT**: 3 scripts externes chargés sans SRI (Subresource Integrity) :
  - `unpkg.com/html5-qrcode@2.3.8` (scanner QR)
  - `cdn.jsdelivr.net/npm/qrcode@1.5.3` (génération QR)
  - `fonts.googleapis.com` (polices)
- 🟠 **IMPORTANT**: `innerHTML` utilisé **22 fois** — le fichier le plus exposé au XSS. La fonction `escHtml()` est définie et utilisée sur les champs texte, mais les structures HTML complexes (tables, grids, modals) sont construites par concaténation de strings avec injection directe de données. Un champ `client_name` malveillant contenant `<script>` pourrait être injecté si `escHtml` est oublié sur un seul champ.
- 🟠 **IMPORTANT**: Authentification côté client bypassable + redirection vers `portal.html` en double.
- 🟡 **MINEUR**: Cookies envoyés avec `credentials: 'include'` — vérifier la configuration serveur.
- 🟡 **MINEUR**: `document.write()` utilisé dans `printQr()` via `window.open()` pour l'impression — risque limité mais à moderniser.

### Qualité du code

- **Fichier le plus volumineux** (90.7 KB) — monolithique avec CSS (13.2 KB), HTML (22 KB) et JS (55 KB) dans un seul fichier.
- `console.log`/`warn`/`error` : 5 occurrences en production.
- Architecture complexe dans un seul fichier : login, sélecteur de relais, scan réception (SCAN 5), retrait client (SCAN 6), gestion colis, caisse, contacts, transit.
- Valeurs codées en dur : refresh 15s, relais par défaut (Mutsamudu, Domoni, Moroni, Fomboni), icônes de relais.
- Liste de relais par défaut `DEFAULT_RELAIS` en fallback — bon pattern de résilience mais les données sont hardcodées.
- Templates de messages WhatsApp en dur dans le code — devraient être configurables depuis le backend.
- Gestion offline avec bannière + restauration automatique — bonne UX.

### Endpoints API appelés

| Méthode | Endpoint | Contexte |
|---------|----------|----------|
| POST | `/api/auth/login` | Authentification |
| GET | `/api/auth/me` | Vérification session |
| GET | `/api/relais` | Liste des points relais |
| GET | `/api/orders/relais?relais_id={id}` | Commandes d'un relais |
| POST | `/api/scans` | Scan réception (SCAN 5) |
| POST | `/api/orders/{id}/qr-token` | Génération token QR retrait |
| POST | `/api/scans/collect` | Retrait par code 6 chiffres |
| POST | `/api/scans/verify-qr` | Retrait par QR code |
| GET | `/api/dashboard/ops?relais_id={id}` | Données caisse/opérations |
| POST | `/api/orders/{id}/contacted` | Marquer client comme contacté |
| GET | `/api/admin/orders?status=shipped&destination_relais={id}` | Colis en approche |

### Observations

- Dashboard le plus complet et fonctionnel : scan réception, retrait client (code + QR), gestion de caisse, suivi contacts, transit.
- Intégration scanner QR bidirectionnel : scan colis entrants (html5-qrcode) + génération QR sortants (qrcode.js).
- Communication inter-onglets via BroadcastChannel pour synchronisation temps réel avec Hub.
- Gestion offline avec bannière et listeners `online`/`offline`.
- Templates WhatsApp contextuels (7 types de raisons de contact).
- Sélecteur de relais avec persistance en localStorage.
- Mode impression pour les QR codes.
- Refresh automatique 15s avec countdown visuel.
- API Clipboard moderne avec fallback `document.execCommand`.

---

## 🔄 Analyse de duplication Mobile / PWA Mobile

- **Similarité** : ~60% des lignes sont strictement identiques.
- **Différences clés** :
  1. Le titre (`📱 Mobile` vs `App Anjouan`)
  2. **L'auth guard est ABSENT dans PWA** (8 lignes manquantes — faille de sécurité)
  3. Quelques variations mineures de contenu HTML
- CSS identique (19.4 KB dupliqué)
- JavaScript identique (mêmes fonctions `pwa*`)
- **Recommandation** : Fusionner en un seul fichier ou extraire CSS/JS commun. La PWA n'est pas une vraie PWA (pas de Service Worker ni manifest).

---

## 🔑 Analyse d'incohérence d'authentification

| Dashboard | Clé token localStorage | Auth guard | Login propre | Redirect portal.html | Auth header | credentials: include |
|-----------|----------------------|------------|--------------|---------------------|-------------|---------------------|
| Hub | `komerce_token` | ✅ | ✅ | ✅ | ❌ | ✅ |
| Mobile | `komerce_token` | ✅ | ❌ | ✅ | ❌ | ✅ |
| PWA Mobile | ❌ (aucun) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Pipeline | `km_token` | ✅ | ✅ | ❌ | ✅ Bearer | ❌ |
| Relais | `komerce_token` | ✅ | ✅ | ✅ | ❌ | ✅ |

**Problèmes** :
- 🔴 PWA Mobile n'a aucune protection d'authentification
- 🟠 Pipeline utilise une clé de token différente (`km_token` vs `komerce_token`)
- 🟠 Pipeline utilise Authorization Bearer ; les autres utilisent credentials: include — approches incompatibles
- 🟠 Trois dashboards ont à la fois un login propre ET une redirection vers portal.html — flow de connexion confus

---

## 📡 Analyse d'incohérence API Base

| Dashboard | API Base | Méthode |
|-----------|----------|---------|
| Hub | `https://komerce-backend-production.up.railway.app` | Hardcodé |
| Mobile | `https://komerce-backend-production.up.railway.app` | Hardcodé |
| PWA Mobile | `https://komerce-backend-production.up.railway.app` | Hardcodé |
| Pipeline | `window.location.origin` | ✅ Dynamique |
| Relais | `https://komerce-backend-production.up.railway.app` | Hardcodé |

**Recommandation** : Adopter l'approche Pipeline (`window.location.origin`) pour tous les dashboards.

---

## Résumé du lot 5

- 🔴 Critiques: 2
- 🟠 Importants: 17
- 🟡 Mineurs: 7
- 📡 Endpoints uniques: 15
- 📄 Fichiers analysés: 5
- 📊 Taille totale: 264 KB

### Endpoints uniques consolidés

| # | Méthode | Endpoint | Utilisé par |
|---|---------|----------|-------------|
| 1 | POST | `/api/auth/login` | Hub, Pipeline, Relais |
| 2 | GET | `/api/auth/me` | Hub, Relais |
| 3 | GET | `/api/dashboard/ops` | Hub, Relais |
| 4 | GET | `/api/dashboard/pipeline` | Pipeline |
| 5 | GET | `/api/admin/orders` | Hub, Relais |
| 6 | GET | `/api/relais` | Hub, Relais |
| 7 | GET | `/api/orders/relais` | Hub, Relais |
| 8 | POST | `/api/scans` | Hub (SCAN 4), Relais (SCAN 5) |
| 9 | POST | `/api/scans/collect` | Relais (SCAN 6 — code) |
| 10 | POST | `/api/scans/verify-qr` | Relais (SCAN 6 — QR) |
| 11 | POST | `/api/orders/{id}/qr-token` | Relais |
| 12 | POST | `/api/orders/{id}/contacted` | Relais |
| 13 | POST | `/api/baskets/share` | Mobile, PWA |
| 14 | GET | `/api/baskets/{code}` | Mobile, PWA |
| 15 | POST | `/api/baskets/gift` | Mobile, PWA |

### Top 5 recommandations prioritaires

1. **🔴 Ajouter l'auth guard à PWA Mobile** — le fichier est accessible sans authentification
2. **🟠 Unifier la gestion des tokens** — `km_token` (Pipeline) vs `komerce_token` (reste) crée des sessions incompatibles
3. **🟠 Extraire l'URL API en configuration** — adopter `window.location.origin` partout comme Pipeline
4. **🟠 Ajouter SRI aux scripts CDN** — 4 scripts sans intégrité (html5-qrcode, qrcode.js)
5. **🟠 Fusionner Mobile/PWA** — 60% de code dupliqué, la "PWA" n'en est pas une
