# 🔍 Audit de Code — Lot B — Utils (email, pricing, rates, reference, sms)

**Date** : 5 avril 2026
**Projet** : Komerce Backend
**Fichiers audités** : `utils/email.js`, `utils/pricing.js`, `utils/rates.js`, `utils/reference.js`, `utils/sms.js`

---

## 📄 utils/email.js (6,7 Ko)

### Sécurité

🟠 **IMPORTANT — Injection HTML dans le template email**
Les variables utilisateur (`order.reference`, `order.relais_name`, noms de produits `i.name`) sont injectées directement dans le template HTML via interpolation de chaîne (template literals) sans aucun échappement :
```js
<p style="...">${order.reference}</p>
// ...
<td style="...">${i.name || 'Produit'}</td>
// ...
${order.relais_name ? `<p style="...">${order.relais_name}</p>` : ''}
```
Si un nom de produit ou un nom de relais contient du HTML/JavaScript malveillant, il sera rendu tel quel dans le client email du destinataire. Risque de phishing ou de détournement visuel de l'email.
**→ Recommandation** : Échapper toutes les variables avec une fonction `escapeHtml()` avant insertion dans le template.

🟡 **MINEUR — URL de production en dur dans le fallback**
```js
const trackingUrl = (process.env.FRONTEND_URL || 'https://komerce-backend-production.up.railway.app') + '/#tracking';
```
L'URL de fallback pointe vers l'infrastructure Railway de production. Si `FRONTEND_URL` n'est pas configurée, l'URL backend (pas frontend) est utilisée, ce qui est probablement incorrect.
**→ Recommandation** : Utiliser une URL frontend par défaut cohérente ou lever une erreur si la variable n'est pas définie.

🟡 **MINEUR — Logging du contenu email en mode dev**
```js
console.log(`[EMAIL-DEV] Body preview: ${html.replace(/<[^>]*>/g, '').substring(0, 150)}...`);
```
Le contenu de l'email (potentiellement sensible : noms, références, montants) est loggé en console. En environnement de développement partagé ou CI, ces logs pourraient être exposés.

🟡 **MINEUR — Logging de la configuration SMTP au démarrage**
```js
console.log(`📧 Email transporter configuré (${SMTP_HOST}:${SMTP_PORT})`);
```
Le host et port SMTP sont loggés. Information mineure mais contribue au footprint d'information.

### Qualité du code

- **Template monolithique** : Le template HTML de confirmation de commande (~60 lignes de HTML inline) est directement dans le code JS. Cela rend la maintenance difficile et empêche les non-développeurs d'éditer les templates.
  **→ Recommandation** : Externaliser les templates dans des fichiers `.html` ou utiliser un moteur de templating (Handlebars, EJS).

- **Bonne gestion du mode dev** : Le fallback console quand SMTP n'est pas configuré est bien pensé. Les retours structurés (`{ skipped, reason }`, `{ sent, messageId }`) facilitent le debug.

- **Pas de validation du format email** : La fonction `sendEmail` vérifie que `to` n'est pas falsy, mais ne valide pas le format de l'adresse email.

- **Fonction `sendOrderConfirmation` trop couplée** : Elle connaît la structure exacte de `order` et `items`, ce qui la rend fragile aux changements de schéma.

### Dépendances

| Type | Détail |
|------|--------|
| Package externe | `nodemailer` |
| Variables d'env | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `FRONTEND_URL` |
| Modules internes | Aucun |
| Tables DB | Aucune directement |
| Utilisé par | Routes de commande (envoi de confirmation) |

### Observations

✅ Bonne architecture de fallback dev/prod avec retours structurés.
⚠️ Manque un système de templates externalisés pour faciliter la maintenance des emails.
⚠️ Pas de mécanisme de retry en cas d'échec SMTP.

---

## 📄 utils/pricing.js (3,7 Ko)

### Sécurité

🟡 **MINEUR — Pas de validation des entrées**
La fonction `calcPrix` ne valide aucun paramètre :
```js
function calcPrix({ prix_aed, category = 'electronique', source = 'S1', qty = 1, ... })
```
Un `prix_aed` négatif, `NaN`, ou extrêmement élevé passera sans erreur et produira des prix incohérents. Un `qty` de 0 ou négatif aussi.
**→ Recommandation** : Ajouter des gardes en entrée (`if (prix_aed <= 0) throw ...`).

### Qualité du code

- 🔴 **CRITIQUE — Incohérence des taux par défaut avec `rates.js`**
  ```js
  // pricing.js
  const DEFAULT_RATES = { eur_kmf: 492, aed_kmf: 138, fret_eur_m3: 180 };
  // rates.js
  const RATES_FALLBACK = { eur_kmf: 495, aed_kmf: 139 };
  ```
  Les deux modules ont des valeurs de fallback **différentes**. Si `pricing.js` est appelé sans passer les taux de `rates.js`, les calculs utiliseront des taux incohérents avec le reste de l'application. De plus, `rates.js` ne fournit pas `fret_eur_m3`, ce qui forcera le fallback `180` dans `calcFret`.
  **→ Recommandation** : Centraliser TOUS les taux par défaut dans `rates.js` et les importer dans `pricing.js`. Ajouter `fret_eur_m3` à `rates.js`.

- **Bonne structure** : La décomposition en 16 étapes est claire et documentée. Le retour détaillé avec `detail` et `meta` est excellent pour le debug et l'affichage.

- **Magic numbers** : Plusieurs constantes sont en dur sans explication :
  ```js
  const transport_dxb = 500;      // 500 quoi ? KMF ?
  const transitaire = Math.round(cif * 0.02) + 450;  // 450 = ?
  const portuaires = 1200;        // Fixe ?
  const transport_relais = 840;   // Fixe ?
  const commission_relais = relais_type === 'showroom' ? 750 : 500;
  ```
  **→ Recommandation** : Extraire ces valeurs dans un objet `COSTS` documenté en tête de fichier.

- **Redondance dans `calcFret`** :
  ```js
  (rates.fret_eur_m3 || 180)
  ```
  `DEFAULT_RATES` contient déjà `fret_eur_m3: 180`. Ce `|| 180` est un double fallback qui masquerait un bug si le taux devait être 0.

### Dépendances

| Type | Détail |
|------|--------|
| Package externe | Aucun |
| Modules internes | Aucun (autonome) |
| Tables DB | Aucune (pur calcul) |
| Utilisé par | Routes produits, routes commandes, module baskets, module ceremony |

### Observations

✅ Module de calcul pur (sans side effects) — facile à tester unitairement.
✅ Excellente traçabilité avec l'objet `detail` retourné.
⚠️ Incohérence de taux avec `rates.js` — **risque fonctionnel majeur**.
⚠️ Les constantes métier (coûts portuaires, transport, etc.) devraient être configurables ou au minimum documentées.

---

## 📄 utils/rates.js (719 o)

### Sécurité

🟡 **MINEUR — Pas de gestion d'erreur sur la requête DB**
```js
async function getRates() {
  const { rows } = await db.query(
    'SELECT eur_kmf, aed_kmf FROM exchange_rates ORDER BY valid_from DESC LIMIT 1'
  );
  return rows[0] || RATES_FALLBACK;
}
```
Si la connexion DB échoue, l'exception remonte non catchée. Aucun try/catch ni fallback en cas d'erreur réseau/DB.
**→ Recommandation** : Envelopper dans un try/catch et retourner `RATES_FALLBACK` en cas d'erreur, avec un log d'avertissement.

### Qualité du code

- 🟠 **IMPORTANT — `fret_eur_m3` manquant dans `RATES_FALLBACK`**
  Le module `pricing.js` attend `rates.fret_eur_m3` mais `rates.js` ne le fournit jamais (ni depuis la DB, ni dans le fallback). Cela signifie que le taux de fret n'est jamais piloté par la base de données.
  **→ Recommandation** : Ajouter `fret_eur_m3` à la table `exchange_rates` et au fallback.

- 🟠 **IMPORTANT — Taux de fallback incohérents avec `pricing.js`**
  Comme mentionné dans l'audit de `pricing.js` : `RATES_FALLBACK = { eur_kmf: 495, aed_kmf: 139 }` vs `DEFAULT_RATES = { eur_kmf: 492, aed_kmf: 138 }`.

- **Pas de cache** : Chaque appel à `getRates()` exécute une requête SQL. Si cette fonction est appelée plusieurs fois par requête HTTP (ex: calcul de prix de N produits), cela multiplie les requêtes inutilement.
  **→ Recommandation** : Implémenter un cache en mémoire avec TTL (ex: 5 minutes).

- **Code concis et lisible** : Le module est simple, bien documenté, et fait exactement ce qu'il doit faire.

### Dépendances

| Type | Détail |
|------|--------|
| Package externe | Aucun |
| Modules internes | `../db` (pool PostgreSQL) |
| Tables DB | `exchange_rates` (colonnes : `eur_kmf`, `aed_kmf`, `valid_from`) |
| Utilisé par | Routes produits, pricing, baskets, modules ayant besoin des taux |

### Observations

✅ Bonne centralisation des taux de change (remplace les duplications mentionnées dans le commentaire).
⚠️ Manque `fret_eur_m3` — le taux de fret n'est pas pilotable.
⚠️ Pas de cache — potentiellement N requêtes SQL par requête HTTP.

---

## 📄 utils/reference.js (2,5 Ko)

### Sécurité

✅ **Bonne pratique** : Utilisation de `crypto.randomInt()` et `crypto.randomBytes()` pour la génération de codes. Beaucoup plus sûr que `Math.random()`.

✅ **Bonne pratique** : Utilisation de séquences PostgreSQL pour les références commande/expédition — garantit l'unicité sans risque de collision.

🟡 **MINEUR — Biais de modulo dans `generateBasketCode()`**
```js
const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 31 caractères
const bytes = crypto.randomBytes(4);
for (let i = 0; i < 4; i++) {
  code += chars[bytes[i] % chars.length]; // 256 % 31 = 8
}
```
L'alphabet contient 31 caractères. `256 % 31 = 8`, donc les 8 premiers caractères (`A-H`) ont une probabilité ~3,3% au lieu de ~3,2%. Le biais est très faible (~3% de différence relative) et non exploitable en pratique, mais c'est une imperfection cryptographique.
**→ Recommandation optionnelle** : Utiliser un rejection sampling ou `crypto.randomInt(0, 31)` pour chaque caractère.

🟡 **MINEUR — Espace de codes limité pour les codes numériques**
`generateCashCode()` et `generatePickupCode()` génèrent des codes à 6 chiffres (900 000 valeurs possibles). Pour un volume élevé de commandes, le risque de collision augmente. Le code ne vérifie pas l'unicité en base.
**→ Recommandation** : Pour les codes critiques (cash/retrait), vérifier l'unicité en base ou allonger le code.

### Qualité du code

- **Excellente documentation** : JSDoc complet, prérequis SQL documentés, commentaires de version.
- **Bon design** : `db` est passé en paramètre (injection de dépendance) pour `generateOrderRef` et `generateShipmentRef`, facilitant les tests.
- **Exclusion des caractères ambigus** : L'alphabet du basket code exclut `I`, `O`, `0`, `1` — bonne UX.
- **Padding cohérent** : `padStart(6, '0')` pour les commandes, `padStart(4, '0')` pour les expéditions.

### Dépendances

| Type | Détail |
|------|--------|
| Package externe | Aucun |
| Modules internes | `crypto` (Node.js built-in) |
| Tables DB | Séquences : `order_ref_seq`, `shipment_ref_seq` |
| Prérequis | `migration-round2.sql` (création des séquences) |
| Utilisé par | Routes commandes, routes expéditions, module baskets |

### Observations

✅ Module exemplaire en termes de sécurité cryptographique.
✅ Injection de dépendance pour `db` — excellent pour la testabilité.
✅ Documentation très complète avec prérequis de migration.

---

## 📄 utils/sms.js (7,4 Ko)

### Sécurité

🟠 **IMPORTANT — Accès direct à `db.pool` non garanti**
```js
const client = await db.pool.connect();
```
Le module accède directement à `db.pool` (ligne ~130), mais le module `db` exporte-t-il `pool` ? Si `db` est un wrapper qui n'expose que `query()`, cet appel échouera en production. Cela constitue un couplage fort avec l'implémentation interne du module `db`.
**→ Recommandation** : Exposer une méthode `db.getClient()` ou `db.transaction(callback)` dans le module `db`.

🟡 **MINEUR — Logging des numéros de téléphone en mode dev**
```js
console.log(`[SMS DEV] to=${to} | type=${type} | "${message}"`);
```
Les numéros de téléphone et le contenu des SMS (potentiellement avec codes de retrait) sont loggés en console.

🟡 **MINEUR — Pas de rate limiting sur l'envoi de SMS**
Aucune limitation du nombre de SMS envoyés par minute/heure. En cas de bug dans le cron ou d'appel en boucle, l'API Africa's Talking serait bombardée, avec un coût financier potentiel.

🟡 **MINEUR — Condition d'initialisation fragile**
```js
if (atKey && atUser && atKey !== '...' && atUser !== 'komerce') {
```
La vérification `atKey !== '...'` et `atUser !== 'komerce'` semble correspondre à des valeurs placeholder dans un `.env.example`. C'est fragile — si les placeholders changent, la condition ne fonctionnera plus.
**→ Recommandation** : Utiliser une variable `SMS_ENABLED=true` explicite.

### Qualité du code

- ✅ **Excellente gestion transactionnelle pour H+36** : L'annulation de commande + restauration du stock est correctement enveloppée dans une transaction PostgreSQL avec ROLLBACK en cas d'erreur. L'envoi SMS est hors transaction — design correct car non critique.

- ✅ **Bonne validation de téléphone** : Regex E.164 (`/^\+[1-9]\d{6,14}$/`) validée avant toute tentative d'envoi.

- ✅ **Logging en base systématique** : Chaque SMS est tracé dans `sms_log` avec statut, ID Africa's Talking, et horodatage.

- 🟠 **Fonction `processCashRelaisReminders` trop longue** (~80 lignes) : Cette fonction gère à la fois les rappels H+12 et les annulations H+36. Elle mélange requêtage, logique métier, SMS, et gestion transactionnelle.
  **→ Recommandation** : Extraire `processH12Reminders()` et `processH36Cancellations()` en fonctions séparées.

- **Pas de retry pour les SMS échoués** : Un SMS en `failed` ne sera jamais retenté. Pour les SMS critiques (codes de retrait), cela peut être problématique.

- **Requêtes SQL optimisables** : Les requêtes H+12 et H+36 utilisent `SELECT o.*` alors que seules quelques colonnes sont nécessaires.

### Dépendances

| Type | Détail |
|------|--------|
| Package externe | `africastalking` |
| Modules internes | `../db` (pool PostgreSQL) |
| Variables d'env | `AT_API_KEY`, `AT_USERNAME`, `AT_SENDER_ID` |
| Tables DB | `sms_log`, `orders`, `users`, `order_status_history`, `order_items`, `products` |
| Utilisé par | Routes commandes, cron job dans `server.js` |

### Observations

✅ Architecture robuste avec transaction DB pour les opérations critiques.
✅ Traçabilité complète des SMS en base.
✅ Bonne séparation dev/prod.
⚠️ La fonction `processCashRelaisReminders` est un monolithe à refactorer.
⚠️ Manque un mécanisme de retry pour les SMS échoués.
⚠️ Pas de rate limiting — risque de surcoût API en cas de bug.

---

## 📊 Tableau récapitulatif

| Fichier | 🔴 Critiques | 🟠 Importants | 🟡 Mineurs |
|---------|:---:|:---:|:---:|
| `utils/email.js` | 0 | 1 | 3 |
| `utils/pricing.js` | 1* | 0 | 1 |
| `utils/rates.js` | 0 | 2 | 1 |
| `utils/reference.js` | 0 | 0 | 2 |
| `utils/sms.js` | 0 | 2 | 3 |
| **Total** | **1** | **5** | **10** |

\* L'incohérence des taux par défaut entre `pricing.js` et `rates.js` est classée critique car elle peut mener à des **écarts de prix réels** en production si les taux DB sont indisponibles.

---

## 🎯 Priorités de remédiation

1. **🔴 P0 — Harmoniser les taux de fallback** entre `pricing.js` et `rates.js`. Centraliser dans `rates.js` et importer partout. Ajouter `fret_eur_m3`.
2. **🟠 P1 — Échapper les variables dans le template email** (`email.js`) pour prévenir les injections HTML.
3. **🟠 P1 — Ajouter un try/catch avec fallback dans `getRates()`** (`rates.js`) pour éviter un crash en cas de panne DB.
4. **🟠 P1 — Vérifier/sécuriser l'accès à `db.pool`** (`sms.js`) ou fournir une API de transaction dans le module `db`.
5. **🟡 P2 — Implémenter un cache TTL pour `getRates()`** pour réduire les requêtes DB.
6. **🟡 P2 — Refactorer `processCashRelaisReminders()`** en deux fonctions distinctes.
7. **🟡 P2 — Valider les entrées de `calcPrix()`** (prix négatifs, qty ≤ 0, etc.).
8. **🟡 P3 — Externaliser les templates email** dans des fichiers dédiés.
