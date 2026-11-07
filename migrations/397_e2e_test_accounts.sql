-- @migration 397_e2e_test_accounts.sql
-- @domain    recette
-- @purpose   Marqueur canonique des comptes de test E2E (identite posee par staging-e2e-provision, jamais par une route).
--
--   Un compte present ici voit les commandes de simulation (orders.simulation_scope) dans les files du workspace
--   operations (Expedier, Relais Receptionner / Distribuer). Table vide = personne ne voit la simulation.
--   Aucune route ni aucun ecran n'ecrit ici. Ne touche pas users.
--
-- Additive, idempotente.

CREATE TABLE IF NOT EXISTS public.e2e_test_accounts (
  user_id    uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.e2e_test_accounts IS
  'Comptes de test E2E. Ecrit uniquement par scripts/recette/staging-e2e-provision.js. Lecture : services/simulation-visibility.js.';
