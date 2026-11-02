-- 362 — Fournisseurs locaux du Hub : périmètre propre, sans toucher au catalogue global.
-- Un fournisseur créé par le Hub (agent_hub) porte owner_scope = 'hub' ; NULL = catalogue global (admin).
-- Un fournisseur du Hub est local ou WhatsApp, jamais une intégration API.
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS owner_scope text NULL;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS created_by uuid NULL REFERENCES public.users(id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_owner_scope_check') THEN
    ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_owner_scope_check
      CHECK (owner_scope IS NULL OR (owner_scope = 'hub' AND platform IN ('local', 'whatsapp') AND auto_order = FALSE));
  END IF;
END $$;

COMMENT ON COLUMN public.suppliers.owner_scope IS 'NULL = catalogue global (admin) ; hub = fournisseur local créé par le Hub, périmètre Hub uniquement';
