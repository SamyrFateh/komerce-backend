# 🔍 Audit de Code — Lot A — Middleware (auth, rate-limit, upload)

**Date :** 5 avril 2026
**Projet :** Komerce Backend (`SamyrFateh/komerce-backend`)
**Fichiers audités :**

| # | Fichier | Taille |
|---|---------|--------|
| 1 | `middleware/auth.js` | 4 318 octets |
| 2 | `middleware/rate-limit.js` | 2 962 octets |
| 3 | `middleware/upload.js` | 1 510 octets |

---

## 1. `middleware/auth.js` — Authentification JWT

### Sécurité

#### 🟠 IMPORTANT — Pas de vérification que `JWT_SECRET` est défini

```js
const decoded = jwt.verify(token, process.env.JWT_SECRET, { ... });
```

Si `process.env.JWT_SECRET` est `undefined` ou une chaîne vide, `jsonwebtoken` peut se comporter de manière imprévisible. En environnement de développement mal configuré, cela pourrait permettre la vérification de tokens arbitraires.

**Recommandation :** Ajouter une vérification au démarrage du module :
```js
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET manquant ou trop court');
}
```

#### 🟠 IMPORTANT — Le cache utilisateur ne s'invalide pas lors d'un changement de rôle ou désactivation de compte

```js
const USER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
```

Un utilisateur dont le rôle est modifié (ou dont le compte est désactivé/supprimé) conserve ses anciens droits pendant **jusqu'à 5 minutes**. Pour une application e-commerce avec gestion de paiements, ce délai peut être problématique.

**Recommandation :** Implémenter une invalidation explicite du cache lors des opérations admin (changement de rôle, suspension). Ou réduire le TTL à 1–2 minutes.

#### 🟡 MINEUR — Fuite du rôle utilisateur dans la réponse d'erreur 403

```js
return res.status(403).json({
  error: `Accès refusé — rôle requis : ${roles.join(' ou ')}`,
  your_role: req.user.role,
});
```

Le champ `your_role` révèle à un attaquant le rôle exact de l'utilisateur compromis, ce qui facilite l'énumération et l'ingénierie sociale. Les rôles requis sont aussi exposés.

**Recommandation :** Retourner un message générique en production. Logger les détails côté serveur uniquement.

#### 🟡 MINEUR — Stratégie d'éviction du cache simpliste

```js
if (userCache.size > 10_000) {
  const oldest = userCache.keys().next().value;
  userCache.delete(oldest);
}
```

La suppression d'une seule entrée quand la limite est atteinte signifie qu'à chaque nouvelle requête au-delà de 10 000 utilisateurs, une seule entrée est purgée. Cela ne réduit pas efficacement la taille. De plus, l'entrée supprimée est la première insérée (FIFO) et non la moins récemment accédée (LRU).

**Recommandation :** Utiliser un module LRU (`lru-cache`) ou purger par lot (ex. supprimer les 1 000 entrées les plus anciennes).

### Qualité du code

- ✅ **Excellente documentation** : en-tête de module détaillé, JSDoc sur les fonctions, références aux bugs corrigés (BUG-014)
- ✅ **Bonne séparation** : `extractToken`, `authenticate`, `requireRole` sont bien découpés
- ✅ **Gestion d'erreurs correcte** : distinction `TokenExpiredError` vs erreur générique, messages utilisateurs clairs
- ✅ **Sécurité JWT solide** : verrouillage `algorithms: ['HS256']`, `maxAge: '24h'`, priorité cookie httpOnly
- ⚠️ Le cache mémoire est documenté comme devant être remplacé par Redis en multi-instance — à planifier

### Dépendances

| Type | Élément |
|------|---------|
| Package externe | `jsonwebtoken` |
| Module interne | `../db` (pool PostgreSQL) |
| Table DB | `users` (`id`, `full_name`, `email`, `phone`, `role`, `currency_pref`) |
| Utilisé par | Toutes les routes protégées via `authenticate`, `requireRole`, `requireAdmin` |

### Observations

- Le pattern cookie httpOnly + fallback Bearer est un bon compromis sécurité/compatibilité mobile
- Le nommage du cookie (`kmrc_jwt`) est cohérent avec le projet
- La requête SQL est paramétrée (`$1`) — pas d'injection SQL possible
- Le module exporte correctement les 3 fonctions nécessaires

---

## 2. `middleware/rate-limit.js` — Limitation de débit

### Sécurité

#### 🟠 IMPORTANT — Stockage en mémoire incompatible avec le multi-instance

`express-rate-limit` utilise par défaut un store en mémoire. Si l'application est déployée sur plusieurs instances (Railway scaling, PM2 cluster), chaque instance a son propre compteur. Un attaquant peut multiplier ses tentatives par le nombre d'instances.

**Recommandation :** Utiliser `rate-limit-redis` ou `rate-limit-memcached` en production. C'est particulièrement critique pour `authLimiter` (brute-force login) et `cashConfirmLimiter` (brute-force code de paiement).

#### 🟠 IMPORTANT — Dépendance au `trust proxy` d'Express non documentée

Les limiteurs sont basés sur l'IP client. Sur Railway (derrière un reverse proxy), si `app.set('trust proxy', ...)` n'est pas configuré dans `server.js`, toutes les requêtes apparaîtront avec la même IP (celle du proxy), bloquant tous les utilisateurs simultanément.

**Recommandation :** Documenter et vérifier que `trust proxy` est correctement configuré dans `server.js`. Ajouter un commentaire dans ce fichier.

#### 🟡 MINEUR — Le `globalLimiter` à 100 req / 15 min peut être trop restrictif

100 requêtes par 15 minutes (~6,7 req/min) est bas pour une application SPA avec dashboard qui effectue de nombreux appels API en parallèle (chargement initial, polling, navigation).

**Recommandation :** Considérer 200–300 req/15min pour le global, ou 500 si l'application fait beaucoup de polling. Monitorer les 429 en production.

#### 🟡 MINEUR — `dashboardLimiter` exporté mais absent du commentaire d'utilisation

Le `dashboardLimiter` est défini et exporté mais pas mentionné dans le bloc de commentaires en tête de fichier qui décrit l'utilisation dans `server.js`.

**Recommandation :** Mettre à jour le commentaire d'en-tête pour inclure `dashboardLimiter`.

### Qualité du code

- ✅ **Bonne couverture** : les endpoints critiques (auth, cash confirm, scan, orders, dashboard) sont tous protégés
- ✅ **Configuration propre** : `standardHeaders: true`, `legacyHeaders: false` — conforme aux bonnes pratiques
- ✅ **Messages d'erreur en français** cohérents avec le reste de l'application
- ✅ **Skip health checks** : le global limiter exclut `/health` et `/ready` — bon pattern pour les probes Kubernetes/Railway
- ⚠️ Pas de logging quand un rate limit est déclenché — utile pour la détection d'abus

### Dépendances

| Type | Élément |
|------|---------|
| Package externe | `express-rate-limit` |
| Module interne | Aucun |
| Utilisé par | `server.js` — appliqué en middleware global et par route |

### Observations

- Le commentaire expliquant le choix de 3 req/min pour `cashConfirmLimiter` (keyspace limité du `cash_ref_code`) montre une bonne compréhension des risques métier
- Le pattern est bien structuré : un fichier centralisé plutôt que des limiteurs dispersés dans chaque route
- Considérer l'ajout d'un `keyGenerator` personnalisé combinant IP + userId pour les routes authentifiées (plus précis)

---

## 3. `middleware/upload.js` — Upload d'images produits

### Sécurité

#### 🔴 CRITIQUE — Validation du fichier basée uniquement sur l'extension

```js
const fileFilter = (_req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Format image non supporté...'));
  }
};
```

Le filtre ne vérifie que l'extension du nom de fichier original, **pas le contenu réel du fichier** (magic bytes / MIME type). Un attaquant peut :
1. Renommer un fichier HTML/SVG malveillant en `.jpg` et l'uploader
2. Si le navigateur fait du content-type sniffing (absence de `X-Content-Type-Options: nosniff`), cela peut mener à du **XSS stocké**
3. Un polyglot file (à la fois image valide et HTML/JS) peut être exécuté dans certains contextes

**Recommandation :**
- Vérifier les magic bytes avec un package comme `file-type` ou `mmmagic`
- S'assurer que `X-Content-Type-Options: nosniff` est configuré dans Express (via `helmet`)
- Retraiter les images avec `sharp` pour éliminer tout payload caché

#### 🟠 IMPORTANT — Fichiers servis directement depuis `public/` sans headers de sécurité

```js
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'products');
```

Les fichiers sont stockés dans le répertoire `public/` qui est typiquement servi statiquement par Express (`express.static`). Sans headers de sécurité (`Content-Security-Policy`, `X-Content-Type-Options: nosniff`), les fichiers uploadés pourraient être exploités pour du XSS.

**Recommandation :** Configurer `express.static` avec des headers stricts, ou servir les uploads via une route dédiée qui force `Content-Type: image/*` et `Content-Disposition: inline`.

#### 🟠 IMPORTANT — Stockage éphémère sur Railway (données perdues au redéploiement)

Le `TODO` en commentaire le confirme :
```
⚠️ Railway : le filesystem est éphémère. Les images uploadées
survivent aux restarts mais PAS aux redéploiements.
```

Cela signifie que **toutes les images produits sont perdues** à chaque déploiement. Pour un site e-commerce, c'est un risque fonctionnel majeur.

**Recommandation :** Migrer vers S3, Cloudflare R2, ou un autre stockage objet persistant. C'est déjà identifié comme TODO Phase 2 — à prioriser.

#### 🟡 MINEUR — Pas de limite sur le nombre de fichiers uploadés simultanément

Le middleware `multer` est exporté tel quel sans préciser `.single()`, `.array()`, ou `.fields()`. Si un handler utilise `upload.array('images')` sans limite, un attaquant pourrait envoyer un grand nombre de fichiers.

**Recommandation :** Préciser les limites dans le middleware ou documenter que chaque route doit appeler `upload.single('image')` ou `upload.array('images', 5)`.

### Qualité du code

- ✅ **Noms de fichiers sécurisés** : utilisation de `crypto.randomBytes(16)` — pas de collision, pas de path traversal via le nom original
- ✅ **Limite de taille** : 5 Mo est raisonnable pour des images produits e-commerce
- ✅ **Création automatique** du dossier upload avec `recursive: true`
- ⚠️ `fs.existsSync` / `mkdirSync` sont synchrones au chargement du module — acceptable au démarrage mais pas en runtime
- ⚠️ `'use strict'` est présent ici mais absent des autres middlewares — incohérence

### Dépendances

| Type | Élément |
|------|---------|
| Packages externes | `multer` |
| Modules Node.js | `path`, `crypto`, `fs` |
| Système de fichiers | `public/uploads/products/` |
| Utilisé par | Routes produits (création/édition de produit avec image) |

### Observations

- Le pattern est fonctionnel pour du MVP mais insuffisant pour la production
- La génération aléatoire des noms de fichiers est un bon choix de sécurité
- L'absence de traitement d'image (redimensionnement, compression) implique que les images sont servies telles quelles — impact potentiel sur la performance frontend
- Considérer l'ajout de `sharp` pour : validation du contenu, redimensionnement, conversion WebP, suppression des métadonnées EXIF (qui peuvent contenir des données sensibles comme la géolocalisation)

---

## 📊 Tableau récapitulatif

| Fichier | 🔴 Critiques | 🟠 Importants | 🟡 Mineurs |
|---------|:------------:|:-------------:|:----------:|
| `middleware/auth.js` | 0 | 2 | 2 |
| `middleware/rate-limit.js` | 0 | 2 | 2 |
| `middleware/upload.js` | 1 | 2 | 1 |
| **TOTAL** | **1** | **6** | **5** |

## 🎯 Actions prioritaires recommandées

1. **🔴 P0** — `upload.js` : Ajouter la validation des magic bytes et le header `X-Content-Type-Options: nosniff` pour prévenir le XSS stocké
2. **🟠 P1** — `upload.js` : Migrer vers un stockage objet persistant (S3/R2) avant tout déploiement supplémentaire en production
3. **🟠 P1** — `auth.js` : Vérifier que `JWT_SECRET` est défini et suffisamment long au démarrage
4. **🟠 P1** — `rate-limit.js` : Configurer `trust proxy` dans Express et documenter la dépendance
5. **🟠 P1** — `rate-limit.js` : Migrer vers un store Redis pour le rate limiting en multi-instance
6. **🟠 P1** — `auth.js` : Réduire le TTL du cache ou ajouter une invalidation explicite
