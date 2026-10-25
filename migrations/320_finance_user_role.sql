-- @migration 320_finance_user_role.sql
-- @domain    auth-identity
-- @purpose   Role finance for a named canonical internal portal identity.
--            Grant finance.read / finance.act ONLY by separate, auditable
--            market-delegation membership (role alone grants no authority).
--
-- Additive, no backfill, no RESET, no bootstrap user, no implicit capability.
-- sourcing is already introduced by migration 148a and agent_transitaire is
-- already part of the historical user_role enum.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'finance';
