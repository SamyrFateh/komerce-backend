-- Migration 122 — Lot 6 : nettoyage des résidus DDL laissés par deux preuves REAL_DB
--
-- Origine constatée dans le dump Railway du 2026-08-01 :
--   * tests/integration/r6-crash-window.test.js créait public.outbox_events
--     sans supprimer la table ; aucun runtime ne la consomme.
--   * tests/integration/txg01-pricing-matrices.test.js renommait la table
--     publique pricing_matrices_audit en pricing_matrices_audit_hidden ; un
--     bootstrap ultérieur recréait alors pricing_matrices_audit, laissant deux
--     tables et deux séquences.
--
-- Cette migration est conservative :
--   * elle refuse de supprimer outbox_events si une ligne non identifiée comme
--     preuve R6 existe ;
--   * elle fusionne les lignes de la table cachée vers la table canonique avant
--     suppression, sans dupliquer une ligne d'audit identique ;
--   * elle restaure les noms canoniques de séquence, contraintes et index.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.outbox_events') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.outbox_events
      WHERE COALESCE(payload->>'reason', '') <> 'r6-proof'
    ) THEN
      RAISE EXCEPTION
        'migration 122: outbox_events contient des lignes non-R6 ; abandon pour éviter une perte de données';
    END IF;

    DROP TABLE public.outbox_events;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.pricing_matrices_audit_hidden') IS NOT NULL
     AND to_regclass('public.pricing_matrices_audit') IS NULL THEN
    ALTER TABLE public.pricing_matrices_audit_hidden
      RENAME TO pricing_matrices_audit;
  ELSIF to_regclass('public.pricing_matrices_audit_hidden') IS NOT NULL
        AND to_regclass('public.pricing_matrices_audit') IS NOT NULL THEN
    INSERT INTO public.pricing_matrices_audit (
      matrix_type,
      category,
      old_value,
      new_value,
      changed_by,
      change_reason,
      created_at
    )
    SELECT
      h.matrix_type,
      h.category,
      h.old_value,
      h.new_value,
      h.changed_by,
      h.change_reason,
      h.created_at
    FROM public.pricing_matrices_audit_hidden h
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.pricing_matrices_audit c
      WHERE c.matrix_type = h.matrix_type
        AND c.category = h.category
        AND c.old_value = h.old_value
        AND c.new_value = h.new_value
        AND c.changed_by IS NOT DISTINCT FROM h.changed_by
        AND c.change_reason IS NOT DISTINCT FROM h.change_reason
        AND c.created_at = h.created_at
    );

    DROP TABLE public.pricing_matrices_audit_hidden;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.pricing_matrices_audit') IS NULL THEN
    RAISE EXCEPTION 'migration 122: pricing_matrices_audit canonique absente';
  END IF;

  IF to_regclass('public.pricing_matrices_audit_id_seq1') IS NOT NULL
     AND to_regclass('public.pricing_matrices_audit_id_seq') IS NULL THEN
    ALTER SEQUENCE public.pricing_matrices_audit_id_seq1
      RENAME TO pricing_matrices_audit_id_seq;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.pricing_matrices_audit'::regclass
      AND conname = 'pricing_matrices_audit_pkey1'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.pricing_matrices_audit'::regclass
      AND conname = 'pricing_matrices_audit_pkey'
  ) THEN
    ALTER TABLE public.pricing_matrices_audit
      RENAME CONSTRAINT pricing_matrices_audit_pkey1 TO pricing_matrices_audit_pkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.pricing_matrices_audit'::regclass
      AND conname = 'pricing_matrices_audit_matrix_type_check1'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.pricing_matrices_audit'::regclass
      AND conname = 'pricing_matrices_audit_matrix_type_check'
  ) THEN
    ALTER TABLE public.pricing_matrices_audit
      RENAME CONSTRAINT pricing_matrices_audit_matrix_type_check1
      TO pricing_matrices_audit_matrix_type_check;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.pricing_matrices_audit'::regclass
      AND conname = 'pricing_matrices_audit_changed_by_fkey1'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.pricing_matrices_audit'::regclass
      AND conname = 'pricing_matrices_audit_changed_by_fkey'
  ) THEN
    ALTER TABLE public.pricing_matrices_audit
      RENAME CONSTRAINT pricing_matrices_audit_changed_by_fkey1
      TO pricing_matrices_audit_changed_by_fkey;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_pma_created
  ON public.pricing_matrices_audit (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pma_matrix_cat
  ON public.pricing_matrices_audit (matrix_type, category);

DO $$
DECLARE
  seq_name text;
  max_id bigint;
BEGIN
  seq_name := pg_get_serial_sequence('public.pricing_matrices_audit', 'id');
  SELECT MAX(id) INTO max_id FROM public.pricing_matrices_audit;

  IF seq_name IS NOT NULL THEN
    IF max_id IS NULL THEN
      PERFORM setval(seq_name::regclass, 1, false);
    ELSE
      PERFORM setval(seq_name::regclass, max_id, true);
    END IF;
  END IF;
END
$$;

COMMIT;
