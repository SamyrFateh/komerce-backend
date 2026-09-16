# LOT — Catalogue Business Truth

Date: 2026-09-16

Décision: le pilotage Catalogue expose `Sourcé → Prêt à publier → Publié → Visible`.

- `Visible` est calculé avec le même prédicat que la boutique publique, par marché.
- `Visible` implique une unité statiquement vendable ; un SKU fournisseur actif/en stock doit porter une SOI minimale valide.
- le checkout conserve son preflight dynamique stock/prix/fret/provider.
- Catalogue N2 = `Vue catalogue | Produits`.
- Sources appartient à Opérations/Sourcing ; Catalogue pays appartient à Marchés.
- Raffinerie et états techniques restent des drill-downs, pas le vocabulaire principal.

Ce fichier est un enregistrement d'audit du lot, pas une nouvelle doctrine propriétaire.
