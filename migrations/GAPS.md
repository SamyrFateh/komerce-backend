# Gaps de numérotation des migrations

> Documenté le 2026-05-24 — ARCH-2  
> Doctrine réauditée le 2026-08-29 — Debt Zero / immutabilité des migrations

Ce fichier documente les trous et collisions historiques connus dans la séquence de migrations.
Les fichiers SQL déjà versionnés sont **immuables** : ne jamais les renommer, les supprimer ni les réécrire pour corriger uniquement leur numérotation.

## Gaps identifiés

| Plage manquante | Entre | Explication |
|-----------------|-------|-------------|
| 026 → 032 | `025_add_subcategory.sql` → `033_parametres_extension.sql` | Migrations issues d'une branche abandonnée ou réorganisation de chantier |
| 053 → 056 | `052_contributions_optional_amount.sql` → `057_cart_event_shares.sql` | Idem |
| 063 | `062_boutique_categories_seed.sql` → `064_enrich_test_products.sql` | Idem |

## Variantes suffixées intentionnelles

Certains numéros ont des variantes avec suffixe lettre. Elles font partie de l'historique publié et restent immuables :

- `015`, `015b`
- `016`, `016b`
- `022`, `022b`
- `023`, `023b`
- `035`, `035b`, `035c`
- `036`, `036b`
- `037`, `037b`
- `060`, `060_add_pending_at_confirmed_at` (historique A4)
- `061`, `061_boutique_categories` (historique A4)

## Doctrine des collisions de même préfixe

Le gate `I-BACK-10` groupe les migrations par token numérique + suffixe lettre optionnel (`014`, `072`, `072a`, `015b`, etc.).

Les sept ensembles ci-dessous ont été réaudités le 2026-08-29. Ils sont désormais classés comme **historique immuable explicitement documenté**, et non comme dette à résoudre par renommage ou suppression.

Cette classification ne relâche pas le garde-fou :

- l'exception porte sur **l'ensemble exact des fichiers**, jamais sur le préfixe seul ;
- si un troisième fichier apparaît sous un préfixe documenté, `I-BACK-10` doit bloquer ;
- si un fichier documenté disparaît ou est remplacé, `I-BACK-10` doit bloquer ;
- toute collision non documentée doit bloquer ;
- toute nouvelle migration doit utiliser un token libre ou un suffixe intentionnel unique dès sa création.

### AUD-10 — clarification de doctrine

AUD-10 avait historiquement prévu de renommer certaines migrations puis de réaligner `schema_migrations` :

- `014_transaction_documents.sql` ↔ `083_transaction_documents.sql`
- `072_jwt_revocation.sql` ↔ `084_jwt_revocation.sql`
- `073_shared_cart_cash_contributions.sql` ↔ `085_shared_cart_cash_contributions.sql`
- `074_invoice_public_token.sql` ↔ `086_invoice_public_token.sql`

Le dépôt dispose encore de `migrations/AUD-10_rename_tracking_fix.sql`, qui documente cette ancienne stratégie. La doctrine actuelle d'immuabilité est plus stricte : **aucune suppression ou renommage supplémentaire des fichiers déjà versionnés n'est autorisé**. Le helper AUD-10 reste un artefact historique et ne constitue plus une action Debt Zero à exécuter pour faire disparaître les collisions du dépôt.

### Cruft distinct, hors I-BACK-10

`072_boutique_category_images.sql`, `072a_boutique_category_images.sql` et `072b_boutique_category_images.sql` ont un contenu proche, tout comme `073a` / `073b_shared_cart_cash_contributions.sql` face à `085_shared_cart_cash_contributions.sql`. Ils portent toutefois des tokens distincts et ne constituent pas des collisions au sens de `I-BACK-10`. Tout dédoublonnage éventuel relève d'un chantier séparé et doit respecter l'immuabilité.

## Ensembles historiques immuables réaudités

> Format consommé par `scripts/audit-backend-arch.js` et `scripts/migration-collision-policy.js` :  
> `- COLLISION: \`TOKEN\` = fichier_a.sql, fichier_b.sql`

- COLLISION: `014` = 014_parcels_final_cleanup.sql, 014_transaction_documents.sql
- COLLISION: `072` = 072_boutique_category_images.sql, 072_jwt_revocation.sql
- COLLISION: `073` = 073_pickup_verify_attempts.sql, 073_shared_cart_cash_contributions.sql
- COLLISION: `074` = 074_add_v4_status_values.sql, 074_invoice_public_token.sql
- COLLISION: `119` = 119_drop_orders_pickup_code.sql, 119_economic_variables_to_finance_config.sql
- COLLISION: `128` = 128_shared_cart_items_sellable_unit.sql, 128_shared_list_pickup_code_recipient.sql
- COLLISION: `147` = 147_catalog_global_access_grants.sql, 147_relais_visit_identity.sql
- COLLISION: `157` = 157_local_stock_exposure_and_allocations.sql, 157_providers_services_media.sql
