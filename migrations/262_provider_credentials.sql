-- @migration 262_provider_credentials.sql
-- @domain    sourcing
-- @purpose   Coffre applicatif des credentials fournisseurs (Provider Credential Authority).
--            Une ligne = un credential versionné ; les secrets sont une enveloppe JSON chiffrée
--            AES-256-GCM sous la clé maître serveur KOMERCE_PROVIDER_CREDENTIALS_MASTER_KEY
--            (jamais en base). sourcing_sources.credential_ref devient le lien canonique.
--
-- Additif et idempotent. Aucune donnée existante modifiée ; aucun secret migré ici.
-- Les sessions OAuth restent dans supplier_oauth_connections (backend OAuth spécialisé) :
-- une ligne auth_type='oauth' référence la session via oauth_session_key, sans token.

CREATE TABLE IF NOT EXISTS public.provider_credentials (
  credential_ref        text PRIMARY KEY,
  provider_key          text NOT NULL,
  auth_type             text NOT NULL,
  status                text NOT NULL DEFAULT 'pending',
  envelope_ciphertext   text,
  envelope_iv           text,
  envelope_tag          text,
  key_version           integer,
  oauth_session_key     text,
  provider_account_label text,
  access_expires_at     timestamptz,
  refresh_expires_at    timestamptz,
  replaces_ref          text REFERENCES public.provider_credentials(credential_ref),
  created_by            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  activated_at          timestamptz,
  rotated_at            timestamptz,
  revoked_at            timestamptz,
  last_tested_at        timestamptz,
  last_test_status      text,
  last_test_code        text,
  CONSTRAINT provider_credentials_ref_chk CHECK (credential_ref ~ '^cred_[a-f0-9]{32}$'),
  CONSTRAINT provider_credentials_provider_chk CHECK (provider_key ~ '^[a-z0-9_-]{2,64}$'),
  CONSTRAINT provider_credentials_auth_type_chk
    CHECK (auth_type IN ('api_key', 'client_credentials', 'oauth')),
  CONSTRAINT provider_credentials_status_chk
    CHECK (status IN ('pending', 'active', 'superseded', 'revoked', 'failed')),
  CONSTRAINT provider_credentials_test_status_chk
    CHECK (last_test_status IS NULL OR last_test_status IN ('ok', 'failed')),
  -- Enveloppe complète ou absente (crypto-shredding des credentials non actifs).
  CONSTRAINT provider_credentials_envelope_triplet_chk CHECK (
    (envelope_ciphertext IS NULL AND envelope_iv IS NULL AND envelope_tag IS NULL AND key_version IS NULL)
    OR (envelope_ciphertext IS NOT NULL AND envelope_iv IS NOT NULL AND envelope_tag IS NOT NULL AND key_version IS NOT NULL)
  ),
  -- Un credential oauth ne porte jamais de token : la session vit dans le backend OAuth.
  CONSTRAINT provider_credentials_oauth_shape_chk CHECK (
    (auth_type = 'oauth' AND envelope_ciphertext IS NULL AND oauth_session_key IS NOT NULL)
    OR (auth_type <> 'oauth' AND oauth_session_key IS NULL)
  ),
  -- Seuls pending/active peuvent encore porter un secret.
  CONSTRAINT provider_credentials_shredded_chk CHECK (
    status IN ('pending', 'active') OR envelope_ciphertext IS NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_provider_credentials_provider
  ON public.provider_credentials (provider_key, status);

COMMENT ON TABLE public.provider_credentials IS
  'Coffre des credentials fournisseurs. Enveloppe AES-256-GCM (IV aléatoire, AAD = provider + credential_ref + version + auth_type) sous clé maître serveur. Jamais relue par le navigateur. Enveloppe effacée dès que le credential est remplacé, révoqué ou en échec.';
COMMENT ON COLUMN public.provider_credentials.oauth_session_key IS
  'Pour auth_type=oauth : clé de la session chiffrée dans supplier_oauth_connections (aucun token ici).';

-- Lien canonique source → credential (la colonne existe depuis la migration 226, inutilisée).
-- NOT VALID : n'impose rien aux éventuelles valeurs historiques, protège toute nouvelle écriture.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'sourcing_sources_credential_ref_fk'
       AND conrelid = 'public.sourcing_sources'::regclass
  ) THEN
    ALTER TABLE public.sourcing_sources
      ADD CONSTRAINT sourcing_sources_credential_ref_fk
      FOREIGN KEY (credential_ref) REFERENCES public.provider_credentials(credential_ref)
      NOT VALID;
  END IF;
END $$;

-- Trace des opérations credential dans le journal des contrôles fournisseur.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.sourcing_provider_control_events'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%capability%'
  LOOP
    EXECUTE format('ALTER TABLE public.sourcing_provider_control_events DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.sourcing_provider_control_events
  ADD CONSTRAINT sourcing_provider_control_events_capability_check
  CHECK (capability IN ('discovery', 'sync', 'import', 'production', 'lifecycle', 'credentials'));
