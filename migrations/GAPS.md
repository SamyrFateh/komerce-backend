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

## Collisions de même préfixe (dette explicite, NON résolue côté fichiers)

> Ajouté le 2026-06-28, suite à audit du gate `I-BACK-10` (`scripts/audit-backend-arch.js`).
> `I-BACK-10` ne détectait jusqu'ici que le motif bare-vs-décrit (060/061, déjà
> nettoyé) — il était aveugle au motif ci-dessous, qui est pourtant celui d'AUD-10.
> La détection a été généralisée (voir le script) pour couvrir tout préfixe
> partagé par 2 fichiers décrits. Pour ne pas faire échouer la CI sur une dette
> déjà connue, les 4 préfixes ci-dessous sont listés en accepté tant qu'ils ne
> sont pas nettoyés.
>
> **Contexte exact** : AUD-10 (clos 2026-06-23, `STATUS.md` §AUD-10) a renommé
> `014_transaction_documents.sql` → `083_...`, `072_jwt_revocation.sql` → `084_...`,
> `073_shared_cart_cash_contributions.sql` → `085_...`, `074_invoice_public_token.sql`
> → `086_...`. Les fichiers renommés (083-086) ont bien été créés, **mais les
> anciens fichiers (014/072/073/074) n'ont jamais été supprimés du disque** —
> ils coexistent, identiques byte-à-byte, avec leur copie renommée. Tant que
> `migrations/AUD-10_rename_tracking_fix.sql` n'est pas confirmé exécuté sur la
> DB live (Railway), ne pas supprimer ces fichiers : `run-migrations.js` les
> rejouerait sinon comme "non appliqués" au prochain déploiement.
>
> **Action de clôture réelle** (une fois Railway confirmé à jour) :
> 1. `psql "$DATABASE_URL" -f migrations/AUD-10_rename_tracking_fix.sql` (si pas déjà fait — idempotent)
> 2. `git rm migrations/014_transaction_documents.sql migrations/072_jwt_revocation.sql migrations/073_shared_cart_cash_contributions.sql migrations/074_invoice_public_token.sql`
> 3. Retirer les 4 lignes `COLLISION:` ci-dessous.
>
> **Format** : `- COLLISION: \`TOKEN\` = fichier_a.sql, fichier_b.sql`. L'allowlist
> est ancrée sur l'ENSEMBLE EXACT des fichiers, pas sur le préfixe seul — si un
> 3ᵉ fichier (ou un fichier différent) apparaît un jour sous le même préfixe,
> ce n'est PAS automatiquement couvert : `audit-backend-arch.js` compare
> l'ensemble réellement présent sur disque à l'ensemble documenté ici, et
> bloque sur tout écart (fichier en plus = nouvelle collision réelle, jamais
> absorbée silencieusement par l'amnistie d'un ancien préfixe).
>
> Bonus relevé au passage (hors scope I-BACK-10, pas une collision de numéro) :
> `072_boutique_category_images.sql`, `072a_boutique_category_images.sql` et
> `072b_boutique_category_images.sql` sont un contenu quasi-identique (seul le
> commentaire d'en-tête change) — cruft d'itération, à dédoublonner séparément
> sans urgence (idempotent, ne casse rien). Idem `073a`/`073b_shared_cart_cash_contributions.sql`
> face à `085_shared_cart_cash_contributions.sql`.

- COLLISION: `014` = 014_parcels_final_cleanup.sql, 014_transaction_documents.sql
- COLLISION: `072` = 072_boutique_category_images.sql, 072_jwt_revocation.sql
- COLLISION: `073` = 073_pickup_verify_attempts.sql, 073_shared_cart_cash_contributions.sql
- COLLISION: `147` = 147_catalog_global_access_grants.sql, 147_relais_visit_identity.sql
- COLLISION: `074` = 074_add_v4_status_values.sql, 074_invoice_public_token.sql
- COLLISION: `119` = 119_drop_orders_pickup_code.sql, 119_economic_variables_to_finance_config.sql
- COLLISION: `128` = 128_shared_cart_items_sellable_unit.sql, 128_shared_list_pickup_code_recipient.sql
