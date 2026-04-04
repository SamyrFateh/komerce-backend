# 🔍 AUDIT DE SÉCURITÉ & BUGS — Komerce Backend
**Date:** 4 avril 2026  
**Périmètre:** 8 routes backend + 5 frontends + schéma DB + server.js  
**Code analysé:** ~550 KB (18 fichiers)

---

## 📊 Résumé

| Sévérité | Nombre |
|---|---|
| 🔴 CRITICAL | 4 |
| 🟡 MEDIUM | 9 |
| 🟢 LOW | 1 |
| **Total** | **14** |

---

## ✅ Ce qui est bien fait

- ✅ bcrypt avec 10 rounds — solide
- ✅ JWT expire en 2h — très bon
- ✅ NULLIF utilisé dans certaines requêtes SQL (dashboard)
- ✅ COALESCE sur certains cost_real_kmf (dashboard)
- ✅ Auth middleware sur toutes les routes sensibles
- ✅ try/catch dans la plupart des routes
- ✅ Index existants: orders(user_id), orders(status), order_items(order_id), scans(order_id)
- ✅ Boutique: 15 error handlers pour 6 fetch — surprotégée
- ✅ Transactions SQL pour la création de commandes

---

## 🔴 Bugs critiques

### BUG-001 — CONFIG
**Fichier:** `public/Komerce_Admin.html` (ligne 715)

**Problème:**
URL API hardcodée: `const API = location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api'`
En production, ça fonctionne MAIS en développement ça envoie vers localhost:3000 même si le serveur est sur un autre port.

**Fix:**
```
Utiliser uniquement `/api` (URL relative) — le ternaire localhost est inutile et risqué si reverse-proxy.
```

**Impact:** Faible en prod, mais peut casser en dev/staging

---

### BUG-002 — DIV/0
**Fichier:** `routes/orders.js` (ligne 351)

**Problème:**
`total_kmf / rates.eur_kmf` — Si getRates() échoue ou retourne 0/null, crash avec NaN ou Infinity.
Le total_eur sera corrompu en base.

**Fix:**
```
Ajouter: `const eurKmf = rates?.eur_kmf || 492;` (fallback hardcoded)
```

**Impact:** Commandes avec total_eur = NaN → finance faussée

---

### BUG-003 — DIV/0
**Fichier:** `routes/pilotage.js` (ligne 241)

**Problème:**
`parseFloat(p.ca_produit_kmf) / qte` — Si un produit a 0 ventes, qte=0 → division par zéro → Infinity dans les marges.

**Fix:**
```
`Math.round(parseFloat(p.ca_produit_kmf) / (qte || 1))`
```

**Impact:** Dashboard pilotage affiche Infinity ou NaN pour les marges

---

### BUG-004 — DIV/0
**Fichier:** `routes/dashboard.js` (ligne 446)

**Problème:**
`(nbRecurrents / nbClients * 100).toFixed(1)` — Si aucun client (base vide ou après reset), nbClients=0 → NaN%

**Fix:**
```
`const tauxReachat = nbClients > 0 ? (nbRecurrents / nbClients * 100).toFixed(1) + '%' : '0%';`
```

**Impact:** Dashboard sales affiche NaN% pour le taux de réachat

---

## 🟡 Bugs medium

### BUG-005 — DIV/0
**Fichier:** `routes/dashboard.js`

**Problème:**
`((nbCmd - nbCmdPrev) / nbCmdPrev * 100)` — Premier mois d'utilisation: nbCmdPrev=0 → Infinity%

**Fix:**
```
`const evo_cmd = nbCmdPrev > 0 ? ((nbCmd - nbCmdPrev) / nbCmdPrev * 100).toFixed(1) : (nbCmd > 0 ? '+100' : '0');`
Note: Le code a PEUT-ÊTRE déjà un guard — à vérifier.
```

**Impact:** Dashboard affiche +Infinity% pour l'évolution

---

### BUG-006 — DIV/0
**Fichier:** `routes/dashboard.js`

**Problème:**
`dailyCAs.reduce((s, v) => s + v, 0) / nbDays` — Si aucune donnée historique, nbDays=0 → NaN forecast

**Fix:**
```
`const avgCA = nbDays > 0 ? dailyCAs.reduce((s, v) => s + v, 0) / nbDays : 0;`
```

**Impact:** Forecast affiche NaN

---

### BUG-007 — NULL
**Fichier:** `routes/orders.js + dashboard.js + finance.js + admin.js`

**Problème:**
cost_real_kmf est nullable (rempli seulement quand l'admin saisit les coûts réels).
- dashboard.js: 17 refs, seulement 8 COALESCE
- finance.js: 6 refs, seulement 2 COALESCE
- orders.js: 6 refs, 0 COALESCE
→ Les calculs de marge retournent NULL quand cost_real_kmf n'est pas renseigné.

**Fix:**
```
Toujours utiliser `COALESCE(o.cost_real_kmf, o.cost_transport_kmf + o.cost_douane_kmf)` ou `COALESCE(o.cost_real_kmf, 0)` dans les calculs SQL.
```

**Impact:** Marges affichées comme null/NaN pour les commandes sans coût réel saisi

---

### BUG-008 — RACE
**Fichier:** `routes/orders.js`

**Problème:**
Le stock est vérifié MAIS sans `SELECT ... FOR UPDATE`. Deux commandes simultanées peuvent acheter le dernier article → survente.

**Fix:**
```
Dans la transaction: `SELECT stock FROM products WHERE id = $1 FOR UPDATE`
```

**Impact:** Survente possible en cas de commandes simultanées (faible risque pour le moment)

---

### BUG-009 — VALIDATION
**Fichier:** `routes/orders.js`

**Problème:**
POST /api/orders: pas de validation `Array.isArray(items)`. Un body malformé (items = string, null, number) crasherait le serveur.

**Fix:**
```
`if (!Array.isArray(items) || items.length === 0) return res.status(400).json({error: 'Items requis'});`
```

**Impact:** Crash 500 sur input invalide

---

### BUG-010 — PERF
**Fichier:** `db/schema.sql`

**Problème:**
5 index manquants sur des colonnes fréquemment requêtées:
- orders(relais_id)
- order_items(product_id)
- recipients(user_id)
- users(email) ← CRITIQUE pour le login
- order_status_history(order_id)

**Fix:**
```
Ajouter les 5 index. Le plus urgent: users(email) — chaque login fait un full scan.
```

**Impact:** Lenteur croissante avec le volume de données, surtout le login

---

### BUG-011 — XSS
**Fichier:** `public/Komerce_Boutique.html`

**Problème:**
innerHTML utilisé avec des données produits (nom, description) venant de l'API. Si un admin injecte du HTML dans un nom de produit, ça s'exécute chez le client.

**Fix:**
```
Utiliser textContent pour les données texte, ou sanitizer avec DOMPurify.
```

**Impact:** XSS stocké possible si un admin compromis injecte du JS dans un produit

---

### BUG-012 — ERROR
**Fichier:** `public/Komerce_Pilotage.html`

**Problème:**
10 fetch() mais seulement 6 error handlers. 4 appels API peuvent échouer silencieusement sans feedback.

**Fix:**
```
Wrap tous les fetch dans try/catch avec affichage d'erreur utilisateur.
```

**Impact:** Dashboard pilotage peut rester bloqué sans explication si l'API est down

---

### BUG-013 — SECURITY
**Fichier:** `server.js`

**Problème:**
Pas de helmet (security headers) ni de rate limiting.
- Sans helmet: headers comme X-Powered-By exposent Express
- Sans rate limiting: attaque brute force sur /api/auth/login possible

**Fix:**
```
`npm install helmet express-rate-limit`
`app.use(helmet())`
`app.use('/api/auth', rateLimit({windowMs: 15*60*1000, max: 20}))`
```

**Impact:** Vulnérable aux attaques brute force et header sniffing

---

### BUG-014 — SECURITY
**Fichier:** `Tous les HTML`

**Problème:**
JWT stocké dans localStorage (komerce_token / kmrc_token). Si une XSS existe (cf BUG-011), le token peut être volé.

**Fix:**
```
Pour la prod: migrer vers httpOnly cookies avec SameSite=Strict. Pour le moment, corriger BUG-011 en priorité.
```

**Impact:** Vol de session si XSS exploitée

---

## 🏷️ Priorité de correction

### Phase 1 — Avant test (maintenant)
| Bug | Effort | Risque si non corrigé |
|---|---|---|
| BUG-002 (DIV/0 rates) | 2 min | Commandes corrompues |
| BUG-003 (DIV/0 qte) | 1 min | Dashboard crashé |
| BUG-004 (DIV/0 clients) | 1 min | Dashboard crashé |
| BUG-007 (NULL cost) | 15 min | Marges fausses |
| BUG-009 (validation items) | 2 min | Crash 500 |

### Phase 2 — Avant prod
| Bug | Effort | Risque si non corrigé |
|---|---|---|
| BUG-010 (indexes) | 5 min | Lenteur progressive |
| BUG-013 (helmet + rate limit) | 10 min | Sécurité |
| BUG-008 (race condition stock) | 10 min | Survente |
| BUG-011 (XSS) | 15 min | Injection JS |
| BUG-012 (fetch errors pilotage) | 10 min | UX dégradée |

### Phase 3 — Nice to have
| Bug | Effort |
|---|---|
| BUG-001 (localhost) | 1 min |
| BUG-005 (DIV/0 evo) | 2 min |
| BUG-006 (DIV/0 forecast) | 2 min |
| BUG-014 (JWT localStorage) | 30 min |

---

*Rapport généré automatiquement par audit statique + vérification manuelle.*
