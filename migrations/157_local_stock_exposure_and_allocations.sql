-- @migration 157_local_stock_exposure_and_allocations.sql
-- @domain    local-stock
-- @purpose   Vague 2, D2 — commercial_exposure sur local_stock (même patron
--            que services/physical_offers), et cycle allocate -> consume |
--            release pour que "Disponible maintenant" ne mente jamais.
-- @added-header 2026-08-28
-- Idempotent : peut être rejoué sans risque.
--
-- Décision (micro-arbitrage validé 2026-08-28) : PAS de qty_allocated
-- matérialisé sur local_stock. La vérité reste qty_physical ; l'allocation
-- active se calcule depuis local_stock_allocations (consumed_at IS NULL
-- AND released_at IS NULL). Matérialiser une somme n'est justifié que par
-- un besoin de performance réel, pas encore constaté.
--
-- PAS de TTL / expiration automatique / cron dédié local-stock. Le release
-- se déclenche uniquement sur un événement RÉEL déjà émis par orders
-- (annulation, échec de paiement, abandon cash) — jamais une horloge
-- inventée par ce domaine. Explicitement PAS branché sur unsold-resolution
-- (qui traite un étage différent : stock déjà CONSOMMÉ, commande jamais
-- retirée — pas un échec avant consommation).
--
-- Une allocation n'a qu'une seule issue terminale (consumed_at XOR
-- released_at, jamais les deux) — même discipline que la contrainte
-- inquiries_exactly_one_target de la migration 156, appliquée ici en
-- invariant applicatif (voir services/local-stock-service.js) plutôt qu'un
-- CHECK db : les deux colonnes sont NULL par défaut (état "actif"), un CHECK
-- interdisant simultanément les deux non-null coderait un état qui ne peut
-- de toute façon être atteint que par un bug applicatif — la garde
-- `WHERE consumed_at IS NULL AND released_at IS NULL` sur chaque mutation
-- est la vraie protection (idempotence), pas une contrainte de forme.

-- ── local_stock — exposition ────────────────────────────────────────────
-- Même patron que services.commercial_exposure / physical_offers.commercial_
-- exposure (et les rails transport, DOCTRINE_TRANSPORT_RAILS.md) : donnée
-- vivante, valorisée, jamais exposée tant que ce champ reste DISABLED.

ALTER TABLE public.local_stock
  ADD COLUMN IF NOT EXISTS commercial_exposure text NOT NULL DEFAULT 'DISABLED';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'local_stock_exposure_valid'
  ) THEN
    ALTER TABLE public.local_stock
      ADD CONSTRAINT local_stock_exposure_valid
      CHECK (commercial_exposure IN ('DISABLED', 'ENABLED'));
  END IF;
END $$;

COMMENT ON COLUMN public.local_stock.commercial_exposure IS
  'Même patron que services/physical_offers.commercial_exposure. Badge '
  '"Disponible maintenant" affiché seulement si ENABLED — et seulement si '
  'le cycle allocate/consume/release (local_stock_allocations) garantit '
  'que la promesse est tenue (pas de survente).';

-- ── local_stock_allocations ──────────────────────────────────────────────
-- Une ligne par (commande, local_stock) engagé. allocated_at posé à la
-- création de la commande (avant tout paiement) — c'est ce qui empêche la
-- survente dès l'instant T, indépendamment du mode de paiement.

CREATE TABLE IF NOT EXISTS public.local_stock_allocations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_stock_id uuid NOT NULL REFERENCES public.local_stock(id) ON DELETE CASCADE,
  order_id       uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  quantity       integer NOT NULL CHECK (quantity > 0),
  allocated_at   timestamp with time zone NOT NULL DEFAULT now(),
  consumed_at    timestamp with time zone,
  released_at    timestamp with time zone
);

COMMENT ON TABLE public.local_stock_allocations IS
  'Engagement d''une commande sur un stock local, avant confirmation du '
  'paiement. Cycle : allocate (création commande) -> consume (paiement '
  'confirmé, qty_physical réellement décrémenté) OU release (annulation, '
  'échec, abandon). Toute mutation consume/release est gardée par '
  'WHERE consumed_at IS NULL AND released_at IS NULL — idempotente par '
  'construction, un webhook rejoué ou une annulation en double sont des '
  'no-op, jamais une double consommation ou un double release.';

COMMENT ON COLUMN public.local_stock_allocations.quantity IS
  'Quantité allouée par cet order_id pour ce local_stock_id. Un même '
  'order_id peut porter plusieurs lignes (un produit local par item de '
  'commande), jamais fusionnées — chaque allocation garde sa propre issue.';

-- Disponibilité = qty_physical - SUM(allocations actives). Index pour que
-- cette agrégation (appelée à chaque tentative d'allocation, sous verrou
-- FOR UPDATE sur local_stock) reste rapide même à volume.
CREATE INDEX IF NOT EXISTS idx_local_stock_allocations_active
  ON public.local_stock_allocations (local_stock_id)
  WHERE consumed_at IS NULL AND released_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_local_stock_allocations_order
  ON public.local_stock_allocations (order_id);
