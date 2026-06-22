-- ============================================================================
-- AUD-10 — Réalignement schema_migrations après dédoublonnage des numéros
-- ============================================================================
-- NE PAS exécuter via scripts/run-migrations.js (ce fichier n'a pas de préfixe
-- NNN_ donc le runner l'ignore — voir MIGRATION_RE dans run-migrations.js).
--
-- À LANCER MANUELLEMENT sur la DB live, AVANT de déployer le commit qui
-- renomme les fichiers dans migrations/. Sinon : le prochain run de
-- scripts/migrate.js verra les nouveaux noms comme "non appliqués" et
-- rejouera les 4 migrations (idempotentes ici, donc sans danger réel, mais
-- à éviter — ce n'est pas le comportement attendu).
--
-- Usage : psql "$DATABASE_URL" -f migrations/AUD-10_rename_tracking_fix.sql
-- Idempotent : peut être relancé sans risque (UPDATE ... WHERE filename = ancien).
-- ============================================================================

UPDATE schema_migrations SET filename = '083_transaction_documents.sql'
  WHERE filename = '014_transaction_documents.sql';

UPDATE schema_migrations SET filename = '084_jwt_revocation.sql'
  WHERE filename = '072_jwt_revocation.sql';

UPDATE schema_migrations SET filename = '085_shared_cart_cash_contributions.sql'
  WHERE filename = '073_shared_cart_cash_contributions.sql';

UPDATE schema_migrations SET filename = '086_invoice_public_token.sql'
  WHERE filename = '074_invoice_public_token.sql';

-- Vérification : doit renvoyer 4 lignes avec les nouveaux noms si tout est OK,
-- 0 ligne si déjà appliqué, et JAMAIS les anciens noms en double.
SELECT filename, applied_at FROM schema_migrations
  WHERE filename IN (
    '083_transaction_documents.sql',
    '084_jwt_revocation.sql',
    '085_shared_cart_cash_contributions.sql',
    '086_invoice_public_token.sql'
  )
  ORDER BY filename;
