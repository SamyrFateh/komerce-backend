# Doctrine historique — Classification des coûts N1 / N2 / N3

> **Statut** : SUPERSEDED depuis le 2026-09-08.  
> **Doctrine canonique active** : `DOCTRINE_CLASSIFICATION_CHARGES.md`.

Les labels **N1 / N2 / N3 ne sont plus des catégories métier ni UI canoniques de Komerce**.

La classification canonique repose désormais sur trois dimensions indépendantes :

```text
nature       = VARIABLE | FIXED
périmètre    = DIRECT | MUTUALIZED
allocation   = article | commande | colis | shipment | marché | usage | GMV | période | autre clé gouvernée
```

Règles essentielles :

- une charge mutualisée peut être fixe ou variable ;
- un coût commande/colis n'est pas « mutualisé » par nature ;
- les charges fixes ne sont pas une dette du SKU ;
- le prix est borné par la réalité du marché ;
- les articles génèrent la contribution et le portefeuille absorbe collectivement les charges fixes directes et mutualisées ;
- les anciens champs techniques `n1`, `n2`, `n3` peuvent subsister transitoirement comme aliases de compatibilité interne, sans être exposés comme doctrine métier.

Ne pas ajouter de nouvelles références métier à N1/N2/N3. Toute nouvelle documentation et toute nouvelle UI doivent suivre `DOCTRINE_CLASSIFICATION_CHARGES.md`.