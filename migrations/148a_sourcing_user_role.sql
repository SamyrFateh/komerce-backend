-- Préparation LOT 4E — rôle sourcing avant la migration 149.
--
-- La DB historique possède user_role sans la valeur `sourcing`, tandis que
-- 149_sourcing_workspace_business_refs.sql bootstrappe les grants via
-- `WHERE role = 'sourcing'`.
--
-- Le runner Komerce exécute chaque fichier dans sa propre transaction. Ce
-- fichier est volontairement trié après 148 et avant 149 afin que la nouvelle
-- valeur enum soit COMMIT avant son utilisation typée par la migration 149.

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'sourcing';
