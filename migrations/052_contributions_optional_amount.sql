-- ============================================================
-- Migration 052 — Contributions : suggestions sans montant
-- ============================================================
-- P1.2 : la page publique workspace doit accepter une "idée"
-- ou un "message" sans montant obligatoire (suggestion pure).
--
-- Changements :
--   1. intended_amount_kmf devient NULLABLE
--   2. Contrainte CHECK : NULL OU > 0 (pas de 0 ni négatif)
--   3. Ajout colonnes : suggestion TEXT, message TEXT, kind
--   4. Type kind : 'suggestion' | 'intention' | 'message'
--      → suggestion = idée produit sans montant
--      → intention  = montant promis (ancien comportement)
--      → message    = juste un mot/encouragement
-- ============================================================

-- 1) Nullable intended_amount_kmf
ALTER TABLE collective_workspace_contributions
  ALTER COLUMN intended_amount_kmf DROP NOT NULL;

-- 2) Remplacer la contrainte CHECK
ALTER TABLE collective_workspace_contributions
  DROP CONSTRAINT IF EXISTS collective_workspace_contributions_intended_amount_kmf_check;

ALTER TABLE collective_workspace_contributions
  ADD CONSTRAINT collective_workspace_contributions_intended_amount_kmf_check
  CHECK (intended_amount_kmf IS NULL OR intended_amount_kmf > 0);

-- 3) Ajouter les colonnes texte
ALTER TABLE collective_workspace_contributions
  ADD COLUMN IF NOT EXISTS suggestion TEXT,
  ADD COLUMN IF NOT EXISTS message    TEXT,
  ADD COLUMN IF NOT EXISTS kind       TEXT NOT NULL DEFAULT 'intention';

-- 4) Contrainte de cohérence : au moins un des trois doit être renseigné
ALTER TABLE collective_workspace_contributions
  DROP CONSTRAINT IF EXISTS collective_workspace_contributions_content_check;

ALTER TABLE collective_workspace_contributions
  ADD CONSTRAINT collective_workspace_contributions_content_check
  CHECK (
    intended_amount_kmf IS NOT NULL
    OR (suggestion IS NOT NULL AND length(trim(suggestion)) > 0)
    OR (message IS NOT NULL AND length(trim(message)) > 0)
  );

-- 5) Contrainte sur kind (CHECK seulement, pas un type ENUM nouveau)
ALTER TABLE collective_workspace_contributions
  DROP CONSTRAINT IF EXISTS collective_workspace_contributions_kind_check;

ALTER TABLE collective_workspace_contributions
  ADD CONSTRAINT collective_workspace_contributions_kind_check
  CHECK (kind IN ('suggestion', 'intention', 'message'));
