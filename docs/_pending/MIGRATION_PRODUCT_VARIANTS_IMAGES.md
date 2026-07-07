# Migration — product_variants : image_url → images[]

> **Lot 2** de la roadmap modale mobile enrichie.
> **Validé par :** propriétaire (session 07/07/2026).
> **Pré-requis :** aucun backend déployé sans ce doc relu et validé.

---

## Contexte

Chaque variante couleur = 1 SKU avec sa propre fiche (stock, prix, photos).
Le schéma actuel expose un seul `image_url` par variante.
Le frontend Lot 2 attend un tableau `images[]` pour alimenter le carousel
quand l'utilisateur clique un swatch couleur.

## Schéma actuel (Vague 3, ROADMAP_MODAL_TEMU.md)

```
product_variants
├── id            UUID PK
├── product_id    UUID FK → products.id
├── variant_type  TEXT        ("Couleur", "Taille", "Pointure"…)
├── variant_value TEXT        ("Bleu", "M", "42"…)
├── sku           TEXT UNIQUE
├── stock         INTEGER     (0 = rupture)
├── price_override INTEGER NULL (si NULL → prix parent)
└── image_url     TEXT NULL    ← SINGULIER
```

## Schéma cible

```
product_variants
├── …colonnes existantes inchangées…
├── image_url     TEXT NULL    ← CONSERVÉ (rétro-compat, déprécié)
└── images        JSONB DEFAULT '[]'   ← NOUVEAU
```

### Règles

1. `images` est un tableau JSON de strings (URLs).
2. Si `images` est vide ou absent, le frontend utilise `image_url` en fallback.
3. Si `image_url` est renseigné mais `images` est vide, la raffinerie
   copie `image_url` dans `images[0]` à l'écriture (normalisation).
4. À terme, `image_url` sera supprimé une fois tous les consommateurs migrés.

## Migration SQL

```sql
-- 1. Ajout colonne
ALTER TABLE product_variants
  ADD COLUMN images JSONB NOT NULL DEFAULT '[]';

-- 2. Backfill : copier image_url existant dans images[0]
UPDATE product_variants
  SET images = jsonb_build_array(image_url)
  WHERE image_url IS NOT NULL
    AND image_url != ''
    AND images = '[]';

-- 3. Index GIN pour requêtes futures sur images
CREATE INDEX idx_product_variants_images
  ON product_variants USING GIN (images);
```

## Endpoint `/api/products/:id/variants`

Le contrat de sortie passe de :

```json
{
  "Couleur": [
    { "value": "Bleu", "stock": 5, "price_kmf": 2500, "image_url": "https://…" }
  ]
}
```

à :

```json
{
  "Couleur": [
    {
      "value": "Bleu",
      "sku": "PROD-001-BLEU",
      "stock": 5,
      "price_kmf": 2500,
      "images": ["https://…/face.jpg", "https://…/dos.jpg"],
      "image_url": "https://…/face.jpg"
    }
  ]
}
```

`image_url` reste présent pour rétro-compat (= `images[0]`).

## Raffinerie (normalisation entrante)

Quelle que soit la forme du contenu source reçu du fournisseur :

| Cas reçu | Sortie normalisée |
|---|---|
| `image_url` seul | `images: [image_url]` |
| `images: [url1, url2]` | tel quel |
| `images: []` + `image_url` | `images: [image_url]` |
| ni `images` ni `image_url` | `images: []` (le frontend affiche un pill texte) |

Le frontend ne gère **aucun** fallback de format — c'est la responsabilité
exclusive de la raffinerie.

## Frontend (déjà livré)

`_renderVariants` dans `b-modal-product.js` :
- Lit `opt.images[]` en priorité, fallback `opt.image_url`
- Swatch `.k-sku` = miniature 60×60 de `images[0]`
- Clic → `buildCarouselSlides()` avec les images du SKU
- Gestion stock (`k-sku--out`, `k-sku-slash`) et prix (`price_kmf`)

## Invariants checkout (cf. ROADMAP_MODAL_TEMU.md R1/R3/R5)

- **R1** : la variante choisie (SKU) doit être transmise à `submitOrder`
- **R3** : le stock de la variante est re-vérifié côté serveur au moment du paiement
- **R5** : si le stock tombe à 0 entre la sélection et le paiement, l'ordre est refusé proprement

Ces invariants sont déjà documentés mais pas encore câblés — à traiter
dans un lot séparé (checkout-variants).

## Rollback

```sql
ALTER TABLE product_variants DROP COLUMN IF EXISTS images;
```

Le frontend retombe sur `image_url` automatiquement (fallback codé).
