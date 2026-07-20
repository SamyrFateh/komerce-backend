# T-007 — Escalade D5 condition 4 : décision produit requise

## Constat

`product.series` n'existe pas dans le contrat Product Detail v1 :
- Fixture `golden-elite-pro-detail.js` : `product` contient id, reference, name, description, category, subcategory — **pas de `series`**
- `services/catalog-product-detail.js` : ne mappe aucun champ `series`
- Schéma DB (`migrations/`) : aucune colonne `series` ou `product_line`
- Doctrine `DOCTRINE_PRODUCT_DETAIL_CONTRACT.md` : ne mentionne pas `series`

## Ce que la maquette montre

Ligne 2 du hero : « GOLDEN PERFORMANCE SERIES » en 10px / 500 / muted.
Source : label de démo dans la maquette, pas une donnée contractuelle.

## Options disponibles (sans modifier le contrat)

**Option A — Utiliser `product.subcategory`**
Disponible dans le contrat (`"subcategory": "chaussures-football"`).
Rendu normalisé : « CHAUSSURES FOOTBALL » uppercase.
Avantage : zéro modification du contrat ni du backend.
Limite : sémantique de catégorie, pas de série commerciale.

**Option B — Utiliser `product.brand` (via `services/catalog-product-detail.js` L193)**
`brand` est extrait du profil produit backend mais n'est pas dans le contrat v1 front.
Il faudrait l'ajouter au contrat v1 (backend + fixture + schema Ajv) — modification de contrat.

**Option C — Masquer silencieusement la ligne 2**
Si aucune donnée disponible, la ligne reste cachée.
La maquette montrait un label démo — en prod réel, la ligne est vide.
L'écart M6 est résolu en acceptant que la ligne 2 n'affiche rien jusqu'à ce que le contrat l'expose.

**Option D — Ajouter `product.series` au contrat v1**
Extension propre du contrat (backend service + migration DB + fixture + Ajv schema).
Hors périmètre de ce chantier CSS/JS-renderer uniquement.

## Recommandation

**Option A à court terme** (subcategory normalisée, zéro modification de contrat).
**Option D à moyen terme** si Komerce veut exposer des noms de collection commerciale réels.

## Décision requise

Quelle option retiens-tu pour T-007 ?
- A : subcategory normalisée (modif renderer uniquement, 0 contrat)
- C : masquer silencieusement (0 code, 0 contrat — M6 reste dette visuelle)
- D : ajouter product.series au contrat v1 (hors périmètre chantier actuel)
