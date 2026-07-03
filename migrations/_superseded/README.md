# _superseded/

Fichiers retirés du scanner de migrations (AUD-10, 2026-06-24).

## Pourquoi ils sont ici et non supprimés

Conservés pour traçabilité git — le contenu est identique aux versions renommées
(083-086) ou aux variantes déjà appliquées en production.

## Ne pas remettre dans migrations/

Le scanner `scripts/run-migrations.js` exclut ce sous-dossier (il ne scanne que
`migrations/*.sql`, pas les sous-dossiers). Ces fichiers ne seront jamais rejoués.

## Détail des déplacements

| Fichier original | Remplacé par | Raison |
|---|---|---|
| `014_transaction_documents.sql` | `083_transaction_documents.sql` | Collision numéro — AUD-10 |
| `072_jwt_revocation.sql` | `084_jwt_revocation.sql` | Collision numéro — AUD-10 |
| `073_shared_cart_cash_contributions.sql` | `085_shared_cart_cash_contributions.sql` | Collision numéro — AUD-10 |
| `074_invoice_public_token.sql` | `086_invoice_public_token.sql` | Collision numéro — AUD-10 |
| `072a_boutique_category_images.sql` | `072_boutique_category_images.sql` | Variante déjà appliquée |
| `072b_boutique_category_images.sql` | `072_boutique_category_images.sql` | Variante déjà appliquée |
| `073a_shared_cart_cash_contributions.sql` | `073_pickup_verify_attempts.sql` + 085 | Variante déjà appliquée |
| `073b_shared_cart_cash_contributions.sql` | idem | Variante déjà appliquée |
| `RECONCILIATION_PROD.sql` | `099_drop_zombie_shared_cart_commitments.sql` | Script hors-runner rejoué par erreur après que 080 avait déjà tourné entièrement — a ressuscité `shared_cart_commitments` + `shared_cart_contributions.commitment_id` hors de `schema_migrations` (juillet 2026). Ne doit plus JAMAIS être rejoué : voir `scripts/check-schema-resurrection.js` (gate anti-résurrection ajouté suite à cet incident). |
