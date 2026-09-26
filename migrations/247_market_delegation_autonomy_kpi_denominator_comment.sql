-- @migration 247_market_delegation_autonomy_kpi_denominator_comment.sql
-- @domain    market-delegation
-- @purpose   Corrige le COMMENT ON TABLE capability_registry posé par la
--            migration 246 : celui-ci disait "Only class DELEGATION belongs
--            to the autonomy KPI denominator", ce qui est imprécis depuis que
--            market_config.update (class DELEGATION, delegation_mode
--            CENTRAL_ONLY) a été fermé par cette même migration 246. Le
--            dénominateur réel est class DELEGATION AND authority_scope
--            MARKET AND delegation_mode DELEGABLE (cf.
--            config/market-delegation-capabilities.js::autonomyDenominator
--            et services/capability-registry.js::autonomyRate).
--            Append-only : aucune donnée touchée, seul le commentaire de
--            doctrine posé sur la table est corrigé.

COMMENT ON TABLE capability_registry IS
  'Executable market-delegation registry. Only rows where class = DELEGATION AND authority_scope = MARKET AND delegation_mode = DELEGABLE belong to the autonomy KPI denominator. market_config.update: CENTRAL_HELD by design, no local field to delegate (see migration 246) — excluded from the denominator despite class = DELEGATION.';
