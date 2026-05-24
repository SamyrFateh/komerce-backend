# Gaps de numérotation des migrations

> Documenté le 2026-05-24 — ARCH-2

Ce fichier documente les trous connus dans la séquence de numérotation des migrations.
Ces gaps sont intentionnels ou le résultat de l'historique du projet — **ne pas créer de migrations pour les combler**.

## Gaps identifiés

| Plage manquante | Entre | Explication |
|-----------------|-------|-------------|
| 026 → 032 | `025_add_subcategory.sql` → `033_parametres_extension.sql` | Migrations issues d'une branche abandonnée ou réorganisation de chantier |
| 053 → 056 | `052_contributions_optional_amount.sql` → `057_cart_event_shares.sql` | Idem |
| 063 | `062_boutique_categories_seed.sql` → `064_enrich_test_products.sql` | Idem |

## Doublons de numéro (suffixe b/c)

Certains numéros ont des variantes avec suffixe lettre — c'est intentionnel (corrections ou compléments mineurs appliqués dans la même plage) :

- `015`, `015b`
- `016`, `016b`
- `022`, `022b`
- `023`, `023b`
- `035`, `035b`, `035c`
- `036`, `036b`
- `037`, `037b`
- `060`, `060_add_pending_at_confirmed_at` (collision A4 — dette documentée, non bloquante)
- `061`, `061_boutique_categories` (idem)

## Règle

Ne jamais renommer ou supprimer une migration existante sans audit DB réel préalable.
Voir `docs/chantier/STATUS.md` section A4 pour le contexte des collisions 060/061.
