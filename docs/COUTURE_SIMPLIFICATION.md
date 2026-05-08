# Simplification du modèle couture

> **Date** : 8 mai 2026
> **Décision** : la prod est vide, on réécrit proprement le modèle métier confection au lieu de migrer l'ancien.
> **Périmètre** : confection uniquement. Les autres modules (lunettes, cosmétiques, construction) ne sont pas touchés.
> **Décision métier** : une commande peut contenir plusieurs personnes → mensurations stockées sur `order_items`.

---

## Le métier en une phrase

Komerce sélectionne des modèles avec des couturiers partenaires, les met en catalogue sous sa marque maison, et le client commande son modèle en saisissant ses mensurations (ou en choisissant une taille standard si proposée).

Pas de catalogue de tissus côté client, pas de combinaisons modèle+tissu à composer, pas d'accessoires à cocher. Le produit est fini, le client donne son corps, le couturier coud.

---

## 1. Modifications du schéma DB

### Sur `products` — 5 colonnes ajoutées

```sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_komerce_made BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS available_sizes TEXT[] DEFAULT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS size_guide_extra JSONB DEFAULT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS confection_partner_id UUID DEFAULT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS confection_delay_days INTEGER DEFAULT NULL;
```

| Colonne | Sens |
|---|---|
| `is_komerce_made` | Produit signé Komerce (porte la marque maison). Affiché côté boutique comme un badge. |
| `available_sizes` | Tailles proposées : `['custom']` par défaut (sur-mesure uniquement), ou `['S','M','L','XL']`, ou `['S','M','L','XL','custom']` (les deux). NULL = produit sans dimension de taille (ex : un parfum). |
| `size_guide_extra` | Mesures spécifiques à ce modèle, en plus des mesures universelles. Exemple salouva : `{ "longueur_pagne_cm": "longueur du tissu drapé" }`. NULL = pas de mesure spécifique. |
| `confection_partner_id` | Référence interne au couturier qui produit. Jamais montré au client. NULL si produit non-confection. |
| `confection_delay_days` | Délai propre au produit. Surcharge le délai par défaut du module couture. |

### Sur `order_items` — 3 colonnes ajoutées + 1 conservée (variant_combo)

```sql
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS module_size VARCHAR(20) DEFAULT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS module_measurements JSONB DEFAULT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS module_instructions TEXT DEFAULT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_combo JSONB DEFAULT NULL;
```

| Colonne | Sens |
|---|---|
| `module_size` | Taille standard choisie ('S', 'M', 'L', 'XL') ou la chaîne 'custom' si le client est passé par les mensurations. NULL si non-confection. |
| `module_measurements` | JSONB des mensurations en cm. Format : `{ "tour_poitrine_cm": 92, "tour_taille_cm": 76, ... }`. NULL si `module_size != 'custom'`. |
| `module_instructions` | Instructions libres du client (« doublure ivoire », « manches longues »). NULL le plus souvent. |
| `variant_combo` | Pour les variantes catalogue (taille/couleur des produits non-confection). Existe déjà dans le code, à confirmer dans schema.sql. |

### Tables à supprimer

```sql
DROP TABLE IF EXISTS fabrics;
DROP TABLE IF EXISTS garment_models;
```

Aucune donnée en prod, suppression franche.

### Migration unique : `068_couture_simplification.sql`

Pour les environnements existants (dev local, staging) qui auraient déjà ces tables ou colonnes.

```sql
-- ============================================================================
-- Migration 068 — Simplification du modèle couture
-- ============================================================================
-- Aligne le schéma sur le métier réel : Komerce sélectionne des modèles
-- catalogue confectionnés sous sa marque maison. Le client choisit un produit
-- et donne ses mensurations (ou sa taille). Pas de catalogue de tissus.
--
-- Idempotente — peut être rejouée sans dommage.
-- ============================================================================

-- ── 1. Enrichissement de products ────────────────────────────────────────────

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_komerce_made       BOOLEAN  NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS available_sizes       TEXT[]   DEFAULT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS size_guide_extra      JSONB    DEFAULT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS confection_partner_id UUID     DEFAULT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS confection_delay_days INTEGER  DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_products_is_komerce_made
  ON products(is_komerce_made) WHERE is_komerce_made = TRUE;

-- ── 2. Enrichissement de order_items ─────────────────────────────────────────

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS module_size         VARCHAR(20) DEFAULT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS module_measurements JSONB       DEFAULT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS module_instructions TEXT        DEFAULT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_combo       JSONB       DEFAULT NULL;

-- ── 3. Suppression des colonnes couture obsolètes (si elles existent) ────────
-- Anciennes colonnes du modèle « tissu + modèle » qu'on abandonne.

ALTER TABLE orders      DROP COLUMN IF EXISTS module_type;
ALTER TABLE orders      DROP COLUMN IF EXISTS module_fabric_id;
ALTER TABLE orders      DROP COLUMN IF EXISTS module_fabric_type;
ALTER TABLE orders      DROP COLUMN IF EXISTS module_size;
ALTER TABLE orders      DROP COLUMN IF EXISTS module_retouche;
ALTER TABLE orders      DROP COLUMN IF EXISTS module_qty_meters;
ALTER TABLE orders      DROP COLUMN IF EXISTS module_accessories;
ALTER TABLE orders      DROP COLUMN IF EXISTS confection_type;
ALTER TABLE orders      DROP COLUMN IF EXISTS confection_instructions;
ALTER TABLE orders      DROP COLUMN IF EXISTS confection_delay_days;
ALTER TABLE orders      DROP COLUMN IF EXISTS confection_artisan_id;

ALTER TABLE order_items DROP COLUMN IF EXISTS module_type;
ALTER TABLE order_items DROP COLUMN IF EXISTS module_fabric_id;
ALTER TABLE order_items DROP COLUMN IF EXISTS module_fabric_type;
ALTER TABLE order_items DROP COLUMN IF EXISTS module_retouche;
ALTER TABLE order_items DROP COLUMN IF EXISTS module_qty_meters;
ALTER TABLE order_items DROP COLUMN IF EXISTS module_accessories;

-- ── 4. Suppression des tables devenues inutiles ──────────────────────────────

DROP TABLE IF EXISTS fabrics;
DROP TABLE IF EXISTS garment_models;
```

**Note importante** : ajouter cette migration dans `scripts/fix-schema.js` pour exécution automatique au boot, pas seulement la déposer en `migrations/`.

---

## 2. Diff sur `routes/orders/create.js`

Suppression d'environ 30 lignes, alignement sur le nouveau modèle.

### Bloc destructuration (lignes 51-57)

```diff
-      module_type,
-      module_fabric_id,
-      module_fabric_type,
-      module_size,
-      module_retouche = false,
-      module_qty_meters,
-      module_accessories,
+      // (rien ici — les champs couture passent maintenant via items[i])
```

### Bloc destructuration `confection_*` (lignes 46-49)

```diff
-      confection_type = 'aucun',
-      confection_instructions,
-      confection_delay_days = 0,
-      confection_artisan_id,
+      // (supprimé — la confection est portée par le produit lui-même via
+      // is_komerce_made, confection_partner_id, confection_delay_days)
```

### Validation `MODULE_TYPES` (lignes 25-26 et 74-77)

```diff
-// MODULE_TYPES — sous-types pour le module couture uniquement
-const MODULE_TYPES = ['ready_made', 'fabric_only', 'custom_from_fabric'];
+// (constante supprimée — le sous-type couture n'existe plus,
+// le client choisit un produit catalogue puis donne taille/mensurations)
```

```diff
-    if (module_type && !MODULE_TYPES.includes(module_type)) {
-      await client.query('ROLLBACK');
-      return res.status(400).json({ error: `module_type invalide. Valeurs : ${MODULE_TYPES.join(', ')}` });
-    }
+    // Validation déplacée par item — voir boucle items ci-dessous
```

### Validation par item (à ajouter dans la boucle `for (const item of items)`)

```javascript
// Si l'item est un produit Komerce confectionné, valider la cohérence taille / mensurations
if (product.is_komerce_made && product.available_sizes && product.available_sizes.length > 0) {
  const wantsCustom = item.module_size === 'custom';
  const standardSize = item.module_size && item.module_size !== 'custom';

  // Vérifier que la taille demandée fait partie des tailles disponibles
  if (item.module_size && !product.available_sizes.includes(item.module_size)) {
    await client.query('ROLLBACK');
    return res.status(400).json({
      error: `Taille "${item.module_size}" non disponible pour ${product.name}`,
      tailles_disponibles: product.available_sizes,
    });
  }

  // Si custom, mensurations obligatoires
  if (wantsCustom && (!item.module_measurements || typeof item.module_measurements !== 'object')) {
    await client.query('ROLLBACK');
    return res.status(400).json({
      error: `Mensurations requises pour ${product.name} (taille sur mesure)`,
      requis: ['tour_poitrine_cm', 'tour_taille_cm', 'longueur_totale_cm'],
    });
  }

  // Validation minimale du contenu des mensurations
  if (wantsCustom) {
    const m = item.module_measurements;
    const required = ['tour_poitrine_cm', 'tour_taille_cm', 'longueur_totale_cm'];
    for (const key of required) {
      if (typeof m[key] !== 'number' || m[key] < 30 || m[key] > 250) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Mensuration ${key} invalide (attendu : nombre entre 30 et 250 cm)`,
        });
      }
    }
  }
}
```

### Bloc INSERT INTO orders (lignes 261-322)

```diff
   `INSERT INTO orders (
      id, reference, user_id, recipient_id, relais_id,
      tracking_phone,
      total_kmf, total_eur,
      payment_mode, payment_status, stripe_payment_id,
      cash_ref_code, pickup_code,
      status,
-     confection_type, confection_instructions,
-     confection_delay_days, confection_artisan_id,
-     module_type, module_fabric_id, module_fabric_type,
-     module_size, module_retouche, module_qty_meters, module_accessories,
      order_occasion,
      cost_estimated_kmf, margin_estimated_pct,
      discount_pct, discount_kmf, loyalty_label,
      destination_island, routing_mode, transit_hub
    ) VALUES (
-     $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',
-     $14,$15,$16,$17,
-     $18,$19,$20,$21,$22,$23,$24,
-     $25,$26,$27,$28,$29,$30,$31,$32,$33
+     $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',
+     $14,$15,$16,$17,$18,$19,$20,$21,$22
    ) RETURNING *`,
   [
     uuidv4(), reference, req.user.id, recipient_id, relais?.id || null,
     tracking_phone || null,
     total_kmf, parseFloat((total_kmf / eurKmf).toFixed(2)),
     payment_mode,
     creditApplied > 0 && total_kmf === 0 ? 'paid' : 'pending',
     stripe_payment_intent || null,
     cash_ref_code,
     pickup_code,
-    confection_type,
-    confection_instructions || null,
-    confection_delay_days,
-    confection_artisan_id || null,
-    module_type || null,
-    module_fabric_id || null,
-    module_fabric_type || null,
-    module_size || null,
-    module_retouche,
-    module_qty_meters || null,
-    module_accessories ? JSON.stringify(module_accessories) : null,
     order_occasion || null,
     Math.round(cost_estimated),
     Number(margin_est),
     discountPct,
     discountKmf,
     loyaltyLabel,
     routing.destination_island,
     routing.routing_mode,
     routing.transit_hub,
   ]
```

### Bloc INSERT INTO order_items (lignes 350-376)

```diff
       await client.query(
         `INSERT INTO order_items (
            order_id, product_id, quantity, price_kmf,
-           module_type, module_fabric_id, module_fabric_type,
-           module_size, module_retouche, module_qty_meters, module_accessories,
+           module_size, module_measurements, module_instructions,
            variant_combo
-         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
+         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
         [
           order.id,
           item.product_id,
           qty,
           product.price_kmf,
-          item.module_type || null,
-          item.module_fabric_id || null,
-          item.module_fabric_type || null,
           item.module_size || null,
-          item.module_retouche || false,
-          item.module_qty_meters || null,
-          item.module_accessories ? JSON.stringify(item.module_accessories) : null,
+          item.module_measurements ? JSON.stringify(item.module_measurements) : null,
+          item.module_instructions || null,
           item.variant_combo && typeof item.variant_combo === 'object' && !Array.isArray(item.variant_combo)
             ? JSON.stringify(item.variant_combo)
             : null,
         ]
       );
```

---

## 3. Diff sur `routes/modules.js`

### Suppression des endpoints `/fabrics` et `/models`

Lignes ~110-174 : supprimer entièrement les blocs `router.get('/fabrics', ...)` et `router.get('/models', ...)`. Et plus bas, les `router.post('/fabrics', ...)` et `router.post('/models', ...)`.

### Simplification du `MODULES_REGISTRY.couture`

```diff
   couture: {
     label:       'Couture & Tenues sur mesure',
     emoji:       '✂️',
     phase:       1,
     disponible:  true,
-    description: 'Tissu au choix (Wax, Bazin, Dentelle, Mousseline…) + confection Deira selon mensurations client. Retouche légère possible au relais Anjouan.',
+    description: 'Modèles confectionnés par nos couturiers partenaires sous notre marque maison. Tailles standard ou sur mesure selon vos mensurations.',
     delai_sup_jours: 5,
     besoin_couvert: 'Couture professionnelle sur mesure · tissus haut de gamme indisponibles localement',
-    inputs_requis: ['fabric_id', 'module_size'],
-    inputs_optionnels: ['module_instructions', 'module_qty_meters', 'module_accessories'],
+    inputs_requis: ['module_size'],
+    inputs_optionnels: ['module_measurements', 'module_instructions'],
   },
```

### Simplification ou suppression de `POST /api/modules/price`

Le calcul de prix complexe (tissu × mètres + confection) n'a plus de sens : le prix d'un produit confection est désormais simplement `products.price_kmf`. L'endpoint `/price` peut soit :

- **Être supprimé** (préférable — son code source devient sans objet)
- **Être conservé en stub** qui répond « le prix est celui du produit »

Recommandation : **suppression**. Le frontend récupère le prix via `GET /api/products/:id` comme pour n'importe quel autre produit.

---

## 4. Diff sur `routes/orders/detail.js`

### Lecture order_items (lignes 39-51)

```diff
     const { rows: items } = await db.query(
       `SELECT
          oi.id, oi.quantity, oi.price_kmf,
-         oi.module_type, oi.module_fabric_type,
-         oi.module_size, oi.module_retouche,
-         oi.module_qty_meters, oi.module_accessories,
-         p.name AS product_name, p.image_url, p.category, p.has_couture, p.emoji
+         oi.module_size, oi.module_measurements, oi.module_instructions,
+         oi.variant_combo,
+         p.name AS product_name, p.image_url, p.category, p.emoji,
+         p.is_komerce_made, p.confection_delay_days
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = $1
        ORDER BY oi.created_at ASC`,
       [order.id]
     );
```

### Lecture commande (lignes 96-99)

```diff
       confection_type:       order.confection_type,
-      module_type:           order.module_type,
-      module_size:           order.module_size,
-      module_retouche:       order.module_retouche,
+      // (retirés — info maintenant portée par order_items individuellement)
```

---

## 5. Le formulaire mensurations côté client

### Mesures universelles (toujours demandées si `module_size === 'custom'`)

| Champ | Type | Validation |
|---|---|---|
| `tour_poitrine_cm` | nombre | 30-250 |
| `tour_taille_cm` | nombre | 30-250 |
| `tour_hanches_cm` | nombre | 30-250 |
| `longueur_totale_cm` | nombre | 30-250 |

### Mesures spécifiques (variables selon `products.size_guide_extra`)

Le produit définit ce qu'il demande en plus. Exemples :

```jsonb
-- Salouva traditionnelle
size_guide_extra = {
  "longueur_pagne_cm": {
    "label": "Longueur du pagne",
    "hint": "De l'épaule au sol, pagne drapé"
  }
}

-- Kandzu homme
size_guide_extra = {
  "tour_cou_cm": {
    "label": "Tour de cou",
    "hint": "Pour ajuster le col"
  },
  "longueur_manche_cm": {
    "label": "Longueur de manche",
    "hint": "De l'épaule au poignet"
  }
}

-- Robe simple sans spécificité
size_guide_extra = NULL  -- aucune mesure spécifique demandée
```

### Format de soumission du client

```json
POST /api/orders
{
  "items": [
    {
      "product_id": "uuid-de-la-salouva",
      "quantity": 1,
      "module_size": "custom",
      "module_measurements": {
        "tour_poitrine_cm": 92,
        "tour_taille_cm": 76,
        "tour_hanches_cm": 98,
        "longueur_totale_cm": 145,
        "longueur_pagne_cm": 180
      },
      "module_instructions": "doublure ivoire si possible"
    },
    {
      "product_id": "uuid-du-kandzu",
      "quantity": 1,
      "module_size": "L",       // taille standard, pas de mensurations
      "module_instructions": "pour mon mari"
    },
    {
      "product_id": "uuid-d-une-paire-de-sandales",
      "quantity": 1
      // aucun champ module_* — produit catalogue normal
    }
  ],
  "relais_id": "...",
  "payment_mode": "stripe_eur",
  "...": "..."
}
```

Une commande, trois articles, deux personnes (madame avec sa salouva sur mesure, monsieur avec son kandzu en taille L), plus un produit catalogue lambda. Le tout passe.

---

## 6. Ce qu'il vous reste à décider plus tard

Pas urgent, mais à garder en tête :

- Le **nom commercial** de votre marque maison. Le code n'attend rien de vous, vous changerez juste le label affiché côté boutique le jour J.
- L'**UI admin** pour saisir `confection_partner_id` (création/gestion des couturiers partenaires). Pas dans cette migration — chantier séparé.
- Le **vocabulaire** des mensurations : faut-il dire « tour de poitrine » ou « tour de buste » ? Les Comoriennes utilisent peut-être un mot précis. À valider avec le terrain.
- La **photo du modèle porté** (par votre couturier, ou un mannequin) versus la **photo à plat** : décision marketing.

---

## Récapitulatif

| Action | Fichier | Effort |
|---|---|---|
| Migration SQL | `migrations/068_couture_simplification.sql` (à créer) | déjà rédigée ci-dessus |
| Mise à jour schema canonique | `db/schema.sql` (à mettre à jour pour refléter le nouvel état) | 15 min |
| Diff create.js | `routes/orders/create.js` | 30 min |
| Diff modules.js | `routes/modules.js` | 30 min |
| Diff detail.js | `routes/orders/detail.js` | 10 min |
| Validators | `validators/index.js` (mise à jour `orders.create` pour les nouveaux champs item-level) | 20 min |
| Tests | adapter `tests/integration/api.test.js` | 30 min |
| **Total** | | **~2h30** |

Vous pouvez confier ce document tel quel à un dev. Il a tout ce qu'il faut.
