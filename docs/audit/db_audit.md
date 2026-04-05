# 🛡️ Audit — Lot C — DB (connexion, schéma, seed)

**Date** : 5 avril 2026  
**Projet** : Komerce Backend (`SamyrFateh/komerce-backend`)  
**Fichiers audités** :
1. `db.js` (racine)
2. `db/index.js`
3. `db/schema.sql`
4. `db/schema_extension.sql`
5. `db/seed.sql`

---

## 1. `db.js` (racine)

### Sécurité

- 🔴 **CRITIQUE — SSL sans vérification de certificat**  
  ```js
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  ```
  `rejectUnauthorized: false` désactive la vérification du certificat TLS du serveur PostgreSQL en production. Cela rend la connexion vulnérable aux attaques **Man-in-the-Middle (MITM)**. Un attaquant sur le réseau pourrait intercepter le trafic entre l'application et la base de données.  
  **Recommandation** : Utiliser `rejectUnauthorized: true` avec le certificat CA du fournisseur (Railway fournit un certificat CA valide), ou à défaut configurer la variable `PGSSLROOTCERT`.

- 🟡 **MINEUR — Gestion d'erreur du pool minimaliste**  
  ```js
  pool.on('error', (err) => {
    console.error('PostgreSQL pool error:', err.message);
  });
  ```
  Le handler `error` se contente de loguer l'erreur sans mécanisme d'alerte, de retry ou de shutdown gracieux. En production, une perte de connexion silencieuse pourrait passer inaperçue.

### Qualité du code

- ✅ Code propre, bien commenté, structuré
- ✅ Bonne utilisation de `dotenv` pour le chargement des variables d'environnement
- ✅ Configuration du pool raisonnable (`max: 10`, timeouts explicites)
- ✅ Exporte `query`, `getClient` et `pool` — API flexible

### Dépendances

| Type | Détail |
|------|--------|
| Package externe | `dotenv`, `pg` (Pool) |
| Variable d'env | `DATABASE_URL`, `NODE_ENV` |
| Utilisé par | Potentiellement tout le projet (module racine de connexion DB) |

### Observations

- 🟠 **Duplication** : Ce fichier et `db/index.js` font exactement la même chose (créer un pool pg). Il y a deux modules de connexion DB concurrents dans le projet — c'est une source de confusion majeure (voir fichier suivant).

---

## 2. `db/index.js`

### Sécurité

- 🔴 **CRITIQUE — SSL sans vérification de certificat** (identique à `db.js`)  
  Même configuration `rejectUnauthorized: false` en production.

- 🟠 **IMPORTANT — Pas d'import `dotenv`**  
  Contrairement à `db.js` (racine), ce fichier ne fait pas `require('dotenv').config()`. Il dépend donc du fait que `dotenv` soit chargé en amont par le point d'entrée de l'application. Si ce module est importé directement (tests, scripts), `DATABASE_URL` pourrait être `undefined`, provoquant une connexion localhost par défaut de `pg` — potentiellement dangereuse.

### Qualité du code

- 🔴 **CRITIQUE — Duplication du module de connexion DB**  
  Le projet possède **deux fichiers de connexion PostgreSQL** :
  - `db.js` (racine) — `connectionTimeoutMillis: 5000`, exporte `query`, `getClient`, `pool`
  - `db/index.js` — `connectionTimeoutMillis: 2000`, exporte `query`, `pool` (pas de `getClient`)
  
  Selon le fichier importé (`require('../db')` vs `require('./db')`), le comportement sera différent. Cela peut créer **deux pools distincts** consommant 20 connexions au lieu de 10, et provoquer des incohérences de timeout.

- ✅ Test de connexion au démarrage (`pool.connect(...)`) — utile pour le diagnostic
- 🟡 Le test de connexion utilise le style callback au lieu de `async/await` — incohérent avec le reste du code

### Dépendances

| Type | Détail |
|------|--------|
| Package externe | `pg` (Pool) |
| Variable d'env | `DATABASE_URL`, `NODE_ENV` |
| Utilisé par | Routes/controllers qui font `require('./db')` depuis le dossier `db/` |

### Observations

- **Action requise** : Supprimer l'un des deux fichiers et standardiser tous les imports sur un seul module de connexion. Recommandation : garder `db.js` (racine) qui est plus complet.

---

## 3. `db/schema.sql`

### Sécurité

- 🔴 **CRITIQUE — Commentaire trompeur sur le hachage de mot de passe**  
  ```sql
  password_hash TEXT,    -- SHA-256 + JWT_SECRET
  ```
  Le commentaire indique « SHA-256 + JWT_SECRET » mais le fichier `seed.sql` insère des hash **bcrypt** (`$2b$10$...`). Si du code applicatif utilise réellement SHA-256 (conformément au commentaire), c'est une **faille critique** : SHA-256 sans sel est vulnérable aux attaques par dictionnaire/rainbow tables. Si seul le commentaire est erroné, il doit être corrigé pour éviter toute confusion.

- 🟠 **IMPORTANT — Pas de Row-Level Security (RLS)**  
  Aucune politique RLS n'est définie. Toute la sécurité d'accès aux données repose entièrement sur la couche applicative. Un bug dans un contrôleur pourrait exposer les données de tous les utilisateurs.

- 🟠 **IMPORTANT — Un utilisateur peut n'avoir ni email ni téléphone**  
  ```sql
  email  TEXT  UNIQUE,
  phone  TEXT  UNIQUE,
  ```
  Les deux colonnes sont nullable. Un utilisateur pourrait être créé sans aucun moyen de contact ni de connexion. Il manque une contrainte :
  ```sql
  CONSTRAINT user_contact CHECK (email IS NOT NULL OR phone IS NOT NULL)
  ```

- 🟡 **MINEUR — Pas de contrainte sur `pickup_code`**  
  Le code de retrait destinataire n'a aucune validation de format ou de longueur.

- 🟡 **MINEUR — Pas de CHECK sur `promo_pct`**  
  La colonne `promo_pct` (pourcentage de promotion) n'a pas de contrainte `CHECK (promo_pct BETWEEN 0 AND 100)`.

- 🟡 **MINEUR — Pas de CHECK sur `stock` ni sur `quantity`**  
  `products.stock`, `basket_items.quantity` et `order_items.quantity` n'ont pas de contrainte `>= 0` / `> 0`.

### Qualité du code

- ✅ Très bien structuré avec des sections clairement délimitées par des commentaires
- ✅ Excellent usage des types ENUM PostgreSQL pour le typage fort
- ✅ Stratégie d'indexation complète et réfléchie (index partiels, index sur FK)
- ✅ Trigger `sync_order_status_from_scan()` bien conçu — logique métier critique correctement implémentée côté DB
- ✅ Trigger `set_updated_at()` réutilisable et appliqué sur les tables clés

- 🟠 **IMPORTANT — Table `disputes` définie deux fois dans le même fichier**  
  La table `disputes` est créée une première fois dans la section « EXTENSION v6.4 » (ligne ~260+) avec `CREATE TABLE IF NOT EXISTS`. Elle est aussi définie dans `schema_extension.sql`. Les définitions diffèrent légèrement :
  - `schema.sql` : `refund_eur NUMERIC(10,2)`, contrainte `ON DELETE CASCADE`
  - `schema_extension.sql` : `refund_eur NUMERIC(8,2)`, pas de `ON DELETE CASCADE`
  
  La deuxième définition sera silencieusement ignorée, mais cette duplication est source de confusion.

- 🟠 **IMPORTANT — Tables `fabrics`/`garment_models` vs `ceremony_fabrics`/`ceremony_models`**  
  Le fichier `schema.sql` crée `fabrics` et `garment_models`, tandis que `schema_extension.sql` crée `ceremony_fabrics` et `ceremony_models`. Ce sont des tables distinctes avec des structures quasi-identiques pour le même module M11. Cela crée une ambiguïté sur laquelle utiliser.

- 🟡 **MINEUR — Colonne `country` définie avec deux defaults différents**  
  ```sql
  -- Dans CREATE TABLE users:
  country CHAR(2) NOT NULL DEFAULT 'FR',
  
  -- Plus bas dans ALTER TABLE:
  ALTER TABLE users ADD COLUMN IF NOT EXISTS country CHAR(2) DEFAULT 'KM';
  ```
  Le `ALTER TABLE` est un no-op (la colonne existe déjà), mais les deux valeurs par défaut différentes (`'FR'` vs `'KM'`) révèlent une incohérence dans l'historique des migrations.

- 🟡 **MINEUR — `exchange_rates` inséré ici ET dans `seed.sql`**  
  Duplication de données initiales entre le schéma et le seed.

### Dépendances

| Type | Détail |
|------|--------|
| Extensions PG | `uuid-ossp`, `pgcrypto` |
| Tables créées | `users`, `relais`, `products`, `baskets`, `basket_items`, `recipients`, `shipments`, `orders`, `order_items`, `scans`, `order_status_history`, `sms_log`, `exchange_rates`, `fabrics`, `garment_models`, `disputes` |
| Types ENUM | `user_role`, `order_status`, `payment_mode`, `payment_status`, `basket_type`, `scan_step` |
| Triggers | `set_updated_at()`, `sync_order_status_from_scan()` |

### Observations

- Le schéma est globalement solide pour un MVP. La logique de scan → statut commande est bien pensée.
- **Recommandation** : Migrer vers un outil de migration (Knex, node-pg-migrate, dbmate) au lieu de fichiers SQL monolithiques. Cela évitera les doublons et permettra un versionnage propre.
- Le trigger de synchronisation scan ne vérifie pas la progression logique des statuts (ex : on pourrait passer de `collected` à `preparation`). Ajouter une vérification d'ordre.

---

## 4. `db/schema_extension.sql`

### Sécurité

- 🟡 **MINEUR — Pas de validation d'entrée sur `ceremony_order_items.size`**  
  La colonne `size TEXT` accepte n'importe quelle valeur. Un `CHECK (size IN ('S','M','L','XL','XXL'))` serait préférable, ou un ENUM dédié.

### Qualité du code

- 🟠 **IMPORTANT — Duplication massive avec `schema.sql`**  
  - `disputes` : déjà définie dans `schema.sql` (ignorée silencieusement par `IF NOT EXISTS`)
  - Les tables `ceremony_fabrics`/`ceremony_models` font doublon fonctionnel avec `fabrics`/`garment_models` de `schema.sql`
  - Les données seed de `ceremony_fabrics` et `ceremony_models` sont aussi dupliquées dans `seed.sql` (via `fabrics` et `garment_models`)

- ✅ Bonne utilisation de `IF NOT EXISTS` pour l'idempotence
- ✅ `ON CONFLICT DO NOTHING` pour les inserts de données initiales
- ✅ Index créés sur les nouvelles tables
- 🟡 `ON CONFLICT DO NOTHING` sans cible explicite — fonctionne mais repose sur le comportement par défaut de PostgreSQL (conflit sur n'importe quelle contrainte unique). Plus explicite avec `ON CONFLICT (id) DO NOTHING`.

### Dépendances

| Type | Détail |
|------|--------|
| Prérequis | `schema.sql` doit être exécuté avant |
| Tables créées | `ceremony_fabrics`, `ceremony_models`, `ceremony_order_items`, `disputes` (skip) |
| FK vers | `orders(id)`, `ceremony_fabrics(id)`, `ceremony_models(id)`, `users(id)` |

### Observations

- Ce fichier devrait être fusionné dans `schema.sql` ou géré par un système de migrations. Avoir deux fichiers SQL à exécuter dans le bon ordre est fragile.

---

## 5. `db/seed.sql`

### Sécurité

- 🔴 **CRITIQUE — Mot de passe admin en clair dans le code source**  
  ```sql
  -- Mot de passe : Komerce2026!
  -- ⚠️  Changer le mot de passe dès la première connexion.
  ```
  Le mot de passe administrateur est écrit en clair dans un commentaire SQL versionné dans Git. Toute personne ayant accès au dépôt (public !) connaît le mot de passe admin. Le commentaire « changer dès la première connexion » ne constitue pas une protection.  
  **Action immédiate requise** : Supprimer le commentaire du mot de passe, révoquer le hash actuel, et utiliser une procédure de setup qui génère un mot de passe aléatoire au premier déploiement.

- 🔴 **CRITIQUE — Hash identique pour admin et utilisateurs démo**  
  ```sql
  -- Admin :
  '$2b$10$t28odHA9/nVHztbjsVLQGOkp0dkaMmkCw3m5qfihuml3.fUwJ2Z/.'
  -- Clients démo :
  '$2b$10$t28odHA9/nVHztbjsVLQGOkp0dkaMmkCw3m5qfihuml3.fUwJ2Z/.'
  ```
  **Tous les comptes partagent le même hash bcrypt**. Soit le commentaire « client123 » est faux et le mot de passe des clients est aussi « Komerce2026! », soit le commentaire admin est faux. Dans tous les cas, cela signifie que le mot de passe admin est déductible via n'importe quel compte démo.

- 🟠 **IMPORTANT — Données réalistes en seed (emails, téléphones)**  
  Les adresses email (`fatouma.ali@gmail.com`, `said.m@hotmail.com`) et numéros de téléphone (`+33612345678`) ressemblent à de vraies coordonnées. Si le seed est accidentellement exécuté en production avec des fonctionnalités d'envoi SMS/email, de vrais utilisateurs pourraient recevoir des messages.  
  **Recommandation** : Utiliser des adresses `@example.com` et des numéros fictifs reconnus (ex : `+33 1 99 00 XX XX`).

- 🟠 **IMPORTANT — Aucun mécanisme d'obligation de changement de mot de passe**  
  Le commentaire dit « changer dès la première connexion » mais ni le schéma ni l'application ne semblent implémenter un flag `must_change_password`.

### Qualité du code

- 🟠 **IMPORTANT — Pas d'idempotence pour les inserts principaux**  
  Les `INSERT INTO users` et `INSERT INTO products` n'ont pas de clause `ON CONFLICT`. Exécuter le seed deux fois provoquera des erreurs sur les contraintes `UNIQUE` (`email`, `sku`).

- 🟠 **IMPORTANT — Duplication des données avec `schema.sql` et `schema_extension.sql`**  
  - `exchange_rates` : inséré dans `schema.sql` ET dans `seed.sql`
  - `fabrics` / `garment_models` : seed insère dans ces tables, mais `schema_extension.sql` insère dans `ceremony_fabrics` / `ceremony_models` — données parallèles pour le même module

- ✅ Bonne couverture des profils utilisateurs (diaspora FR, AE, local KM)
- ✅ Catalogue produits réaliste avec images Unsplash
- ✅ Les `UPDATE` finaux pour ajouter `price_aed` et dimensions sont une bonne approche de migration de données
- 🟡 Les URLs d'images Unsplash incluent des paramètres de redimensionnement — en production, utiliser un CDN propre

### Dépendances

| Type | Détail |
|------|--------|
| Prérequis | `schema.sql` doit être exécuté avant |
| Tables alimentées | `users`, `exchange_rates`, `relais`, `products`, `fabrics`, `garment_models` |
| Dépendances externes | URLs d'images Unsplash |

### Observations

- Le fichier devrait être scindé en deux : un seed de production (admin, taux de change, relais initiaux) et un seed de démo/test.
- Les mots de passe doivent être gérés via des variables d'environnement ou un script interactif, jamais en dur dans un fichier SQL.

---

## 📊 Tableau récapitulatif

| Fichier | 🔴 Critiques | 🟠 Importants | 🟡 Mineurs |
|---------|:------------:|:-------------:|:----------:|
| `db.js` (racine) | 1 | 0 | 1 |
| `db/index.js` | 2 | 1 | 1 |
| `db/schema.sql` | 1 | 4 | 5 |
| `db/schema_extension.sql` | 0 | 1 | 2 |
| `db/seed.sql` | 2 | 4 | 1 |
| **TOTAL** | **6** | **10** | **10** |

---

## 🎯 Actions prioritaires

1. **🔴 Supprimer le mot de passe admin du code source** — risque immédiat sur un dépôt public
2. **🔴 Corriger `rejectUnauthorized: false`** — vulnérabilité MITM sur les deux fichiers de connexion
3. **🔴 Éliminer la duplication de modules DB** — garder un seul fichier de connexion (`db.js` racine)
4. **🔴 Clarifier le hachage de mot de passe** — corriger le commentaire `SHA-256` et vérifier le code applicatif
5. **🟠 Consolider les fichiers SQL** — fusionner ou migrer vers un outil de migration
6. **🟠 Ajouter des contraintes CHECK** — `stock >= 0`, `quantity > 0`, `promo_pct BETWEEN 0 AND 100`
7. **🟠 Rendre le seed idempotent** — ajouter `ON CONFLICT` sur tous les inserts
