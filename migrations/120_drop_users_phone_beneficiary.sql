-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 120 — Retrait de users.phone_beneficiary (Lot 3 — convergence retrait)
--
-- Contexte : jusqu'à Lot 3, le checkout boutique permettait de désigner un
-- bénéficiaire de retrait distinct du payeur (bloc « Qui récupère ? »,
-- champs recipient_name/recipient_phone envoyés à /api/orders). Le
-- middleware auth-guest.js mettait alors à jour users.phone_beneficiary à
-- chaque commande, et services/notifications/internals.js (pickRecipients)
-- s'en servait pour notifier séparément payeur et bénéficiaire sur
-- plusieurs événements (order_created, order_shipped, order_delivered).
--
-- Lot 3 supprime ce concept : l'identité OTP vérifiée de l'acheteur est
-- désormais l'unique source de nom/téléphone pour le retrait.
-- users.phone_beneficiary n'est plus écrite ni lue nulle part dans le code
-- applicatif (vérifié par grep exhaustif — middleware/auth-guest.js,
-- middleware/require-verified-identity.js, services/notifications/
-- {internals,order,parcel}.js et routes/orders/{status,cancel}.js ont tous
-- été nettoyés de toute référence à cette colonne).
--
-- Hors périmètre, non touché par cette migration :
--   - recipients (table) / orders.recipient_id — bénéficiaire logistique
--     du colis, concept distinct du retrait, conservé.
--   - shared_carts.beneficiary_user_id / beneficiary_*_snapshot —
--     bénéficiaire du panier groupé, concept distinct, conservé.
--   - users.phone_payer — téléphone dédié au paiement, concept distinct
--     (payeur), conservé.
--
-- ⚠️ PRÉREQUIS avant d'appliquer cette migration en production :
--   1. Confirmer que le déploiement contenant le nettoyage applicatif Lot 3
--      (routes/orders/create.js, b-checkout.js, validators/index.js,
--      auth-guest.js, notifications/internals.js) tourne depuis assez
--      longtemps pour qu'aucun chemin résiduel ne dépende encore de la
--      colonne.
--   2. Les ADD COLUMN IF NOT EXISTS défensifs pour phone_beneficiary dans
--      scripts/fix-schema.js et bootstrap/startup-migrations.js ont été
--      retirés dans le même lot — ne pas les réintroduire après cette
--      migration sans revoir la décision.
--
-- Réversibilité : DROP COLUMN est destructif. En cas de doute, commenter le
-- DROP et ne garder que le DROP de l'index (recréable sans perte si on
-- change d'avis), le temps de valider en prod.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Index legacy — plus aucun code ne fait de lookup sur
--    users.phone_beneficiary (pickRecipients ne s'en sert plus).
DROP INDEX IF EXISTS public.idx_users_phone_beneficiary;

-- 2) Colonne retirée. IF EXISTS pour idempotence si déjà appliqué.
ALTER TABLE public.users
  DROP COLUMN IF EXISTS phone_beneficiary;
