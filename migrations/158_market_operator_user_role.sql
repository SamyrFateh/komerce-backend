-- LOT 4U — dedicated country dashboard operator role.
-- Read-only dashboard authority is still granted exclusively through
-- operator_market_scopes; this enum value alone grants no market access.

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'market_operator';
