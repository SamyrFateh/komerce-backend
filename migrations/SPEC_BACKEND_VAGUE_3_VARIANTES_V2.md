# Vague 3 — Variantes produits : Spec backend V2

> **Cette V2 remplace la V1.** Elle a été révisée après lecture du backend réel
> Komerce. Plusieurs hypothèses de la V1 étaient inexactes ou inutiles.
> **À copier dans `docs/_work/variants_design_2026-05.md` avant tout commit DB.**

---

## 0. Audit du backend existant (corrige les erreurs de la V1)

| Hypothèse V1 | Réalité observée | Impact sur la spec |
|---|---|---|
| Il faut ajouter un champ `images` à `products` | `products.images` existe déjà (JSON array) | **Rien à faire**, le frontend l'utilise déjà via `b-modal.js` |
| Pas de notion de "variantes" dans le code | `order_items` a déjà `module_type, module_size, module_fabric_id, module_fabric_type, module_retouche, module_qty_meters, module_accessories` | **Cette infrastructure couvre déjà le cas "couture sur mesure"**. On ne doit PAS la dupliquer. La Vague 3 doit s'aligner sur ce pattern. |
| Décrémentation stock dans `routes/orders/create.js` | Décrémentation dans `services/order-payment-confirmation.js::confirmPaymentCycle` (ligne 155-160), avec `FOR UPDATE OF p` pour lock atomique | **C'est le bon endroit** pour ajouter la logique variantes. Pattern existant respecte R5. |
| `products` a 16 colonnes (cf. schema.sql) | `products` a en réalité ~28 colonnes (subcategory, dimensions_cm, badge, has_couture, customs_risk_coeff, sourcing_source, etc.) | Les nouvelles colonnes éventuelles doivent suivre le pattern `ALTER TABLE products ADD COLUMN IF NOT EXISTS …` |
| Migrations à la racine `db/migrations/` | Les migrations vivent dans `migrations/` (pas `db/migrations/`) et sont numérotées `0XX_*.sql`. Dernière = `062_boutique_categories_seed.sql` | Prochaine migration = `063_product_variants.sql` |
| `gen_random_uuid()` partout | `db/schema.sql` initial utilise `uuid_generate_v4()` (uuid-ossp), mais les **migrations récentes** (044+) utilisent `gen_random_uuid()` (pgcrypto). Convention récente du projet. | Utiliser `gen_random_uuid()` pour rester cohérent avec les migrations récentes |

**Question d'architecture résolue :** la table `order_items` a déjà des colonnes
`module_*` qui sont en fait *exactement* le concept "variante" (taille de
vêtement, type de tissu, retouche oui/non). Donc deux choix possibles pour la
Vague 3 :

- **Option A** : étendre l'infrastructure `module_*` existante (ajouter table
  `module_*` côté products avec les options possibles, l'étendre à toutes les
  catégories pas juste couture).
- **Option B** : créer une infrastructure générique `product_variants` séparée,
  et migrer plus tard les colonnes `module_*` vers cette structure générique.

**Recommandation : Option B.** Raisons :
1. Les colonnes `module_*` sont très spécifiques au métier couture (fabric_id,
   qty_meters, accessories). Mélanger ça avec "Couleur: Bleu" rend le schéma
   confus.
2. Le frontend (déjà déployé) attend un format `product.variants = { Taille: [...] }`
   purement libre, pas un champ `module_*`.
3. Migration progressive : le code couture peut continuer à fonctionner avec
   `module_*` pendant que les autres catégories utilisent `product_variants`.

---

## 1. Checklist ZONE_IMPACT (révisée)

| # | Question | Réponse |
|---|----------|---------|
| 1 | Quelles zones je touche ? | DB (1 nouvelle table + 1 colonne JSON sur `order_items`), API GET/POST products, service `confirmPaymentCycle` |
| 2 | Quelles tables j'écris ? | INSERT/UPDATE/DELETE sur `product_variants` (nouvelle). UPDATE sur `order_items` (ajouter colonne `variant_combo jsonb`). UPDATE sur `products` (ajouter `has_variants boolean`). **Aucun UPDATE sur `orders.status`** (R3 préservé). **Aucun UPDATE sur `parcels`** (R4 préservé). |
| 3 | Quel invariant pourrait casser ? | **R5 (stock = transaction Supabase)** : c'est le seul qui est touché. La décrémentation des stocks de variantes doit avoir lieu dans la **même transaction** que la décrémentation du stock global, dans `confirmPaymentCycle`, en utilisant `FOR UPDATE` comme déjà pratiqué (ligne 128 du service actuel). |
| 4 | Quel est le blast radius ? | `services/order-payment-confirmation.js` (ligne 118-160), `routes/products.js` (GET/POST/PUT), `routes/orders/create.js` (validation stock côté checkout — ligne 171), nouvelle table, validators. Indirectement : admin vendeur (saisie variantes — out of scope). |
| 5 | Mon analyse est dans `_work/` ? | À créer : `docs/_work/variants_design_2026-05.md` (copie de ce document) |
| 6 | Le propriétaire a validé ? | **À OBTENIR** avant tout commit DB |

---

## 2. Schéma DB — Migration `063_product_variants.sql`

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- LOT 11 — Variantes produits (taille, couleur, matériau, etc.)
--
-- Permet à un produit d'avoir N axes de variation, chacun avec M options.
-- Chaque option a son propre stock optionnel et son image optionnelle.
-- L'objet GET /api/products/:id retourne product.variants = { type: [...] }
-- conformément au format attendu par le frontend (b-modal.js, déjà déployé).
--
-- Cohabite avec les colonnes module_* de order_items (couture) sans interférer.
-- À terme, les colonnes module_* pourront être migrées vers cette structure
-- générique, mais ce n'est PAS dans cette PR.
-- ─────────────────────────────────────────────────────────────────────────────

-- Flag sur products : indique au runtime si on doit charger les variantes
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS has_variants BOOLEAN NOT NULL DEFAULT FALSE;

-- Nouvelle table product_variants
CREATE TABLE IF NOT EXISTS product_variants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,

  -- Type de la variante : 'Taille', 'Couleur', 'Matériau', etc. Libre.
  variant_type    TEXT        NOT NULL,

  -- Valeur affichée à l'utilisateur : 'S', 'Bleu', 'Coton', etc.
  variant_value   TEXT        NOT NULL,

  -- SKU optionnel pour suivi vendeur
  sku             TEXT,

  -- Stock spécifique. NULL = "non géré par cette variante" (retombe sur products.stock).
  -- 0 = en rupture pour cette variante.
  stock           INTEGER,

  -- Surcharge prix optionnelle. NULL = même prix que products.price_kmf.
  price_kmf       INTEGER,

  -- Image spécifique à la variante (ex: photo en couleur "Rouge")
  image_url       TEXT,

  -- Ordre d'affichage dans le sélecteur (asc)
  display_order   INTEGER     NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Pas deux fois la même valeur pour le même type sur le même produit
  CONSTRAINT product_variants_unique_value
    UNIQUE (product_id, variant_type, variant_value),

  CONSTRAINT product_variants_stock_non_negatif
    CHECK (stock IS NULL OR stock >= 0),

  CONSTRAINT product_variants_prix_non_negatif
    CHECK (price_kmf IS NULL OR price_kmf >= 0)
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product
  ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_lookup
  ON product_variants(product_id, variant_type, display_order);

-- Trigger updated_at
CREATE TRIGGER trg_product_variants_updated
  BEFORE UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Colonne variant_combo sur order_items
-- Format: {"Taille": "M", "Couleur": "Bleu"}
-- NULL pour les commandes existantes et pour les produits sans variantes.
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS variant_combo JSONB;

-- Index optionnel pour stats futures (ventes par taille, etc.)
CREATE INDEX IF NOT EXISTS idx_order_items_variant_combo
  ON order_items USING gin (variant_combo)
  WHERE variant_combo IS NOT NULL;
```

**Pourquoi `variant_combo jsonb` et pas une FK vers `product_variants` ?**
Pour qu'une commande passée reste cohérente même si le vendeur supprime une
variante. On stocke la combo "telle qu'elle était au moment de la commande".

**À propos des colonnes `module_*` existantes** : on ne les touche pas dans
cette PR. Elles continuent de fonctionner pour le cas couture comme avant.

---

## 3. Modifications de `routes/products.js`

### 3.1 GET /api/products/:id (ligne 176-187)

**Avant :**
```js
const { rows } = await db.query(
  `SELECT * FROM products WHERE id = $1 AND is_active = TRUE`,
  [req.params.id]
);
if (!rows.length) return res.status(404).json({ error: 'Produit introuvable' });
res.json(rows[0]);
```

**Après :**
```js
const { rows } = await db.query(
  `SELECT * FROM products WHERE id = $1 AND is_active = TRUE`,
  [req.params.id]
);
if (!rows.length) return res.status(404).json({ error: 'Produit introuvable' });

const product = rows[0];

// Charger les variantes si le produit en a (économise un JOIN sur 95% des cas)
if (product.has_variants) {
  const { rows: vRows } = await db.query(
    `SELECT variant_type, variant_value, stock, price_kmf, image_url, display_order
     FROM product_variants
     WHERE product_id = $1
     ORDER BY variant_type, display_order ASC, variant_value ASC`,
    [product.id]
  );
  // Regrouper par type pour matcher le format attendu par le frontend
  const variants = {};
  for (const v of vRows) {
    if (!variants[v.variant_type]) variants[v.variant_type] = [];
    variants[v.variant_type].push({
      value: v.variant_value,
      stock: v.stock,
      price_kmf: v.price_kmf,
      image_url: v.image_url,
    });
  }
  product.variants = variants;
}

res.json(product);
```

### 3.2 GET /api/products (ligne 31-124)

**Pas de modification** dans le SELECT principal (on ne charge pas les
variantes dans la liste pour rester rapide). Mais il faut ajouter `has_variants`
dans la liste des colonnes sélectionnées (ligne 76-101) pour que le frontend
sache s'il y a des variantes à charger en cliquant sur le produit.

Ajouter après `p.created_at` :
```sql
,
p.has_variants
```

### 3.3 Nouveau endpoint POST /api/products/:id/variants (admin)

À ajouter après la route DELETE existante (ligne 316). Pattern identique
à celui des autres endpoints admin du fichier.

```js
// ─── POST /api/products/:id/variants (admin) ─────────────────────────────────
// Remplace toutes les variantes du produit par celles fournies (atomique).
// Body: { variants: [{type, value, stock?, price_kmf?, image_url?, sku?, display_order?}, ...] }

router.post('/:id/variants', authenticate, requireRole(['admin']), requireUUID, async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { variants = [] } = req.body;
    if (!Array.isArray(variants)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'variants doit être un tableau' });
    }

    // Vérifier que le produit existe
    const { rows: [product] } = await client.query(
      'SELECT id FROM products WHERE id = $1',
      [req.params.id]
    );
    if (!product) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Produit introuvable' });
    }

    // Validation entrées
    for (const v of variants) {
      if (!v.type || !v.value) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Chaque variante doit avoir type et value' });
      }
      if (v.stock !== undefined && v.stock !== null && (Number(v.stock) < 0 || isNaN(Number(v.stock)))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Stock invalide pour ${v.type}:${v.value}` });
      }
      if (v.price_kmf !== undefined && v.price_kmf !== null && (Number(v.price_kmf) < 0 || isNaN(Number(v.price_kmf)))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Prix invalide pour ${v.type}:${v.value}` });
      }
    }

    // Wipe + recréation atomique
    await client.query('DELETE FROM product_variants WHERE product_id = $1', [req.params.id]);

    for (const v of variants) {
      await client.query(
        `INSERT INTO product_variants
           (product_id, variant_type, variant_value, sku, stock, price_kmf, image_url, display_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          req.params.id,
          v.type,
          v.value,
          v.sku || null,
          v.stock === undefined ? null : v.stock,
          v.price_kmf === undefined ? null : v.price_kmf,
          v.image_url || null,
          v.display_order || 0,
        ]
      );
    }

    // Mettre à jour le flag has_variants
    await client.query(
      `UPDATE products SET has_variants = $1, updated_at = NOW() WHERE id = $2`,
      [variants.length > 0, req.params.id]
    );

    await client.query('COMMIT');
    res.json({ success: true, count: variants.length });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});
```

---

## 4. Modifications de `routes/orders/create.js` (validation stock)

Le code actuel (ligne 171-177) valide le stock global du produit :
```js
if (product.stock !== null && product.stock < qty) {
  await client.query('ROLLBACK');
  return res.status(409).json({ error: `Stock insuffisant pour ${product.name}...` });
}
```

**À modifier** pour qu'il valide aussi le stock de la variante choisie si l'item
porte un `variant_combo`. Modification minimale :

```js
// Stock global d'abord (existant)
if (product.stock !== null && product.stock < qty) {
  await client.query('ROLLBACK');
  return res.status(409).json({
    error: `Stock insuffisant pour ${product.name} — disponible : ${product.stock}`,
    available_stock: product.stock,
  });
}

// NEW : si une combo de variantes est passée, vérifier les stocks individuels
if (item.variant_combo && typeof item.variant_combo === 'object') {
  for (const [vType, vValue] of Object.entries(item.variant_combo)) {
    const { rows: [variant] } = await client.query(
      `SELECT stock FROM product_variants
       WHERE product_id = $1 AND variant_type = $2 AND variant_value = $3`,
      [item.product_id, vType, vValue]
    );
    if (variant && variant.stock !== null && variant.stock < qty) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Stock insuffisant pour ${product.name} — ${vType}: ${vValue} — disponible : ${variant.stock}`,
        available_stock: variant.stock,
      });
    }
  }
}
```

Et dans l'INSERT `order_items` (ligne 312), ajouter `variant_combo` :
```sql
INSERT INTO order_items (
   order_id, product_id, quantity, price_kmf,
   module_type, module_fabric_id, module_fabric_type,
   module_size, module_retouche, module_qty_meters, module_accessories,
   variant_combo                                                       -- NEW
 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
```

avec `item.variant_combo ? JSON.stringify(item.variant_combo) : null` en
paramètre 12.

---

## 5. Modifications de `services/order-payment-confirmation.js` (CRITIQUE — R5)

C'est ici que la décrémentation atomique du stock se fait (ligne 118-160).
Il faut **étendre** la requête pour récupérer aussi les variantes liées, et
décrémenter les deux dans la même transaction.

### Avant (ligne 118-160)

```js
const { rows: items } = await dbClient.query(
  `SELECT oi.product_id, oi.quantity, p.stock, p.name AS product_name
   FROM order_items oi
   JOIN products p ON p.id = oi.product_id
   WHERE oi.order_id = $1
     AND p.stock IS NOT NULL
   FOR UPDATE OF p`,
  [orderId]
);
// ... vérification rupture ...
for (const item of items) {
  await dbClient.query(
    'UPDATE products SET stock = stock - $1 WHERE id = $2',
    [item.quantity, item.product_id]
  );
}
```

### Après

```js
const { rows: items } = await dbClient.query(
  `SELECT
     oi.id            AS order_item_id,
     oi.product_id,
     oi.quantity,
     oi.variant_combo,
     p.stock,
     p.has_variants,
     p.name           AS product_name
   FROM order_items oi
   JOIN products p ON p.id = oi.product_id
   WHERE oi.order_id = $1
     AND p.stock IS NOT NULL
   FOR UPDATE OF p`,
  [orderId]
);

// Pour les items avec variant_combo, on lock aussi les rows product_variants
// concernées dans la même transaction, et on vérifie leur stock.
const insufficientItems = [];

for (const item of items) {
  // Vérif stock global produit (comportement existant)
  if (item.stock < item.quantity) {
    insufficientItems.push({
      product_id:   item.product_id,
      product_name: item.product_name,
      available:    item.stock,
      needed:       item.quantity,
    });
    continue;
  }
  // Vérif stocks variantes (nouveau)
  if (item.has_variants && item.variant_combo) {
    for (const [vType, vValue] of Object.entries(item.variant_combo)) {
      const { rows: [variant] } = await dbClient.query(
        `SELECT id, stock FROM product_variants
         WHERE product_id = $1 AND variant_type = $2 AND variant_value = $3
         FOR UPDATE`,
        [item.product_id, vType, vValue]
      );
      if (variant && variant.stock !== null && variant.stock < item.quantity) {
        insufficientItems.push({
          product_id:   item.product_id,
          product_name: `${item.product_name} (${vType}: ${vValue})`,
          available:    variant.stock,
          needed:       item.quantity,
        });
        break;
      }
    }
  }
}

if (insufficientItems.length > 0) {
  return { success: true, noop: false, stockBlocked: true, insufficientItems };
}

// Décrémenter stock global ET stocks variantes (même transaction)
for (const item of items) {
  await dbClient.query(
    'UPDATE products SET stock = stock - $1 WHERE id = $2',
    [item.quantity, item.product_id]
  );
  if (item.has_variants && item.variant_combo) {
    for (const [vType, vValue] of Object.entries(item.variant_combo)) {
      await dbClient.query(
        `UPDATE product_variants
         SET stock = stock - $1
         WHERE product_id = $2 AND variant_type = $3 AND variant_value = $4
           AND stock IS NOT NULL`,
        [item.quantity, item.product_id, vType, vValue]
      );
    }
  }
}

return { success: true, noop: false, stockBlocked: false, insufficientItems: [] };
```

**Invariant R5 respecté** : tout reste dans la même transaction (`dbClient`),
les locks `FOR UPDATE` empêchent la race condition. Le `WHERE stock IS NOT NULL`
sur l'UPDATE évite de décrémenter une variante "non gérée" (qui retombe sur
le stock global).

---

## 6. Validators (à mettre dans `validators/`)

Ajouter un validator Joi pour les variantes côté admin et côté order :

```js
// validators/products.js — étendre l'existant
const variantsSchema = Joi.array().items(
  Joi.object({
    type:          Joi.string().min(1).max(50).required(),
    value:         Joi.string().min(1).max(50).required(),
    stock:         Joi.number().integer().min(0).allow(null),
    price_kmf:     Joi.number().integer().min(0).allow(null),
    image_url:     Joi.string().uri().allow(null, ''),
    sku:           Joi.string().max(50).allow(null, ''),
    display_order: Joi.number().integer().min(0),
  })
).max(50);

// validators/orders.js — étendre la création de commande
// Dans le schéma items, ajouter :
variant_combo: Joi.object().pattern(
  Joi.string().min(1).max(50),
  Joi.string().min(1).max(50)
).allow(null),
```

---

## 7. Migration progressive (4 phases rollback-ables)

| Phase | Action | Reversible | Impact runtime |
|-------|--------|-----------|----------------|
| 1 | Apply migration `063_product_variants.sql` | OUI (DROP TABLE + ALTER ... DROP COLUMN) | Aucun (`has_variants = false` partout) |
| 2 | Deploy backend modif `GET /api/products/:id` (charge `variants` si `has_variants`) | OUI (rollback git) | Aucun visible (tous les produits ont `has_variants = false`) |
| 3 | Deploy `POST /api/products/:id/variants` + UI admin pour saisir | OUI | Sur les produits où l'admin pose des variantes : le frontend (déjà déployé) montre l'UI |
| 4 | Deploy modif `confirmPaymentCycle` + `routes/orders/create.js` | OUI (rollback git, mais surveiller les commandes en cours) | Les commandes avec `variant_combo` décrémentent les stocks variantes |

**Ordre des PR conseillé :**
1. PR-VAR-1 : migration SQL (phase 1) — mergeable seule, zéro impact runtime
2. PR-VAR-2 : `routes/products.js` GET enrichi (phase 2) — mergeable seule
3. PR-VAR-3 : `routes/products.js` POST admin variantes + UI admin (phase 3)
4. PR-VAR-4 : `confirmPaymentCycle` + `create.js` aware (phase 4 — la critique)

À chaque PR : commit toutes les 10 minutes (règle 🔴 du README), delta dans
`docs/_pending/` avant de marquer "terminé" (règle 🚫 du README).

---

## 8. Tests à écrire (avant la phase 4)

### Tests unitaires (`tests/`)

- `getEffectiveStock(product_sans_variantes)` → retourne `product.stock`
- `getEffectiveStock(product_avec_variantes_full_combo)` → retourne `min(stocks)`
- `getEffectiveStock(product_avec_variantes_partial_combo)` → fallback global
- POST /api/products/:id/variants atomique (rollback si une ligne invalide)

### Tests d'intégration (existants à étendre)

- Commande sans variantes → comportement identique à aujourd'hui
- Commande avec `variant_combo` valide → stock variante + stock produit décrémentés
- 2 commandes simultanées sur même variante (stock=1) → une réussit, l'autre 409
- Suppression d'une variante référencée dans `order_items` finalisés → autorisée
- Suppression d'une variante référencée dans `order_items` `pending` → refusée

---

## 9. Risques et mitigations (révisés après lecture du code)

| Risque | Mitigation | Présent dans le code ? |
|--------|-----------|------------------------|
| Race condition stock entre 2 commandes | `FOR UPDATE` sur products (déjà fait ligne 128 du service) + `FOR UPDATE` sur product_variants (à ajouter) | Pattern existant, à étendre |
| Incohérence stock global vs stocks variantes | Ne pas imposer `sum(variants.stock) <= product.stock`. Documenter explicitement. | Choix d'architecture à valider |
| Variante supprimée fait planter une commande | `variant_combo jsonb` dans `order_items` = autonome | Pattern à implémenter |
| Frontend envoie combo incohérente | Validation API + validation côté checkout | À ajouter |
| Cache CDN sur GET /api/products/:id | Voir si Komerce a déjà du cache. Sinon TTL court à mettre. | À vérifier au moment du déploiement |

---

## 10. Estimation effort (révisée — backend plus mûr que prévu)

| Phase | Estimation | Note |
|-------|-----------|------|
| 1. Migration SQL | 30 min | Format simple, copier le pattern de `061_boutique_categories.sql` |
| 2. GET produit enrichi | 30 min | Modification 1 fichier, test unitaire facile |
| 3. POST admin + validators | 1h30 | Pattern admin déjà bien rodé dans `routes/products.js` |
| 4. UI admin saisie variantes | 3h | **Hors scope ici**, à faire séparément côté admin frontend |
| 5. confirmPaymentCycle aware | 1h30 | Modification chirurgicale d'un service existant bien architecturé |
| 6. routes/orders/create.js validation stock | 30 min | Ajout simple d'une boucle |
| 7. Tests intégration | 2h | Le repo a déjà `tests/`, prolonger ce qui existe |
| **Total backend (hors UI admin)** | **≈ 6h** | Plus court que la V1 grâce à la maturité du code existant |

---

## 11. Hors scope (volontairement)

- Promotions par variante — futur
- Variantes liées entre elles ("la taille L n'est dispo qu'en Bleu") — futur
- Migration des colonnes `module_*` de couture vers la structure générique — futur
- Variantes multi-photos par variante (genre 3 photos pour la couleur Rouge) — déjà supporté par `image_url` unique mais pas multi
- Stock partagé entre variantes — choix volontaire, on ne le fait pas
- Cache invalidation sur GET /api/products/:id après update variantes — à documenter le jour du déploiement selon la stack cache

---

## 12. Diff lié côté frontend (déjà déployé, rien à faire)

Le frontend déployé attend exactement le format suivant dans la réponse de
`GET /api/products/:id` :

```json
{
  "id": "...",
  "name": "...",
  ...
  "has_variants": true,
  "variants": {
    "Taille":  [
      {"value": "S", "stock": 5,  "price_kmf": null, "image_url": null},
      {"value": "M", "stock": 0,  "price_kmf": null, "image_url": null}
    ],
    "Couleur": [
      {"value": "Bleu",  "stock": null, "price_kmf": null, "image_url": "..."},
      {"value": "Rouge", "stock": null, "price_kmf": null, "image_url": "..."}
    ]
  }
}
```

Ce format est exactement celui produit par la fonction de la section 3.1 de
cette spec. Aucune adaptation frontend nécessaire.

Le frontend envoie côté `POST /api/orders` un champ `variant_combo` par item :
```json
{
  "items": [
    {
      "product_id": "...",
      "quantity": 1,
      "variant_combo": {"Taille": "M", "Couleur": "Bleu"}
    }
  ]
}
```

Le code de la section 4 de cette spec gère ce champ.

---

**Validation propriétaire requise avant tout commit DB.**
**Ce document doit être copié dans `docs/_work/variants_design_2026-05.md`
avant la PR-VAR-1**, conformément à la règle 🧠 du README.
