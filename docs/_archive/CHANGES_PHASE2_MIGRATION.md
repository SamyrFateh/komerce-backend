# 🔶 KOMERCE — Point 6 Phase 2 : Migration des constantes

> **Date** : 7 avril 2026 · **Scope** : `komerce-backend`  
> **Roadmap** : Point 6 — Gouvernance Opérationnelle · Phase 2  
> **Principe** : _"Le code définit les mécanismes. La base définit les seuils. Le terrain ajuste les seuils."_

---

## 📋 Résumé des modifications

| # | Fix | Fichier | Description |
|:-:|:---:|---------|-------------|
| 1 | Fix 1 | `utils/rules.js` | Ajout `getRuleNumber()` et `getRuleString()` — wrappers typés |
| 2 | Fix 2 | `routes/orders.js` | 🔒 Correction injection SQL — requêtes paramétrées `/problems` |
| 3 | Fix 3 | `routes/orders.js` | 🔒 Correction injection SQL — `pickup_code` paramétré |
| 4 | Fix 4 | `utils/pricing.js` | Moteur pricing v6.5 — 100% async + `getRuleNumber()` |
| 5 | Fix 5 | `utils/rates.js` | Taux de change — fallback harmonisé via `business_rules` |
| 6 | Fix 6 | `utils/sms.js` | Rappels cash — délais dynamiques (plus de 12h/36h en dur) |
| 7 | Fix 7 | `server.js` | Cron cash — intervalle configurable depuis `business_rules` |
| 8 | Fix 8 | `server.js` | Seed — 10 nouvelles règles pricing dans `business_rules` |
| 9 | Fix 9 | `server.js` | Seed — règles loyalty marquées "info-only" |
| 10 | Nouveau | `db/migrations/008` | Migration SQL — insert des règles pricing |

---

## 📂 Fichiers modifiés

### 1. `utils/rules.js` — Fix 1

**Ajout** de deux fonctions wrappers typés autour de `getRule()` :

```javascript
// Safe wrapper — always returns a Number
async function getRuleNumber(key, defaultValue) {
  const val = await getRule(key, defaultValue);
  const num = Number(val);
  return Number.isFinite(num) ? num : defaultValue;
}

// Safe wrapper — always returns a String
async function getRuleString(key, defaultValue) {
  const val = await getRule(key, defaultValue);
  return typeof val === 'string' ? val : String(defaultValue);
}
```

**Exports mis à jour** :
```javascript
module.exports = {
  getRule,
  getRuleNumber,   // ← nouveau
  getRuleString,   // ← nouveau
  getAllRules,
  invalidateCache,
  reloadRules,
};
```

**Pourquoi ?** `getRuleNumber()` empêche toute injection SQL si la valeur est interpolée dans une requête (le cast `Number()` garantit un résultat numérique ou le fallback). `getRuleString()` garantit un type `string`.

---

### 2. `routes/orders.js` — Fix 2 & 3

#### Fix 2 : Injection SQL dans `/problems` (🔒 Sécurité)

**Avant** — valeurs interpolées directement dans le SQL :
```javascript
const prepDays = await getRule('PROBLEM_PREP_BLOCKED_DAYS', 4);
// ... puis dans la requête :
// ... INTERVAL '${prepDays} days' ...  ← 💀 INJECTION SQL
```

**Après** — requêtes paramétrées :
```javascript
const prepDays = await getRuleNumber('PROBLEM_PREP_BLOCKED_DAYS', 4);
// ... paramètres pushés dans le tableau params[] :
const prepDaysIdx = params.length + 1;
params.push(prepDays);
// ... puis dans la requête :
// ... INTERVAL '1 day' * $${prepDaysIdx} ...  ← ✅ PARAMÉTRÉ
```

**5 seuils migrés** : `prepDays`, `transitDays`, `waitDays`, `noNotifHours`, `stalledDays`

#### Fix 3 : Injection SQL dans `pickup_code` (🔒 Sécurité)

**Avant** — code généré concaténé dans le SQL :
```javascript
pickupCodePatch = `, pickup_code = '${newCode}'`;  // ← 💀 INJECTION
await client.query(`UPDATE orders SET status = $1${pickupCodePatch}...`);
```

**Après** — paramètre séparé :
```javascript
pickupCodeValue = newCode;
if (pickupCodeValue) {
  await client.query(
    `UPDATE orders SET status = $1, pickup_code = $2, updated_at = NOW() WHERE id = $3`,
    [status, pickupCodeValue, order.id]  // ← ✅ PARAMÉTRÉ
  );
}
```

---

### 3. `utils/pricing.js` — Fix 4

**Réécriture complète** du moteur de pricing en v6.5 :

| Aspect | Avant (v6.4) | Après (v6.5) |
|--------|:------------:|:------------:|
| Fonctions | Synchrones | **async** |
| Paramètres | Hardcodés | **`getRuleNumber()`** |
| Taux de change | `DEFAULT_RATES` statique | **`getDefaultRates()` async** |
| Configurabilité | Aucune | **10 paramètres via admin UI** |

**10 paramètres pricing configurables** :

| Clé | Valeur défaut | Description |
|-----|:-------------:|-------------|
| `COMMISSION_AGENT_PCT` | 5% | Commission agent source S1 |
| `TRANSPORT_DXB_KMF` | 500 | Transport intra-Dubai |
| `TRANSITAIRE_PCT` | 2% | Commission transitaire |
| `TRANSITAIRE_FIXED_KMF` | 450 | Frais fixes transitaire |
| `PORTUAIRES_KMF` | 1200 | Frais portuaires |
| `TRANSPORT_RELAIS_KMF` | 840 | Transport relais |
| `COMMISSION_RELAIS_STANDARD_KMF` | 500 | Commission relais standard |
| `COMMISSION_RELAIS_SHOWROOM_KMF` | 750 | Commission relais showroom |
| `FRAIS_STRIPE_PCT` | 2.5% | Frais Stripe diaspora |
| `MARGE_PCT` | 12% | Marge commerciale |

---

### 4. `utils/rates.js` — Fix 5

**Réécriture** — utilise `getRuleNumber()` pour les taux fallback :

```javascript
async function getRates() {
  const { rows } = await db.query(
    'SELECT eur_kmf, aed_kmf FROM exchange_rates ORDER BY valid_from DESC LIMIT 1'
  );
  if (rows[0]) return rows[0];
  // Fallback via business_rules (elles-mêmes avec fallback hardcodé)
  return {
    eur_kmf: await getRuleNumber('EUR_KMF_FALLBACK', 492),
    aed_kmf: await getRuleNumber('AED_KMF_FALLBACK', 138),
  };
}
```

---

### 5. `utils/sms.js` — Fix 6

**Rappels cash relais dynamiques** :

| Aspect | Avant | Après |
|--------|:-----:|:-----:|
| Délai 1er rappel | **12h** en dur | `cashTimeoutHours / 3` |
| Délai annulation | **36h** en dur | `CASH_PAYMENT_TIMEOUT_HOURS` |
| SQL `INTERVAL` | `'12 hours'` / `'36 hours'` | `'1 hour' * $1` (paramétré) |
| Message SMS | "Delai restant : 24h" | Calculé dynamiquement |
| Raison annulation | "après 36h" | `après ${cashTimeoutHours}h` |

---

### 6. `server.js` — Fix 7, 8, 9

#### Fix 7 : Cron dynamique

```javascript
// Avant : intervalle fixe
setInterval(async () => { ... }, 60 * 60 * 1000);

// Après : intervalle depuis business_rules
(async () => {
  let intervalMin = 60;
  try {
    intervalMin = await _getRuleNum('CASH_REMINDER_INTERVAL_MIN', 60);
  } catch (_) { /* fallback 60min */ }
  setInterval(async () => { ... }, intervalMin * 60 * 1000);
})();
```

#### Fix 8 : 10 règles pricing dans le seed

Le seed `business_rules` passe de **36 à 46 règles**. Les 10 nouvelles règles correspondent aux paramètres du moteur de pricing (voir tableau Fix 4 ci-dessus).

#### Fix 9 : Règles loyalty marquées "info-only"

Les 6 règles loyalty reçoivent la description `'Info — géré via PUT /api/loyalty/tiers/:id'` pour indiquer qu'elles sont gérées par l'API dédiée et ne doivent pas être modifiées directement dans la page config admin.

---

### 7. `db/migrations/008_pricing_rules.sql` — Nouveau fichier

Migration SQL idempotente (`ON CONFLICT DO NOTHING`) qui insère les 10 règles pricing dans `business_rules`. À exécuter si le seed n'a pas encore été re-lancé.

---

## 🏗️ Arborescence des fichiers livrés

```
fixes/
├── utils_rules.js                      ← utils/rules.js modifié
├── utils_rates.js                      ← utils/rates.js modifié
├── utils_pricing.js                    ← utils/pricing.js modifié
├── utils_sms.js                        ← utils/sms.js modifié
├── routes_orders.js                    ← routes/orders.js modifié
├── server.js                           ← server.js modifié
├── db_migrations_008_pricing_rules.sql ← nouveau fichier migration
└── CHANGES.md                          ← ce fichier
```

## 📦 Instructions de déploiement

1. **Copier les fichiers** dans le repo aux bons emplacements :
   - `utils_rules.js` → `utils/rules.js`
   - `utils_rates.js` → `utils/rates.js`
   - `utils_pricing.js` → `utils/pricing.js`
   - `utils_sms.js` → `utils/sms.js`
   - `routes_orders.js` → `routes/orders.js`
   - `server.js` → `server.js`
   - `db_migrations_008_pricing_rules.sql` → `db/migrations/008_pricing_rules.sql`

2. **Exécuter la migration** (si le seed n'a pas été relancé) :
   ```bash
   psql $DATABASE_URL < db/migrations/008_pricing_rules.sql
   ```

3. **Redémarrer le serveur** — les nouvelles valeurs se chargent via le cache `business_rules` (TTL 1 min).

---

## ✅ Vérifications effectuées

| Check | Résultat |
|-------|:--------:|
| `getRuleNumber` présent dans rules.js | ✅ |
| `getRuleString` présent dans rules.js | ✅ |
| Exports mis à jour dans rules.js | ✅ |
| SQL injection `pickupCodePatch` supprimée | ✅ |
| Interpolations `${prepDays}` etc. supprimées | ✅ |
| Requêtes paramétrées `$N` dans orders.js | ✅ |
| `INTERVAL '12 hours'` supprimé de sms.js | ✅ |
| `INTERVAL '36 hours'` supprimé de sms.js | ✅ |
| Cron intervalle dynamique dans server.js | ✅ |
| 10 règles pricing dans le seed | ✅ |
| Règles loyalty marquées info-only | ✅ |
| Pricing async + getRuleNumber | ✅ |
| Rates fallback via getRuleNumber | ✅ |

---

> 🔒 _"Safe by default : si la DB est vide, les valeurs par défaut (actuelles) s'appliquent. Zéro breaking change."_
