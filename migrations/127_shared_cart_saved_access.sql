-- ============================================================
-- Migration 127 : shared_cart_saved_access (Amendement V2 §D)
-- Date : août 2026
--
-- CONTEXTE :
--   Bibliothèque « Mes listes ». Jusqu'ici, l'entrée propriétaire
--   (Mon Komerce > Mes listes) ouvrait automatiquement la liste la plus
--   récente créée par l'utilisateur (group-side-cart.js::
--   activateOwnerMostRecentList) — aucune notion de liste *reçue* et
--   conservée n'existait. L'amendement V2 §D introduit une vraie
--   bibliothèque avec deux sections :
--     - Créées par moi   → shared_carts.organizer_user_id = viewer
--     - Partagées avec moi → listes reçues (lien token) qu'un
--       destinataire a explicitement choisi de conserver.
--
--   Un destinataire ne devient jamais membre d'une liste par simple
--   consultation du lien : la sauvegarde est un acte explicite (POST
--   /api/shared-carts/save), jamais automatique/implicite (pas de
--   "signet" posé en arrière-plan à l'ouverture d'un lien). Cette table
--   est donc la seule source de vérité de "quelles listes reçues cet
--   utilisateur a choisi de retrouver plus tard".
--
--   Le créateur d'une liste n'a pas besoin d'une ligne ici pour ses
--   propres listes (déjà couvertes par organizer_user_id) — le service
--   (shared-cart-library.js::saveSharedCartForUser) refuse explicitement
--   qu'un créateur sauvegarde sa propre liste, pour ne jamais dupliquer
--   la même liste dans les deux sections de la bibliothèque. Pas de
--   contrainte SQL dédiée : la règle dépend d'une jointure vers
--   shared_carts (organizer_user_id), hors de portée d'un simple CHECK.
--
-- IDEMPOTENT via IF NOT EXISTS / garde interne.
-- ============================================================

SET client_encoding = 'UTF8';
SET search_path = public;

CREATE TABLE IF NOT EXISTS shared_cart_saved_access (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    shared_cart_id uuid NOT NULL,
    saved_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shared_cart_saved_access_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'shared_cart_saved_access_user_id_fkey'
  ) THEN
    ALTER TABLE shared_cart_saved_access
      ADD CONSTRAINT shared_cart_saved_access_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'shared_cart_saved_access_shared_cart_id_fkey'
  ) THEN
    ALTER TABLE shared_cart_saved_access
      ADD CONSTRAINT shared_cart_saved_access_shared_cart_id_fkey
      FOREIGN KEY (shared_cart_id) REFERENCES shared_carts(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Un utilisateur ne sauvegarde une même liste qu'une fois — un second
-- POST /save est idempotent côté service (voir shared-cart-library.js),
-- cette contrainte est le filet de sécurité au niveau base.
CREATE UNIQUE INDEX IF NOT EXISTS shared_cart_saved_access_unique
  ON shared_cart_saved_access (user_id, shared_cart_id);

-- Section "Partagées avec moi" triée par sauvegarde la plus récente.
CREATE INDEX IF NOT EXISTS idx_shared_cart_saved_access_user
  ON shared_cart_saved_access (user_id, saved_at DESC);

DO $$
BEGIN
  RAISE NOTICE 'Migration 127 OK — shared_cart_saved_access prête (bibliothèque Mes listes, V2-D).';
END $$;
