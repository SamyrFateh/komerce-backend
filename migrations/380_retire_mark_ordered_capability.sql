-- @migration 380_retire_mark_ordered_capability.sql
-- @domain market-delegation
-- L1 a removed every mark-ordered writer: this capability must no longer be delegable.
-- Keep immutable audit meaning after deleting the registry row; legacy_capability
-- is an historical snapshot only and is never an authorization input.
ALTER TABLE public.market_delegation_audit
  ADD COLUMN IF NOT EXISTS retired_capability text;

UPDATE public.market_delegation_audit
   SET retired_capability = capability
 WHERE capability = 'execution.order.mark_ordered'
   AND retired_capability IS NULL;

-- Future deletion of retired capabilities must not erase old audit events.
-- Keep the surviving FK for active capabilities, nulling only deleted references.
ALTER TABLE public.market_delegation_audit
  DROP CONSTRAINT IF EXISTS market_delegation_audit_capability_fkey;
ALTER TABLE public.market_delegation_audit
  ADD CONSTRAINT market_delegation_audit_capability_fkey
  FOREIGN KEY (capability) REFERENCES public.capability_registry(capability)
  ON DELETE SET NULL;

-- Revoke grants before removing ceilings: the existing ceiling guard blocks
-- deleting a still-active capability when memberships retain active grants.
DELETE FROM public.membership_capabilities
 WHERE capability = 'execution.order.mark_ordered';
DELETE FROM public.assignment_capability_ceiling
 WHERE capability = 'execution.order.mark_ordered';
DELETE FROM public.ceiling_template_capabilities
 WHERE capability = 'execution.order.mark_ordered';
DELETE FROM public.capability_registry
 WHERE capability = 'execution.order.mark_ordered';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.capability_registry WHERE capability='execution.order.mark_ordered')
    OR EXISTS (SELECT 1 FROM public.membership_capabilities WHERE capability='execution.order.mark_ordered')
    OR EXISTS (SELECT 1 FROM public.assignment_capability_ceiling WHERE capability='execution.order.mark_ordered')
    OR EXISTS (SELECT 1 FROM public.ceiling_template_capabilities WHERE capability='execution.order.mark_ordered')
  THEN
    RAISE EXCEPTION 'MARK_ORDERED_CAPABILITY_NOT_RETIRED';
  END IF;
END $$;
