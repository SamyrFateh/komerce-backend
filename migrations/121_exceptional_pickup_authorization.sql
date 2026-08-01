-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 121 — Autorisation nominative de retrait exceptionnel (Lot 5)
--
-- Contexte : le code secret (migrations 049/070/073, convergence 119) reste le
-- moyen normal de retrait. Ce lot ajoute un mécanisme de substitution
-- exceptionnel pour le cas où le code n'a pas été reçu ou transmis : l'acheteur
-- authentifié autorise nominativement une personne (prénoms + nom tels qu'ils
-- figurent sur sa pièce d'identité), et l'agent relais compare aveuglément
-- après contrôle visuel de la pièce.
--
-- Frontières (feat/exceptional-pickup-authorization) :
--   auth-identity possède `user_pickup_authorizations` — la préférence
--   courante du compte (une par utilisateur, versionnée).
--   logistics (feature `pickup`, cf. features/logistics.feature.js) possède la
--   procédure de remise elle-même et son propre compteur de tentatives, séparé
--   de pickup_secret_attempts pour ne jamais mélanger les deux moyens de
--   retrait dans un même compteur/blocage.
--
-- Komerce n'est pas encore en production (staging de préproduction sans
-- données métier historiques) — migration franche, sans backfill.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── auth-identity : autorisation nominative courante du compte ─────────────
-- Une seule ligne active par utilisateur (PK sur user_id — remplacement =
-- UPDATE de la ligne existante, jamais d'historique multi-lignes ici ; le
-- comptage de version + l'audit alerts suffisent, cf. §4/§18 du lot).
CREATE TABLE IF NOT EXISTS user_pickup_authorizations (
  user_id                  UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  authorized_given_names   TEXT,
  authorized_family_name   TEXT,
  normalized_given_names   TEXT,
  normalized_family_name   TEXT,
  version                  INTEGER NOT NULL DEFAULT 0,
  is_active                BOOLEAN NOT NULL DEFAULT false,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at               TIMESTAMPTZ,
  CONSTRAINT user_pickup_authorizations_active_names_required CHECK (
    NOT is_active OR (
      authorized_given_names IS NOT NULL AND authorized_family_name IS NOT NULL AND
      normalized_given_names IS NOT NULL AND normalized_family_name IS NOT NULL
    )
  )
);

COMMENT ON TABLE user_pickup_authorizations IS
  'Lot 5 — autorisation nominative de retrait exceptionnel. Préférence courante '
  'du compte (auth-identity), consultée au moment exact de la remise par '
  'services/pickup-secret-service.js (logistics). Ne stocke jamais de donnée de '
  'pièce d''identité (pas de copie, numéro, date d''expiration ou signature).';

-- ── logistics (pickup) : compteur dédié, séparé de pickup_secret_attempts ──
-- Décision explicite (§13 du lot) : ne pas réutiliser pickup_secret_attempts /
-- pickup_secret_blocked_until, qui gouvernent le moyen normal (code). Un agent
-- qui échoue la procédure exceptionnelle ne doit pas bloquer accidentellement
-- le retrait par code, et inversement.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS exceptional_pickup_attempts       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exceptional_pickup_blocked_until  TIMESTAMPTZ;

-- Identification de la méthode de remise effective (§11 du lot :
-- "AUTHORIZED_NAME_ID_CHECK"). Nullable et non rétro-rempli : les remises déjà
-- passées (par code) ne sont pas réécrites, conformément à la doctrine
-- "aucune commande existante n'est réécrite" (§7). NULL reste donc lisible
-- comme "retrait par code (par défaut, historique)" pour toute commande
-- collectée avant ce lot ou via le chemin normal.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS pickup_collected_via TEXT;

-- ── Preuve minimale et durable portée par le scan de collecte ──────────────
-- Le scan reste l'événement opérationnel immuable de la remise.
--
-- Pour le retrait exceptionnel, il conserve uniquement :
--   - la méthode de remise ;
--   - la version de l'autorisation effectivement contrôlée ;
--   - l'attestation booléenne du contrôle visuel de la pièce.
--
-- Aucun nom, numéro de pièce, copie ou signature n'est conservé.
ALTER TABLE scans
  ADD COLUMN IF NOT EXISTS pickup_method TEXT,
  ADD COLUMN IF NOT EXISTS authorization_version INTEGER,
  ADD COLUMN IF NOT EXISTS document_checked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pickup_relais_id UUID REFERENCES relais(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_scans_pickup_method'
  ) THEN
    ALTER TABLE scans
      ADD CONSTRAINT chk_scans_pickup_method
      CHECK (
        pickup_method IS NULL
        OR pickup_method IN ('PICKUP_CODE', 'AUTHORIZED_NAME_ID_CHECK')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_scans_exceptional_pickup_proof'
  ) THEN
    ALTER TABLE scans
      ADD CONSTRAINT chk_scans_exceptional_pickup_proof
      CHECK (
        (
          pickup_method = 'AUTHORIZED_NAME_ID_CHECK'
          AND authorization_version IS NOT NULL
          AND authorization_version > 0
          AND document_checked = true
          AND pickup_relais_id IS NOT NULL
        )
        OR
        (
          pickup_method IS DISTINCT FROM 'AUTHORIZED_NAME_ID_CHECK'
          AND authorization_version IS NULL
          AND document_checked = false
          AND (
            pickup_method IS NULL
            OR pickup_relais_id IS NOT NULL
          )
        )
      );
  END IF;
END
$$;

COMMENT ON COLUMN scans.pickup_method IS
  'Méthode ayant authentifié la remise : PICKUP_CODE ou AUTHORIZED_NAME_ID_CHECK.';

COMMENT ON COLUMN scans.authorization_version IS
  'Version de l’autorisation nominative contrôlée lors d’un retrait exceptionnel. Aucun nom conservé.';

COMMENT ON COLUMN scans.document_checked IS
  'Attestation de l’agent : pièce officielle avec photo contrôlée visuellement. Aucune copie conservée.';

COMMENT ON COLUMN scans.pickup_relais_id IS
  'Relais dans lequel la remise physique a été enregistrée.';

COMMIT;
