-- @migration 380_retire_mark_ordered_capability.sql
-- @domain market-delegation / purchasing
-- L1 #3314: order "ordered" is derived from payment confirmation. No executable
-- mark-ordered route or capability remains. Staging has no historical grants to retain.
DO $$
BEGIN
  DELETE FROM public.membership_capabilities
    WHERE capability = 'execution.order.mark_ordered';
  DELETE FROM public.assignment_capability_ceiling
    WHERE capability = 'execution.order.mark_ordered';
  DELETE FROM public.ceiling_template_capabilities
    WHERE capability = 'execution.order.mark_ordered';
  DELETE FROM public.market_delegation_audit
    WHERE capability = 'execution.order.mark_ordered';
  DELETE FROM public.capability_registry
    WHERE capability = 'execution.order.mark_ordered';
END $$;
