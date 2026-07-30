-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 119 — Retrait de orders.pickup_code (Lot 2 — convergence retrait)
--
-- Contexte : jusqu'à Lot 2, orders.pickup_code stockait le code de retrait
-- EN CLAIR, écrit par 6 chemins différents (create.js, shared-cart-lifecycle,
-- order-status-machine, payment-cash-confirm, cash-operations,
-- parcel-auto-create-service) et lu directement par autant de lecteurs
-- (scan-operations, tracking.js /verify-pickup, dashboards, tracking client).
--
-- Lot 2 a fait converger tous ces canaux vers un secret haché+salé
-- (pickup_secret_hash / pickup_secret_salt / pickup_secret_last4, cf. migration
-- des tables pickup_print_tokens/pickup_reveal_codes, 070) via le point
-- d'entrée idempotent ensureSecretGenerated() de
-- services/pickup-secret-service.js. orders.pickup_code n'est plus écrite ni
-- lue nulle part dans le code applicatif (vérifié par grep exhaustif —
-- seules restent des références à parcels.pickup_code, hors périmètre, une
-- colonne distincte sur une autre table).
--
-- ⚠️ PRÉREQUIS avant d'appliquer cette migration en production :
--   1. Confirmer que le déploiement contenant la convergence Lot 2 tourne
--      depuis assez longtemps pour qu'aucune commande active ne dépende
--      encore d'un pickup_code en clair non repris par le backfill.
--   2. Avoir exécuté (ou laissé tourner) scripts/fix-schema.js au moins une
--      fois post-déploiement : il backfill désormais pickup_secret_hash pour
--      toute commande 'available' qui n'en a pas encore (ancien comportement :
--      backfill de pickup_code en clair, remplacé — cf. commentaire dans le
--      script).
--   3. Ne PAS confondre avec parcels.pickup_code, qui reste hors périmètre et
--      n'est pas touché ici.
--
-- Réversibilité : DROP COLUMN est destructif. En cas de doute, commenter le
-- DROP et ne garder que le DROP des deux index (qui eux peuvent être recréés
-- sans perte si on change d'avis), le temps de valider en prod.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Index legacy sur la colonne en clair — plus aucun code ne fait de lookup
--    direct sur orders.pickup_code (converge vers pickup_secret_last4 +
--    vérification par hash, cf. services/pickup-secret-service.js).
DROP INDEX IF EXISTS public.idx_orders_pickup_code;
DROP INDEX IF EXISTS public.uq_orders_pickup_active;

-- 2) Colonne retirée. IF EXISTS pour idempotence si déjà appliqué.
ALTER TABLE public.orders
  DROP COLUMN IF EXISTS pickup_code;
